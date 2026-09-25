package repository

import (
	"bytes"
	"encoding/json"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
)

const NativeOrphanAttentionMessage = "原生成任务执行状态需要人工核对，已保留原始记录和积分，请勿重复提交"

// Orphan routing never publishes work. A proven rejection is handed back to the
// existing retry path; all other unsafe evidence enters a nonterminal hold.
type NativeOrphanRepository interface {
	RouteNativeOrphan(model.Job, time.Time) (bool, error)
	DeferBusyNativeRecovery(model.Job, time.Time) (bool, error)
}

var orphanNativeRunningSQL = `status = 'running' AND COALESCE(external_provider, '') = ''
 AND COALESCE(dispatch_state, '') NOT IN ('recovery_pending', 'recovery_published')
 AND ((type = 'video.generate' AND COALESCE(queue_phase, '') IN ('','waiting_provider_slot','provider_retry_backoff','video_recovery_pending','video_submission_uncertain'))
   OR (type IN ('image.generate','image.edit') AND COALESCE(queue_phase, '') IN ('','waiting_provider_slot','provider_retry_backoff','image_recovery_pending','image_submission_uncertain')))
 AND (COALESCE(jsonb_typeof(bridge_metadata), 'null') <> 'object'
      OR NOT jsonb_exists(bridge_metadata, '_worker_recovery_control')
      OR (jsonb_typeof(bridge_metadata->'_worker_recovery_control') = 'object' AND bridge_metadata->'_worker_recovery_control'->'acknowledged' = 'true'::jsonb))
 AND NOT COALESCE((` + automaticNativeRecoverySQL + `), false)`

func CanRouteNativeOrphan(job model.Job) bool {
	if job.Status != model.JobStatusRunning || job.ExternalProvider != "" || job.DispatchState == JobDispatchRecoveryPending || job.DispatchState == JobDispatchRecoveryPublished || CanAutomaticallyRecoverNative(job) {
		return false
	}
	phase := "video_recovery_pending"
	uncertainPhase := "video_submission_uncertain"
	switch job.Type {
	case model.JobTypeVideoGenerate:
	case model.JobTypeImageGenerate, model.JobTypeImageEdit:
		phase = "image_recovery_pending"
		uncertainPhase = "image_submission_uncertain"
	default:
		return false
	}
	if job.QueuePhase != "" && job.QueuePhase != "waiting_provider_slot" && job.QueuePhase != "provider_retry_backoff" && job.QueuePhase != phase && job.QueuePhase != uncertainPhase {
		return false
	}
	var metadata map[string]json.RawMessage
	if json.Unmarshal(job.BridgeMetadata, &metadata) == nil {
		if raw, exists := metadata[JobRecoveryControlKey]; exists {
			var control struct {
				Acknowledged bool `json:"acknowledged"`
			}
			if json.Unmarshal(raw, &control) != nil || !control.Acknowledged {
				return false
			}
		}
	}
	return true
}

func nativeOrphanOutcome(job model.Job) (string, model.JSONB) {
	retry := job
	retry.Status, retry.QueuePhase = model.JobStatusQueued, "provider_retry_backoff"
	if job.DispatchCiphertext != "" && CanRedispatchProviderWait(retry) {
		return retry.QueuePhase, model.JSONB(`{"code":"provider_retry_backoff","message":"上游已明确拒绝本次提交，后台将按原任务继续处理","retryable":true}`)
	}
	kind := "video"
	if job.Type != model.JobTypeVideoGenerate {
		kind = "image"
	}
	// Existing Worker deliveries explicitly stop on recovery_attention. Merely
	// setting submission_uncertain would leave a checkpoint-less redelivery able
	// to pass its normal execution path and create another paid task.
	phase := kind + "_recovery_attention"
	failure, _ := json.Marshal(map[string]any{"code": phase, "message": NativeOrphanAttentionMessage, "retryable": false})
	return phase, failure
}

func nativeSnapshotJSON(raw model.JSONB) []byte {
	if len(raw) == 0 {
		return []byte("{}")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if decoder.Decode(&value) != nil {
		return raw
	}
	encoded, _ := json.Marshal(value)
	return encoded
}

func sameOptionalTime(a, b *time.Time) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && a.Equal(*b))
}

