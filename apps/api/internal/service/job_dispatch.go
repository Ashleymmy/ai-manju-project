package service

import (
	"bytes"
	"compress/zlib"
	"context"
	"encoding/json"
	"errors"
	"log"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
)

const (
	jobDispatchInterval   = 10 * time.Second
	jobDispatchRetryDelay = 15 * time.Second
	// Receipt grace also spaces scans of observed work. Keep encrypted execution
	// data until terminal so accepted tasks can be recovered without resubmission.
	jobDispatchReceiptGrace = repository.JobDispatchReceiptGrace
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
		if job.Status == model.JobStatusSucceeded || job.Status == model.JobStatusFailed || job.Status == model.JobStatusCanceled {
			return s.repo.UpdateDispatch(id, model.JobDispatchObserved, nil, true)
		}
		if job.DispatchState == repository.JobDispatchRecoveryPending || job.DispatchState == repository.JobDispatchRecoveryPublished {
			return s.dispatchNativeRecovery(ctx, job)
		}
		if repository.ProviderRetryScheduled(job, time.Now().UTC()) {
			return nil
		}
		// Redis retry delivery is not durable evidence of paid execution. Recover
		// only never-started work or a durable explicit rejection. Accepted and
		// uncertain submissions retain their original recovery-only behavior.
		restoreProviderWait := repository.CanRedispatchProviderWait(job)
		ordinaryQueuePhase := job.QueuePhase == "" || job.QueuePhase == model.JobQueueWaitingDispatch
		if job.Status != model.JobStatusQueued || (job.StartedAt != nil && !restoreProviderWait) || (!ordinaryQueuePhase && !restoreProviderWait) || (job.DispatchState == model.JobDispatchObserved && !restoreProviderWait) {
			next := time.Now().UTC().Add(jobDispatchReceiptGrace)
			return s.repo.UpdateDispatch(id, model.JobDispatchObserved, &next, false)
		}
		if job.DispatchNextAttemptAt != nil && job.DispatchNextAttemptAt.After(time.Now().UTC()) {
			return nil
		}
		next := time.Now().UTC().Add(jobDispatchRetryDelay)
		// Bound and space all failures, including decryption/configuration errors.
		if err := s.repo.UpdateDispatch(id, model.JobDispatchPending, &next, false); err != nil {
			return err
		}
		envelope, err := s.decodeDispatch(job)
		if err != nil {
			return err
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
