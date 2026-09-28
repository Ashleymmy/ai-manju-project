package service

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
)

func TestJobDispatchRestoresLostProviderWaitRetry(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		for _, initialState := range []string{model.JobDispatchPublished, model.JobDispatchObserved} {
			t.Run(initialState, func(t *testing.T) {
				producer := &queue.MemoryProducer{}
				svc := dispatchService(repo, producer)
				billing := &jobSafetyBilling{}
				svc.SetBillingHooks(billing)
				input := dispatchInput("lost-provider-retry-" + initialState)
				created, err := svc.Enqueue(context.Background(), input)
				if err != nil {
					t.Fatal(err)
				}
				original := producer.Messages[0]
				ciphertext := created.Job.DispatchCiphertext
				// Worker writes the capacity wait before publishing a Celery retry.
				// Lose that retry and expire the relay's previous receipt grace.
				if _, err := repo.UpdateQueuePhase(created.Job.ID, "waiting_provider_slot"); err != nil {
					t.Fatal(err)
				}
				future := time.Now().UTC().Add(time.Minute)
				if err := repo.UpdateDispatch(created.Job.ID, initialState, &future, false); err != nil {
					t.Fatal(err)
				}
				if err := svc.DispatchPending(context.Background()); err != nil {
					t.Fatal(err)
				}
				if _, err := svc.Enqueue(context.Background(), input); err != nil || len(producer.Messages) != 1 {
					t.Fatal("provider wait bypassed its existing receipt grace")
				}
				past := time.Now().UTC().Add(-time.Minute)
				if err := repo.UpdateDispatch(created.Job.ID, initialState, &past, false); err != nil {
					t.Fatal(err)
				}
				if err := svc.DispatchPending(context.Background()); err != nil {
					t.Fatal(err)
				}
				if len(producer.Messages) != 2 {
					t.Fatalf("lost retry not recovered: deliveries=%d", len(producer.Messages))
				}
				restored := producer.Messages[1]
				if restored.JobID != original.JobID || restored.TaskName != original.TaskName || restored.Queue != original.Queue || string(restored.Payload) != string(original.Payload) || !reflect.DeepEqual(restored.Kwargs, original.Kwargs) {
					t.Fatal("recovery changed original job or execution snapshot")
				}
				current, _ := repo.GetByID(created.Job.ID)
				if current.DispatchCiphertext != ciphertext || current.Status != model.JobStatusQueued || current.StartedAt != nil || current.Attempts != 0 || current.QueuePhase != "waiting_provider_slot" || current.DispatchState != model.JobDispatchPublished || current.DispatchNextAttemptAt == nil || !current.DispatchNextAttemptAt.After(time.Now().UTC()) || billing.released != 0 {
					t.Fatal("recovery changed lifecycle, reservation, or receipt grace")
				}
				for range 3 {
					if err := svc.DispatchPending(context.Background()); err != nil {
						t.Fatal(err)
					}
				}
				// An HTTP idempotency replay also respects the same grace period.
				if replay, err := svc.Enqueue(context.Background(), input); err != nil || replay.Created || replay.Job.ID != created.Job.ID {
					t.Fatal("idempotency replay did not retain original job")
				}
				if len(producer.Messages) != 2 {
					t.Fatal("successive scans or replay duplicated delivery within receipt grace")
				}
			})
		}
	})
}

func TestJobDispatchLegacyProviderWaitWithoutDeadlineRecovers(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		producer := &queue.MemoryProducer{}
		svc := dispatchService(repo, producer)
		created, err := svc.Enqueue(context.Background(), dispatchInput("legacy-provider-wait"))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repo.UpdateQueuePhase(created.Job.ID, "waiting_provider_slot"); err != nil {
			t.Fatal(err)
		}
		if err := repo.UpdateDispatch(created.Job.ID, model.JobDispatchObserved, nil, false); err != nil {
			t.Fatal(err)
		}
		if err := svc.DispatchPending(context.Background()); err != nil {
			t.Fatal(err)
		}
		if len(producer.Messages) != 2 || producer.Messages[1].JobID != created.Job.ID {
			t.Fatal("legacy observed provider wait was stranded")
		}
	})
}

