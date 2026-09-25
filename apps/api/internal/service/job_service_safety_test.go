package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
)

type jobSafetyBilling struct {
	watermark *bool
	reserved  int
	released  int
}

func TestNormalizedVideoWatermarkKeepsConvertedProviderSchema(t *testing.T) {
	parameters := map[string]any{"duration": 5, "watermark": false}
	provider := map[string]any{"provider_type": model.ModelProviderTypeAliyunYike, "video_request_body": map[string]any{"input": map[string]any{"prompt": "test"}, "parameters": parameters}}
	got := normalizedVideoTaskKwargs(model.JobTypeVideoGenerate, model.JSONB(`{"watermark":true}`), map[string]any{"provider": provider})
	body := got["provider"].(map[string]any)["video_request_body"].(map[string]any)
	if _, exists := body["watermark"]; exists {
		t.Fatal("watermark added outside provider parameters")
	}
	if body["parameters"].(map[string]any)["watermark"] != true || body["parameters"].(map[string]any)["duration"] != 5 || parameters["watermark"] != false {
		t.Fatal("converted parameters changed or were not normalized")
	}
}

func (b *jobSafetyBilling) NormalizePayloadForJob(_ string, _ string, payload model.JSONB) (model.JSONB, error) {
	if b.watermark == nil {
		return payload, nil
	}
	var body map[string]any
	if err := json.Unmarshal(payload, &body); err != nil {
		return nil, err
	}
	body["watermark"] = *b.watermark
	return json.Marshal(body)
}

func (b *jobSafetyBilling) ReserveForJob(string, string, string, model.JSONB) error {
	b.reserved++
	return nil
}

func (b *jobSafetyBilling) ReleaseForJob(string) { b.released++ }

func TestJobServiceExplicitKeysAreScoped(t *testing.T) {
	producer := &queue.MemoryProducer{}
	svc := NewJobService(repository.NewMemoryJobRepository(), producer, "celery", 3)
	inputs := []EnqueueJobInput{
		{UserID: "a", Scope: "personal", Type: model.JobTypeVideoGenerate},
		{UserID: "b", Scope: "personal", Type: model.JobTypeVideoGenerate},
		{UserID: "a", Scope: "team", Type: model.JobTypeVideoGenerate},
		{UserID: "a", Scope: "personal", Type: model.JobTypeImageGenerate},
	}
	seen := map[string]bool{}
	for _, input := range inputs {
		input.IdempotencyKey = "shared-client-key"
		input.Payload = model.JSONB(`{"prompt":"test"}`)
		first, err := svc.Enqueue(context.Background(), input)
		if err != nil || !first.Created || seen[first.Job.ID] {
			t.Fatalf("scope was not isolated: result=%+v err=%v", first, err)
		}
		seen[first.Job.ID] = true
		second, err := svc.Enqueue(context.Background(), input)
		if err != nil || second.Created || second.Job.ID != first.Job.ID {
			t.Fatalf("same-scope retry not idempotent: result=%+v err=%v", second, err)
		}
	}
	if len(producer.Messages) != len(inputs) {
		t.Fatalf("published %d messages, want %d", len(producer.Messages), len(inputs))
	}
}

func TestJobServiceLegacyExplicitKeysRespectOwnership(t *testing.T) {
	for _, tc := range []struct {
		name, user, scope, jobType string
		matches                    bool
	}{
		{"same", "a", "personal", model.JobTypeVideoGenerate, true},
		{"different user", "b", "personal", model.JobTypeVideoGenerate, false},
		{"different workspace", "a", "team", model.JobTypeVideoGenerate, false},
		{"different type", "a", "personal", model.JobTypeImageGenerate, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := repository.NewMemoryJobRepository()
			_, err := repo.Create(model.Job{ID: "legacy", UserID: "a", WorkspaceID: WorkspaceIDForScope("personal", "a"), Type: model.JobTypeVideoGenerate, IdempotencyKey: "raw-key", Status: model.JobStatusQueued, Payload: model.JSONB(`{}`)})
			if err != nil {
				t.Fatal(err)
			}
			producer := &queue.MemoryProducer{}
			svc := NewJobService(repo, producer, "celery", 3)
			input := EnqueueJobInput{UserID: tc.user, Scope: tc.scope, Type: tc.jobType, IdempotencyKey: "raw-key", Payload: model.JSONB(`{}`)}
			result, err := svc.Enqueue(context.Background(), input)
			if err != nil || (result.Job.ID == "legacy") != tc.matches || result.Created == tc.matches {
				t.Fatalf("legacy lookup result=%+v err=%v", result, err)
			}
			if tc.matches && len(producer.Messages) != 0 {
				t.Fatal("legacy retry unexpectedly published")
			}
			input.RepublishExisting = true
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			retried, err := svc.Enqueue(ctx, input)
			if err != nil || retried.Job.ID != result.Job.ID {
				t.Fatalf("republish result=%+v err=%v", retried, err)
			}
		})
	}
}

