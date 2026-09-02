package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

type AssetExportHandler struct{ exports *service.AssetExportService }

func NewAssetExportHandler(exports *service.AssetExportService) *AssetExportHandler {
	return &AssetExportHandler{exports: exports}
}

func (h *AssetExportHandler) Create(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		SelectionMode  string                    `json:"selection_mode" binding:"required"`
		AssetIDs       []string                  `json:"asset_ids"`
		FolderID       string                    `json:"folder_id"`
		Filter         service.AssetExportFilter `json:"filter"`
		CanvasFragment json.RawMessage           `json:"canvas_fragment"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	batch, err := h.exports.Create(user.ID, requestWorkspaceScope(c), service.AssetExportCreateInput{
		SelectionMode: req.SelectionMode, AssetIDs: req.AssetIDs, FolderID: req.FolderID,
		Filter: req.Filter, CanvasFragment: model.JSONB(req.CanvasFragment),
	})
	if err != nil {
		assetExportError(c, err)
		return
	}
	response.Accepted(c, batch)
}

func (h *AssetExportHandler) List(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	batches, err := h.exports.List(user.ID, requestWorkspaceScope(c))
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, batches)
}

func (h *AssetExportHandler) Get(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	batch, err := h.exports.Get(c.Param("exportId"), user.ID, requestWorkspaceScope(c))
	if err != nil {
		assetExportError(c, err)
		return
	}
	response.OK(c, batch)
}

func (h *AssetExportHandler) Cancel(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	batch, err := h.exports.Cancel(c.Param("exportId"), user.ID, requestWorkspaceScope(c))
	if err != nil {
		assetExportError(c, err)
		return
	}
	response.OK(c, batch)
}

func (h *AssetExportHandler) Content(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	content, err := h.exports.OpenContent(c.Request.Context(), c.Param("exportId"), user.ID, requestWorkspaceScope(c))
	if err != nil {
		assetExportError(c, err)
		return
	}
	defer content.Reader.Close()
	fileName := strings.NewReplacer("\r", "", "\n", "", `"`, "").Replace(content.Batch.FileName)
	if fileName == "" {
		fileName = "ai-manju-assets.zip"
	}
	c.Header("Content-Disposition", `attachment; filename="`+fileName+`"`)
	c.DataFromReader(http.StatusOK, content.Object.Size, "application/zip", content.Reader, nil)
}

func assetExportError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, repository.ErrAssetExportNotFound), errors.Is(err, repository.ErrAssetNotFound), errors.Is(err, repository.ErrAssetFolderNotFound):
		response.Error(c, http.StatusNotFound, err.Error())
	case errors.Is(err, service.ErrAssetExportExpired):
		response.Error(c, http.StatusGone, err.Error())
	case errors.Is(err, service.ErrAssetExportNotReady):
		response.Error(c, http.StatusConflict, err.Error())
	case errors.Is(err, service.ErrAssetExportSelection), errors.Is(err, service.ErrAssetCategory), errors.Is(err, service.ErrAssetSourceType), errors.Is(err, service.ErrTagMatchMode), errors.Is(err, service.ErrAssetLibrarySmartView), errors.Is(err, repository.ErrTagUsage), errors.Is(err, repository.ErrTagNotFound):
		response.Error(c, http.StatusBadRequest, err.Error())
	default:
		response.Error(c, http.StatusInternalServerError, err.Error())
	}
}
