package service

import (
	"bytes"
	"compress/zlib"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/queue"
)

const (
	jobDispatchInterval   = 10 * time.Second
	jobDispatchRetryDelay = 15 * time.Second
	// Retain encrypted delivery data until a worker actually observes the job,
	// so Redis loss after an acknowledged LPUSH is also recoverable.
	jobDispatchReceiptGrace = 2 * time.Minute
	jobDispatchBatchSize    = 20
	// Match the maximum media request budget when restoring execution kwargs.
	jobDispatchMaxDecodedBytes = 512 * 1024 * 1024
)

type jobDispatchEnvelope struct {
	JobID    string         `json:"job_id"`
	TaskName string         `json:"task_name"`
	Queue    string         `json:"queue"`
	Kwargs   map[string]any `json:"kwargs"`
}

// EnableDurableDispatch is wired for the application with its existing secret;
// no additional credential or plaintext execution configuration is introduced.
func (s *JobService) EnableDurableDispatch(box provider.SecretBox) { s.dispatchBox = &box }

func (s *JobService) prepareDispatch(job *model.Job, kwargs map[string]any) error {
	if s.dispatchBox == nil {
		return nil
	}
	encoded, err := json.Marshal(jobDispatchEnvelope{JobID: job.ID, TaskName: taskNameForJobType(job.Type), Queue: s.queueName, Kwargs: kwargs})
	if err != nil {
		return errors.New("invalid task dispatch configuration")
	}
	if len(encoded) > jobDispatchMaxDecodedBytes {
		return errors.New("task dispatch exceeds media request limit")
	}
	var compressed bytes.Buffer
	writer, err := zlib.NewWriterLevel(&compressed, zlib.BestSpeed)
	if err != nil {
		return errors.New("task dispatch encoding unavailable")
	}
	if _, err := writer.Write(encoded); err != nil {
		return errors.New("task dispatch encoding unavailable")
	}
	if err := writer.Close(); err != nil {
		return errors.New("task dispatch encoding unavailable")
	}
	ciphertext, err := s.dispatchBox.Encrypt(compressed.String())
	if err != nil {
		return errors.New("task dispatch encryption unavailable")
	}
	job.DispatchCiphertext, job.DispatchState = ciphertext, model.JobDispatchPending
	job.QueuePhase = model.JobQueueWaitingDispatch
	return nil
}

func (s *JobService) dispatchJob(ctx context.Context, id string) error {
	if s.dispatchBox == nil {
		return nil
	}
	return s.repo.WithExternalLock(ctx, "dispatch:"+id, func() error {
		job, err := s.repo.GetByID(id)
		if err != nil {
			return err
		}
		if job.DispatchCiphertext == "" {
			return nil
		}
		if job.Status != model.JobStatusQueued || job.StartedAt != nil || job.QueuePhase == "waiting_provider_slot" {
			return s.repo.UpdateDispatch(id, model.JobDispatchObserved, nil, true)
		}
		if job.DispatchNextAttemptAt != nil && job.DispatchNextAttemptAt.After(time.Now().UTC()) {
			return nil
		}
		next := time.Now().UTC().Add(jobDispatchRetryDelay)
		// Bound and space all failures, including decryption/configuration errors.
		if err := s.repo.UpdateDispatch(id, model.JobDispatchPending, &next, false); err != nil {
			return err
		}
		plain, err := s.dispatchBox.Decrypt(job.DispatchCiphertext)
		if err != nil {
			return errors.New("task dispatch decryption unavailable")
		}
		reader, err := zlib.NewReader(bytes.NewBufferString(plain))
		if err != nil {
			return errors.New("invalid task dispatch encoding")
		}
		decoded, err := io.ReadAll(io.LimitReader(reader, jobDispatchMaxDecodedBytes+1))
		_ = reader.Close()
		if err != nil || len(decoded) > jobDispatchMaxDecodedBytes {
			return errors.New("invalid task dispatch size")
		}
		var envelope jobDispatchEnvelope
		if json.Unmarshal(decoded, &envelope) != nil || envelope.JobID != job.ID || envelope.TaskName != taskNameForJobType(job.Type) {
			return errors.New("invalid durable task dispatch")
		}
		// JSON decoding uses float64; preserve the Celery integer timelimit field.
		if value, ok := envelope.Kwargs["generation_soft_timeout_seconds"].(float64); ok {
			envelope.Kwargs["generation_soft_timeout_seconds"] = int(value)
		}
		if s.producer == nil {
			return queue.ErrBrokerNotConfigured
		}
		if err := s.publishDurableJob(ctx, queue.TaskMessage{TaskName: envelope.TaskName, Queue: envelope.Queue, JobID: job.ID, Payload: job.Payload, Kwargs: envelope.Kwargs}); err != nil {
			// The broker may have accepted the message. Never fail/refund/clean it.
			return errors.New("task dispatch awaiting broker acknowledgement")
		}
		next = time.Now().UTC().Add(jobDispatchReceiptGrace)
		return s.repo.UpdateDispatch(id, model.JobDispatchPublished, &next, false)
	})
}

func (s *JobService) DispatchPending(ctx context.Context) error {
	if s.dispatchBox == nil {
		return nil
	}
	ids, err := s.repo.ListDispatchPendingIDs(time.Now().UTC(), jobDispatchBatchSize)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := s.dispatchJob(ctx, id); err != nil {
			log.Printf("job_id=%s event=job_dispatch_pending", id)
		}
	}
	return nil
}

func (s *JobService) StartDispatch(ctx context.Context) {
	if s.dispatchBox == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(jobDispatchInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := s.DispatchPending(ctx); err != nil {
					log.Printf("event=job_dispatch_scan_failed")
				}
			}
		}
	}()
}
