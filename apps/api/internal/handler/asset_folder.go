package handler

import (
	"errors"
	"net/http"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

type AssetFolderHandler struct {
	folders *service.AssetFolderService
}

func NewAssetFolderHandler(folders *service.AssetFolderService) *AssetFolderHandler {
	return &AssetFolderHandler{folders: folders}
}

func (h *AssetFolderHandler) List(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	folders, err := h.folders.List(user.ID, requestWorkspaceScope(c))
	if err != nil {
		assetFolderError(c, err)
		return
	}
	response.OK(c, folders)
}

func (h *AssetFolderHandler) Create(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		Name      string `json:"name"`
		ParentID  string `json:"parent_id"`
		SortOrder int    `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	folder, err := h.folders.Create(user.ID, requestWorkspaceScope(c), service.AssetFolderCreateInput{Name: req.Name, ParentID: req.ParentID, SortOrder: req.SortOrder})
	if err != nil {
		assetFolderError(c, err)
		return
	}
	response.Created(c, folder)
}

func (h *AssetFolderHandler) Update(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		Name      string `json:"name"`
		ParentID  string `json:"parent_id"`
		SortOrder int    `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	folder, err := h.folders.Update(c.Param("folderId"), user.ID, requestWorkspaceScope(c), service.AssetFolderUpdateInput{Name: req.Name, ParentID: req.ParentID, SortOrder: req.SortOrder})
	if err != nil {
		assetFolderError(c, err)
		return
	}
	response.OK(c, folder)
}

func (h *AssetFolderHandler) Delete(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	moved, err := h.folders.Delete(c.Param("folderId"), user.ID, requestWorkspaceScope(c))
	if err != nil {
		assetFolderError(c, err)
		return
	}
	response.OK(c, gin.H{"moved_assets": moved})
}

func assetFolderError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, repository.ErrAssetFolderNotFound):
		response.Error(c, http.StatusNotFound, err.Error())
	case errors.Is(err, repository.ErrAssetFolderConflict), errors.Is(err, repository.ErrAssetFolderProtected), errors.Is(err, repository.ErrAssetFolderInUse):
		response.Error(c, http.StatusConflict, err.Error())
	case errors.Is(err, service.ErrAssetFolderNameRequired), errors.Is(err, service.ErrAssetFolderNameTooLong), errors.Is(err, service.ErrAssetFolderDepth), errors.Is(err, service.ErrAssetFolderCycle), errors.Is(err, service.ErrAssetFolderParent):
		response.Error(c, http.StatusBadRequest, err.Error())
	default:
		response.Error(c, http.StatusInternalServerError, err.Error())
	}
}
