package repository

import (
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
)

var ErrJobNotFound = errors.New("job not found")

type JobRepository interface {
	Create(job model.Job) (model.Job, error)
	GetByID(id string) (model.Job, error)
	GetByIdempotencyKey(key string) (model.Job, error)
	UpdateStatus(id string, status string) (model.Job, error)
	UpdateProgress(id string, progress int) (model.Job, error)
	UpdateQueuePhase(id string, phase string) (model.Job, error)
	SetResult(id string, result model.JSONB) (model.Job, error)
	SetError(id string, errorPayload model.JSONB) (model.Job, error)
	ListByUser(userID string) ([]model.Job, error)
}

type MemoryJobRepository struct {
	mu      sync.RWMutex
	jobs    map[string]model.Job
	byKey   map[string]string
	clockFn func() time.Time
}

func NewMemoryJobRepository() *MemoryJobRepository {
	return &MemoryJobRepository{
		jobs:    make(map[string]model.Job),
		byKey:   make(map[string]string),
		clockFn: func() time.Time { return time.Now().UTC() },
	}
}

func (r *MemoryJobRepository) Create(job model.Job) (model.Job, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if existingID := r.byKey[job.IdempotencyKey]; existingID != "" {
		return r.jobs[existingID], nil
	}
	now := r.clockFn()
	job.CreatedAt = now
	job.UpdatedAt = now
	r.jobs[job.ID] = job
	r.byKey[job.IdempotencyKey] = job.ID
	return job, nil
}

func (r *MemoryJobRepository) GetByID(id string) (model.Job, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	job, ok := r.jobs[id]
	if !ok {
		return model.Job{}, ErrJobNotFound
	}
	return job, nil
}

func (r *MemoryJobRepository) GetByIdempotencyKey(key string) (model.Job, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	id := r.byKey[key]
	if id == "" {
		return model.Job{}, ErrJobNotFound
	}
	return r.jobs[id], nil
}

func (r *MemoryJobRepository) UpdateStatus(id string, status string) (model.Job, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	job, ok := r.jobs[id]
	if !ok {
		return model.Job{}, ErrJobNotFound
	}
	now := r.clockFn()
	job.Status = status
	if status != model.JobStatusQueued {
		job.QueuePhase = ""
	}
	job.UpdatedAt = now
	switch status {
	case model.JobStatusRunning:
		if job.StartedAt == nil {
			job.StartedAt = &now
		}
	case model.JobStatusSucceeded, model.JobStatusFailed, model.JobStatusCanceled:
		job.FinishedAt = &now
	}
	r.jobs[id] = job
	return job, nil
}

func (r *MemoryJobRepository) UpdateProgress(id string, progress int) (model.Job, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	job, ok := r.jobs[id]
	if !ok {
		return model.Job{}, ErrJobNotFound
	}
	job.Progress = clampProgress(progress)
	job.UpdatedAt = r.clockFn()
	r.jobs[id] = job
	return job, nil
}

func (r *MemoryJobRepository) UpdateQueuePhase(id string, phase string) (model.Job, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	job, ok := r.jobs[id]
	if !ok {
		return model.Job{}, ErrJobNotFound
	}
	job.QueuePhase = phase
	job.UpdatedAt = r.clockFn()
	r.jobs[id] = job
	return job, nil
}

func (r *MemoryJobRepository) SetResult(id string, result model.JSONB) (model.Job, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	job, ok := r.jobs[id]
	if !ok {
		return model.Job{}, ErrJobNotFound
	}
	now := r.clockFn()
	job.Result = normalizeJSONB(result)
	job.Status = model.JobStatusSucceeded
	job.QueuePhase = ""
	job.Progress = 100
	job.UpdatedAt = now
	job.FinishedAt = &now
	r.jobs[id] = job
	return job, nil
}

func (r *MemoryJobRepository) SetError(id string, errorPayload model.JSONB) (model.Job, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	job, ok := r.jobs[id]
	if !ok {
		return model.Job{}, ErrJobNotFound
	}
	now := r.clockFn()
	job.Error = normalizeJSONB(errorPayload)
	job.Status = model.JobStatusFailed
	job.QueuePhase = ""
	job.Attempts++
	job.UpdatedAt = now
	job.FinishedAt = &now
	r.jobs[id] = job
	return job, nil
}

func (r *MemoryJobRepository) ListByUser(userID string) ([]model.Job, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	jobs := make([]model.Job, 0)
	for _, job := range r.jobs {
		if job.UserID == userID {
			jobs = append(jobs, job)
		}
	}
	sort.Slice(jobs, func(i, j int) bool {
		return jobs[i].UpdatedAt.After(jobs[j].UpdatedAt)
	})
	return jobs, nil
}

