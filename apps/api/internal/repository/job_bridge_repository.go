package repository

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/jackc/pgx/v5"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func IsUncertainSubmission(job model.Job) bool {
	var failure struct {
		Code string `json:"code"`
	}
	return job.ExternalProvider == "sd-video" && job.Status == model.JobStatusFailed && json.Unmarshal(job.Error, &failure) == nil && failure.Code == "submission_uncertain"
}

// 只允许已人工核对的外部任务恢复；普通终态和已取消任务保持不可变。
func (r *MemoryJobRepository) ResumeReconciledExternal(id string, taskID string) (model.Job, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	job, ok := r.jobs[id]
	if !ok {
		return model.Job{}, ErrJobNotFound
	}
	if IsUncertainSubmission(job) && job.ExternalTaskID == taskID {
		job.Status, job.BridgeState = model.JobStatusRunning, "pending"
		job.Error, job.FinishedAt, job.BridgeNextAttemptAt = model.JSONB("{}"), nil, nil
		job.UpdatedAt = r.clockFn()
		r.jobs[id] = job
	}
	return job, nil
}

func (r *GormJobRepository) ResumeReconciledExternal(id string, taskID string) (model.Job, error) {
	err := r.db.Model(&model.Job{}).Where("id=? AND external_provider='sd-video' AND external_task_id=? AND status='failed' AND error->>'code'='submission_uncertain'", id, taskID).
		Updates(map[string]any{"status": model.JobStatusRunning, "bridge_state": "pending", "error": model.JSONB("{}"), "finished_at": nil, "bridge_next_attempt_at": nil, "updated_at": time.Now().UTC()}).Error
	if err != nil {
		return model.Job{}, err
	}
	return r.GetByID(id)
}

// 与取消共用同一把任务锁；数据库连接断开时自动释放，不依赖进程内单例。
func (r *MemoryJobRepository) WithExternalLock(ctx context.Context, id string, fn func() error) error {
	value, _ := r.externalLocks.LoadOrStore(id, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	return fn()
}

func (r *GormJobRepository) WithExternalLock(ctx context.Context, id string, fn func() error) error {
	// 锁连接独立于业务连接池，避免 MaxOpenConns=1 或大量取消请求耗尽池后死锁。
	dialect, ok := r.db.Dialector.(*postgres.Dialector)
	if !ok || dialect.Config.DSN == "" {
		return errors.New("external job locking requires PostgreSQL DSN")
	}
	lockContext, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	connection, err := pgx.Connect(lockContext, dialect.Config.DSN)
	if err != nil {
		return err
	}
	defer func() {
		closeContext, closeCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer closeCancel()
		_ = connection.Close(closeContext)
	}()
	if _, err := connection.Exec(lockContext, "SELECT pg_advisory_lock(hashtextextended($1,0))", "sd-video:"+id); err != nil {
		return err
	}
	return fn()
}

func (r *MemoryJobRepository) SetBridgeState(id string, state string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	job, ok := r.jobs[id]
	if !ok {
		return ErrJobNotFound
	}
	job.BridgeState = state
	job.UpdatedAt = r.clockFn()
	r.jobs[id] = job
	return nil
}

func (r *GormJobRepository) SetBridgeState(id string, state string) error {
	return r.db.Model(&model.Job{}).Where("id = ?", id).Updates(map[string]any{"bridge_state": state, "updated_at": time.Now().UTC()}).Error
}

func (r *MemoryJobRepository) DelayBridge(id string, until time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	job, ok := r.jobs[id]
	if !ok {
		return ErrJobNotFound
	}
	job.BridgeNextAttemptAt, job.UpdatedAt = &until, r.clockFn()
	job.BridgeAttempts++
	r.jobs[id] = job
	return nil
}

func (r *GormJobRepository) DelayBridge(id string, until time.Time) error {
	return r.db.Model(&model.Job{}).Where("id=?", id).Updates(map[string]any{"bridge_next_attempt_at": until, "bridge_attempts": gorm.Expr("COALESCE(bridge_attempts,0)+1"), "updated_at": time.Now().UTC()}).Error
}
