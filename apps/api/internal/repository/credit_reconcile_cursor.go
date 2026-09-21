package repository

import (
	"github.com/ai-manju/api/internal/model"
	"sort"
	"time"
)

func (r *MemoryCreditRepository) ListReservedConsumptionsAfter(createdAt time.Time, id string, limit int) ([]model.TaskConsumption, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	rows := []model.TaskConsumption{}
	for _, c := range r.consumptions {
		if c.Status == model.TaskConsumptionStatusReserved && (createdAt.IsZero() || c.CreatedAt.After(createdAt) || (c.CreatedAt.Equal(createdAt) && c.ID > id)) {
			rows = append(rows, c)
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].CreatedAt.Equal(rows[j].CreatedAt) {
			return rows[i].ID < rows[j].ID
		}
		return rows[i].CreatedAt.Before(rows[j].CreatedAt)
	})
	if limit > 0 && len(rows) > limit {
		rows = rows[:limit]
	}
	return rows, nil
}
func (r *GormCreditRepository) ListReservedConsumptionsAfter(createdAt time.Time, id string, limit int) ([]model.TaskConsumption, error) {
	rows := []model.TaskConsumption{}
	q := r.db.Where("status = ?", model.TaskConsumptionStatusReserved)
	if !createdAt.IsZero() {
		q = q.Where("created_at > ? OR (created_at = ? AND id > ?)", createdAt, createdAt, id)
	}
	if limit > 0 {
		q = q.Limit(limit)
	}
	err := q.Order("created_at ASC, id ASC").Find(&rows).Error
	return rows, err
}
