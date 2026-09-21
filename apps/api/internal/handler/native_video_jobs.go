package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

func (h *AIHandler) SetGenerationAssetService(assets *service.AssetService) {
	h.generationAssets = assets
}

// Native asynchronous videos use the same durable job, cancellation and retry
// lifecycle as image/OpenAI video generation. Supplier task IDs stay private.
func (h *AIHandler) enqueueNativeVideo(c *gin.Context, body map[string]any) {
	requested := firstNonEmpty(stringFromAny(body["model"]), c.Query("model"))
	candidates, ok := h.providerHandler.LoadGenerationCandidates(c, model.ModelCapabilityVideo, requested)
	if !ok {
		return
	}
	if len(seedanceAssetIDsFromPayload(body)) > 0 {
		// Registered asset IDs belong to one provider account. A matching model
		// on another supplier cannot reuse them, even during automatic failover.
		selected, err := h.providerHandler.resolveProviderSelection(model.ModelCapabilityVideo, requested)
		if err != nil {
			response.Error(c, http.StatusBadRequest, errGenerationUnavailable.Error())
			return
		}
		var scoped []modelSelection
		for _, candidate := range candidates {
			if candidate.Config.ID == selected.Config.ID {
				scoped = append(scoped, candidate)
			}
		}
		if len(scoped) == 0 {
			response.Error(c, http.StatusBadRequest, errGenerationUnavailable.Error())
			return
		}
		candidates = scoped
	}
	removeGenerationPrivateFields(body)
	body["studio_model"] = requested
	if err := h.prepareVideoAssetRegistration(c, body); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	body["model"] = candidates[0].Model
	kwargs := h.generationJobKwargs(candidates, "native_video")
	for i, config := range kwargs["provider_candidates"].([]map[string]any) {
		candidate := candidates[i]
		config["video_protocol"] = "seedance"
		// Preserve native API options without forwarding worker bookkeeping.
		config["video_request_body"] = nativeVideoProviderBody(body)
		if candidate.Config.ProviderType == model.ModelProviderTypeAliyunYike {
			converted, err := yikeVideoRequest(body, candidate.Model)
			if err != nil {
				// Only this supplier may reject a reference mode supported by another.
				config["video_request_error"] = true
			} else {
				config["video_request_body"] = converted
			}
		}
	}
	payload, err := marshalJSONB(body)
	if err != nil {
		response.Error(c, http.StatusBadRequest, "视频请求格式不正确")
		return
	}
	result, err := h.enqueueAIJob(c, model.JobTypeVideoGenerate, payload, kwargs)
	if err != nil {
		return
	}
	response.OK(c, gin.H{"id": result.Job.ID, "job_id": result.Job.ID, "status": result.Job.Status, "model": candidates[0].Model})
}

// Retain the native response shape and old remote-ID routes for existing tasks.
func (h *AIHandler) serveGenerationVideoJob(c *gin.Context, content bool) bool {
	if !strings.HasPrefix(c.Param("id"), "job_") {
		return false
	}
	if h.jobs == nil {
		response.Error(c, http.StatusServiceUnavailable, "任务服务暂不可用")
		return true
	}
	user := auth.MustCurrentUser(c)
	job, err := h.jobs.GetForUser(c.Param("id"), user.ID)
	if err != nil || job.Type != model.JobTypeVideoGenerate {
		response.Error(c, http.StatusNotFound, "视频任务不存在")
		return true
	}
	assetID := generationVideoAssetID(job.Result)
	if !content {
		public := jobResponse(job)
		result := gin.H{"id": job.ID, "job_id": job.ID, "status": public["status"], "progress": job.Progress, "content": gin.H{}}
		if job.Status == model.JobStatusFailed {
			result["error"] = gin.H{"message": errGenerationUnavailable.Error()}
		}
		if job.Status == model.JobStatusSucceeded && assetID != "" {
			result["content"] = gin.H{"video_url": "/api/ai/contents/generations/tasks/" + job.ID + "/content"}
		}
		response.OK(c, result)
		return true
	}
	if job.Status != model.JobStatusSucceeded || assetID == "" {
		response.Error(c, http.StatusConflict, "视频结果尚未就绪")
		return true
	}
	if h.generationAssets == nil {
		response.Error(c, http.StatusServiceUnavailable, "视频内容暂不可用")
		return true
	}
	asset, err := h.generationAssets.OpenContent(c.Request.Context(), assetID, user.ID, workspaceScopeFromID(job.WorkspaceID))
	if err != nil {
		response.Error(c, http.StatusNotFound, "视频内容不存在")
		return true
	}
	defer asset.Reader.Close()
	c.DataFromReader(http.StatusOK, asset.Object.Size, firstNonEmpty(asset.Object.ContentType, "video/mp4"), asset.Reader, map[string]string{"Cache-Control": "private, max-age=3600"})
	return true
}

func generationVideoAssetID(raw model.JSONB) string {
	var result struct {
		Outputs []struct {
			AssetID string `json:"asset_id"`
		} `json:"outputs"`
		Assets []struct {
			ID string `json:"id"`
		} `json:"assets"`
	}
	if json.Unmarshal(raw, &result) != nil {
		return ""
	}
	for _, output := range result.Outputs {
		if output.AssetID != "" {
			return output.AssetID
		}
	}
	for _, asset := range result.Assets {
		if asset.ID != "" {
			return asset.ID
		}
	}
	return ""
}
