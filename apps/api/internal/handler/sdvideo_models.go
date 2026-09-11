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

func (h *ModelProviderHandler) SetSDVideoClient(client *sdvideo.Client) { h.sdVideo = client }

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
	return gin.H{
		"id": sdVideoManagedProviderPrefix + stringFromAny(item["key"]), "name": item["name"],
		"configured": true, "provider_type": "openai_compatible", "mode": "openai_compatible",
		"base_url": "sd-video://managed", "auth_type": "none", "text_model": "", "video_model": modelID,
		"capabilities": []string{"video"}, "models_by_capability": gin.H{"video": []string{modelID}},
		"default_for": []string{}, "timeout_ms": 120000, "max_concurrency": item["concurrency_limit"],
		"enabled": enabled, "version": item["version"], "api_key_set": item["disabled_reason"] == nil,
		"disabled_reason": item["disabled_reason"],
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
