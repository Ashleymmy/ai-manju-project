package repository

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/monitoring"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Reports never silently truncate totals; narrow the window above this bound.
const MaxMonitoringFacts = 50000

var ErrMonitoringTooLarge = errors.New("监控记录过多，请缩短时间范围或选择用户后查询")

type MonitoringFacts struct {
	Errors []model.RuntimeError
	Calls  []model.AIRequestLog
	Jobs   []model.Job
}
type RuntimeMonitoringRepository interface {
	Record(context.Context, model.RuntimeError) error
	Facts(context.Context, time.Time, time.Time, string) (MonitoringFacts, error)
}
type MemoryRuntimeMonitoringRepository struct {
	mu     sync.RWMutex
	events map[string]model.RuntimeError
	jobs   *MemoryJobRepository
	calls  *MemoryMonitoringRepository
}
type GormRuntimeMonitoringRepository struct{ db *gorm.DB }

func NewRuntimeMonitoringRepository(jobs JobRepository, calls MonitoringRepository) RuntimeMonitoringRepository {
	if r, ok := jobs.(*GormJobRepository); ok {
		return &GormRuntimeMonitoringRepository{db: r.db}
	}
	return &MemoryRuntimeMonitoringRepository{events: map[string]model.RuntimeError{}, jobs: jobs.(*MemoryJobRepository), calls: calls.(*MemoryMonitoringRepository)}
}
func cleanRuntimeError(e model.RuntimeError) model.RuntimeError {
	e.Message, e.Detail, e.Suggestion = monitoring.SafeText(e.Message), monitoring.SafeText(e.Detail), monitoring.SafeText(e.Suggestion)
	e.Endpoint, e.Model, e.Operation = monitoring.SafeText(e.Endpoint), monitoring.SafeText(e.Model), monitoring.SafeText(e.Operation)
	e.ErrorCode = monitoring.SafeText(e.ErrorCode)
	if e.CreatedAt.IsZero() {
		e.CreatedAt = time.Now().UTC()
	}
	return e
}
func (r *MemoryRuntimeMonitoringRepository) Record(ctx context.Context, e model.RuntimeError) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.events[e.ID]; !exists {
		r.events[e.ID] = cleanRuntimeError(e)
	}
	return nil
}
func (r *GormRuntimeMonitoringRepository) Record(ctx context.Context, e model.RuntimeError) error {
	e = cleanRuntimeError(e)
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&e).Error
}
func (r *MemoryRuntimeMonitoringRepository) Facts(ctx context.Context, start, end time.Time, userID string) (MonitoringFacts, error) {
	f := MonitoringFacts{}
	match := func(t time.Time, u string) bool {
		return !t.Before(start) && t.Before(end) && (userID == "" || userID == u)
	}
	r.mu.RLock()
	for _, e := range r.events {
		if match(e.CreatedAt, e.UserID) {
			f.Errors = append(f.Errors, e)
			if len(f.Errors) > MaxMonitoringFacts {
				break
			}
		}
	}
	r.mu.RUnlock()
	r.calls.mu.RLock()
	for _, c := range r.calls.logs {
		if match(c.CreatedAt, c.UserID) {
			f.Calls = append(f.Calls, c)
			if len(f.Errors)+len(f.Calls) > MaxMonitoringFacts {
				break
			}
		}
	}
	r.calls.mu.RUnlock()
	r.jobs.mu.RLock()
	for _, j := range r.jobs.jobs {
		t := j.CreatedAt
		if j.FinishedAt != nil {
			t = *j.FinishedAt
		}
		if match(t, j.UserID) {
			f.Jobs = append(f.Jobs, j)
			if len(f.Errors)+len(f.Calls)+len(f.Jobs) > MaxMonitoringFacts {
				break
			}
		}
	}
	r.jobs.mu.RUnlock()
	if len(f.Errors)+len(f.Calls)+len(f.Jobs) > MaxMonitoringFacts {
		return MonitoringFacts{}, ErrMonitoringTooLarge
	}
	return f, ctx.Err()
}
func (r *GormRuntimeMonitoringRepository) Facts(ctx context.Context, start, end time.Time, userID string) (MonitoringFacts, error) {
	f := MonitoringFacts{}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY").Error; err != nil {
			return err
		}
		query := func(column string, remaining int) *gorm.DB {
			q := tx.Where(column+" >= ? AND "+column+" < ?", start, end).Limit(remaining + 1)
			if userID != "" {
				q = q.Where("user_id = ?", userID)
			}
			return q
		}
		if err := query("created_at", MaxMonitoringFacts).Find(&f.Errors).Error; err != nil {
			return err
		}
		remaining := MaxMonitoringFacts - len(f.Errors)
		if remaining < 0 {
			return ErrMonitoringTooLarge
		}
		if err := query("created_at", remaining).Find(&f.Calls).Error; err != nil {
			return err
		}
		remaining -= len(f.Calls)
		if remaining < 0 {
			return ErrMonitoringTooLarge
		}
		// Select operational fields only; large prompts/media never enter report memory.
		if err := query("COALESCE(finished_at, created_at)", remaining).Select(`id,user_id,type,status,error,attempts,max_attempts,created_at,started_at,finished_at,external_provider,
			jsonb_build_object('model',payload->>'model','request_id',payload->>'request_id',
			'source_project_id',COALESCE(payload->>'source_project_id',payload->'asset_registration'->>'source_project_id',payload->'asset_context'->>'source_project_id'),
			'source_node_id',COALESCE(payload->>'source_node_id',payload->'asset_registration'->>'source_node_id',payload->'asset_context'->>'source_node_id')) AS payload`).Find(&f.Jobs).Error; err != nil {
			return err
		}
		if len(f.Jobs) > remaining {
			return ErrMonitoringTooLarge
		}
		return nil
	})
	return f, err
}
