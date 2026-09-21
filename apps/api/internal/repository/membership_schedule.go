package repository

import (
	"errors"
	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
	"sort"
	"time"
)

func (r *MemoryMembershipRepository) ScheduleMembership(next model.UserMembership, duration time.Duration, now time.Time) (model.UserMembership, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	start := now
	for _, m := range r.memberships {
		if next.OrderID != "" && m.OrderID == next.OrderID {
			return m, nil
		}
		if m.UserID == next.UserID && (m.Status == model.MembershipStatusActive || m.Status == model.MembershipStatusScheduled) && m.ExpiresAt.After(start) {
			start = m.ExpiresAt
		}
	}
	next.ID = "mem_" + randomRepositoryHex(12)
	next.StartedAt = start
	next.ExpiresAt = start.Add(duration)
	next.CreatedAt = now
	next.UpdatedAt = now
	next.Status = model.MembershipStatusScheduled
	// An expired-but-unswept active row still owns the slot until cleanup.
	occupied := false
	for _, m := range r.memberships {
		if m.UserID == next.UserID && m.Status == model.MembershipStatusActive {
			occupied = true
		}
	}
	if !start.After(now) && !occupied {
		next.Status = model.MembershipStatusActive
	}
	r.memberships[next.ID] = next
	return next, nil
}
func (r *GormMembershipRepository) ScheduleMembership(next model.UserMembership, duration time.Duration, now time.Time) (model.UserMembership, error) {
	var result model.UserMembership
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", "membership:"+next.UserID).Error; err != nil {
			return err
		}
		if next.OrderID != "" {
			err := tx.First(&result, "order_id = ?", next.OrderID).Error
			if err == nil {
				return nil
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}
		var terms []model.UserMembership
		if err := tx.Where("user_id = ? AND status IN ?", next.UserID, []string{model.MembershipStatusActive, model.MembershipStatusScheduled}).Find(&terms).Error; err != nil {
			return err
		}
		start := now
		occupied := false
		for _, m := range terms {
			if m.ExpiresAt.After(start) {
				start = m.ExpiresAt
			}
			if m.Status == model.MembershipStatusActive {
				occupied = true
			}
		}
		next.ID = "mem_" + randomRepositoryHex(12)
		next.StartedAt = start
		next.ExpiresAt = start.Add(duration)
		next.CreatedAt = now
		next.UpdatedAt = now
		next.Status = model.MembershipStatusScheduled
		if !start.After(now) && !occupied {
			next.Status = model.MembershipStatusActive
		}
		if err := tx.Create(&next).Error; err != nil {
			return err
		}
		result = next
		return nil
	})
	return result, err
}
func (r *MemoryMembershipRepository) ActivateDueMemberships(now time.Time, limit int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	rows := []model.UserMembership{}
	occupied := map[string]bool{}
	for _, m := range r.memberships {
		if m.Status == model.MembershipStatusActive {
			occupied[m.UserID] = true
		}
		if m.Status == model.MembershipStatusScheduled && !m.StartedAt.After(now) {
			rows = append(rows, m)
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].StartedAt.Before(rows[j].StartedAt) })
	for i, m := range rows {
		if limit > 0 && i >= limit {
			break
		}
		if !m.ExpiresAt.After(now) {
			m.Status = model.MembershipStatusExpired
		} else if !occupied[m.UserID] {
			m.Status = model.MembershipStatusActive
			occupied[m.UserID] = true
		} else {
			continue
		}
		m.UpdatedAt = now
		r.memberships[m.ID] = m
	}
	return nil
}
func (r *GormMembershipRepository) ActivateDueMemberships(now time.Time, limit int) error {
	var rows []model.UserMembership
	q := r.db.Where("status = ? AND started_at <= ?", model.MembershipStatusScheduled, now).Order("started_at ASC, id ASC")
	if limit > 0 {
		q = q.Limit(limit)
	}
	if err := q.Find(&rows).Error; err != nil {
		return err
	}
	for _, candidate := range rows {
		if err := r.db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", "membership:"+candidate.UserID).Error; err != nil {
				return err
			}
			var m model.UserMembership
			if err := tx.First(&m, "id = ?", candidate.ID).Error; err != nil {
				return err
			}
			if m.Status != model.MembershipStatusScheduled {
				return nil
			}
			status := model.MembershipStatusExpired
			if m.ExpiresAt.After(now) {
				var active int64
				if err := tx.Model(&model.UserMembership{}).Where("user_id = ? AND status = ?", m.UserID, model.MembershipStatusActive).Count(&active).Error; err != nil {
					return err
				}
				if active > 0 {
					return nil
				}
				status = model.MembershipStatusActive
			}
			return tx.Model(&m).Updates(map[string]any{"status": status, "updated_at": now}).Error
		}); err != nil {
			return err
		}
	}
	return nil
}
