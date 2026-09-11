package service

// SD-video bridge reconciliation keeps the Studio job and asset stores
// durable even when the browser is closed before it requests /content.
// The standalone service remains the owner of provider execution; this
// component only polls, imports completed results and records lineage.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"mime"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/sdvideo"
)

const (
	defaultSDVideoBridgeInterval = 5 * time.Second
	defaultSDVideoBridgeBatch    = 20
	// 待人工核对不是自动重试，低频读取原任务，不重新入队生成。
	sdVideoReconciliationInterval = time.Minute
	maxSDVideoBridgeResultBytes   = int64(512 * 1024 * 1024)
)

type SDVideoBridge struct {
	jobs         *JobService
	users        repository.UserRepository
	client       *sdvideo.Client
	assets       *AssetService
	interval     time.Duration
	batchSize    int
	lastProgress atomic.Int64
}

func NewSDVideoBridge(jobs *JobService, users repository.UserRepository, client *sdvideo.Client, assets *AssetService, interval time.Duration, batchSize int) *SDVideoBridge {
	if interval <= 0 {
		interval = defaultSDVideoBridgeInterval
	}
	if batchSize <= 0 {
		batchSize = defaultSDVideoBridgeBatch
	}
	return &SDVideoBridge{jobs: jobs, users: users, client: client, assets: assets, interval: interval, batchSize: batchSize}
}

