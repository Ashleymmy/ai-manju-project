package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

type SeedanceAssetHandler struct {
	assets *service.SeedanceAssetService
	cfg    config.Config
}

func NewSeedanceAssetHandler(assets *service.SeedanceAssetService, cfg config.Config) *SeedanceAssetHandler {
	return &SeedanceAssetHandler{assets: assets, cfg: cfg}
}

func (h *SeedanceAssetHandler) AdminReadiness(c *gin.Context) {
	response.OK(c, h.assets.Readiness())
}

func (h *SeedanceAssetHandler) AdminList(c *gin.Context) {
	result, err := h.assets.ListAssets(seedanceAssetListInputFromQuery(c, false))
	if err != nil {
		writeSeedanceAssetError(c, err)
		return
	}
	response.OK(c, result)
}

func (h *SeedanceAssetHandler) Mentions(c *gin.Context) {
	result, err := h.assets.ListAssets(seedanceAssetListInputFromQuery(c, true))
	if err != nil {
		writeSeedanceAssetError(c, err)
		return
	}
	response.OK(c, result)
}

func (h *SeedanceAssetHandler) AdminGet(c *gin.Context) {
	asset, err := h.assets.GetAsset(c.Param("id"))
	if err != nil {
		writeSeedanceAssetError(c, err)
		return
	}
	response.OK(c, asset)
}

func (h *SeedanceAssetHandler) AdminUpload(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, h.cfg.MaxAssetUploadBytes)
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		response.Error(c, http.StatusBadRequest, "file is required")
		return
	}
	defer file.Close()
	asset, err := h.assets.RegisterAssetFromUpload(c.Request.Context(), service.SeedanceAssetUploadInput{
		Name:        strings.TrimSpace(c.PostForm("name")),
		Description: strings.TrimSpace(c.PostForm("description")),
		AssetType:   strings.TrimSpace(c.PostForm("asset_type")),
		ContentType: header.Header.Get("Content-Type"),
		SizeLimit:   h.cfg.MaxAssetUploadBytes,
		Reader:      file,
		FileName:    header.Filename,
		CreatedBy:   user.ID,
		TagIDs:      splitCSV(c.PostForm("tag_ids")),
	})
	if err != nil {
		writeSeedanceAssetError(c, err)
		return
	}
	response.Created(c, asset)
}

func (h *SeedanceAssetHandler) AdminRegisterURL(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		Name        string   `json:"name"`
		Description string   `json:"description"`
		AssetType   string   `json:"asset_type"`
		SourceURL   string   `json:"source_url"`
		TagIDs      []string `json:"tag_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	asset, err := h.assets.RegisterAssetFromURL(c.Request.Context(), service.SeedanceAssetRegisterURLInput{
		Name:        req.Name,
		Description: req.Description,
		AssetType:   req.AssetType,
		SourceURL:   req.SourceURL,
		CreatedBy:   user.ID,
		TagIDs:      req.TagIDs,
	})
	if err != nil {
		writeSeedanceAssetError(c, err)
		return
	}
	response.Created(c, asset)
}

func (h *SeedanceAssetHandler) AdminUpdate(c *gin.Context) {
	var req struct {
		Name        *string  `json:"name"`
		Description *string  `json:"description"`
		TagIDs      []string `json:"tag_ids"`
		HasTagIDs   bool     `json:"-"`
	}
	var raw map[string]any
	if err := c.ShouldBindJSON(&raw); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if value, ok := raw["name"].(string); ok {
		req.Name = &value
	}
	if value, ok := raw["description"].(string); ok {
		req.Description = &value
	}
	if value, ok := raw["tag_ids"].([]any); ok {
		req.HasTagIDs = true
		req.TagIDs = make([]string, 0, len(value))
		for _, item := range value {
			if text, ok := item.(string); ok {
				req.TagIDs = append(req.TagIDs, text)
			}
		}
	}
	var tagIDs *[]string
	if req.HasTagIDs {
		tagIDs = &req.TagIDs
	}
	asset, err := h.assets.UpdateAsset(c.Param("id"), service.SeedanceAssetUpdateInput{
		Name:        req.Name,
		Description: req.Description,
		TagIDs:      tagIDs,
	})
	if err != nil {
		writeSeedanceAssetError(c, err)
		return
	}
	response.OK(c, asset)
}

func (h *SeedanceAssetHandler) AdminDelete(c *gin.Context) {
	if err := h.assets.DeleteAsset(c.Request.Context(), c.Param("id")); err != nil {
		writeSeedanceAssetError(c, err)
		return
	}
	response.OK(c, gin.H{})
}

func (h *SeedanceAssetHandler) AdminSync(c *gin.Context) {
	count, err := h.assets.SyncAssets(c.Request.Context())
	if err != nil {
		writeSeedanceAssetError(c, err)
		return
	}
	response.OK(c, gin.H{"synced": count})
}

func (h *SeedanceAssetHandler) AdminPoll(c *gin.Context) {
	count, err := h.assets.PollPendingOnce(c.Request.Context())
	if err != nil {
		writeSeedanceAssetError(c, err)
		return
	}
	response.OK(c, gin.H{"updated": count})
}

func (h *SeedanceAssetHandler) EnsureActive(c *gin.Context) {
	var req struct {
		AssetID  string   `json:"asset_id"`
		AssetIDs []string `json:"asset_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	assetIDs := append([]string{}, req.AssetIDs...)
	if strings.TrimSpace(req.AssetID) != "" {
		assetIDs = append(assetIDs, req.AssetID)
	}
	if len(assetIDs) == 0 {
		response.Error(c, http.StatusBadRequest, "asset_id is required")
		return
	}
	if err := h.assets.EnsureAssetsActive(c.Request.Context(), assetIDs); err != nil {
		writeSeedanceAssetError(c, err)
		return
	}
	response.OK(c, gin.H{"active": true})
}

