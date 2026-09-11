package handler

import (
	"github.com/ai-manju/api/internal/response"
	"github.com/gin-gonic/gin"
	"net/http"
)

// 擦除复用本地 outbox/Job/Bridge，不能让工具结果停留在远端临时 URL。
func (h *AIHandler) CreateSDVideoErase(c *gin.Context) {
	if h.sdVideo == nil || !h.sdVideo.Enabled() {
		response.Error(c, 503, "sd-video unavailable")
		return
	}
	var request struct {
		AssetID string `json:"asset_id"`
		Mode    string `json:"mode"`
	}
	if c.ShouldBindJSON(&request) != nil || request.AssetID == "" {
		response.Error(c, http.StatusBadRequest, "Studio video asset required")
		return
	}
	if request.Mode == "" {
		request.Mode = "standard"
	}
	if request.Mode != "standard" && request.Mode != "pro" {
		response.Error(c, 400, "invalid erase mode")
		return
	}
	h.createSDVideoTask(c, map[string]any{
		"model": "sdvideo/toolkit/erase", "tool_mode": request.Mode,
		"content": []any{map[string]any{"type": "video", "asset_id": request.AssetID}},
	})
}
