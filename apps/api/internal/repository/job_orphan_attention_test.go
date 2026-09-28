package repository

import (
	"encoding/json"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
)

func orphanFixture(id string, now time.Time) model.Job {
	return model.Job{ID: id, IdempotencyKey: id, UserID: "user", WorkspaceID: "workspace", Type: model.JobTypeVideoGenerate, Status: model.JobStatusRunning, DispatchState: model.JobDispatchObserved, DispatchCiphertext: "retained-original-config", BridgeMetadata: model.JSONB(`{}`), Payload: model.JSONB(`{}`), Attempts: 2, MaxAttempts: 3, UpdatedAt: now.Add(-3 * time.Minute)}
}

func TestNativeOrphanRoutingMemoryPostgresParity(t *testing.T) {
	forRunningRecoveryScanRepositories(t, func(t *testing.T, repo JobRepository, seed func(model.Job)) {
		now := time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)
		for index, tc := range []struct {
			name  string
			alter func(*model.Job)
			phase string
		}{
			{"missing", nil, "video_recovery_attention"},
			{"missing_config", func(j *model.Job) { j.DispatchCiphertext = "" }, "video_recovery_attention"},
			{"scalar_metadata", func(j *model.Job) { j.BridgeMetadata = model.JSONB(`"unknown"`) }, "video_recovery_attention"},
			{"image_missing", func(j *model.Job) { j.Type = model.JobTypeImageGenerate }, "image_recovery_attention"},
			{"edit_missing", func(j *model.Job) { j.Type = model.JobTypeImageEdit }, "image_recovery_attention"},
			{"uncertain", func(j *model.Job) {
				j.BridgeMetadata = model.JSONB(`{"_worker_video_checkpoint":{"version":1,"revision":2,"phase":"submission_intent","provider_identity":"original"}}`)
			}, "video_recovery_attention"},
			{"accepted_no_config", func(j *model.Job) {
				j.DispatchCiphertext = ""
				j.BridgeMetadata = model.JSONB(`{"_worker_video_checkpoint":{"version":1,"revision":2,"phase":"accepted","provider_task_id":"original-task","provider_identity":"original"}}`)
			}, "video_recovery_attention"},
			{"proven_rejection", func(j *model.Job) {
				j.BridgeMetadata = model.JSONB(`{"_worker_video_checkpoint":{"version":1,"revision":2,"phase":"rejected","provider_identity":"original"}}`)
			}, "provider_retry_backoff"},
			{"rejection_has_task", func(j *model.Job) {
				j.BridgeMetadata = model.JSONB(`{"_worker_video_checkpoint":{"version":1,"revision":2,"phase":"rejected","provider_task_id":"may-have-been-accepted","provider_identity":"original"}}`)
			}, "video_recovery_attention"},
			{"fresh", func(j *model.Job) { j.UpdatedAt = now }, ""},
			{"future_retry", func(j *model.Job) { at := now.Add(time.Hour); j.WorkerRetryAt = &at }, ""},
			{"future_dispatch", func(j *model.Job) { at := now.Add(time.Hour); j.DispatchNextAttemptAt = &at }, ""},
			{"external", func(j *model.Job) { j.ExternalProvider = "sd-video" }, ""},
			{"manual_control", func(j *model.Job) {
				j.BridgeMetadata = model.JSONB(`{"_worker_recovery_control":{"acknowledged":false}}`)
			}, ""},
			{"operator_hold", func(j *model.Job) { j.QueuePhase = "video_recovery_attention" }, ""},
		} {
			t.Run(tc.name, func(t *testing.T) {
				job := orphanFixture(fmt.Sprintf("orphan_%d", index), now)
				if tc.alter != nil {
					tc.alter(&job)
				}
				seed(job)
				observed, _ := repo.GetByID(job.ID)
				ids, err := repo.ListDispatchPendingIDs(now, 0)
				if err != nil || slices.Contains(ids, job.ID) != (tc.phase != "") {
					t.Fatalf("orphan scan mismatch phase=%s error=%v", tc.phase, err)
				}
				changed, err := repo.(NativeOrphanRepository).RouteNativeOrphan(observed, now)
				if err != nil || changed != (tc.phase != "") {
					t.Fatalf("orphan CAS mismatch: changed=%v error=%v", changed, err)
				}
				stored, _ := repo.GetByID(job.ID)
				if tc.phase == "" {
					return
				}
				if stored.Status != model.JobStatusQueued || stored.QueuePhase != tc.phase || stored.DispatchCiphertext != observed.DispatchCiphertext || stored.Attempts != observed.Attempts || stored.DispatchAttempts != observed.DispatchAttempts || string(nativeSnapshotJSON(stored.BridgeMetadata)) != string(nativeSnapshotJSON(observed.BridgeMetadata)) {
					t.Fatal("routing destroyed original execution evidence")
				}
				if tc.phase == "provider_retry_backoff" {
					if !CanRedispatchProviderWait(stored) {
						t.Fatal("proven rejected retry was disabled")
					}
					return
				}
				var failure map[string]any
				_ = json.Unmarshal(stored.Error, &failure)
				if failure["message"] != NativeOrphanAttentionMessage || failure["retryable"] != false {
					t.Fatal("orphan did not get fixed safe operator message")
				}
				rows, _, err := repo.(NativeJobRecoveryRepository).ListNativeRecovery(100, 0)
				found := false
				for _, row := range rows {
					found = found || row.ID == job.ID
				}
				if err != nil || !found {
					t.Fatal("missing evidence orphan absent from administrator reconciliation")
				}
				ids, _ = repo.ListDispatchPendingIDs(now.Add(time.Hour), 0)
				if slices.Contains(ids, job.ID) {
					t.Fatal("attention job remained in automatic relay scan")
				}
			})
		}
	})
}

