package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/storage"
)

type failingJobProducer struct{}

func (failingJobProducer) Publish(context.Context, queue.TaskMessage) error {
	return errors.New("broker unavailable")
}

func TestTaskNameForVideoGeneration(t *testing.T) {
	if got := taskNameForJobType(model.JobTypeVideoGenerate); got != "worker.video_generate" {
		t.Fatalf("taskNameForJobType(video.generate) = %q", got)
	}
}

func TestJobServiceEnqueueIsIdempotent(t *testing.T) {
	producer := &queue.MemoryProducer{}
	svc := NewJobService(repository.NewMemoryJobRepository(), producer, "celery", 3)

	first, err := svc.Enqueue(context.Background(), EnqueueJobInput{
		UserID:         "user_a",
		Scope:          WorkspaceScopePersonal,
		Type:           model.JobTypeImageGenerate,
		Payload:        model.JSONB(`{"prompt":"same"}`),
		TaskKwargs:     map[string]any{"provider": map[string]any{"api_key": "short-lived"}},
		IdempotencyKey: "idem-key",
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.Enqueue(context.Background(), EnqueueJobInput{
		UserID:         "user_a",
		Scope:          WorkspaceScopePersonal,
		Type:           model.JobTypeImageGenerate,
		Payload:        model.JSONB(`{"prompt":"same"}`),
		IdempotencyKey: "idem-key",
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.Job.ID != second.Job.ID || second.Created {
		t.Fatalf("first=%+v second=%+v", first, second)
	}
	if len(producer.Messages) != 1 {
		t.Fatalf("published messages = %d, want 1", len(producer.Messages))
	}
	providerKwargs, ok := producer.Messages[0].Kwargs["provider"].(map[string]any)
	if !ok || providerKwargs["api_key"] != "short-lived" {
		t.Fatalf("published kwargs = %+v", producer.Messages[0].Kwargs)
	}
}

func TestJobServiceCanRepublishQueuedExistingJobForSchedulerRecovery(t *testing.T) {
	producer := &queue.MemoryProducer{}
	svc := NewJobService(repository.NewMemoryJobRepository(), producer, "celery", 3)
	input := EnqueueJobInput{
		UserID: "user_a", Scope: WorkspaceScopePersonal, Type: model.JobTypeImageGenerate,
		Payload: model.JSONB(`{"prompt":"same"}`), IdempotencyKey: "scheduler-recovery",
		TaskKwargs: map[string]any{"provider": map[string]any{"api_key": "transient"}},
	}
	first, err := svc.Enqueue(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	input.RepublishExisting = true
	second, err := svc.Enqueue(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if second.Created || second.Job.ID != first.Job.ID || len(producer.Messages) != 2 {
		t.Fatalf("first=%+v second=%+v messages=%d", first, second, len(producer.Messages))
	}
	if producer.Messages[0].JobID != producer.Messages[1].JobID {
		t.Fatalf("republished job IDs differ: %+v", producer.Messages)
	}
}

func TestJobServiceUsesStableMultipartIdempotencyPayload(t *testing.T) {
	producer := &queue.MemoryProducer{}
	svc := NewJobService(repository.NewMemoryJobRepository(), producer, "celery", 3)
	stable := model.JSONB(`{"prompt":"same","files":[{"sha256":"abc","size":3}]}`)

	first, err := svc.Enqueue(context.Background(), EnqueueJobInput{
		UserID:             "user_1",
		Scope:              "personal",
		Type:               model.JobTypeImageEdit,
		Payload:            model.JSONB(`{"prompt":"same","files":[{"storage_key":"jobs/inputs/a"}]}`),
		IdempotencyPayload: stable,
	})
	if err != nil {
		t.Fatalf("first enqueue: %v", err)
	}
	second, err := svc.Enqueue(context.Background(), EnqueueJobInput{
		UserID:             "user_1",
		Scope:              "personal",
		Type:               model.JobTypeImageEdit,
		Payload:            model.JSONB(`{"prompt":"same","files":[{"storage_key":"jobs/inputs/b"}]}`),
		IdempotencyPayload: stable,
	})
	if err != nil {
		t.Fatalf("second enqueue: %v", err)
	}
	if !first.Created || second.Created || first.Job.ID != second.Job.ID || len(producer.Messages) != 1 {
		t.Fatalf("unexpected idempotency result: first=%+v second=%+v messages=%d", first, second, len(producer.Messages))
	}
}

func TestJobServiceCancelCleansStagedInputs(t *testing.T) {
	root := t.TempDir()
	jobInputs := NewJobInputService(storage.NewLocalFSStorage(root), 1024)
	staged, err := jobInputs.Stage(context.Background(), "default:user_1", []JobInputUpload{{
		FieldName:   "image",
		FileName:    "input.png",
		ContentType: "image/png",
		Reader:      bytes.NewReader([]byte("staged-image")),
	}})
	if err != nil {
		t.Fatalf("stage input: %v", err)
	}
	payload, err := json.Marshal(map[string]any{
		StagedInputKeysPayloadField: StagedInputKeys(staged),
		"files":                     []map[string]any{staged[0].Payload()},
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	svc := NewJobService(repository.NewMemoryJobRepository(), &queue.MemoryProducer{}, "celery", 3)
	svc.SetJobInputService(jobInputs)
	created, err := svc.Enqueue(context.Background(), EnqueueJobInput{
		UserID:  "user_1",
		Scope:   WorkspaceScopePersonal,
		Type:    model.JobTypeImageEdit,
		Payload: model.JSONB(payload),
	})
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	inputPath := filepath.Join(root, filepath.FromSlash(staged[0].StorageKey))
	if _, err := os.Stat(inputPath); err != nil {
		t.Fatalf("staged input before cancel: %v", err)
	}

	canceled, err := svc.CancelForUser(created.Job.ID, "user_1")
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if canceled.Status != model.JobStatusCanceled {
		t.Fatalf("cancel status = %q", canceled.Status)
	}
	if _, err := os.Stat(inputPath); !os.IsNotExist(err) {
		t.Fatalf("staged input remains after cancel, stat error = %v", err)
	}
}

func TestJobServicePublishFailureCleansStagedInputs(t *testing.T) {
	root := t.TempDir()
	jobInputs := NewJobInputService(storage.NewLocalFSStorage(root), 1024)
	staged, err := jobInputs.Stage(context.Background(), "default:user_1", []JobInputUpload{{
		FieldName: "image", FileName: "input.png", ContentType: "image/png", Reader: bytes.NewReader([]byte("staged-image")),
	}})
	if err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(map[string]any{StagedInputKeysPayloadField: StagedInputKeys(staged)})
	if err != nil {
		t.Fatal(err)
	}
	svc := NewJobService(repository.NewMemoryJobRepository(), failingJobProducer{}, "celery", 3)
	svc.SetJobInputService(jobInputs)
	result, err := svc.Enqueue(context.Background(), EnqueueJobInput{
		UserID: "user_1", Scope: WorkspaceScopePersonal, Type: model.JobTypeImageEdit, Payload: model.JSONB(payload),
	})
	if err == nil || result.Job.Status != model.JobStatusFailed {
		t.Fatalf("enqueue result=%+v err=%v", result, err)
	}
	inputPath := filepath.Join(root, filepath.FromSlash(staged[0].StorageKey))
	if _, statErr := os.Stat(inputPath); !os.IsNotExist(statErr) {
		t.Fatalf("publish failure leaked staged input, stat error = %v", statErr)
	}
}
