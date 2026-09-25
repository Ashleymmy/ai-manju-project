package service

import (
	"context"
	"errors"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
)

// Called under the relay lock. The worker advisory lock prevents a stale scan
// from moving a currently executing job or racing an administrator recovery.
func (s *JobService) dispatchAutomaticNativeRecovery(ctx context.Context, id string) error {
	native, ok := s.repo.(repository.NativeJobRecoveryRepository)
	if !ok {
		return ErrNativeRecoveryUnavailable
	}
	var message *queue.TaskMessage
	err := native.WithNativeJobLock(ctx, id, func() error {
		job, err := s.repo.GetByID(id)
		if err != nil {
			return err
		}
		if !repository.CanAutomaticallyRecoverNative(job) || job.DispatchState == repository.JobDispatchRecoveryPending || job.DispatchState == repository.JobDispatchRecoveryPublished {
			return nil
		}
		now := s.dispatchTime()
		if repository.ProviderRetryScheduled(job, now) || (job.DispatchNextAttemptAt != nil && job.DispatchNextAttemptAt.After(now)) {
			return nil
		}
		// Persist spacing before decoding or publishing, including ambiguous
		// broker failures. Never overwrite a newer Worker ACK after publication.
		next := now.Add(jobDispatchReceiptGrace)
		if err := s.repo.UpdateDispatch(id, model.JobDispatchObserved, &next, false); err != nil {
			return err
		}
		envelope, err := s.decodeDispatch(job)
		if err != nil {
			return err
		}
		envelope.Kwargs["_recovery_only"] = true
		envelope.Kwargs["_recovery_automatic"] = true
		delete(envelope.Kwargs, "_recovery_dispatch_token")
		if s.producer == nil {
			return queue.ErrBrokerNotConfigured
		}
		message = &queue.TaskMessage{TaskName: envelope.TaskName, Queue: envelope.Queue, JobID: job.ID, Payload: job.Payload, Kwargs: envelope.Kwargs}
		return nil
	})
	if errors.Is(err, repository.ErrJobRecoveryBusy) {
		// A batch of long-running live Workers must not occupy every oldest
		// scan slot indefinitely. Only defer this relay observation; preserve the
		// execution state, checkpoint and Worker retry timer. The dispatch lock
		// still serializes administrator requests and other relays here.
		job, readErr := s.repo.GetByID(id)
		if readErr != nil {
			return readErr
		}
		now := s.dispatchTime()
		if job.Status == model.JobStatusRunning && repository.CanAutomaticallyRecoverNative(job) &&
			job.DispatchState != repository.JobDispatchRecoveryPending && job.DispatchState != repository.JobDispatchRecoveryPublished &&
			(job.DispatchNextAttemptAt == nil || !job.DispatchNextAttemptAt.After(now)) {
			next := now.Add(jobDispatchReceiptGrace)
			return s.repo.UpdateDispatch(id, job.DispatchState, &next, false)
		}
		return nil
	}
	if err != nil || message == nil {
		return err
	}
	// Release the Worker lock before publication: a fast consumer would otherwise
	// acknowledge and discard this message as already_locked. The relay lock is
	// still held, and the Worker revalidates its checkpoint before recovery.
	if err := s.publishDurableJob(ctx, *message); err != nil {
		return errors.New("automatic recovery publication awaiting acknowledgement")
	}
	return nil
}
