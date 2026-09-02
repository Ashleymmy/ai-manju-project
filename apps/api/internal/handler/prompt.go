package handler

import (
	"context"
	"net/http"
	"strconv"

	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

type promptListService interface {
	List(context.Context, service.PromptListQuery) (service.PromptListPayload, error)
}

type PromptHandler struct {
	catalog promptListService
}

func NewPromptHandler(catalog promptListService) *PromptHandler {
	return &PromptHandler{catalog: catalog}
}

func (h *PromptHandler) List(c *gin.Context) {
	payload, err := h.catalog.List(c.Request.Context(), service.PromptListQuery{
		Keyword:  c.Query("keyword"),
		Tags:     c.QueryArray("tag"),
		Category: c.Query("category"),
		Page:     positiveQueryInt(c.Query("page"), 1),
		PageSize: positiveQueryInt(c.Query("pageSize"), 20),
	})
	if err != nil {
		response.Error(c, http.StatusBadGateway, "prompt catalog is temporarily unavailable")
		return
	}
	c.Header("Cache-Control", "no-store")
	// This public catalog predates requestApi and the frozen Studio consumes the payload directly.
	c.JSON(http.StatusOK, payload)
}

func positiveQueryInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}