// Start launches one lightweight reconciler per API process. Database-backed
// ListByExternal plus the per-job idempotent asset key make duplicate polls
// safe across API replicas.
func (b *SDVideoBridge) Start(ctx context.Context) {
	if b == nil || b.jobs == nil || b.users == nil || b.client == nil || !b.client.Enabled() || b.assets == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(b.interval)
		defer ticker.Stop()
		for {
			if _, err := b.RunOnce(ctx); err != nil {
				log.Printf("sd-video bridge reconcile failed: %v", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

// RunOnce is exported for deterministic integration tests and operational
// probes. It returns the number of rows examined and imported/updated.
func (b *SDVideoBridge) RunOnce(ctx context.Context) (int, error) {
	if b == nil || b.jobs == nil || b.users == nil || b.client == nil || b.assets == nil {
		return 0, errors.New("sd-video bridge is not configured")
	}
	rows, err := b.jobs.ListExternalPending("sd-video", nil, b.batchSize)
	if err != nil {
		return 0, err
	}
	b.lastProgress.Store(time.Now().Unix())
	processed := 0
	for _, job := range rows {
		if err := b.jobs.repo.WithExternalLock(ctx, job.ID, func() error {
			latest, err := b.jobs.repo.GetByID(job.ID)
			if err != nil {
				return err
			}
			if (latest.BridgeState == "done" && !repository.IsUncertainSubmission(latest)) || latest.BridgeState == "canceled" {
				return nil
			}
			if reconcileErr := b.reconcile(ctx, latest); reconcileErr != nil {
				var remote *sdvideo.Error
				if latest.ExternalTaskID == "" && errors.As(reconcileErr, &remote) && (remote.StatusCode == 400 || remote.StatusCode == 404 || remote.StatusCode == 422) {
					if _, err := b.jobs.SetError(latest.ID, model.JSONB(`{"code":"sd_video_request_rejected","message":"video request validation failed"}`)); err != nil {
						return err
					}
					return b.jobs.repo.SetBridgeState(latest.ID, "done")
				}
				delay := time.Duration(5*(1<<min(latest.BridgeAttempts, 6))) * time.Second
				if err := b.jobs.repo.DelayBridge(latest.ID, time.Now().UTC().Add(delay)); err != nil {
					return err
				}
				return errors.New("remote service or asset synchronization temporarily unavailable")
			}
			return nil
		}); err != nil {
			// A single transient provider or storage failure must not prevent the
			// remaining workspaces from being reconciled on this pass.
			log.Printf("sd-video bridge task=%s reconcile error=%v", job.ExternalTaskID, err)
		}
		processed++
		b.lastProgress.Store(time.Now().Unix())
	}
	return processed, nil
}

// 只读探针，绝不在健康检查中提交任务或执行资产导入。
func (b *SDVideoBridge) HealthSnapshot(ctx context.Context) (repository.BridgeStatistics, float64, error) {
	stats, err := b.jobs.repo.BridgeStatistics(ctx)
	last := b.lastProgress.Load()
	if last == 0 {
		return stats, 0, errors.New("bridge has not completed an initial scan")
	}
	return stats, max(0, float64(time.Now().Unix()-last)), err
}

func (b *SDVideoBridge) reconcile(ctx context.Context, job model.Job) error {
	user, err := b.users.GetUser(job.UserID)
	if err != nil {
		return fmt.Errorf("load owner: %w", err)
	}
	taskID := strings.TrimSpace(job.ExternalTaskID)
	if taskID == "" {
		if job.Status == model.JobStatusCanceled {
			return b.jobs.repo.SetBridgeState(job.ID, "canceled")
		}
		var request map[string]any
		if err := json.Unmarshal(job.Payload, &request); err != nil {
			return err
		}
		// 该 Payload 与幂等键在发送前已经持久化；超时恢复会命中同一远端任务。
		request["studio_job_id"] = job.ID
		remote, err := b.client.CreateAcceptedTask(ctx, user, job.WorkspaceID, request)
		if err != nil {
			return err
		}
		var created map[string]any
		if err := json.Unmarshal(remote.Data, &created); err != nil {
			return err
		}
		taskID = stringValue(created["task_id"])
		if taskID == "" {
			return errors.New("sd-video returned no task id")
		}
		job, err = b.jobs.UpdateExternalState(job.ID, "sd-video", taskID, "queued", job.BridgeMetadata)
		if err != nil {
			return err
		}
	}
	if job.Status == model.JobStatusCanceled {
		if _, err := b.client.CancelTask(ctx, user, job.WorkspaceID, taskID); err != nil {
			return err
		}
		return b.jobs.repo.SetBridgeState(job.ID, "canceled")
	}
	remote, err := b.client.GetTask(ctx, user, job.WorkspaceID, taskID)
	if err != nil {
		return err
	}
	var payload map[string]any
	if err := json.Unmarshal(remote.Data, &payload); err != nil {
		return fmt.Errorf("decode task response: %w", err)
	}
	status := strings.ToLower(strings.TrimSpace(stringValue(payload["status"])))
	if status == "" {
		status = "queued"
	}
	progress := intValue(payload["progress"])
	metadata := mergeBridgeMetadata(job.BridgeMetadata, payload)
	var original map[string]any
	_ = json.Unmarshal(job.Payload, &original)
	metadata["project_id"] = original["project_id"]
	metadata["node_id"] = original["node_id"]
	metadata["reconciliation"] = payload["reconciliation"]

	if status == "failed" {
		failure, _ := payload["error"].(map[string]any)
		if failure["code"] == "submission_uncertain" {
			if !repository.IsUncertainSubmission(job) {
				if _, err := b.jobs.SetError(job.ID, errorJSONValue(payload["error"], "submission requires reconciliation")); err != nil {
					return err
				}
			}
			if _, err := b.jobs.UpdateExternalState(job.ID, "sd-video", taskID, "failed", mustSDVideoBridgeJSONB(metadata)); err != nil {
				return err
			}
			if err := b.jobs.repo.SetBridgeState(job.ID, "reconciliation_required"); err != nil {
				return err
			}
			return b.jobs.repo.DelayBridge(job.ID, time.Now().UTC().Add(sdVideoReconciliationInterval))
		}
	}
	if repository.IsUncertainSubmission(job) && (status == "running" || status == "queued" || status == "succeeded") {
		review, _ := payload["reconciliation"].(map[string]any)
		if review["decision"] != "bind_existing" || intValue(review["attempt"]) != intValue(payload["attempt"]) || intValue(review["attempt"]) < 1 {
			return errors.New("remote task recovery lacks reconciliation evidence")
		}
		job, err = b.jobs.repo.ResumeReconciledExternal(job.ID, taskID)
		if err != nil {
			return err
		}
		if job.Status == model.JobStatusCanceled {
			return nil
		}
	}

	if status == "failed" || status == "error" || status == "expired" || status == "timeout" {
		if repository.IsUncertainSubmission(job) {
			review, _ := payload["reconciliation"].(map[string]any)
			failure, _ := payload["error"].(map[string]any)
			validDecision := review["decision"] == "bind_existing" || (review["decision"] == "confirm_not_submitted" && failure["code"] == "submission_not_created_verified")
			if !validDecision || intValue(review["attempt"]) < 1 || intValue(review["attempt"]) != intValue(payload["attempt"]) {
				return errors.New("remote failure change lacks reconciliation evidence")
			}
		}
		_, setErr := b.jobs.SetError(job.ID, errorJSONValue(payload["error"], "sd-video task failed"))
		if setErr != nil {
			return setErr
		}
		_, setErr = b.jobs.UpdateExternalState(job.ID, "sd-video", taskID, "failed", mustSDVideoBridgeJSONB(metadata))
		if setErr != nil {
			return setErr
		}
		return b.jobs.repo.SetBridgeState(job.ID, "done")
	}
	if status == "canceled" || status == "cancelled" {
		if job.Status != model.JobStatusCanceled {
			if _, cancelErr := b.jobs.repo.UpdateStatus(job.ID, model.JobStatusCanceled); cancelErr != nil {
				return cancelErr
			}
		}
		_, setErr := b.jobs.UpdateExternalProgress(job.ID, "sd-video", taskID, "canceled", progress, mustSDVideoBridgeJSONB(metadata))
		if setErr != nil {
			return setErr
		}
		return b.jobs.repo.SetBridgeState(job.ID, "canceled")
	}
	if status != "succeeded" {
		_, updateErr := b.jobs.UpdateExternalProgress(job.ID, "sd-video", taskID, status, progress, mustSDVideoBridgeJSONB(metadata))
		return updateErr
	}
	// A locally canceled bridge must never import a late provider result.
	if job.Status == model.JobStatusCanceled {
		_, updateErr := b.jobs.UpdateExternalProgress(job.ID, "sd-video", taskID, "succeeded", progress, mustSDVideoBridgeJSONB(metadata))
		return updateErr
	}

	body, contentType, err := b.client.Result(ctx, user, job.WorkspaceID, taskID)
	if err != nil {
		return err
	}
	if int64(len(body)) > maxSDVideoBridgeResultBytes {
		return fmt.Errorf("sd-video result exceeds %d bytes", maxSDVideoBridgeResultBytes)
	}
	if expected := stringValue(payloadResult(payload, "sha256")); expected != "" {
		digest := sha256.Sum256(body)
		if !strings.EqualFold(expected, hex.EncodeToString(digest[:])) {
			return errors.New("sd-video result checksum mismatch")
		}
	}
	if strings.TrimSpace(contentType) == "" {
		contentType = "video/mp4"
	}
	name := taskID + extensionForContentType(contentType)
	if result, ok := payload["result"].(map[string]any); ok {
		if candidate := filepath.Base(strings.TrimSpace(stringValue(result["file_name"]))); candidate != "." && candidate != "" {
			name = candidate
		}
	}
	asset, uploadErr := b.assets.Upload(ctx, AssetUploadInput{
		UserID: user.ID, Scope: WorkspaceScopeFromID(job.WorkspaceID), Type: "video", Name: name,
		Extension: extensionForContentType(contentType), SizeLimit: maxSDVideoBridgeResultBytes,
		ContentType: contentType, Reader: bytes.NewReader(body),
		ParentAssetIDs: sdVideoParentAssets(original),
		Registration: AssetRegistrationContext{
			AssetName: name, SourceType: model.AssetSourceSDVideo, SourceJobID: job.ID,
			SourceProjectID: stringValue(metadata["project_id"]), SourceNodeID: stringValue(metadata["node_id"]),
			SourceMetadata: map[string]any{"external_task_id": taskID, "external_provider": "sd-video"},
		},
		IdempotencyKey: "sd-video-result:" + taskID, IngestionMode: "automatic",
	})
	if uploadErr != nil {
		return uploadErr
	}
	metadata["asset_id"] = asset.ID
	metadata["result"] = map[string]any{"asset_id": asset.ID, "content_type": contentType, "size_bytes": len(body)}
	resultJSON, _ := json.Marshal(map[string]any{"asset_id": asset.ID, "external_task_id": taskID, "content_type": contentType, "size_bytes": len(body), "sha256": stringValue(payloadResult(payload, "sha256"))})
	if _, err := b.jobs.SetResult(job.ID, model.JSONB(resultJSON)); err != nil {
		return err
	}
	_, err = b.jobs.UpdateExternalState(job.ID, "sd-video", taskID, "succeeded", mustSDVideoBridgeJSONB(metadata))
	if err != nil {
		return err
	}
	return b.jobs.repo.SetBridgeState(job.ID, "done")
}

func sdVideoParentAssets(request map[string]any) []string {
	result := []string{}
	items, _ := request["references"].([]any)
	for _, item := range items {
		if reference, ok := item.(map[string]any); ok {
			if id := stringValue(reference["asset_ref"]); strings.HasPrefix(id, "asset_") {
				result = append(result, id)
			}
		}
	}
	return result
}

func mergeBridgeMetadata(raw model.JSONB, payload map[string]any) map[string]any {
	metadata := map[string]any{}
	_ = json.Unmarshal(raw, &metadata)
	if value, ok := payload["project_id"]; ok {
		metadata["project_id"] = value
	}
	if value, ok := payload["node_id"]; ok {
		metadata["node_id"] = value
	}
	metadata["remote_status"] = payload["status"]
	metadata["remote_progress"] = payload["progress"]
	return metadata
}

func extensionForContentType(contentType string) string {
	base := strings.TrimSpace(strings.Split(contentType, ";")[0])
	// mime.ExtensionsByType 的系统排序不稳定（Windows 可先返回 .m4v）。
	// 与 AssetService 的稳定查找规则一致，避免已入库但内容 404。
	if base == "video/mp4" {
		return ".mp4"
	}
	if base == "video/webm" {
		return ".webm"
	}
	if values, _ := mime.ExtensionsByType(base); len(values) > 0 {
		return values[0]
	}
	return ".mp4"
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func intValue(value any) int {
	switch value := value.(type) {
	case float64:
		return int(value)
	case int:
		return value
	case json.Number:
		parsed, _ := value.Int64()
		return int(parsed)
	default:
		return 0
	}
}

func errorJSONValue(value any, fallback string) model.JSONB {
	if value == nil {
		value = map[string]any{"code": "sd_video_task_failed", "message": fallback}
	}
	data, err := json.Marshal(value)
	if err != nil {
		return model.JSONB(`{"code":"sd_video_task_failed","message":"sd-video task failed"}`)
	}
	return model.JSONB(data)
}

func mustSDVideoBridgeJSONB(value map[string]any) model.JSONB {
	data, err := json.Marshal(value)
	if err != nil {
		return model.JSONB("{}")
	}
	return model.JSONB(data)
}

func payloadResult(payload map[string]any, key string) any {
	result, _ := payload["result"].(map[string]any)
	return result[key]
}
