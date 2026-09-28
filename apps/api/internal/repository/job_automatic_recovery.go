package repository

import (
	"bytes"
	"encoding/json"
	"time"

	"github.com/ai-manju/api/internal/model"
)

// NativeRunningRecoveryGrace is only an observation window, not proof that a
// Worker has died. The API must also acquire the Worker's advisory lock and
// reread the accepted checkpoint before recovering an orphaned running job.
// Share the 120-second receipt grace used by queued delivery repair.
const NativeRunningRecoveryGrace = JobDispatchReceiptGrace

// Automatic recovery may only resume an accepted task/response. These selectors
// intentionally exclude submission_intent and operator holds, unlike the manual
// recovery action which can acknowledge a new administrator-directed window.
var automaticNativeRecoverySQL = `status IN ('queued', 'running') AND COALESCE(external_provider, '') = ''
 AND COALESCE(dispatch_ciphertext, '') <> '' AND jsonb_typeof(bridge_metadata) = 'object'
 AND (NOT jsonb_exists(bridge_metadata, '_worker_recovery_control')
      OR (jsonb_typeof(bridge_metadata->'_worker_recovery_control') = 'object'
          AND bridge_metadata->'_worker_recovery_control'->'acknowledged' = 'true'::jsonb))
 AND ((type = 'video.generate' AND (queue_phase IN ('video_recovery_pending', 'waiting_provider_slot') OR (status = 'running' AND COALESCE(queue_phase, '') = ''))
       AND ` + acceptedCheckpointSQL(nativeRetryVideoCheckpointKey, nativeRetryImageCheckpointKey, "'accepted','downloaded'", "provider_task_id") + `)
   OR (type IN ('image.generate', 'image.edit') AND (queue_phase IN ('image_recovery_pending', 'waiting_provider_slot') OR (status = 'running' AND COALESCE(queue_phase, '') = ''))
       AND ` + acceptedCheckpointSQL(nativeRetryImageCheckpointKey, nativeRetryVideoCheckpointKey, "'received','downloaded'", "receipt_id") + `))`

func acceptedCheckpointSQL(key, other, phases, identity string) string {
	cp := "(bridge_metadata->'" + key + "')"
	return `NOT jsonb_exists(bridge_metadata, '` + other + `')
 AND jsonb_typeof(` + cp + `) = 'object'
 AND jsonb_typeof(` + cp + `->'version') = 'number' AND ` + cp + `->>'version' = '1'
 AND jsonb_typeof(` + cp + `->'revision') = 'number'
 AND (` + cp + `->>'revision') ~ '^[1-9][0-9]*$'
 AND ` + cp + `->'revision' <= '9223372036854775807'::jsonb
 AND jsonb_typeof(` + cp + `->'provider_identity') = 'string' AND ` + cp + `->>'provider_identity' <> ''
 AND jsonb_typeof(` + cp + `->'phase') = 'string' AND ` + cp + `->>'phase' IN (` + phases + `)
 AND jsonb_typeof(` + cp + `->'` + identity + `') = 'string' AND ` + cp + `->>'` + identity + `' <> ''
 AND COALESCE(jsonb_typeof(` + cp + `->'recovery'), 'null') IN ('null', 'object')
 AND COALESCE(` + cp + `->'recovery'->'requires_attention', 'false'::jsonb) IN ('false'::jsonb, 'null'::jsonb)`
}

// CanAutomaticallyRecoverNative mirrors automaticNativeRecoverySQL, including
// strict JSON types. A retained snapshot is execution configuration, never proof
// that it is safe to create a new paid task.
func CanAutomaticallyRecoverNative(job model.Job) bool {
	if (job.Status != model.JobStatusQueued && job.Status != model.JobStatusRunning) || job.ExternalProvider != "" || job.DispatchCiphertext == "" {
		return false
	}
	var metadata map[string]json.RawMessage
	if json.Unmarshal(job.BridgeMetadata, &metadata) != nil || metadata == nil {
		return false
	}
	if raw, exists := metadata[JobRecoveryControlKey]; exists {
		var control struct {
			Acknowledged bool `json:"acknowledged"`
		}
		if json.Unmarshal(raw, &control) != nil || !control.Acknowledged {
			return false
		}
	}
	key, other, phase := nativeRetryVideoCheckpointKey, nativeRetryImageCheckpointKey, "video_recovery_pending"
	switch job.Type {
	case model.JobTypeVideoGenerate:
	case model.JobTypeImageGenerate, model.JobTypeImageEdit:
		key, other, phase = nativeRetryImageCheckpointKey, nativeRetryVideoCheckpointKey, "image_recovery_pending"
	default:
		return false
	}
	if job.QueuePhase != phase && job.QueuePhase != "waiting_provider_slot" && !(job.Status == model.JobStatusRunning && job.QueuePhase == "") {
		return false
	}
	if _, exists := metadata[other]; exists {
		return false
	}
	var checkpoint struct {
		Version  int             `json:"version"`
		Revision int64           `json:"revision"`
		Phase    string          `json:"phase"`
		Identity string          `json:"provider_identity"`
		TaskID   json.RawMessage `json:"provider_task_id"`
		Receipt  json.RawMessage `json:"receipt_id"`
		Recovery json.RawMessage `json:"recovery"`
	}
	if json.Unmarshal(metadata[key], &checkpoint) != nil || checkpoint.Version != 1 || checkpoint.Revision < 1 || checkpoint.Identity == "" {
		return false
	}
	var receipt string
	if job.Type == model.JobTypeVideoGenerate {
		if json.Unmarshal(checkpoint.TaskID, &receipt) != nil || receipt == "" || (checkpoint.Phase != "accepted" && checkpoint.Phase != "downloaded") {
			return false
		}
	} else if json.Unmarshal(checkpoint.Receipt, &receipt) != nil || receipt == "" || (checkpoint.Phase != "received" && checkpoint.Phase != "downloaded") {
		return false
	}
	if len(checkpoint.Recovery) > 0 && !bytes.Equal(bytes.TrimSpace(checkpoint.Recovery), []byte("null")) {
		var recovery struct {
			RequiresAttention bool `json:"requires_attention"`
		}
		if json.Unmarshal(checkpoint.Recovery, &recovery) != nil || recovery.RequiresAttention {
			return false
		}
	}
	return true
}

// RunningNativeRecoveryScheduled keeps fresh running work and renewed Worker
// timers out of the scan as well as the locked publication path. A missing
// update timestamp fails closed; neither age nor an accepted ID alone permits
// recovery without acquiring the live Worker lock.
func RunningNativeRecoveryScheduled(job model.Job, now time.Time) bool {
	return job.UpdatedAt.IsZero() || job.UpdatedAt.Add(NativeRunningRecoveryGrace).After(now) ||
		(job.WorkerRetryAt != nil && job.WorkerRetryAt.Add(JobDispatchReceiptGrace).After(now))
}
