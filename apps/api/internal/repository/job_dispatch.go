package repository

import (
	"encoding/json"
	"sort"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
)

// Provider waits before mark_running have never entered paid execution. A lost
// Celery retry may be restored only while that evidence is still unchanged.
// Keep this predicate aligned with CanRedispatchProviderWait below; checkpoints
// and recovery controls must never be mistaken for an unstarted queue wait.
const providerWaitRedispatchSQL = `status = 'queued' AND queue_phase = 'waiting_provider_slot'
 AND started_at IS NULL AND COALESCE(external_provider, '') = ''
 AND COALESCE(jsonb_typeof(bridge_metadata), 'null') IN ('null', 'object')
 AND NOT jsonb_exists(COALESCE(bridge_metadata, '{}'::jsonb), '_worker_video_checkpoint')
 AND NOT jsonb_exists(COALESCE(bridge_metadata, '{}'::jsonb), '_worker_image_checkpoint')
 AND NOT jsonb_exists(COALESCE(bridge_metadata, '{}'::jsonb), '_worker_recovery_control')`

func CanRedispatchProviderWait(job model.Job) bool {
	if job.Status != model.JobStatusQueued || job.QueuePhase != "waiting_provider_slot" || job.StartedAt != nil || job.ExternalProvider != "" {
		return false
	}
	var metadata map[string]json.RawMessage
	if len(job.BridgeMetadata) > 0 && json.Unmarshal(job.BridgeMetadata, &metadata) != nil {
		return false
	}
	for _, key := range []string{"_worker_video_checkpoint", "_worker_image_checkpoint", JobRecoveryControlKey} {
		if _, exists := metadata[key]; exists {
			return false
		}
	}
	return true
}

func (r *MemoryJobRepository) ListDispatchPendingIDs(now time.Time, limit int) ([]string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	jobs := []model.Job{}
	for _, job := range r.jobs {
		// Most observed active jobs need manual recovery. Only unstarted provider
		// waits can safely restore a lost retry, including legacy observed rows.
		terminal := job.Status == model.JobStatusSucceeded || job.Status == model.JobStatusFailed || job.Status == model.JobStatusCanceled
		if (job.DispatchState == model.JobDispatchPending || job.DispatchState == model.JobDispatchPublished || (job.DispatchState == model.JobDispatchObserved && (terminal || CanRedispatchProviderWait(job))) || job.DispatchState == JobDispatchRecoveryPending || job.DispatchState == JobDispatchRecoveryPublished) && job.DispatchCiphertext != "" && (job.DispatchNextAttemptAt == nil || !job.DispatchNextAttemptAt.After(now)) {
			jobs = append(jobs, job)
		}
	}
	sort.Slice(jobs, func(i, j int) bool {
		iTime, jTime := jobs[i].CreatedAt, jobs[j].CreatedAt
		if jobs[i].DispatchNextAttemptAt != nil {
			iTime = *jobs[i].DispatchNextAttemptAt
		}
		if jobs[j].DispatchNextAttemptAt != nil {
			jTime = *jobs[j].DispatchNextAttemptAt
		}
		if iTime.Equal(jTime) {
			return jobs[i].ID < jobs[j].ID
		}
		return iTime.Before(jTime)
	})
	if limit > 0 && len(jobs) > limit {
		jobs = jobs[:limit]
	}
	ids := make([]string, 0, len(jobs))
	for _, job := range jobs {
		ids = append(ids, job.ID)
	}
	return ids, nil
}

func (r *MemoryJobRepository) UpdateDispatch(id string, state string, next *time.Time, completed bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	job, ok := r.jobs[id]
	if !ok {
		return ErrJobNotFound
	}
	if job.DispatchCiphertext == "" {
		return nil
	}
	job.DispatchState, job.DispatchNextAttemptAt = state, next
	job.DispatchAttempts++
	if completed {
		job.DispatchCiphertext = ""
	}
	if job.Status == model.JobStatusQueued && job.StartedAt == nil && (job.QueuePhase == "" || job.QueuePhase == model.JobQueueWaitingDispatch) {
		if state == model.JobDispatchPending {
			job.QueuePhase = model.JobQueueWaitingDispatch
		} else {
			job.QueuePhase = ""
		}
	}
	r.jobs[id] = job
	return nil
}

func (r *GormJobRepository) ListDispatchPendingIDs(now time.Time, limit int) ([]string, error) {
	ids := []string{}
	query := r.db.Model(&model.Job{}).Where("(dispatch_state IN ? OR (dispatch_state = ? AND (status IN ? OR ("+providerWaitRedispatchSQL+")))) AND COALESCE(dispatch_ciphertext,'') <> '' AND (dispatch_next_attempt_at IS NULL OR dispatch_next_attempt_at <= ?)", []string{model.JobDispatchPending, model.JobDispatchPublished, JobDispatchRecoveryPending, JobDispatchRecoveryPublished}, model.JobDispatchObserved, []string{model.JobStatusSucceeded, model.JobStatusFailed, model.JobStatusCanceled}, now).
		Order("COALESCE(dispatch_next_attempt_at, created_at) ASC").Order("id ASC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	err := query.Pluck("id", &ids).Error
	return ids, err
}

func (r *GormJobRepository) UpdateDispatch(id string, state string, next *time.Time, completed bool) error {
	phase := ""
	if state == model.JobDispatchPending {
		phase = model.JobQueueWaitingDispatch
	}
	updates := map[string]any{
		"dispatch_state": state, "dispatch_next_attempt_at": next,
		"dispatch_attempts": gorm.Expr("COALESCE(dispatch_attempts,0) + 1"),
		"queue_phase":       gorm.Expr("CASE WHEN status = 'queued' AND started_at IS NULL AND COALESCE(queue_phase,'') IN ('','waiting_dispatch') THEN ? ELSE queue_phase END", phase),
	}
	if completed {
		updates["dispatch_ciphertext"] = ""
	}
	result := r.db.Model(&model.Job{}).Where("id = ? AND COALESCE(dispatch_ciphertext,'') <> ''", id).UpdateColumns(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		_, err := r.GetByID(id)
		return err
	}
	return nil
}
