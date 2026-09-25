package repository

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/jackc/pgx/v5"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const (
	// Native recovery republishes only a saved result/task, never generation.
	JobDispatchRecoveryPending   = "recovery_pending"
	JobDispatchRecoveryPublished = "recovery_published"
	JobRecoveryControlKey        = "_worker_recovery_control"
)

var ErrJobRecoveryConflict = errors.New("job recovery state changed")
var ErrJobRecoveryBusy = errors.New("job is currently executing")

type NativeJobRecoveryRepository interface {
	ListNativeRecovery(limit, offset int) ([]model.Job, int64, error)
	WithNativeJobLock(context.Context, string, func() error) error
	ScheduleNativeRecovery(string, string, int, string, string, time.Time) (model.Job, error)
	PrepareNativeRecoveryPublish(string, string, time.Time) (bool, error)
	MarkNativeRecoveryPublished(string, time.Time) error
}

func nativeRecoveryCandidate(job model.Job) bool {
	if job.ExternalProvider != "" || (job.Status != model.JobStatusQueued && job.Status != model.JobStatusRunning) {
		return false
	}
	var metadata map[string]json.RawMessage
	_ = json.Unmarshal(job.BridgeMetadata, &metadata)
	return (job.Type == model.JobTypeVideoGenerate && len(metadata["_worker_video_checkpoint"]) > 0) || ((job.Type == model.JobTypeImageGenerate || job.Type == model.JobTypeImageEdit) && len(metadata["_worker_image_checkpoint"]) > 0)
}

func (r *MemoryJobRepository) ListNativeRecovery(limit, offset int) ([]model.Job, int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	jobs := []model.Job{}
	for _, job := range r.jobs {
		if nativeRecoveryCandidate(job) {
			jobs = append(jobs, job)
		}
	}
	sort.Slice(jobs, func(i, j int) bool {
		if jobs[i].UpdatedAt.Equal(jobs[j].UpdatedAt) {
			return jobs[i].ID < jobs[j].ID
		}
		return jobs[i].UpdatedAt.Before(jobs[j].UpdatedAt)
	})
	total := int64(len(jobs))
	if offset >= len(jobs) {
		return []model.Job{}, total, nil
	}
	return jobs[offset:min(len(jobs), offset+limit)], total, nil
}

func (r *GormJobRepository) ListNativeRecovery(limit, offset int) ([]model.Job, int64, error) {
	var total int64
	// jsonb_exists avoids SQL placeholder ambiguity in GORM.
	query := r.db.Model(&model.Job{}).Where("COALESCE(external_provider,'')='' AND status IN ? AND ((type='video.generate' AND jsonb_exists(bridge_metadata,'_worker_video_checkpoint')) OR (type IN ('image.generate','image.edit') AND jsonb_exists(bridge_metadata,'_worker_image_checkpoint')))", []string{model.JobStatusQueued, model.JobStatusRunning})
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	jobs := []model.Job{}
	// Never fetch media payload/result/ciphertext just to render the recovery list.
	err := query.Select("id,user_id,workspace_id,type,status,queue_phase,bridge_metadata,updated_at,dispatch_state,CASE WHEN COALESCE(dispatch_ciphertext,'')<>'' THEN 'present' ELSE '' END AS dispatch_ciphertext").Order("updated_at ASC,id ASC").Limit(limit).Offset(offset).Find(&jobs).Error
	return jobs, total, err
}