func TestNativeOrphanCASRejectsConcurrentCheckpointCancelAndTimerChanges(t *testing.T) {
	forRunningRecoveryScanRepositories(t, func(t *testing.T, repo JobRepository, seed func(model.Job)) {
		now := time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)
		for index, field := range []string{"status", "bridge_metadata", "worker_retry_at", "dispatch_next_attempt_at", "dispatch_state", "dispatch_ciphertext"} {
			t.Run(field, func(t *testing.T) {
				job := orphanFixture(fmt.Sprintf("orphan_cas_%d", index), now)
				seed(job)
				observed, _ := repo.GetByID(job.ID)
				future := now.Add(time.Hour)
				values := map[string]any{"status": model.JobStatusCanceled, "bridge_metadata": model.JSONB(`{"_worker_video_checkpoint":{"version":1,"revision":3,"phase":"accepted","provider_identity":"new","provider_task_id":"new-original-task"}}`), "worker_retry_at": &future, "dispatch_next_attempt_at": &future, "dispatch_state": JobDispatchRecoveryPending, "dispatch_ciphertext": "different-config"}
				switch typed := repo.(type) {
				case *MemoryJobRepository:
					typed.mu.Lock()
					current := typed.jobs[job.ID]
					switch field {
					case "status":
						current.Status = model.JobStatusCanceled
					case "bridge_metadata":
						current.BridgeMetadata = values[field].(model.JSONB)
					case "worker_retry_at":
						current.WorkerRetryAt = &future
					case "dispatch_next_attempt_at":
						current.DispatchNextAttemptAt = &future
					case "dispatch_state":
						current.DispatchState = JobDispatchRecoveryPending
					case "dispatch_ciphertext":
						current.DispatchCiphertext = "different-config"
					}
					typed.jobs[job.ID] = current
					typed.mu.Unlock()
				case *GormJobRepository:
					if err := typed.db.Model(&model.Job{}).Where("id = ?", job.ID).UpdateColumn(field, values[field]).Error; err != nil {
						t.Fatal(err)
					}
				}
				// Keep UpdatedAt unchanged deliberately: CAS must also fence the
				// actual checkpoint/control/timer, not merely its write timestamp.
				if changed, err := repo.(NativeOrphanRepository).RouteNativeOrphan(observed, now); err != nil || changed {
					t.Fatal("stale orphan routing overwrote newer evidence")
				}
				if changed, err := repo.(NativeOrphanRepository).DeferBusyNativeRecovery(observed, now.Add(2*time.Hour)); err != nil || changed {
					t.Fatal("busy scan delay overwrote newer Worker state")
				}
			})
		}
	})
}
