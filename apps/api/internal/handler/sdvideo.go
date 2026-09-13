package handler

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

func (h *AIHandler) shouldUseSDVideo(requestedModel string) bool {
	return h.sdVideo != nil && h.sdVideo.Enabled() && strings.HasPrefix(strings.ToLower(strings.TrimSpace(requestedModel)), "sdvideo/")
}

func (h *AIHandler) shouldUseSDVideoTask(c *gin.Context) bool {
	if h.shouldUseSDVideo(c.Query("model")) {
		return true
	}
	if h.sdVideo == nil || !h.sdVideo.Enabled() {
		return false
	}
	if h.jobs != nil && strings.HasPrefix(c.Param("id"), "job_") {
		user := auth.MustCurrentUser(c)
		job, err := h.jobs.GetForUser(c.Param("id"), user.ID)
		return err == nil && job.ExternalProvider == "sd-video"
	}
	// Standalone task IDs are deliberately namespaced.  This makes refreshed
	// Studio pages independent from the optional model query parameter while
	// keeping old provider task IDs on their original compatibility path.
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(c.Param("id"))), "sdv_")
}

func (h *AIHandler) createSDVideoTask(c *gin.Context, body map[string]any) {
	if h.sdVideo.Mode() != "active" {
		response.Error(c, http.StatusServiceUnavailable, "new video submissions are disabled")
		return
	}
	user := auth.MustCurrentUser(c)
	if projectID := stringFromAny(body["project_id"]); projectID != "" {
		if h.projects == nil {
			response.Error(c, 503, "project service unavailable")
			return
		}
		snapshot, err := h.projects.GetSnapshot(projectID, user.ID, requestWorkspaceScope(c))
		if err != nil {
			response.Error(c, 404, "project snapshot not found")
			return
		}
		if nodeID := stringFromAny(body["node_id"]); nodeID != "" {
			var graph struct {
				Nodes []struct {
					ID string `json:"id"`
				} `json:"nodes"`
			}
			if json.Unmarshal(snapshot.Data, &graph) != nil {
				response.Error(c, 409, "project snapshot is invalid")
				return
			}
			found := false
			for _, node := range graph.Nodes {
				if node.ID == nodeID {
					found = true
					break
				}
			}
			if !found {
				response.Error(c, 409, "canvas node no longer exists; save the canvas before generating")
				return
			}
		}
	} else if stringFromAny(body["node_id"]) != "" {
		response.Error(c, 400, "node requires project")
		return
	}
	modelName := strings.TrimSpace(stringFromAny(body["model"]))
	modelID := strings.TrimPrefix(modelName, "sdvideo/")
	if !h.sdVideo.AllowsCreation(service.WorkspaceIDForScope(requestWorkspaceScope(c), user.ID), modelID) {
		response.Error(c, 403, "video model is not enabled for this workspace")
		return
	}
	if modelID == "" {
		response.Error(c, http.StatusBadRequest, "sd-video model is required")
		return
	}
	if h.sdVideo.Shadow() {
		response.Error(c, http.StatusConflict, "shadow mode only validates; no task submitted")
		return
	}
	if h.jobs == nil {
		response.Error(c, http.StatusServiceUnavailable, "job service unavailable")
		return
	}
	payload := map[string]any{
		"idempotency_key": c.GetHeader("Idempotency-Key"),
		"model":           modelID,
		"prompt":          stringFromAny(body["prompt"]),
		"ratio":           stringFromAny(body["ratio"]),
		"duration":        body["duration"],
		"resolution":      body["resolution"],
		"generate_audio":  body["generate_audio"],
		"watermark":       body["watermark"],
		"content":         body["content"],
		"project_id":      stringFromAny(body["project_id"]),
		"node_id":         stringFromAny(body["node_id"]),
		"scope":           requestWorkspaceScope(c),
		"tool_mode":       body["tool_mode"],
	}
	references, referenceErr := h.prepareSDVideoReferences(c, user, requestWorkspaceScope(c), body["content"])
	if referenceErr != nil {
		response.Error(c, http.StatusBadRequest, referenceErr.Error())
		return
	}
	payload["references"] = references
	if payload["prompt"] == "" {
		if items, ok := body["content"].([]any); ok {
			var parts []string
			for _, item := range items {
				if value, ok := item.(map[string]any); ok && stringFromAny(value["type"]) == "text" {
					parts = append(parts, stringFromAny(value["text"]))
				}
			}
			payload["prompt"] = strings.Join(parts, "\n")
		}
	}
	payload["conversation_id"] = body["conversation_id"]
	payload["studio_message_id"] = body["studio_message_id"]
	// 未传的字段交给远端 schema 默认值，不发送 null 覆盖默认值。
	for _, key := range []string{"ratio", "duration", "resolution", "generate_audio", "watermark", "conversation_id", "studio_message_id"} {
		if value := payload[key]; value == nil || value == "" {
			delete(payload, key)
		}
	}
	if strings.TrimSpace(stringFromAny(payload["idempotency_key"])) == "" {
		payload["idempotency_key"] = "studio-" + randomHex(16)
	}
	bridgePayload, err := marshalJSONB(payload)
	if err != nil {
		response.Error(c, http.StatusBadRequest, "invalid video request")
		return
	}
	bridge, err := h.jobs.CreateExternal(service.ExternalJobInput{UserID: user.ID, Scope: requestWorkspaceScope(c), Type: model.JobTypeVideoGenerate, ExternalProvider: "sd-video", Payload: bridgePayload, IdempotencyKey: "sdvideo:" + stringFromAny(payload["idempotency_key"])})
	if err != nil {
		response.Error(c, http.StatusInternalServerError, "could not persist video job")
		return
	}
	taskID, bridgeJobID := bridge.Job.ID, bridge.Job.ID
	response.OK(c, gin.H{
		"id": taskID, "task_id": taskID, "job_id": bridgeJobID,
		"external_provider": "sd-video", "external_task_id": bridge.Job.ExternalTaskID,
		"status": bridge.Job.Status,
	})
}

