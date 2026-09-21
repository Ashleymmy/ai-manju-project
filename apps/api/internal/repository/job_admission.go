package repository

import (
	"errors"
	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
)

var ErrJobConcurrencyLimit = errors.New("concurrent task limit reached for current membership tier")

func admissionTypes(jobType string) []string {
	switch jobType {
	case model.JobTypeImageGenerate, model.JobTypeImageEdit:
		return []string{model.JobTypeImageGenerate, model.JobTypeImageEdit}
	case model.JobTypeVideoGenerate:
		return []string{model.JobTypeVideoGenerate}
	default:
		return nil
	}
}
func (r *MemoryJobRepository) CreateWithinLimit(job model.Job, limit int) (model.Job, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if id := r.byKey[job.IdempotencyKey]; id != "" {
		return r.jobs[id], nil
	}
	types := admissionTypes(job.Type)
	count := 0
	for _, j := range r.jobs {
		if j.UserID != job.UserID || (j.Status != model.JobStatusQueued && j.Status != model.JobStatusRunning) {
			continue
		}
		for _, typ := range types {
			if j.Type == typ {
				count++
				break
			}
		}
	}
	if len(types) > 0 && count >= limit {
		return model.Job{}, ErrJobConcurrencyLimit
	}
	return r.createJobLocked(job)
}
func (r *GormJobRepository) CreateWithinLimit(job model.Job, limit int) (model.Job, error) {
	var result model.Job
	err := r.db.Transaction(func(tx *gorm.DB) error {
		// Transaction-scoped lock releases on rollback, process exit or disconnect.
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", "member-admission:"+job.UserID).Error; err != nil {
			return err
		}
		repo := NewGormJobRepository(tx)
		if existing, err := repo.GetByIdempotencyKey(job.IdempotencyKey); err == nil {
			result = existing
			return nil
		} else if !errors.Is(err, ErrJobNotFound) {
			return err
		}
		types := admissionTypes(job.Type)
		if len(types) > 0 {
			count, err := repo.CountActiveByUserAndTypes(job.UserID, types)
			if err != nil {
				return err
			}
			if count >= int64(limit) {
				return ErrJobConcurrencyLimit
			}
		}
		var err error
		result, err = repo.Create(job)
		return err
	})
	return result, err
}
