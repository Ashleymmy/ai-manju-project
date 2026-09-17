package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/sdvideo"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

const sdVideoManagedProviderPrefix = "sdvideo::"

// One management entry groups models while preserving their independent routes.
const sdVideoManagedProviderGroupID = sdVideoManagedProviderPrefix + "all"

func sdVideoProviderGroup(items []map[string]any) gin.H {
	models := make([]gin.H, 0, len(items))
	ids := make([]string, 0, len(items))
	enabledCount, configuredCount := 0, 0
	for _, item := range items {
		view := sdVideoModelProvider(item)
		if view["enabled"] == true {
			enabledCount++
		}
		if view["api_key_set"] == true {
			configuredCount++
		}
		ids = append(ids, stringFromAny(item["id"]))
		models = append(models, gin.H{
			"key": item["key"], "model_id": item["id"], "name": item["name"],
			"enabled": view["enabled"], "available": item["available"], "version": item["version"],
			"concurrency_limit": item["concurrency_limit"], "credentials_configured": view["api_key_set"],
			"upstream_provider": item["upstream_provider"], "disabled_reason": item["disabled_reason"],
		})
	}
	return gin.H{
		"id": sdVideoManagedProviderGroupID, "name": "sdvideo", "configured": true,
		"provider_type": "openai_compatible", "mode": "openai_compatible", "base_url": "sd-video://managed",
		"auth_type": "none", "text_model": "", "video_model": "", "capabilities": []string{"video"},
		"models_by_capability": gin.H{"video": ids}, "default_for": []string{}, "timeout_ms": 120000,
		"max_concurrency": 1, "enabled": enabledCount > 0, "enabled_model_count": enabledCount,
		"api_key_set": configuredCount == len(items) && len(items) > 0, "sdvideo_models": models,
	}
}

func (h *ModelProviderHandler) SetSDVideoClient(client *sdvideo.Client) { h.sdVideo = client }

func (h *ModelProviderHandler) handleSDVideoGroup(c *gin.Context, operation string, items []map[string]any) {
	group := sdVideoProviderGroup(items)
	if operation == "get" {
		response.OK(c, group)
		return
	}
	if operation == "models" {
		ids := group["models_by_capability"].(gin.H)["video"]
		response.OK(c, gin.H{"models": ids, "video_models": ids})
		return
	}
	if operation == "test" {
		response.OK(c, gin.H{"ok": group["api_key_set"], "message": "已检查凭据配置状态；实际可用性需手动生成验证。", "models": group["sdvideo_models"]})
		return
	}
	var req struct {
		BaseURL string            `json:"base_url"`
		APIKey  string            `json:"api_key"`
		Secrets map[string]string `json:"secrets"`
		Models  []struct {
			Key         string `json:"key"`
			Name        string `json:"name"`
			ModelID     string `json:"model_id"`
			Enabled     bool   `json:"enabled"`
			Concurrency int    `json:"concurrency_limit"`
			Version     int    `json:"version"`
		} `json:"sdvideo_models"`
	}
	if c.ShouldBindJSON(&req) != nil || req.BaseURL != "sd-video://managed" || req.APIKey != "" || len(req.Secrets) > 0 {
		response.Error(c, 400, "视频凭证和上游地址由独立 SD-video 配置管理")
		return
	}
	known := map[string]bool{}
	for _, item := range items {
		known[stringFromAny(item["key"])] = true
	}
	if len(req.Models) == 0 || len(req.Models) != len(items) {
		response.Error(c, 409, "模型列表已变化，请重新加载后保存")
		return
	}
	changes := make([]map[string]any, 0, len(items))
	for _, item := range req.Models {
		if !known[item.Key] || item.Version < 1 || strings.TrimSpace(item.Name) == "" || strings.TrimSpace(item.ModelID) == "" || item.Concurrency < 1 || item.Concurrency > 16 {
			response.Error(c, 400, "无效的视频模型配置，请检查模型 ID、名称和并发数")
			return
		}
		delete(known, item.Key)
		changes = append(changes, map[string]any{"key": item.Key, "name": strings.TrimSpace(item.Name), "model_id": strings.TrimSpace(item.ModelID), "enabled": item.Enabled, "concurrency_limit": item.Concurrency, "version": item.Version})
	}
	user := auth.MustCurrentUser(c)
	envelope, err := h.sdVideo.BusinessRequest(c.Request.Context(), http.MethodPut, "/v1/admin/models", user, service.WorkspaceIDForScope(requestWorkspaceScope(c), user.ID), map[string]any{"items": changes})
	if err != nil {
		code := http.StatusBadGateway
		var remote *sdvideo.Error
		if errors.As(err, &remote) && remote.StatusCode >= 400 && remote.StatusCode < 500 {
			code = remote.StatusCode
		}
		response.Error(c, code, "视频模型配置未保存，请重新加载后重试")
		return
	}
	var updated struct {
		Items []map[string]any `json:"items"`
	}
	if json.Unmarshal(envelope.Data, &updated) != nil || len(updated.Items) != len(items) {
		response.Error(c, 502, "invalid model response")
		return
	}
	response.OK(c, sdVideoProviderGroup(updated.Items))
}