func (h *AIHandler) prepareSDVideoReferences(c *gin.Context, user model.User, scope string, raw any) ([]map[string]any, error) {
	references := sdVideoReferencesFromContent(raw)
	for _, reference := range references {
		if reference["provider_asset"] == true {
			delete(reference, "provider_asset")
			continue
		}
		if raw := strings.TrimSpace(stringFromAny(reference["storage_token"])); raw != "" {
			if !strings.HasPrefix(raw, "data:") {
				return nil, errors.New("upload reference media before submitting video")
			}
			header, encoded, ok := strings.Cut(raw, ",")
			if !ok || !strings.HasSuffix(header, ";base64") {
				return nil, errors.New("invalid reference data URL")
			}
			contentType := strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
			if !strings.HasPrefix(contentType, stringFromAny(reference["kind"])+"/") {
				return nil, errors.New("reference media type mismatch")
			}
			if int64(base64.StdEncoding.DecodedLen(len(encoded))) > maxSeedanceRemoteVideoBytes {
				return nil, errors.New("reference exceeds size limit")
			}
			body, err := base64.StdEncoding.DecodeString(encoded)
			if err != nil {
				return nil, errors.New("invalid reference encoding")
			}
			token, err := h.sdVideo.UploadInput(c.Request.Context(), user, service.WorkspaceIDForScope(scope, user.ID), "reference", contentType, body)
			if err != nil {
				return nil, errors.New("reference upload unavailable")
			}
			reference["storage_token"] = token
			continue
		}
		assetRef := strings.TrimSpace(stringFromAny(reference["asset_ref"]))
		if assetRef == "" || strings.TrimSpace(stringFromAny(reference["storage_token"])) != "" {
			continue
		}
		if h.assets == nil || h.sdVideo == nil {
			return nil, errors.New("sd-video reference asset service is unavailable")
		}
		content, err := h.assets.OpenContent(c.Request.Context(), assetRef, user.ID, scope)
		if err != nil {
			return nil, fmt.Errorf("open reference asset: %w", err)
		}
		body, readErr := io.ReadAll(io.LimitReader(content.Reader, maxSeedanceRemoteVideoBytes+1))
		_ = content.Reader.Close()
		if readErr != nil {
			return nil, fmt.Errorf("read reference asset: %w", readErr)
		}
		if int64(len(body)) > maxSeedanceRemoteVideoBytes {
			return nil, errors.New("reference asset exceeds the maximum size")
		}
		name := strings.TrimSpace(content.Asset.Name)
		if name == "" {
			name = assetRef
		}
		contentType := firstNonEmpty(content.Asset.ContentType, content.Object.ContentType, "application/octet-stream")
		if !strings.HasPrefix(contentType, stringFromAny(reference["kind"])+"/") {
			return nil, errors.New("reference asset media type mismatch")
		}
		token, uploadErr := h.sdVideo.UploadInput(c.Request.Context(), user, service.WorkspaceIDForScope(scope, user.ID), name, contentType, body)
		if uploadErr != nil {
			return nil, fmt.Errorf("upload reference asset to sd-video: %w", uploadErr)
		}
		reference["storage_token"] = token
	}
	return references, nil
}

