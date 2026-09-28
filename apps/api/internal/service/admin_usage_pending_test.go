package service

import (
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

func TestAdminUsagePendingReservationAge(t *testing.T) {
	now := time.Now().UTC()
	for _, tc := range []struct {
		name                 string
		jobAt, consumptionAt time.Time
		wantSeconds          float64
	}{
		{"uses reservation instead of earlier job", now.Add(-time.Hour), now.Add(-2 * time.Minute), 120},
		{"falls back to job timestamp", now.Add(-3 * time.Minute), time.Time{}, 180},
		{"unknown timestamps do not invent an ancient wait", time.Time{}, time.Time{}, 0},
		{"future reservation never gives negative age", now.Add(-time.Hour), now.Add(time.Hour), 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			row := UsageRow{Status: model.JobStatusQueued, CreatedAt: tc.jobAt}
			attachConsumption(&row, model.TaskConsumption{Status: model.TaskConsumptionStatusReserved, CreatedAt: tc.consumptionAt})
			if row.PendingAgeSeconds < tc.wantSeconds || row.PendingAgeSeconds > tc.wantSeconds+2 {
				t.Fatalf("pending age = %v, expected %v seconds", row.PendingAgeSeconds, tc.wantSeconds)
			}
			if tc.wantSeconds == 0 && row.PendingAgeSeconds != 0 {
				t.Fatalf("unknown or future timestamps must have no elapsed age: %+v", row)
			}
		})
	}
}

func TestAdminUsagePendingReasonClassification(t *testing.T) {
	for _, tc := range []struct {
		name, status, phase, billingMode, want string
	}{
		{"waiting for dispatch", model.JobStatusQueued, model.JobQueueWaitingDispatch, "", model.JobQueueWaitingDispatch},
		{"waiting for provider", model.JobStatusQueued, "waiting_provider_slot", "", "waiting_provider_slot"},
		{"plain queued job", model.JobStatusQueued, "", "", "job_in_progress"},
		{"running job", model.JobStatusRunning, "", "", "job_in_progress"},
		{"automatic video metrics", model.JobStatusSucceeded, "waiting_provider_slot", AutomaticVideoBillingMode, "video_metrics_pending"},
		{"fixed-duration video is not waiting for metrics", model.JobStatusSucceeded, "", "", "reservation_pending"},
		{"missing job reservation", "missing_job", "", "", "reservation_pending"},
		{"native uncertain image", model.JobStatusQueued, "image_submission_uncertain", "", "image_submission_uncertain"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			row := UsageRow{Status: tc.status, QueuePhase: tc.phase}
			params := model.JSONB(`{"billing_mode":"` + tc.billingMode + `"}`)
			attachConsumption(&row, model.TaskConsumption{Status: model.TaskConsumptionStatusReserved, Params: params})
			if row.PendingReason != tc.want {
				t.Fatalf("pending reason = %q, want %q", row.PendingReason, tc.want)
			}
		})
	}
	for _, status := range []string{model.TaskConsumptionStatusReleased, model.TaskConsumptionStatusSettled} {
		row := UsageRow{Status: model.JobStatusFailed, PendingReason: "submission_uncertain", PendingAgeSeconds: 120}
		attachConsumption(&row, model.TaskConsumption{Status: status})
		if row.PendingReason != "" || row.PendingAgeSeconds != 0 {
			t.Fatalf("%s consumption retained stale pending metadata: %+v", status, row)
		}
	}
}

func TestAdminUsageSubmissionUncertainOnlyPendingWhileReserved(t *testing.T) {
	usageTestBackends(t, func(t *testing.T, f usageTestFixture) {
		now := time.Now().UTC()
		if _, err := f.credits.AdjustPermanent("pending-user", 100, model.LedgerTypeAdminAdd, "test", "fund-pending", now); err != nil {
			t.Fatal(err)
		}
		for _, status := range []string{model.TaskConsumptionStatusReserved, model.TaskConsumptionStatusReleased, model.TaskConsumptionStatusSettled, "untracked"} {
			id := "uncertain-" + status
			if _, err := f.jobs.Create(model.Job{ID: id, IdempotencyKey: id, UserID: "pending-user", WorkspaceID: "workspace", Type: model.JobTypeVideoGenerate, Status: model.JobStatusFailed, ExternalProvider: "sd-video", Payload: model.JSONB(`{}`), Result: model.JSONB(`{}`), Error: model.JSONB(`{"code":"submission_uncertain"}`)}); err != nil {
				t.Fatal(err)
			}
			if status == "untracked" {
				continue
			}
			if _, err := f.credits.Reserve(repository.ReserveInput{JobID: id, UserID: "pending-user", TaskType: model.TaskTypeVideoStandard, Model: "video", Credits: 10, Params: model.JSONB(`{}`), Now: now}); err != nil {
				t.Fatal(err)
			}
			if status == model.TaskConsumptionStatusReleased {
				if _, err := f.credits.Release(id, now); err != nil {
					t.Fatal(err)
				}
			}
			if status == model.TaskConsumptionStatusSettled {
				if _, err := f.credits.Settle(id, now); err != nil {
					t.Fatal(err)
				}
			}
		}
		out, err := f.report.Report(UsageFilter{Start: now.Add(-time.Hour), End: now.Add(time.Hour), Page: 1, PageSize: 20})
		if err != nil {
			t.Fatal(err)
		}
		if out.Total != 4 || out.Stats.CreditsFrozen != 10 {
			t.Fatalf("unexpected pending facts: %+v", out)
		}
		for _, row := range out.Items {
			if row.CreditStatus == model.TaskConsumptionStatusReserved {
				if row.PendingReason != "submission_uncertain" || row.PendingAgeSeconds < 0 {
					t.Fatalf("missing uncertain reservation: %+v", row)
				}
			} else if row.PendingReason != "" || row.PendingAgeSeconds != 0 {
				t.Fatalf("non-reserved job is incorrectly shown as pending: %+v", row)
			}
		}
	})
}
