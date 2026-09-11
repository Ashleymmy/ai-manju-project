package repository

import (
	"context"
	"time"
)

// 持久待处理记录包括延迟补偿和旧版已关闭的不确定提交。
type BridgeStatistics struct {
	Pending              int64
	Retrying             int64
	Uncertain            int64
	OldestPendingSeconds float64
}

func (r *MemoryJobRepository) BridgeStatistics(ctx context.Context) (BridgeStatistics, error) {
	if err := ctx.Err(); err != nil {
		return BridgeStatistics{}, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := BridgeStatistics{}
	for _, job := range r.jobs {
		if job.ExternalProvider != "sd-video" || job.BridgeState == "canceled" {
			continue
		}
		uncertain := IsUncertainSubmission(job)
		if job.BridgeState == "done" && !uncertain {
			continue
		}
		result.Pending++
		if uncertain {
			result.Uncertain++
		}
		if job.BridgeAttempts > 0 {
			result.Retrying++
		}
		result.OldestPendingSeconds = max(result.OldestPendingSeconds, r.clockFn().Sub(job.CreatedAt).Seconds())
	}
	return result, nil
}

func (r *GormJobRepository) BridgeStatistics(ctx context.Context) (BridgeStatistics, error) {
	result := BridgeStatistics{}
	err := r.db.WithContext(ctx).Raw(`SELECT count(*) pending,
		count(*) FILTER (WHERE bridge_attempts>0) retrying,
		count(*) FILTER (WHERE status='failed' AND error->>'code'='submission_uncertain') uncertain,
		greatest(0,coalesce(max(extract(epoch from ?::timestamptz-created_at)),0)) oldest_pending_seconds
		FROM jobs WHERE external_provider='sd-video' AND coalesce(bridge_state,'')<>'canceled'
		AND (coalesce(bridge_state,'')<>'done' OR (status='failed' AND error->>'code'='submission_uncertain'))`, time.Now().UTC()).Scan(&result).Error
	return result, err
}
