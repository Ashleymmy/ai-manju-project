package service

import (
	"context"
	"errors"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

func (s *JobService) deferBusyNativeRecovery(observed model.Job) error {
	if repo, ok := s.repo.(repository.NativeOrphanRepository); ok && observed.Status == model.JobStatusRunning {
		// Keep old live Workers from occupying every scan slot. CAS changes only
		// the private observation timer, not attempts or the Worker's job state.
		_, err := repo.DeferBusyNativeRecovery(observed, s.dispatchTime().Add(repository.NativeRunningRecoveryGrace))
		return err
	}
	return nil
}

// The caller holds the durable-dispatch lock. No broker, Provider, billing or
// config decoder is used: routing only makes an orphan's uncertainty visible.
func (s *JobService) routeNativeOrphan(ctx context.Context, observed model.Job) error {
	orphans, ok := s.repo.(repository.NativeOrphanRepository)
	if !ok {
		return ErrNativeRecoveryUnavailable
	}
	native, ok := s.repo.(repository.NativeJobRecoveryRepository)
	if !ok {
		return ErrNativeRecoveryUnavailable
	}
	if repository.ProviderRetryScheduled(observed, s.dispatchTime()) || (observed.DispatchNextAttemptAt != nil && observed.DispatchNextAttemptAt.After(s.dispatchTime())) {
		return nil
	}
	err := native.WithNativeJobLock(ctx, observed.ID, func() error {
		fresh, err := s.repo.GetByID(observed.ID)
		if err != nil {
			return err
		}
		if !repository.CanRouteNativeOrphan(fresh) || repository.ProviderRetryScheduled(fresh, s.dispatchTime()) || (fresh.DispatchNextAttemptAt != nil && fresh.DispatchNextAttemptAt.After(s.dispatchTime())) {
			return nil
		}
		_, err = orphans.RouteNativeOrphan(fresh, s.dispatchTime())
		return err
	})
	if errors.Is(err, repository.ErrJobRecoveryBusy) {
		return s.deferBusyNativeRecovery(observed)
	}
	return err
}
