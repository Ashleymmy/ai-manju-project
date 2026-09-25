package repository

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func forRunningRecoveryScanRepositories(t *testing.T, run func(*testing.T, JobRepository, func(model.Job))) {
	t.Helper()
	t.Run("Memory", func(t *testing.T) {
		repo := NewMemoryJobRepository()
		run(t, repo, func(job model.Job) {
			repo.clockFn = func() time.Time { return job.UpdatedAt }
			if _, err := repo.Create(job); err != nil {
				t.Fatal(err)
			}
		})
	})
	t.Run("Postgres", func(t *testing.T) {
		dsn := os.Getenv("JOB_DISPATCH_TEST_DATABASE_URL")
		if dsn == "" {
			t.Skip("isolated PostgreSQL connection not configured")
		}
		root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
		if err != nil {
			t.Fatal("test PostgreSQL connection unavailable")
		}
		schema := fmt.Sprintf("running_recovery_test_%d", time.Now().UnixNano())
		if root.Exec("CREATE SCHEMA "+schema).Error != nil {
			t.Fatal("cannot create isolated running recovery schema")
		}
		t.Cleanup(func() { root.Exec("DROP SCHEMA " + schema + " CASCADE"); db, _ := root.DB(); _ = db.Close() })
		parsed, err := url.Parse(dsn)
		if err != nil {
			t.Fatal("invalid test PostgreSQL URL")
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
		if err != nil {
			t.Fatal("isolated test PostgreSQL connection unavailable")
		}
		t.Cleanup(func() { connection, _ := db.DB(); _ = connection.Close() })
		if err := db.AutoMigrate(&model.Job{}); err != nil {
			t.Fatal("running recovery schema migration failed")
		}
		run(t, NewGormJobRepository(db), func(job model.Job) {
			updated := job.UpdatedAt
			if err := db.Create(&job).Error; err != nil {
				t.Fatal("running fixture insert failed")
			}
			// Direct fixture seeding preserves the simulated last Worker write,
			// including unknown legacy timestamps, without blocking real time.
			var value any = updated
			if updated.IsZero() {
				value = nil
			}
			if err := db.Model(&model.Job{}).Where("id = ?", job.ID).UpdateColumn("updated_at", value).Error; err != nil {
				t.Fatal("running timestamp fixture failed")
			}
		})
	})
}

func TestAutomaticRecoveryRunningScanMemoryPostgresParity(t *testing.T) {
	forRunningRecoveryScanRepositories(t, func(t *testing.T, repo JobRepository, seed func(model.Job)) {
		now := time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)
		type scenario struct {
			name   string
			change func(*model.Job, map[string]any, map[string]any)
			want   bool
		}
		cases := []scenario{
			{"stale_video_accepted", nil, true},
			{"video_downloaded", func(j *model.Job, cp, m map[string]any) { cp["phase"] = "downloaded" }, true},
			{"running_recovery_wait", func(j *model.Job, cp, m map[string]any) { j.QueuePhase = "video_recovery_pending" }, true},
			{"running_gate_wait", func(j *model.Job, cp, m map[string]any) { j.QueuePhase = "waiting_provider_slot" }, true},
			{"recent_worker_update", func(j *model.Job, cp, m map[string]any) {
				j.UpdatedAt = now.Add(-NativeRunningRecoveryGrace + time.Second)
			}, false},
			{"freshness_boundary", func(j *model.Job, cp, m map[string]any) { j.UpdatedAt = now.Add(-NativeRunningRecoveryGrace) }, true},
			{"future_worker_update", func(j *model.Job, cp, m map[string]any) { j.UpdatedAt = now.Add(time.Minute) }, false},
			{"unknown_worker_update", func(j *model.Job, cp, m map[string]any) { j.UpdatedAt = time.Time{} }, false},
			{"future_worker_retry", func(j *model.Job, cp, m map[string]any) { retry := now.Add(time.Minute); j.WorkerRetryAt = &retry }, false},
			{"worker_retry_grace", func(j *model.Job, cp, m map[string]any) { retry := now.Add(-time.Minute); j.WorkerRetryAt = &retry }, false},
			{"worker_retry_boundary", func(j *model.Job, cp, m map[string]any) {
				retry := now.Add(-JobDispatchReceiptGrace)
				j.WorkerRetryAt = &retry
			}, true},
			{"relay_receipt_wait", func(j *model.Job, cp, m map[string]any) {
				next := now.Add(time.Minute)
				j.DispatchNextAttemptAt = &next
			}, false},
			{"acknowledged_manual_control", func(j *model.Job, cp, m map[string]any) {
				m[JobRecoveryControlKey] = map[string]any{"acknowledged": true}
			}, true},
			{"unacknowledged_manual_control", func(j *model.Job, cp, m map[string]any) {
				m[JobRecoveryControlKey] = map[string]any{"acknowledged": false}
			}, false},
			{"attention", func(j *model.Job, cp, m map[string]any) { cp["recovery"] = map[string]any{"requires_attention": true} }, false},
			{"attention_phase", func(j *model.Job, cp, m map[string]any) { j.QueuePhase = "video_recovery_attention" }, false},
			{"uncertain_submission", func(j *model.Job, cp, m map[string]any) { cp["phase"] = "submission_intent" }, false},
			{"missing_original_task", func(j *model.Job, cp, m map[string]any) { delete(cp, "provider_task_id") }, false},
			{"missing_checkpoint", func(j *model.Job, cp, m map[string]any) { delete(m, nativeRetryVideoCheckpointKey) }, false},
			{"conflicting_checkpoints", func(j *model.Job, cp, m map[string]any) { m[nativeRetryImageCheckpointKey] = map[string]any{} }, false},
			{"no_original_configuration", func(j *model.Job, cp, m map[string]any) { j.DispatchCiphertext = "" }, false},
			{"external_sd_video", func(j *model.Job, cp, m map[string]any) { j.ExternalProvider = "sd-video" }, false},
			{"queued_without_recovery_phase", func(j *model.Job, cp, m map[string]any) { j.Status = model.JobStatusQueued }, false},
			{"image_received", func(j *model.Job, cp, m map[string]any) {
				j.Type = model.JobTypeImageGenerate
				cp["phase"], cp["receipt_id"] = "received", "original-receipt"
				delete(m, nativeRetryVideoCheckpointKey)
				m[nativeRetryImageCheckpointKey] = cp
			}, true},
			{"image_edit_downloaded", func(j *model.Job, cp, m map[string]any) {
				j.Type, j.QueuePhase = model.JobTypeImageEdit, "waiting_provider_slot"
				cp["phase"], cp["receipt_id"] = "downloaded", "original-receipt"
				delete(m, nativeRetryVideoCheckpointKey)
				m[nativeRetryImageCheckpointKey] = cp
			}, true},
		}
		var expected []string
		for index, tc := range cases {
			cp := map[string]any{"version": 1, "revision": 2, "phase": "accepted", "provider_identity": "original-provider", "provider_task_id": "original-task", "recovery": map[string]any{"failures": 3, "requires_attention": false}}
			metadata := map[string]any{nativeRetryVideoCheckpointKey: cp}
			id := fmt.Sprintf("scan_%02d", index)
			job := model.Job{ID: id, IdempotencyKey: id, UserID: "user", Type: model.JobTypeVideoGenerate, Status: model.JobStatusRunning, DispatchState: model.JobDispatchObserved, DispatchCiphertext: "synthetic-encrypted-original", UpdatedAt: now.Add(-3 * time.Minute), Payload: model.JSONB(`{}`)}
			if tc.change != nil {
				tc.change(&job, cp, metadata)
			}
			job.BridgeMetadata, _ = json.Marshal(metadata)
			seed(job)
			if tc.want {
				expected = append(expected, id)
			}
			t.Run(tc.name, func(t *testing.T) {
				ids, err := repo.ListDispatchPendingIDs(now, 0)
				if err != nil || slices.Contains(ids, id) != tc.want {
					t.Fatalf("scan eligibility differs: expected=%v error=%v", tc.want, err)
				}
				memoryDecision := CanAutomaticallyRecoverNative(job) && !ProviderRetryScheduled(job, now) && (job.DispatchNextAttemptAt == nil || !job.DispatchNextAttemptAt.After(now))
				if memoryDecision != tc.want {
					t.Fatal("locked predicate differs from SQL scan")
				}
			})
		}
		ids, err := repo.ListDispatchPendingIDs(now, 0)
		if err != nil || len(ids) != len(expected) {
			t.Fatal("final scan included an unsafe running candidate")
		}
		for _, id := range expected {
			if !slices.Contains(ids, id) {
				t.Fatal("final scan lost a valid orphan candidate")
			}
		}
	})
}