func TestJobDispatchProviderWaitPublicationFailureIsThrottled(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		created, err := dispatchService(repo, &queue.MemoryProducer{}).Enqueue(context.Background(), dispatchInput("provider-wait-broker-down"))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repo.UpdateQueuePhase(created.Job.ID, "waiting_provider_slot"); err != nil {
			t.Fatal(err)
		}
		past := time.Now().UTC().Add(-time.Minute)
		if err := repo.UpdateDispatch(created.Job.ID, model.JobDispatchObserved, &past, false); err != nil {
			t.Fatal(err)
		}
		calls := 0
		svc := dispatchService(repo, jobSafetyProducer(func(context.Context, queue.TaskMessage) error {
			calls++
			return errors.New("broker acknowledgement unavailable")
		}))
		for range 3 {
			if err := svc.DispatchPending(context.Background()); err != nil {
				t.Fatal(err)
			}
		}
		current, _ := repo.GetByID(created.Job.ID)
		if calls != 1 || current.Status != model.JobStatusQueued || current.DispatchCiphertext != created.Job.DispatchCiphertext || current.DispatchState != model.JobDispatchPending || current.DispatchNextAttemptAt == nil || !current.DispatchNextAttemptAt.After(time.Now().UTC()) {
			t.Fatal("broker failure lost reservation snapshot or bypassed retry spacing")
		}
	})
}

func TestJobDispatchProviderWaitNeverResendsStartedOrCheckpointedWork(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		cases := []struct {
			name, phase, metadata string
			started               bool
		}{
			{name: "already_started", phase: "waiting_provider_slot", started: true},
			{name: "accepted", phase: "waiting_provider_slot", metadata: `{"_worker_video_checkpoint":{"phase":"accepted","provider_task_id":"existing"}}`},
			{name: "uncertain", phase: "waiting_provider_slot", metadata: `{"_worker_video_checkpoint":{"phase":"submission_intent"}}`},
			{name: "image_received", phase: "waiting_provider_slot", metadata: `{"_worker_image_checkpoint":{"phase":"received"}}`},
			{name: "recovery_control", phase: "waiting_provider_slot", metadata: `{"_worker_recovery_control":{"acknowledged":true}}`},
			{name: "attention", phase: "video_recovery_attention"},
			{name: "uncertain_phase", phase: "image_submission_uncertain"},
		}
		for _, tc := range cases {
			for _, state := range []string{model.JobDispatchPublished, model.JobDispatchObserved} {
				t.Run(tc.name+"_"+state, func(t *testing.T) {
					producer := &queue.MemoryProducer{}
					svc := dispatchService(repo, producer)
					created, err := svc.Enqueue(context.Background(), dispatchInput(tc.name+"_"+state))
					if err != nil {
						t.Fatal(err)
					}
					if tc.started {
						if _, err := repo.UpdateStatus(created.Job.ID, model.JobStatusRunning); err != nil {
							t.Fatal(err)
						}
						if _, err := repo.UpdateStatus(created.Job.ID, model.JobStatusQueued); err != nil {
							t.Fatal(err)
						}
					}
					if tc.metadata != "" {
						if _, err := repo.SetExternalState(created.Job.ID, "", "", "", model.JSONB(tc.metadata)); err != nil {
							t.Fatal(err)
						}
					}
					if _, err := repo.UpdateQueuePhase(created.Job.ID, tc.phase); err != nil {
						t.Fatal(err)
					}
					past := time.Now().UTC().Add(-time.Minute)
					if err := repo.UpdateDispatch(created.Job.ID, state, &past, false); err != nil {
						t.Fatal(err)
					}
					if err := svc.DispatchPending(context.Background()); err != nil {
						t.Fatal(err)
					}
					current, _ := repo.GetByID(created.Job.ID)
					if len(producer.Messages) != 1 || current.DispatchCiphertext == "" || current.QueuePhase != tc.phase {
						t.Fatal("started or uncertain work was resent or lost its recovery state")
					}
				})
			}
		}
	})
}
