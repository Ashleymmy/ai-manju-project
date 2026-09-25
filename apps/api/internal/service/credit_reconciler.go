package service

import (
	"context"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

const (
	// CreditReconcileBatchSize caps one sweep so a reservation backlog drains
	// over multiple ticks instead of blocking a single one.
	CreditReconcileBatchSize = 200
	// CreditReconcileOrphanGrace: a reservation whose job row never appeared
	// (crash between reserve and job create) is released after one hour.
	CreditReconcileOrphanGrace = time.Hour
)

// CreditReconciler is the settlement consumer (WP-M3). It exists because the
// Python worker writes terminal job states directly to Postgres — the Go API
// never sees them on a callback. The reconciler scans reserved consumptions,
// reads the job's truth, and settles (success) or releases (failed/canceled)
// through the engine's idempotent transitions. Repeats are always safe.
type CreditReconciler struct {
	mu         sync.Mutex
	cursorTime time.Time
	cursorID   string
	credits    repository.CreditRepository
	jobs       repository.JobRepository
	engine     *CreditLedgerService
	interval   time.Duration
	clock      func() time.Time
}

func NewCreditReconciler(credits repository.CreditRepository, jobs repository.JobRepository, engine *CreditLedgerService, interval time.Duration) *CreditReconciler {
	if interval <= 0 {
		interval = 15 * time.Second
	}
	return &CreditReconciler{
		credits:  credits,
		jobs:     jobs,
		engine:   engine,
		interval: interval,
		clock:    func() time.Time { return time.Now().UTC() },
	}
}

// SetClock overrides the time source (tests).
func (r *CreditReconciler) SetClock(clock func() time.Time) {
	if clock != nil {
		r.clock = clock
	}
}

// Start runs the sweep loop until ctx is canceled, following the existing
// Start*Maintenance goroutine pattern. Per-item errors are logged and skipped
// — one broken row must never stall the sweep (不卡死).
func (r *CreditReconciler) Start(ctx context.Context) {
	ticker := time.NewTicker(r.interval)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if _, _, err := r.ReconcileOnce(ctx); err != nil {
					log.Printf("event=credit_reconcile_failed reason=%q", err.Error())
				}
			}
		}
	}()
}

// ReconcileOnce processes one batch. Exported for tests; returns how many
// consumptions were settled and released.
func (r *CreditReconciler) ReconcileOnce(ctx context.Context) (settled int, released int, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	reserved, err := r.credits.ListReservedConsumptionsAfter(r.cursorTime, r.cursorID, CreditReconcileBatchSize)
	if err != nil {
		return 0, 0, err
	}
	if len(reserved) == 0 && !r.cursorTime.IsZero() {
		r.cursorTime, r.cursorID = time.Time{}, ""
		reserved, err = r.credits.ListReservedConsumptionsAfter(r.cursorTime, r.cursorID, CreditReconcileBatchSize)
		if err != nil {
			return 0, 0, err
		}
	}
	for _, consumption := range reserved {
		if ctx.Err() != nil {
			return settled, released, ctx.Err()
		}
		r.cursorTime, r.cursorID = consumption.CreatedAt, consumption.ID
		job, jobErr := r.jobs.GetByID(consumption.JobID)
		if jobErr != nil {
			if errors.Is(jobErr, repository.ErrJobNotFound) {
				// 孤儿冻结：建单前崩溃留下的。超过宽限期才释放，给建单竞态留余地。
				if r.clock().Sub(consumption.CreatedAt) >= CreditReconcileOrphanGrace {
					if _, relErr := r.engine.Release(consumption.JobID); relErr != nil {
						log.Printf("job_id=%s event=credit_orphan_release_failed reason=%q", consumption.JobID, relErr.Error())
						continue
					}
					released++
				}
				continue
			}
			return settled, released, jobErr
		}
		switch job.Status {
		case model.JobStatusSucceeded:
			if _, settleErr := r.engine.SettleCompletedJob(job); settleErr != nil {
				log.Printf("job_id=%s event=credit_settle_failed reason=%q", consumption.JobID, settleErr.Error())
				continue
			}
			settled++
		case model.JobStatusFailed, model.JobStatusCanceled:
			if repository.IsUncertainSubmission(job) {
				log.Printf("job_id=%s event=credit_release_deferred reason=uncertain_submission", consumption.JobID)
				continue
			}
			if _, relErr := r.engine.Release(consumption.JobID); relErr != nil {
				log.Printf("job_id=%s event=credit_release_failed reason=%q", consumption.JobID, relErr.Error())
				continue
			}
			released++
		default:
			// queued/running：继续等待。
		}
	}
	return settled, released, nil
}
