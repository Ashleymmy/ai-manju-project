package repository

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
)

// imageOutputCount uses persisted outputs, not requested n or billing records.
// Assets repeat output metadata in some results, so only outputs are counted.
func imageOutputCount(result model.JSONB) int64 {
	var payload struct {
		Outputs []map[string]any `json:"outputs"`
	}
	if json.Unmarshal(result, &payload) != nil {
		return 0
	}
	seen := make(map[string]bool)
	for _, output := range payload.Outputs {
		if kind, _ := output["type"].(string); kind != "" && kind != "image" {
			continue
		}
		if mime, _ := output["content_type"].(string); mime != "" && !strings.HasPrefix(mime, "image/") {
			continue
		}
		for _, field := range []string{"asset_id", "path", "remote_url", "url"} {
			if value, ok := output[field].(string); ok && strings.TrimSpace(value) != "" {
				seen[field+":"+strings.TrimSpace(value)] = true
				break
			}
		}
	}
	return int64(len(seen))
}

func (r *MemoryJobRepository) CountImageOutputsInRange(ctx context.Context, userID string, start, end time.Time) (int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var count int64
	for _, job := range r.jobs {
		if err := ctx.Err(); err != nil {
			return 0, err
		}
		if job.UserID != userID || job.Status != model.JobStatusSucceeded || (job.Type != model.JobTypeImageGenerate && job.Type != model.JobTypeImageEdit) {
			continue
		}
		completedAt := job.CreatedAt // Legacy jobs may not have finished_at.
		if job.FinishedAt != nil {
			completedAt = *job.FinishedAt
		}
		if (!start.IsZero() && completedAt.Before(start)) || (!end.IsZero() && !completedAt.Before(end)) {
			continue
		}
		count += imageOutputCount(job.Result)
	}
	return count, ctx.Err()
}

func (r *GormJobRepository) CountImageOutputsInRange(ctx context.Context, userID string, start, end time.Time) (int64, error) {
	query := r.db.WithContext(ctx).Model(&model.Job{}).Select("result").
		Where("user_id = ? AND status = ? AND type IN ?", userID, model.JobStatusSucceeded, []string{model.JobTypeImageGenerate, model.JobTypeImageEdit})
	if !start.IsZero() {
		query = query.Where("COALESCE(finished_at, created_at) >= ?", start)
	}
	if !end.IsZero() {
		query = query.Where("COALESCE(finished_at, created_at) < ?", end)
	}
	// Stream only result data, not prompts or provider credentials. Both storage
	// implementations share the same output validation and deduplication rules.
	rows, err := query.Rows()
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var count int64
	for rows.Next() {
		var result []byte
		if err := rows.Scan(&result); err != nil {
			return 0, err
		}
		count += imageOutputCount(result)
	}
	return count, rows.Err()
}