func (h *AIHandler) getSDVideoTask(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	if h.jobs != nil && strings.HasPrefix(c.Param("id"), "job_") {
		job, err := h.jobs.GetForUser(c.Param("id"), user.ID)
		if err != nil || job.WorkspaceID != service.WorkspaceIDForScope(requestWorkspaceScope(c), user.ID) {
			response.Error(c, http.StatusNotFound, "job not found")
			return
		}
		response.OK(c, gin.H{"id": job.ID, "task_id": job.ID, "job_id": job.ID, "status": job.Status, "progress": job.Progress, "result": job.Result, "error": job.Error, "external_task_id": job.ExternalTaskID})
		return
	}
	workspaceID := service.WorkspaceIDForScope(requestWorkspaceScope(c), user.ID)
	result, err := h.sdVideo.GetTask(c.Request.Context(), user, workspaceID, c.Param("id"))
	if err != nil {
		response.Error(c, http.StatusBadGateway, err.Error())
		return
	}
	data := map[string]any{}
	if len(result.Data) > 0 {
		_ = json.Unmarshal(result.Data, &data)
	}
	statusValue := stringOrDefault(stringFromAny(data["status"]), "queued")
	// GET 无状态写入；远端 succeeded 不等于 Studio Asset 已成功同步。
	response.OK(c, gin.H{"id": c.Param("id"), "task_id": c.Param("id"), "status": statusValue, "progress": data["progress"], "result": data["result"], "error": data["error"]})
}

func sdVideoReferencesFromContent(raw any) []map[string]any {
	items, ok := raw.([]any)
	if !ok {
		return nil
	}
	references := make([]map[string]any, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}
		kind, value := "", ""
		switch stringFromAny(record["type"]) {
		case "image_url", "image":
			kind = "image"
			value = stringFromAny(record["url"])
			if nested, ok := record["image_url"].(map[string]any); ok {
				value = firstNonEmpty(stringFromAny(nested["url"]), value)
			}
		case "video_url", "video":
			kind = "video"
			value = stringFromAny(record["url"])
			if nested, ok := record["video_url"].(map[string]any); ok {
				value = firstNonEmpty(stringFromAny(nested["url"]), value)
			}
		case "audio_url", "audio":
			kind = "audio"
			value = stringFromAny(record["url"])
			if nested, ok := record["audio_url"].(map[string]any); ok {
				value = firstNonEmpty(stringFromAny(nested["url"]), value)
			}
		default:
			continue
		}
		assetID := strings.TrimSpace(stringFromAny(record["asset_id"]))
		if strings.TrimSpace(value) == "" && assetID == "" {
			continue
		}
		reference := map[string]any{"kind": kind}
		if assetID != "" {
			reference["asset_ref"] = assetID
		} else if strings.HasPrefix(value, "asset://") {
			reference["asset_ref"] = value
			reference["provider_asset"] = true
		} else {
			// Data URLs and Studio temporary storage tokens are intentionally
			// forwarded as opaque values; the SD-video service owns resolving
			// them and never receives a browser credential.
			reference["storage_token"] = value
		}
		if role := stringFromAny(record["role"]); role != "" {
			reference["role"] = role
		}
		references = append(references, reference)
	}
	return references
}