func (h *SeedanceAssetHandler) ListTags(c *gin.Context) {
	tags, err := h.assets.ListTags()
	if err != nil {
		writeSeedanceAssetError(c, err)
		return
	}
	response.OK(c, gin.H{"items": tags})
}

func (h *SeedanceAssetHandler) UpsertTag(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	tag, err := h.assets.UpsertTag(service.SeedanceAssetTagInput{Name: req.Name, Color: req.Color, CreatedBy: user.ID})
	if err != nil {
		writeSeedanceAssetError(c, err)
		return
	}
	response.OK(c, tag)
}

func (h *SeedanceAssetHandler) DeleteTag(c *gin.Context) {
	if err := h.assets.DeleteTag(c.Param("id")); err != nil {
		writeSeedanceAssetError(c, err)
		return
	}
	response.OK(c, gin.H{})
}

func (h *SeedanceAssetHandler) AddTag(c *gin.Context) {
	if err := h.assets.AddTag(c.Param("id"), c.Param("tag_id")); err != nil {
		writeSeedanceAssetError(c, err)
		return
	}
	response.OK(c, gin.H{})
}

func (h *SeedanceAssetHandler) RemoveTag(c *gin.Context) {
	if err := h.assets.RemoveTag(c.Param("id"), c.Param("tag_id")); err != nil {
		writeSeedanceAssetError(c, err)
		return
	}
	response.OK(c, gin.H{})
}

func seedanceAssetListInputFromQuery(c *gin.Context, activeOnly bool) service.SeedanceAssetListInput {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	return service.SeedanceAssetListInput{
		Status:     strings.TrimSpace(c.Query("status")),
		Type:       strings.TrimSpace(c.Query("type")),
		TagID:      strings.TrimSpace(c.Query("tag_id")),
		Search:     strings.TrimSpace(c.Query("search")),
		ActiveOnly: activeOnly,
		Limit:      limit,
		Offset:     offset,
	}
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func writeSeedanceAssetError(c *gin.Context, err error) {
	status := http.StatusBadGateway
	if errors.Is(err, repository.ErrSeedanceAssetNotFound) || errors.Is(err, repository.ErrSeedanceAssetTagNotFound) {
		status = http.StatusNotFound
	}
	if errors.Is(err, service.ErrSeedanceAssetProviderNotConfigured) || errors.Is(err, service.ErrPublicAssetURLNotConfigured) || errors.Is(err, service.ErrSeedanceAssetNotActive) {
		status = http.StatusBadRequest
	}
	response.Error(c, status, err.Error())
}
