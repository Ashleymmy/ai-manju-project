package repository

import (
	"context"
	"encoding/json"
	"slices"

	"github.com/ai-manju/api/internal/model"
)

// JobStatusFilter bounds browser status/recovery reads before loading payloads.
type JobStatusFilter struct {
	WorkspaceID string
	Statuses    []string
	Types       []string
	Limit       int
}

// JobStatusReader deliberately leaves full generation inputs in the repository.
// Workers and retries still use GetByID; status polling never needs media bytes.
type JobStatusReader interface {
	GetStatusForUser(context.Context, string, string) (model.Job, error)
	ListStatusesForUser(context.Context, string, JobStatusFilter) ([]model.Job, error)
}

// Keep enough identity to reconnect canvas/workbench tasks after a reload.
var jobStatusPayloadKeys = []string{"model", "studio_model", "project_id", "node_id", "conversation_id", "studio_message_id"}

func CompactJobStatus(job model.Job) model.Job {
	var payload map[string]json.RawMessage
	_ = json.Unmarshal(job.Payload, &payload)
	compact := make(map[string]json.RawMessage)
	for _, key := range jobStatusPayloadKeys {
		if value, ok := payload[key]; ok && string(value) != "null" {
			compact[key] = value
		}
	}
	var registration map[string]json.RawMessage
	if json.Unmarshal(payload["asset_registration"], &registration) == nil && registration != nil {
		identity := make(map[string]json.RawMessage)
		for _, key := range []string{"source_node_id", "source_project_id"} {
			if value, ok := registration[key]; ok && string(value) != "null" {
				identity[key] = value
			}
		}
		compact["asset_registration"], _ = json.Marshal(identity)
	}
	job.Payload, _ = json.Marshal(compact)
	return job
}

func (r *MemoryJobRepository) GetStatusForUser(ctx context.Context, id, userID string) (model.Job, error) {
	if err := ctx.Err(); err != nil {
		return model.Job{}, err
	}
	job, err := r.GetByID(id)
	if err != nil {
		return model.Job{}, err
	}
	if job.UserID != userID {
		return model.Job{}, ErrJobNotFound
	}
	return CompactJobStatus(job), nil
}

func (r *MemoryJobRepository) ListStatusesForUser(ctx context.Context, userID string, filter JobStatusFilter) ([]model.Job, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	jobs, err := r.ListByUser(userID)
	if err != nil {
		return nil, err
	}
	result := make([]model.Job, 0)
	for _, job := range jobs {
		if job.WorkspaceID != filter.WorkspaceID || (len(filter.Statuses) > 0 && !slices.Contains(filter.Statuses, job.Status)) || (len(filter.Types) > 0 && !slices.Contains(filter.Types, job.Type)) {
			continue
		}
		result = append(result, CompactJobStatus(job))
		if filter.Limit > 0 && len(result) >= filter.Limit {
			break
		}
	}
	return result, nil
}

// Select JSON identity inside PostgreSQL so large base64 references never cross
// the DB connection. Explicit columns prevent accidentally selecting payload too.
const jobStatusSelect = `id,idempotency_key,user_id,workspace_id,type,status,result,error,attempts,max_attempts,progress,queue_phase,created_at,updated_at,started_at,finished_at,external_provider,external_task_id,external_status,bridge_metadata,bridge_state,bridge_next_attempt_at,bridge_attempts,
jsonb_strip_nulls(jsonb_build_object(
 'model',payload->'model','studio_model',payload->'studio_model',
 'project_id',payload->'project_id','node_id',payload->'node_id',
 'conversation_id',payload->'conversation_id','studio_message_id',payload->'studio_message_id',
 'asset_registration',CASE WHEN jsonb_typeof(payload->'asset_registration')='object' THEN jsonb_build_object(
  'source_node_id',payload->'asset_registration'->'source_node_id',
  'source_project_id',payload->'asset_registration'->'source_project_id') ELSE NULL END
)) AS payload`

func (r *GormJobRepository) GetStatusForUser(ctx context.Context, id, userID string) (model.Job, error) {
	var job model.Job
	err := r.db.WithContext(ctx).Select(jobStatusSelect).Where("id = ? AND user_id = ?", id, userID).First(&job).Error
	return job, mapJobGormError(err)
}

func (r *GormJobRepository) ListStatusesForUser(ctx context.Context, userID string, filter JobStatusFilter) ([]model.Job, error) {
	jobs := make([]model.Job, 0)
	query := r.db.WithContext(ctx).Select(jobStatusSelect).Where("user_id = ? AND workspace_id = ?", userID, filter.WorkspaceID)
	if len(filter.Statuses) > 0 {
		query = query.Where("status IN ?", filter.Statuses)
	}
	if len(filter.Types) > 0 {
		query = query.Where("type IN ?", filter.Types)
	}
	if filter.Limit > 0 {
		query = query.Limit(filter.Limit)
	}
	err := query.Order("updated_at DESC").Find(&jobs).Error
	return jobs, err
}
