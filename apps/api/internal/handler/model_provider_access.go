package handler

import (
	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/gin-gonic/gin"
)

func (h *ModelProviderHandler) forUser(user model.User) *ModelProviderHandler {
	scoped := *h
	scoped.repo = repository.ForUserModelProviders(h.repo, user)
	return &scoped
}

func (h *ModelProviderHandler) forRequest(c *gin.Context) *ModelProviderHandler {
	user, _ := auth.CurrentUser(c)
	return h.forUser(user)
}