func (r *MemoryJobRepository) WithNativeJobLock(ctx context.Context, id string, fn func() error) error {
	value, _ := r.externalLocks.LoadOrStore("native-worker:"+id, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	if !lock.TryLock() {
		return ErrJobRecoveryBusy
	}
	defer lock.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	return fn()
}

func (r *GormJobRepository) WithNativeJobLock(ctx context.Context, id string, fn func() error) error {
	dialect, ok := r.db.Dialector.(*postgres.Dialector)
	if !ok || dialect.Config.DSN == "" {
		return errors.New("native recovery requires PostgreSQL")
	}
	lockCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	conn, err := pgx.Connect(lockCtx, dialect.Config.DSN)
	if err != nil {
		return err
	}
	defer func() {
		closeCtx, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		_ = conn.Close(closeCtx)
	}()
	var acquired bool
	// Exactly the same lock namespace as worker.db.JobStore.job_lock.
	if err := conn.QueryRow(lockCtx, "SELECT pg_try_advisory_lock(hashtext($1))", id).Scan(&acquired); err != nil {
		return err
	}
	if !acquired {
		return ErrJobRecoveryBusy
	}
	return fn()
}

func (r *MemoryJobRepository) ScheduleNativeRecovery(id, key string, revision int, token, actor string, now time.Time) (model.Job, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	job, ok := r.jobs[id]
	if !ok {
		return model.Job{}, ErrJobNotFound
	}
	var metadata map[string]any
	_ = json.Unmarshal(job.BridgeMetadata, &metadata)
	checkpoint, _ := metadata[key].(map[string]any)
	if !nativeRecoveryCandidate(job) || job.DispatchCiphertext == "" || checkpoint["revision"] != float64(revision) {
		return model.Job{}, ErrJobRecoveryConflict
	}
	metadata[JobRecoveryControlKey] = map[string]any{"token": token, "requested_by": actor, "requested_at": now, "checkpoint_revision": revision}
	raw, _ := json.Marshal(metadata)
	job.BridgeMetadata = model.JSONB(raw)
	job.DispatchState, job.DispatchNextAttemptAt = JobDispatchRecoveryPending, &now
	r.jobs[id] = job
	return job, nil
}

func (r *GormJobRepository) ScheduleNativeRecovery(id, key string, revision int, token, actor string, now time.Time) (model.Job, error) {
	control, _ := json.Marshal(map[string]any{"token": token, "requested_by": actor, "requested_at": now, "checkpoint_revision": revision})
	result := r.db.Model(&model.Job{}).Where("id=? AND COALESCE(external_provider,'')='' AND status IN ? AND COALESCE(dispatch_ciphertext,'')<>'' AND bridge_metadata->?->>'revision'=?", id, []string{model.JobStatusQueued, model.JobStatusRunning}, key, fmtRevision(revision)).UpdateColumns(map[string]any{
		"bridge_metadata": gorm.Expr("jsonb_set(bridge_metadata,ARRAY[?],?::jsonb)", JobRecoveryControlKey, string(control)), "dispatch_state": JobDispatchRecoveryPending, "dispatch_next_attempt_at": now,
	})
	if result.Error != nil {
		return model.Job{}, result.Error
	}
	if result.RowsAffected == 0 {
		return model.Job{}, ErrJobRecoveryConflict
	}
	return r.GetByID(id)
}

func fmtRevision(revision int) string { raw, _ := json.Marshal(revision); return string(raw) }

// A worker may acknowledge an earlier delivery while the dispatcher is reading
// the job. Never turn that acknowledgement back into a pending publication.
func (r *MemoryJobRepository) PrepareNativeRecoveryPublish(id, token string, next time.Time) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	job, ok := r.jobs[id]
	if !ok {
		return false, ErrJobNotFound
	}
	var metadata map[string]json.RawMessage
	_ = json.Unmarshal(job.BridgeMetadata, &metadata)
	var control map[string]any
	_ = json.Unmarshal(metadata[JobRecoveryControlKey], &control)
	if (job.DispatchState != JobDispatchRecoveryPending && job.DispatchState != JobDispatchRecoveryPublished) || (job.Status != model.JobStatusQueued && job.Status != model.JobStatusRunning) || control["token"] != token || control["acknowledged"] == true {
		return false, nil
	}
	job.DispatchState, job.DispatchNextAttemptAt = JobDispatchRecoveryPending, &next
	job.DispatchAttempts++
	r.jobs[id] = job
	return true, nil
}

func (r *GormJobRepository) PrepareNativeRecoveryPublish(id, token string, next time.Time) (bool, error) {
	result := r.db.Model(&model.Job{}).Where("id=? AND dispatch_state IN ? AND status IN ? AND bridge_metadata->?->>'token'=? AND COALESCE(bridge_metadata->?->>'acknowledged','false')<>'true'", id, []string{JobDispatchRecoveryPending, JobDispatchRecoveryPublished}, []string{model.JobStatusQueued, model.JobStatusRunning}, JobRecoveryControlKey, token, JobRecoveryControlKey).
		UpdateColumns(map[string]any{"dispatch_state": JobDispatchRecoveryPending, "dispatch_next_attempt_at": next, "dispatch_attempts": gorm.Expr("COALESCE(dispatch_attempts,0)+1")})
	return result.RowsAffected > 0, result.Error
}

func (r *MemoryJobRepository) MarkNativeRecoveryPublished(id string, next time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	job, ok := r.jobs[id]
	if !ok {
		return ErrJobNotFound
	}
	if job.DispatchState == JobDispatchRecoveryPending {
		job.DispatchState = JobDispatchRecoveryPublished
		job.DispatchNextAttemptAt = &next
		r.jobs[id] = job
	}
	return nil
}
func (r *GormJobRepository) MarkNativeRecoveryPublished(id string, next time.Time) error {
	return r.db.Model(&model.Job{}).Where("id=? AND dispatch_state=?", id, JobDispatchRecoveryPending).UpdateColumns(map[string]any{"dispatch_state": JobDispatchRecoveryPublished, "dispatch_next_attempt_at": next}).Error
}
