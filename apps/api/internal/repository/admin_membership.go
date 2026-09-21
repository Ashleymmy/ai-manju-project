package repository

import (
	"errors"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ErrMembershipChanged prevents overwriting a membership changed by another operator.
var ErrMembershipChanged = errors.New("membership changed; refresh before editing")

func (r *MemoryMembershipRepository) ReplaceAdminMembership(next model.UserMembership, expectedID string) (model.UserMembership, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if existing, ok := r.memberships[next.ID]; ok {
		return existing, nil
	}
	currentID := ""
	for _, m := range r.memberships {
		if m.UserID == next.UserID && m.Status == model.MembershipStatusActive {
			currentID = m.ID
		}
	}
	if currentID != expectedID {
		return model.UserMembership{}, ErrMembershipChanged
	}
	for id, m := range r.memberships {
		if m.UserID == next.UserID && m.Status == model.MembershipStatusScheduled {
			m.Status = model.MembershipStatusRevoked
			m.UpdatedAt = next.CreatedAt
			r.memberships[id] = m
		}
	}
	if currentID != "" {
		old := r.memberships[currentID]
		old.Status, old.UpdatedAt = model.MembershipStatusRevoked, next.CreatedAt
		r.memberships[currentID] = old
	}
	r.memberships[next.ID] = next
	return next, nil
}

func (r *GormMembershipRepository) ReplaceAdminMembership(next model.UserMembership, expectedID string) (model.UserMembership, error) {
	var result model.UserMembership
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", "membership:"+next.UserID).Error; err != nil {
			return err
		}
		// Serialize admin changes even when no active membership row exists.
		var user model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ?", next.UserID).Error; err != nil {
			return err
		}
		if err := tx.First(&result, "id = ?", next.ID).Error; err == nil {
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var current model.UserMembership
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ? AND status = ?", next.UserID, model.MembershipStatusActive).First(&current).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if current.ID != expectedID {
			return ErrMembershipChanged
		}
		if err := tx.Model(&model.UserMembership{}).Where("user_id = ? AND status = ?", next.UserID, model.MembershipStatusScheduled).Updates(map[string]any{"status": model.MembershipStatusRevoked, "updated_at": next.CreatedAt}).Error; err != nil {
			return err
		}
		if current.ID != "" {
			if err := tx.Model(&current).Updates(map[string]any{"status": model.MembershipStatusRevoked, "updated_at": time.Now().UTC()}).Error; err != nil {
				return err
			}
		}
		if err := tx.Create(&next).Error; err != nil {
			return err
		}
		result = next
		return nil
	})
	return result, err
}