type GormJobRepository struct {
	db *gorm.DB
}

func NewGormJobRepository(db *gorm.DB) *GormJobRepository {
	return &GormJobRepository{db: db}
}

func (r *GormJobRepository) Create(job model.Job) (model.Job, error) {
	if existing, err := r.GetByIdempotencyKey(job.IdempotencyKey); err == nil {
		return existing, nil
	}
	now := time.Now().UTC()
	job.CreatedAt = now
	job.UpdatedAt = now
	if err := r.db.Create(&job).Error; err != nil {
		if existing, getErr := r.GetByIdempotencyKey(job.IdempotencyKey); getErr == nil {
			return existing, nil
		}
		return model.Job{}, err
	}
	return job, nil
}

func (r *GormJobRepository) GetByID(id string) (model.Job, error) {
	var job model.Job
	if err := r.db.First(&job, "id = ?", id).Error; err != nil {
		return model.Job{}, mapJobGormError(err)
	}
	return job, nil
}

func (r *GormJobRepository) GetByIdempotencyKey(key string) (model.Job, error) {
	var job model.Job
	if err := r.db.First(&job, "idempotency_key = ?", key).Error; err != nil {
		return model.Job{}, mapJobGormError(err)
	}
	return job, nil
}

func (r *GormJobRepository) UpdateStatus(id string, status string) (model.Job, error) {
	job, err := r.GetByID(id)
	if err != nil {
		return model.Job{}, err
	}
	now := time.Now().UTC()
	updates := map[string]any{"status": status, "updated_at": now}
	if status != model.JobStatusQueued {
		updates["queue_phase"] = ""
	}
	if status == model.JobStatusRunning && job.StartedAt == nil {
		updates["started_at"] = now
	}
	if isTerminalJobStatus(status) {
		updates["finished_at"] = now
	}
	if err := r.db.Model(&model.Job{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		return model.Job{}, err
	}
	return r.GetByID(id)
}

func (r *GormJobRepository) UpdateProgress(id string, progress int) (model.Job, error) {
	if err := r.db.Model(&model.Job{}).Where("id = ?", id).Updates(map[string]any{
		"progress":   clampProgress(progress),
		"updated_at": time.Now().UTC(),
	}).Error; err != nil {
		return model.Job{}, err
	}
	return r.GetByID(id)
}

func (r *GormJobRepository) UpdateQueuePhase(id string, phase string) (model.Job, error) {
	if err := r.db.Model(&model.Job{}).Where("id = ?", id).Updates(map[string]any{
		"queue_phase": phase,
		"updated_at":  time.Now().UTC(),
	}).Error; err != nil {
		return model.Job{}, err
	}
	return r.GetByID(id)
}

func (r *GormJobRepository) SetResult(id string, result model.JSONB) (model.Job, error) {
	now := time.Now().UTC()
	if err := r.db.Model(&model.Job{}).Where("id = ?", id).Updates(map[string]any{
		"result":      normalizeJSONB(result),
		"status":      model.JobStatusSucceeded,
		"progress":    100,
		"queue_phase": "",
		"updated_at":  now,
		"finished_at": now,
	}).Error; err != nil {
		return model.Job{}, err
	}
	return r.GetByID(id)
}

func (r *GormJobRepository) SetError(id string, errorPayload model.JSONB) (model.Job, error) {
	job, err := r.GetByID(id)
	if err != nil {
		return model.Job{}, err
	}
	now := time.Now().UTC()
	if err := r.db.Model(&model.Job{}).Where("id = ?", id).Updates(map[string]any{
		"error":       normalizeJSONB(errorPayload),
		"status":      model.JobStatusFailed,
		"attempts":    job.Attempts + 1,
		"queue_phase": "",
		"updated_at":  now,
		"finished_at": now,
	}).Error; err != nil {
		return model.Job{}, err
	}
	return r.GetByID(id)
}

func (r *GormJobRepository) ListByUser(userID string) ([]model.Job, error) {
	var jobs []model.Job
	if err := r.db.Where("user_id = ?", userID).Order("updated_at DESC").Find(&jobs).Error; err != nil {
		return nil, err
	}
	return jobs, nil
}

func mapJobGormError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrJobNotFound
	}
	return err
}

func normalizeJSONB(value model.JSONB) model.JSONB {
	if len(value) == 0 {
		return model.JSONB("{}")
	}
	return value
}

func clampProgress(progress int) int {
	if progress < 0 {
		return 0
	}
	if progress > 100 {
		return 100
	}
	return progress
}

func isTerminalJobStatus(status string) bool {
	return status == model.JobStatusSucceeded || status == model.JobStatusFailed || status == model.JobStatusCanceled
}