func (h *ModelProviderHandler) sdVideoModels(c *gin.Context) ([]map[string]any, error) {
	user := auth.MustCurrentUser(c)
	envelope, err := h.sdVideo.BusinessRequest(c.Request.Context(), http.MethodGet, "/v1/admin/models", user, service.WorkspaceIDForScope(requestWorkspaceScope(c), user.ID), nil)
	if err != nil {
		return nil, err
	}
	var result struct {
		Items []map[string]any `json:"items"`
	}
	err = json.Unmarshal(envelope.Data, &result)
	return result.Items, err
}

// 现有管理页面使用同一模型编辑表单；视频元数据只写入 SD-video，不复制 Provider 密钥。
func sdVideoModelProvider(item map[string]any) gin.H {
	modelID := stringFromAny(item["id"])
	enabled, ok := item["enabled"].(bool)
	if !ok {
		enabled, _ = item["available"].(bool)
	}
	providerType := "openai_compatible"
	if item["upstream_provider"] == "ark_official" {
		providerType = "volcengine_ark"
	}
	return gin.H{
		"id": sdVideoManagedProviderPrefix + stringFromAny(item["key"]), "name": item["name"],
		"configured": true, "provider_type": providerType, "mode": "openai_compatible",
		"base_url": "sd-video://managed", "auth_type": "none", "text_model": "", "video_model": modelID,
		"capabilities": []string{"video"}, "models_by_capability": gin.H{"video": []string{modelID}},
		"default_for": []string{}, "timeout_ms": 120000, "max_concurrency": item["concurrency_limit"],
		"enabled": enabled, "version": item["version"], "api_key_set": item["disabled_reason"] == nil,
		"disabled_reason":   item["disabled_reason"],
		"upstream_provider": item["upstream_provider"],
	}
}

func (h *ModelProviderHandler) handleSDVideoModel(c *gin.Context, operation string) bool {
	id := c.Param("id")
	if !strings.HasPrefix(id, sdVideoManagedProviderPrefix) {
		return false
	}
	if h.sdVideo == nil || !h.sdVideo.Enabled() {
		response.Error(c, http.StatusServiceUnavailable, "sd-video unavailable")
		return true
	}
	key := strings.TrimPrefix(id, sdVideoManagedProviderPrefix)
	if operation == "delete" {
		response.Error(c, http.StatusConflict, "SD-video 系统模型不能删除，请停用该模型")
		return true
	}
	items, err := h.sdVideoModels(c)
	if id == sdVideoManagedProviderGroupID {
		if err != nil {
			response.Error(c, 503, "sd-video unavailable")
			return true
		}
		h.handleSDVideoGroup(c, operation, items)
		return true
	}
	var current map[string]any
	for _, item := range items {
		if item["key"] == key {
			current = item
			break
		}
	}
	if err != nil {
		response.Error(c, 503, "sd-video unavailable")
		return true
	}
	if current == nil {
		response.Error(c, 404, "model not found")
		return true
	}
	if operation == "get" {
		response.OK(c, sdVideoModelProvider(current))
		return true
	}
	if operation == "models" {
		modelID := stringFromAny(current["id"])
		response.OK(c, gin.H{"models": []string{modelID}, "video_models": []string{modelID}, "default_video_model": modelID})
		return true
	}
	method, path := http.MethodPost, "/v1/admin/models/"+url.PathEscape(key)+"/test"
	var payload map[string]any
	if operation == "update" {
		var req struct {
			Name         string            `json:"name"`
			Model        string            `json:"video_model"`
			Enabled      bool              `json:"enabled"`
			Concurrency  int               `json:"max_concurrency"`
			Version      int               `json:"version"`
			APIKey       string            `json:"api_key"`
			Secrets      map[string]string `json:"secrets"`
			BaseURL      string            `json:"base_url"`
			Capabilities []string          `json:"capabilities"`
		}
		if c.ShouldBindJSON(&req) != nil {
			response.Error(c, 400, "invalid model configuration")
			return true
		}
		if req.APIKey != "" || len(req.Secrets) > 0 || req.BaseURL != "sd-video://managed" {
			response.Error(c, 400, "视频凭证和上游地址由独立 SD-video Secret 配置管理，不能写入 Studio")
			return true
		}
		if req.Version < 1 || len(req.Capabilities) != 1 || req.Capabilities[0] != "video" {
			response.Error(c, 409, "请重新加载视频模型；SD-video 模型仅支持视频能力")
			return true
		}
		payload = map[string]any{"name": req.Name, "model_id": req.Model, "enabled": req.Enabled, "concurrency_limit": req.Concurrency, "version": req.Version}
		method, path = http.MethodPut, "/v1/admin/models/"+url.PathEscape(key)
	}
	user := auth.MustCurrentUser(c)
	envelope, err := h.sdVideo.BusinessRequest(c.Request.Context(), method, path, user, service.WorkspaceIDForScope(requestWorkspaceScope(c), user.ID), payload)
	if err != nil {
		code := http.StatusBadGateway
		var remote *sdvideo.Error
		if errors.As(err, &remote) && remote.StatusCode >= 400 && remote.StatusCode < 500 {
			code = remote.StatusCode
		}
		response.Error(c, code, "视频模型配置未保存或版本冲突，请重新加载后重试")
		return true
	}
	if operation == "update" {
		var updated map[string]any
		if json.Unmarshal(envelope.Data, &updated) != nil {
			response.Error(c, 502, "invalid model response")
			return true
		}
		response.OK(c, sdVideoModelProvider(updated))
	} else {
		response.OK(c, envelope.Data)
	}
	return true
}