func TestJobServiceExplicitKeyCannotAliasImplicitFingerprint(t *testing.T) {
	producer := &queue.MemoryProducer{}
	svc := NewJobService(repository.NewMemoryJobRepository(), producer, "celery", 3)
	input := EnqueueJobInput{UserID: "a", Scope: "personal", Type: model.JobTypeImageGenerate, Payload: model.JSONB(`{"prompt":"original"}`)}
	input.IdempotencyKey = fingerprintJob(input.UserID, WorkspaceIDForScope(input.Scope, input.UserID), input.Type, input.Payload)
	first, err := svc.Enqueue(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	input.IdempotencyKey = ""
	second, err := svc.Enqueue(context.Background(), input)
	if err != nil || !second.Created || first.Job.ID == second.Job.ID || len(producer.Messages) != 2 {
		t.Fatalf("explicit key collided with an implicit fingerprint: first=%+v second=%+v err=%v", first, second, err)
	}
}

type cancelAfterCreateJobRepository struct {
	repository.JobRepository
	cancel context.CancelFunc
}

func (r cancelAfterCreateJobRepository) Create(job model.Job) (model.Job, error) {
	created, err := r.JobRepository.Create(job)
	r.cancel()
	return created, err
}

type jobSafetyProducer func(context.Context, queue.TaskMessage) error

func (p jobSafetyProducer) Publish(ctx context.Context, message queue.TaskMessage) error {
	return p(ctx, message)
}

func TestJobServiceDurablePublicationSurvivesRequestCancellation(t *testing.T) {
	type contextKey struct{}
	for _, stage := range []string{"after-create", "during-publish", "expired-republish"} {
		t.Run(stage, func(t *testing.T) {
			base := context.WithValue(context.Background(), contextKey{}, "trace")
			ctx, cancel := context.WithCancel(base)
			defer cancel()
			var repo repository.JobRepository = repository.NewMemoryJobRepository()
			input := EnqueueJobInput{UserID: "a", Scope: "personal", Type: model.JobTypeVideoGenerate, Payload: model.JSONB(`{}`), IdempotencyKey: "durable"}
			if stage == "after-create" {
				repo = cancelAfterCreateJobRepository{JobRepository: repo, cancel: cancel}
			}
			if stage == "expired-republish" {
				_, err := repo.Create(model.Job{ID: "existing", UserID: "a", WorkspaceID: WorkspaceIDForScope("personal", "a"), Type: input.Type, Status: model.JobStatusQueued, Payload: input.Payload, IdempotencyKey: input.IdempotencyKey})
				if err != nil {
					t.Fatal(err)
				}
				var expiredCancel context.CancelFunc
				ctx, expiredCancel = context.WithDeadline(base, time.Now().Add(-time.Second))
				defer expiredCancel()
				input.RepublishExisting = true
			}
			published := 0
			var brokerContext context.Context
			producer := jobSafetyProducer(func(publishCtx context.Context, _ queue.TaskMessage) error {
				published++
				brokerContext = publishCtx
				cancel()
				if publishCtx.Err() != nil || publishCtx.Value(contextKey{}) != "trace" {
					t.Fatalf("publication lost context values or was canceled: %v", publishCtx.Err())
				}
				deadline, ok := publishCtx.Deadline()
				if remaining := time.Until(deadline); !ok || remaining <= 0 || remaining > jobPublishTimeout {
					t.Fatalf("publication has no bounded fresh deadline: %v %v", deadline, ok)
				}
				return nil
			})
			svc := NewJobService(repo, producer, "celery", 3)
			billing := &jobSafetyBilling{}
			svc.SetBillingHooks(billing)
			result, err := svc.Enqueue(ctx, input)
			if err != nil || result.Job.Status != model.JobStatusQueued || published != 1 || billing.released != 0 {
				t.Fatalf("durable publish result=%+v err=%v calls=%d releases=%d", result, err, published, billing.released)
			}
			if brokerContext.Err() != context.Canceled {
				t.Fatal("publication context was not cleaned up")
			}
		})
	}
}

func TestJobServiceNormalizedWatermarkReachesAllNativeProviders(t *testing.T) {
	for _, watermark := range []bool{true, false} {
		for _, asAny := range []bool{true, false} {
			preferred := map[string]any{"video_request_body": map[string]any{"watermark": !watermark, "prompt": "keep"}}
			fallback := map[string]any{"video_request_body": map[string]any{"watermark": !watermark}}
			kwargs := map[string]any{"provider": preferred, "provider_candidates": []map[string]any{preferred, fallback}}
			if asAny {
				kwargs["provider_candidates"] = []any{preferred, fallback}
			}
			producer := &queue.MemoryProducer{}
			svc := NewJobService(repository.NewMemoryJobRepository(), producer, "celery", 3)
			svc.SetBillingHooks(&jobSafetyBilling{watermark: &watermark})
			input := EnqueueJobInput{UserID: "a", Scope: "personal", Type: model.JobTypeVideoGenerate, Payload: model.JSONB(`{"watermark":false}`), TaskKwargs: kwargs, IdempotencyKey: "watermark"}
			if _, err := svc.Enqueue(context.Background(), input); err != nil {
				t.Fatal(err)
			}
			input.RepublishExisting = true
			input.Payload = model.JSONB(`{"watermark":false}`)
			if _, err := svc.Enqueue(context.Background(), input); err != nil {
				t.Fatal(err)
			}
			for _, message := range producer.Messages {
				encoded, err := json.Marshal(message.Kwargs)
				if err != nil {
					t.Fatal(err)
				}
				var actual map[string]any
				if err := json.Unmarshal(encoded, &actual); err != nil {
					t.Fatal(err)
				}
				providers := append([]any{actual["provider"]}, actual["provider_candidates"].([]any)...)
				for _, value := range providers {
					body := value.(map[string]any)["video_request_body"].(map[string]any)
					if body["watermark"] != watermark {
						t.Fatalf("provider watermark=%v, want %v", body["watermark"], watermark)
					}
				}
			}
			if preferred["video_request_body"].(map[string]any)["watermark"] != !watermark || fallback["video_request_body"].(map[string]any)["watermark"] != !watermark {
				t.Fatal("caller provider maps were mutated")
			}
		}
	}
}
