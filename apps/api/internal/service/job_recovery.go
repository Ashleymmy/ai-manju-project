package service

import (
	"bytes"
	"compress/zlib"
	"context"
	"encoding/json"
	"errors"
	"io"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
)

const nativeRecoveryPageSize = 30

var ErrNativeRecoveryUnavailable = errors.New("原任务缺少可恢复记录，不能重新提交生成")
var ErrNativeRecoveryForbidden = errors.New("只有可写管理员可以恢复生成任务")

type NativeRecoveryRow struct {
	ID                 string    `json:"id"`
	UserID             string    `json:"user_id"`
	WorkspaceID        string    `json:"workspace_id"`
	Type               string    `json:"type"`
	Status             string    `json:"status"`
	QueuePhase         string    `json:"queue_phase"`
	ProviderID         string    `json:"provider_id"`
	Model              string    `json:"model"`
	CheckpointPhase    string    `json:"checkpoint_phase"`
	CheckpointRevision int       `json:"checkpoint_revision"`
	ProviderTaskID     string    `json:"provider_task_id"`
	CanResume          bool      `json:"can_resume"`
	Reason             string    `json:"reason"`
	RecoveryRequested  bool      `json:"recovery_requested"`
	UpdatedAt          time.Time `json:"updated_at"`
}
type NativeRecoveryPage struct {
	Items  []NativeRecoveryRow `json:"items"`
	Total  int64               `json:"total"`
	Limit  int                 `json:"limit"`
	Offset int                 `json:"offset"`
}
type nativeCheckpoint struct {
	Version          int    `json:"version"`
	Revision         int    `json:"revision"`
	Phase            string `json:"phase"`
	ProviderID       string `json:"provider_id"`
	Model            string `json:"model"`
	ProviderTaskID   string `json:"provider_task_id"`
	ProviderIdentity string `json:"provider_identity"`
	ReceiptID        string `json:"receipt_id"`
}