func nativeOrphanSnapshotMatches(current, observed model.Job) bool {
	return current.Status == observed.Status && current.Status == model.JobStatusRunning && current.Type == observed.Type && current.ExternalProvider == observed.ExternalProvider && current.QueuePhase == observed.QueuePhase && current.DispatchState == observed.DispatchState && current.DispatchCiphertext == observed.DispatchCiphertext && current.UpdatedAt.Equal(observed.UpdatedAt) && sameOptionalTime(current.WorkerRetryAt, observed.WorkerRetryAt) && sameOptionalTime(current.DispatchNextAttemptAt, observed.DispatchNextAttemptAt) && bytes.Equal(nativeSnapshotJSON(current.BridgeMetadata), nativeSnapshotJSON(observed.BridgeMetadata))
}

func nativeOrphanDue(job model.Job, now time.Time) bool {
	return !RunningNativeRecoveryScheduled(job, now) && (job.DispatchNextAttemptAt == nil || !job.DispatchNextAttemptAt.After(now))
}

func (r *MemoryJobRepository) RouteNativeOrphan(observed model.Job, now time.Time) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	job, exists := r.jobs[observed.ID]
	if !exists {
		return false, ErrJobNotFound
	}
	if !nativeOrphanSnapshotMatches(job, observed) || !CanRouteNativeOrphan(job) || !nativeOrphanDue(job, now) {
		return false, nil
	}
	job.QueuePhase, job.Error = nativeOrphanOutcome(job)
	job.Status, job.DispatchState, job.DispatchNextAttemptAt, job.UpdatedAt = model.JobStatusQueued, model.JobDispatchObserved, nil, now
	r.jobs[job.ID] = job
	return true, nil
}

// A busy Worker only delays the relay's next observation. CAS prevents a stale
// scan from overwriting a newer Worker ACK/retry. No attempt or job state changes.
func (r *MemoryJobRepository) DeferBusyNativeRecovery(observed model.Job, next time.Time) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	job, exists := r.jobs[observed.ID]
	if !exists {
		return false, ErrJobNotFound
	}
	if !nativeOrphanSnapshotMatches(job, observed) || (job.DispatchNextAttemptAt != nil && !job.DispatchNextAttemptAt.Before(next)) {
		return false, nil
	}
	job.DispatchNextAttemptAt = &next
	r.jobs[job.ID] = job
	return true, nil
}

func (r *GormJobRepository) nativeOrphanSnapshotQuery(observed model.Job) *gorm.DB {
	raw := string(observed.BridgeMetadata)
	if raw == "" {
		raw = "{}"
	}
	return r.db.Model(&model.Job{}).Where(`id = ? AND status = ? AND status = 'running' AND type = ? AND COALESCE(external_provider,'') = ? AND COALESCE(queue_phase,'') = ? AND COALESCE(dispatch_state,'') = ? AND COALESCE(dispatch_ciphertext,'') = ? AND updated_at = ? AND worker_retry_at IS NOT DISTINCT FROM ? AND dispatch_next_attempt_at IS NOT DISTINCT FROM ? AND COALESCE(bridge_metadata,'{}'::jsonb) = ?::jsonb`, observed.ID, observed.Status, observed.Type, observed.ExternalProvider, observed.QueuePhase, observed.DispatchState, observed.DispatchCiphertext, observed.UpdatedAt, observed.WorkerRetryAt, observed.DispatchNextAttemptAt, raw)
}

func (r *GormJobRepository) RouteNativeOrphan(observed model.Job, now time.Time) (bool, error) {
	if !CanRouteNativeOrphan(observed) || !nativeOrphanDue(observed, now) {
		return false, nil
	}
	phase, failure := nativeOrphanOutcome(observed)
	result := r.nativeOrphanSnapshotQuery(observed).Where(orphanNativeRunningSQL).UpdateColumns(map[string]any{"status": model.JobStatusQueued, "queue_phase": phase, "error": failure, "dispatch_state": model.JobDispatchObserved, "dispatch_next_attempt_at": nil, "updated_at": now})
	return result.RowsAffected == 1, result.Error
}

func (r *GormJobRepository) DeferBusyNativeRecovery(observed model.Job, next time.Time) (bool, error) {
	if observed.DispatchNextAttemptAt != nil && !observed.DispatchNextAttemptAt.Before(next) {
		return false, nil
	}
	result := r.nativeOrphanSnapshotQuery(observed).UpdateColumn("dispatch_next_attempt_at", next)
	return result.RowsAffected == 1, result.Error
}