// Multipart 参考素材进入同一转换路径，不遗留只供旧图片 Worker 使用的 staged key。
func (h *AIHandler) createSDVideoMultipart(c *gin.Context, fields map[string]string, files []provider.ProxyMultipartFile) {
	body := proxyMultipartJobPayload(fields, nil)
	if seconds, err := strconv.Atoi(fields["seconds"]); err == nil {
		body["duration"] = seconds
	}
	body["resolution"] = fields["resolution_name"]
	if fields["ratio"] != "" {
		body["ratio"] = fields["ratio"]
	} else {
		switch fields["size"] {
		case "720x1280":
			body["ratio"] = "9:16"
		case "1024x1024":
			body["ratio"] = "1:1"
		default:
			body["ratio"] = "16:9"
		}
	}
	content := []any{map[string]any{"type": "text", "text": fields["prompt"]}}
	for _, file := range files {
		media, err := io.ReadAll(io.LimitReader(file.File, maxSeedanceRemoteVideoBytes+1))
		if err != nil || int64(len(media)) > maxSeedanceRemoteVideoBytes {
			response.Error(c, http.StatusBadRequest, "invalid or oversized reference")
			return
		}
		contentType := file.Header.Get("Content-Type")
		if contentType == "" {
			contentType = http.DetectContentType(media)
		}
		kind := strings.SplitN(contentType, "/", 2)[0]
		if kind != "image" && kind != "video" && kind != "audio" {
			response.Error(c, http.StatusBadRequest, "unsupported reference media type")
			return
		}
		role := "reference"
		if file.FieldName == "first_frame" || file.FieldName == "last_frame" {
			role = file.FieldName
		}
		content = append(content, map[string]any{"type": kind + "_url", "role": role, "url": "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(media)})
	}
	body["content"] = content
	h.createSDVideoTask(c, body)
}

func (h *AIHandler) getSDVideoTaskContent(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	workspaceID := service.WorkspaceIDForScope(requestWorkspaceScope(c), user.ID)
	taskID := c.Param("id")
	if strings.HasPrefix(taskID, "job_") {
		job, err := h.jobs.GetForUser(taskID, user.ID)
		if err != nil || job.WorkspaceID != workspaceID {
			response.Error(c, http.StatusNotFound, "job not found")
			return
		}
		if job.Status != model.JobStatusSucceeded {
			response.Error(c, http.StatusConflict, "video result is not ready")
			return
		}
		taskID = job.ExternalTaskID
		var result map[string]any
		if json.Unmarshal(job.Result, &result) == nil {
			if assetID := stringFromAny(result["asset_id"]); strings.HasPrefix(assetID, "asset_") {
				c.Redirect(http.StatusTemporaryRedirect, "/api/assets/"+assetID+"/content?scope="+requestWorkspaceScope(c))
				return
			}
		}
	}
	body, contentType, err := h.sdVideo.Result(c.Request.Context(), user, workspaceID, taskID)
	if err != nil {
		response.Error(c, http.StatusBadGateway, err.Error())
		return
	}
	if contentType == "" {
		contentType = "video/mp4"
	}
	// 资产仅由持锁 Bridge Worker 导入，下载请求不能绕开取消和同步状态。
	c.Data(http.StatusOK, contentType, body)
}

func (h *AIHandler) importSDVideoResult(c *gin.Context, user model.User, body []byte, contentType string) {
	if h.assets == nil || h.jobs == nil || len(body) == 0 {
		return
	}
	bridge, err := h.jobs.GetExternalForUser("sd-video", c.Param("id"), user.ID)
	if err != nil {
		return
	}
	metadata := map[string]any{}
	if len(bridge.BridgeMetadata) > 0 {
		_ = json.Unmarshal(bridge.BridgeMetadata, &metadata)
	}
	if assetID := strings.TrimSpace(stringFromAny(metadata["asset_id"])); assetID != "" {
		return
	}
	name := c.Param("id") + ".mp4"
	if result, ok := metadata["result"].(map[string]any); ok {
		if candidate := strings.TrimSpace(stringFromAny(result["file_name"])); candidate != "" {
			name = candidate
		}
	}
	asset, uploadErr := h.assets.Upload(c.Request.Context(), service.AssetUploadInput{
		UserID: user.ID, Scope: requestWorkspaceScope(c), Type: "video", Name: name,
		Extension: ".mp4", SizeLimit: maxSeedanceRemoteVideoBytes, ContentType: contentType,
		Reader: bytes.NewReader(body), Registration: service.AssetRegistrationContext{
			AssetName: name, SourceType: model.AssetSourceSDVideo, SourceJobID: bridge.ID,
			SourceNodeID: stringFromAny(metadata["node_id"]), SourceProjectID: stringFromAny(metadata["project_id"]),
			SourceMetadata: map[string]any{"external_task_id": c.Param("id"), "external_provider": "sd-video"},
		},
		IdempotencyKey: "sd-video-result:" + c.Param("id"), IngestionMode: "automatic",
	})
	if uploadErr != nil {
		log.Printf("sd-video result import failed request_id=%s external_task_id=%s error=%v", response.RequestID(c), c.Param("id"), uploadErr)
		return
	}
	metadata["asset_id"] = asset.ID
	metadata["result"] = map[string]any{"asset_id": asset.ID, "content_type": contentType, "size_bytes": len(body)}
	_, _ = h.jobs.UpdateExternalState(bridge.ID, "sd-video", c.Param("id"), "succeeded", mustSDVideoJSONB(metadata))
}

func mustSDVideoJSONB(value map[string]any) model.JSONB {
	encoded, err := json.Marshal(value)
	if err != nil {
		return model.JSONB("{}")
	}
	return model.JSONB(encoded)
}

func stringOrDefault(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