func nativeCheckpointFor(job model.Job) (string, nativeCheckpoint) {
	key := "_worker_video_checkpoint"
	if job.Type == model.JobTypeImageGenerate || job.Type == model.JobTypeImageEdit {
		key = "_worker_image_checkpoint"
	}
	var metadata map[string]json.RawMessage
	_ = json.Unmarshal(job.BridgeMetadata, &metadata)
	var checkpoint nativeCheckpoint
	_ = json.Unmarshal(metadata[key], &checkpoint)
	return key, checkpoint
}
func nativeRecoveryRow(job model.Job) NativeRecoveryRow {
	_, cp := nativeCheckpointFor(job)
	row := NativeRecoveryRow{ID: job.ID, UserID: job.UserID, WorkspaceID: job.WorkspaceID, Type: job.Type, Status: job.Status, QueuePhase: job.QueuePhase, ProviderID: cp.ProviderID, Model: cp.Model, CheckpointPhase: cp.Phase, CheckpointRevision: cp.Revision, ProviderTaskID: cp.ProviderTaskID, UpdatedAt: job.UpdatedAt}
	row.RecoveryRequested = job.DispatchState == repository.JobDispatchRecoveryPending || job.DispatchState == repository.JobDispatchRecoveryPublished
	if job.ExternalProvider != "" || (job.Status != model.JobStatusQueued && job.Status != model.JobStatusRunning) {
		row.Reason = "任务已结束或由独立视频服务处理"
		return row
	}
	if cp.Version != 1 || cp.Revision < 1 || cp.ProviderIdentity == "" {
		row.Reason = "缺少原始提交检查点，需人工核对"
		return row
	}
	if job.DispatchCiphertext == "" {
		row.Reason = "历史任务未保留执行配置，需人工核对；不可重新生成"
		return row
	}
	switch job.Type {
	case model.JobTypeVideoGenerate:
		row.CanResume = (cp.Phase == "accepted" || cp.Phase == "downloaded") && cp.ProviderTaskID != ""
	case model.JobTypeImageGenerate, model.JobTypeImageEdit:
		row.CanResume = cp.Phase == "received" || cp.Phase == "downloaded" || (cp.Phase == "submission_intent" && cp.ReceiptID != "")
	}
	if !row.CanResume {
		row.Reason = "提交结果不明，需先在供应商核对原任务，禁止自动补发"
	} else if cp.Phase == "submission_intent" {
		row.Reason = "仅检查已保存的图片响应；没有响应则继续等待人工核对"
	} else {
		row.Reason = "仅查询、下载或导入原任务结果，不会再次发起生成"
	}
	if row.RecoveryRequested {
		row.CanResume = false
		row.Reason = "恢复请求已入队，等待后台同步原结果"
	}
	return row
}
func (s *JobService) ListNativeRecovery(limit, offset int) (NativeRecoveryPage, error) {
	repo, ok := s.repo.(repository.NativeJobRecoveryRepository)
	if !ok {
		return NativeRecoveryPage{}, ErrNativeRecoveryUnavailable
	}
	if limit < 1 || limit > 100 {
		limit = nativeRecoveryPageSize
	}
	if offset < 0 {
		offset = 0
	}
	jobs, total, err := repo.ListNativeRecovery(limit, offset)
	if err != nil {
		return NativeRecoveryPage{}, err
	}
	rows := make([]NativeRecoveryRow, 0, len(jobs))
	for _, job := range jobs {
		rows = append(rows, nativeRecoveryRow(job))
	}
	return NativeRecoveryPage{Items: rows, Total: total, Limit: limit, Offset: offset}, nil
}
func (s *JobService) ResumeNativeRecovery(ctx context.Context, actor model.User, id string, revision int) (NativeRecoveryRow, error) {
	if !model.IsAdminRole(actor.Role) || model.IsReadOnlyAdminRole(actor.Role) {
		return NativeRecoveryRow{}, ErrNativeRecoveryForbidden
	}
	repo, ok := s.repo.(repository.NativeJobRecoveryRepository)
	if !ok || s.dispatchBox == nil {
		return NativeRecoveryRow{}, ErrNativeRecoveryUnavailable
	}
	var scheduled model.Job
	err := s.repo.WithExternalLock(ctx, "dispatch:"+id, func() error {
		return repo.WithNativeJobLock(ctx, id, func() error {
			job, err := s.repo.GetByID(id)
			if err != nil {
				return err
			}
			key, cp := nativeCheckpointFor(job)
			if cp.Revision != revision || revision < 1 {
				return repository.ErrJobRecoveryConflict
			}
			row := nativeRecoveryRow(job)
			if row.RecoveryRequested {
				scheduled = job
				return nil
			}
			if !row.CanResume {
				return ErrNativeRecoveryUnavailable
			}
			// Refuse unreadable snapshots before recording an actionable recovery.
			if _, err = s.decodeDispatch(job); err != nil {
				return ErrNativeRecoveryUnavailable
			}
			scheduled, err = repo.ScheduleNativeRecovery(id, key, revision, randomHex(16), actor.ID, time.Now().UTC())
			return err
		})
	})
	if err != nil {
		return NativeRecoveryRow{}, err
	}
	// The durable dispatcher handles broker outages; HTTP disconnects do not undo
	// the request, release credits, or erase the original result checkpoint.
	_ = s.dispatchJob(context.WithoutCancel(ctx), id)
	if refreshed, err := s.repo.GetByID(id); err == nil {
		scheduled = refreshed
	}
	return nativeRecoveryRow(scheduled), nil
}
func (s *JobService) decodeDispatch(job model.Job) (jobDispatchEnvelope, error) {
	var envelope jobDispatchEnvelope
	if s.dispatchBox == nil {
		return envelope, ErrNativeRecoveryUnavailable
	}
	plain, err := s.dispatchBox.Decrypt(job.DispatchCiphertext)
	if err != nil {
		return envelope, errors.New("task dispatch decryption unavailable")
	}
	reader, err := zlib.NewReader(bytes.NewBufferString(plain))
	if err != nil {
		return envelope, errors.New("invalid task dispatch encoding")
	}
	defer reader.Close()
	decoded, err := io.ReadAll(io.LimitReader(reader, jobDispatchMaxDecodedBytes+1))
	if err != nil || len(decoded) > jobDispatchMaxDecodedBytes {
		return envelope, errors.New("invalid task dispatch size")
	}
	if json.Unmarshal(decoded, &envelope) != nil || envelope.JobID != job.ID || envelope.TaskName != taskNameForJobType(job.Type) || envelope.Kwargs == nil {
		return envelope, errors.New("invalid durable task dispatch")
	}
	if value, ok := envelope.Kwargs["generation_soft_timeout_seconds"].(float64); ok {
		envelope.Kwargs["generation_soft_timeout_seconds"] = int(value)
	}
	return envelope, nil
}
func (s *JobService) dispatchNativeRecovery(ctx context.Context, job model.Job) error {
	repo, ok := s.repo.(repository.NativeJobRecoveryRepository)
	if !ok {
		return ErrNativeRecoveryUnavailable
	}
	if job.DispatchNextAttemptAt != nil && job.DispatchNextAttemptAt.After(time.Now().UTC()) {
		return nil
	}
	// This route can only restore a previously accepted task/response. A second
	// worker-side guard rejects missing or changed checkpoints before any POST.
	candidate := job
	candidate.DispatchState = model.JobDispatchObserved
	if !nativeRecoveryRow(candidate).CanResume {
		return ErrNativeRecoveryUnavailable
	}
	var metadata struct {
		Control struct {
			Token string `json:"token"`
		} `json:"_worker_recovery_control"`
	}
	_ = json.Unmarshal(job.BridgeMetadata, &metadata)
	if metadata.Control.Token == "" {
		return ErrNativeRecoveryUnavailable
	}
	envelope, err := s.decodeDispatch(job)
	if err != nil {
		return err
	}
	envelope.Kwargs["_recovery_only"] = true
	envelope.Kwargs["_recovery_dispatch_token"] = metadata.Control.Token
	next := time.Now().UTC().Add(jobDispatchRetryDelay)
	prepared, err := repo.PrepareNativeRecoveryPublish(job.ID, metadata.Control.Token, next)
	if err != nil {
		return err
	}
	if !prepared {
		return nil
	}
	if s.producer == nil {
		return queue.ErrBrokerNotConfigured
	}
	if err = s.publishDurableJob(ctx, queue.TaskMessage{TaskName: envelope.TaskName, Queue: envelope.Queue, JobID: job.ID, Payload: job.Payload, Kwargs: envelope.Kwargs}); err != nil {
		return errors.New("recovery publication awaiting acknowledgement")
	}
	return repo.MarkNativeRecoveryPublished(job.ID, time.Now().UTC().Add(jobDispatchReceiptGrace))
}
