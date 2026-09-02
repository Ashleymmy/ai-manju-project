package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/service"
	"github.com/ai-manju/api/internal/storage"
	"github.com/gin-gonic/gin"
)

type AssetHandler struct {
	assets  *service.AssetService
	lineage *service.AssetLineageService
	usage   *service.AssetUsageService
	cfg     config.Config
}

func NewAssetHandler(repo repository.AssetRepository, cfg config.Config) *AssetHandler {
	return NewAssetHandlerWithService(service.NewAssetService(repo, storage.NewLocalFSStorage(cfg.AssetStorageDir)), cfg)
}

func NewAssetHandlerWithService(assets *service.AssetService, cfg config.Config) *AssetHandler {
	return &AssetHandler{assets: assets, cfg: cfg}
}

func (h *AssetHandler) SetLineageService(lineage *service.AssetLineageService) {
	h.lineage = lineage
}

func (h *AssetHandler) SetUsageService(usage *service.AssetUsageService) {
	h.usage = usage
}

func (h *AssetHandler) List(c *gin.Context) {
	user, ok := auth.CurrentUser(c)
	if !ok {
		response.Error(c, http.StatusUnauthorized, "authentication required")
		return
	}

	scope := requestWorkspaceScope(c)
	assets, err := h.assets.List(user.ID, scope)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	response.OK(c, assetResponses(assets, ""))
}

func (h *AssetHandler) Get(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	asset, err := h.assets.Get(c.Param("id"), user.ID, requestWorkspaceScope(c))
	if err != nil {
		if errors.Is(err, repository.ErrAssetNotFound) {
			response.Error(c, http.StatusNotFound, "asset not found")
			return
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	asset.Scope = workspaceScopeFromID(asset.WorkspaceID)
	response.OK(c, assetResponse(asset, ""))
}

func (h *AssetHandler) ListLibrary(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	createdFrom, err := optionalAssetTime(c.Query("created_from"))
	if err != nil {
		response.Error(c, http.StatusBadRequest, "created_from must be RFC3339")
		return
	}
	createdTo, err := optionalAssetTime(c.Query("created_to"))
	if err != nil {
		response.Error(c, http.StatusBadRequest, "created_to must be RFC3339")
		return
	}
	result, err := h.assets.ListLibrary(user.ID, requestWorkspaceScope(c), service.AssetLibraryInput{
		FolderID: c.Query("folder_id"), IncludeDescendants: queryBool(c.Query("include_descendants")),
		TagIDs: parseAssetTags(c.Query("tag_ids")), TagMatch: c.Query("tag_match"), IncludeTagDescendants: queryBool(c.Query("include_tag_descendants")), SmartView: c.Query("smart_view"),
		Type: c.Query("type"), Category: c.Query("category"), SourceType: c.Query("source_type"),
		SourceProjectID: c.Query("source_project_id"), Keyword: c.Query("keyword"), CreatedFrom: createdFrom, CreatedTo: createdTo,
		Page: queryPositiveInt(c.Query("page")), PageSize: queryPositiveInt(c.Query("page_size")), Sort: c.Query("sort"),
	})
	if err != nil {
		if errors.Is(err, repository.ErrAssetFolderNotFound) {
			response.Error(c, http.StatusNotFound, err.Error())
			return
		}
		if errors.Is(err, service.ErrAssetCategory) || errors.Is(err, service.ErrAssetSourceType) || errors.Is(err, service.ErrTagMatchMode) || errors.Is(err, service.ErrAssetLibrarySmartView) || errors.Is(err, repository.ErrTagUsage) || errors.Is(err, repository.ErrTagNotFound) {
			response.Error(c, http.StatusBadRequest, err.Error())
			return
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	items := assetResponses(result.Items, "")
	if h.usage != nil && len(result.Items) > 0 {
		assetIDs := make([]string, 0, len(result.Items))
		for _, asset := range result.Items {
			assetIDs = append(assetIDs, asset.ID)
		}
		stats, statsErr := h.usage.BatchStats(assetIDs, user.ID, requestWorkspaceScope(c))
		if statsErr != nil {
			response.Error(c, http.StatusInternalServerError, statsErr.Error())
			return
		}
		for index, asset := range result.Items {
			view := stats[asset.ID]
			items[index]["usage_stats"] = view.AssetUsageAggregate
			items[index]["user_state"] = view.UserState
		}
	}
	response.OK(c, gin.H{"items": items, "total": result.Total, "page": result.Page, "page_size": result.PageSize})
}

func (h *AssetHandler) Upload(c *gin.Context) {
	user, ok := auth.CurrentUser(c)
	if !ok {
		response.Error(c, http.StatusUnauthorized, "authentication required")
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, h.cfg.MaxAssetUploadBytes)
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			response.Error(c, http.StatusRequestEntityTooLarge, "file is too large")
			return
		}
		response.Error(c, http.StatusBadRequest, "file is required")
		return
	}
	defer file.Close()

	requestedType := strings.TrimSpace(strings.ToLower(c.PostForm("type")))
	sniffedContentType := sniffAssetContentType(file)
	contentType := inferAssetContentType(header.Filename, header.Header.Get("Content-Type"), sniffedContentType)
	assetType := normalizeAssetType(requestedType, contentType)
	if assetType == "" {
		response.Error(c, http.StatusBadRequest, "unsupported asset type")
		return
	}
	contentType, contentTypeMatchesAssetType := ensureAssetContentTypeForType(contentType, assetType)
	if !contentTypeMatchesAssetType || !assetPayloadMatchesContentType(assetType, contentType, sniffedContentType) {
		response.Error(c, http.StatusBadRequest, "uploaded file does not match asset type")
		return
	}

	scope := requestWorkspaceScope(c)
	assetID := "asset_" + randomHexString(12)
	extension := safeAssetExtension(header.Filename, contentType, assetType)

	name := strings.TrimSpace(c.PostForm("name"))
	if name == "" {
		name = header.Filename
	}
	if name == "" {
		name = assetID
	}

	sourceType := strings.TrimSpace(strings.ToLower(c.PostForm("source_type")))
	if sourceType != model.AssetSourceCanvas {
		sourceType = model.AssetSourceManualUpload
	}
	sourceProjectID := ""
	sourceProjectName := ""
	if sourceType == model.AssetSourceCanvas {
		sourceProjectID = c.PostForm("source_project_id")
		sourceProjectName = c.PostForm("source_project_name")
	}
	registration := service.AssetRegistrationContext{
		FolderID: c.PostForm("folder_id"), Category: c.PostForm("category"), SourceType: sourceType,
		SourceProjectID: sourceProjectID, SourceProjectName: sourceProjectName,
	}
	if raw := strings.TrimSpace(c.PostForm("source_metadata")); raw != "" {
		if err := json.Unmarshal([]byte(raw), &registration.SourceMetadata); err != nil {
			response.Error(c, http.StatusBadRequest, "source_metadata must be a JSON object")
			return
		}
	}
	asset, err := h.assets.Upload(c.Request.Context(), service.AssetUploadInput{
		ID:             assetID,
		UserID:         user.ID,
		Scope:          scope,
		Type:           assetType,
		Name:           name,
		Extension:      extension,
		SizeLimit:      h.cfg.MaxAssetUploadBytes,
		ContentType:    contentType,
		Reader:         file,
		Registration:   registration,
		Tags:           parseAssetTags(c.PostForm("tags")),
		TagIDs:         parseAssetTags(c.PostForm("tag_ids")),
		Note:           c.PostForm("note"),
		ParentAssetIDs: parseAssetTags(c.PostForm("parent_asset_ids")),
		RelationType:   c.PostForm("relation_type"),
		SourceNodeID:   c.PostForm("source_node_id"),
		IngestionMode:  c.PostForm("ingestion_mode"),
		IdempotencyKey: firstNonEmpty(c.PostForm("idempotency_key"), c.GetHeader("Idempotency-Key")),
	})
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) || errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, service.ErrPayloadTooLarge) {
			response.Error(c, http.StatusRequestEntityTooLarge, "file is too large")
			return
		}
		assetMutationError(c, err)
		return
	}

	response.Created(c, assetResponse(asset, contentType))
}

func (h *AssetHandler) Lineage(c *gin.Context) {
	if h.lineage == nil {
		response.Error(c, http.StatusServiceUnavailable, "asset lineage service is unavailable")
		return
	}
	user := auth.MustCurrentUser(c)
	result, err := h.lineage.Get(c.Param("id"), user.ID, requestWorkspaceScope(c))
	if err != nil {
		assetMutationError(c, err)
		return
	}
	response.OK(c, result)
}

func (h *AssetHandler) ResyncInheritedTags(c *gin.Context) {
	if h.lineage == nil {
		response.Error(c, http.StatusServiceUnavailable, "asset lineage service is unavailable")
		return
	}
	user := auth.MustCurrentUser(c)
	if err := h.lineage.ResyncInheritedTags(c.Param("id"), user.ID, requestWorkspaceScope(c)); err != nil {
		assetMutationError(c, err)
		return
	}
	response.OK(c, gin.H{})
}

func (h *AssetHandler) UpdateMetadata(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		Name     *string   `json:"name"`
		FolderID *string   `json:"folder_id"`
		Category *string   `json:"category"`
		Tags     *[]string `json:"tags"`
		TagIDs   *[]string `json:"tag_ids"`
		Note     *string   `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	asset, err := h.assets.UpdateMetadata(c.Param("id"), user.ID, requestWorkspaceScope(c), service.AssetMetadataInput{Name: req.Name, FolderID: req.FolderID, Category: req.Category, Tags: req.Tags, TagIDs: req.TagIDs, Note: req.Note})
	if err != nil {
		assetMutationError(c, err)
		return
	}
	response.OK(c, assetResponse(asset, ""))
}

func (h *AssetHandler) BulkMove(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		AssetIDs []string `json:"asset_ids" binding:"required"`
		FolderID string   `json:"folder_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	moved, err := h.assets.BulkMove(req.AssetIDs, req.FolderID, user.ID, requestWorkspaceScope(c))
	if err != nil {
		assetMutationError(c, err)
		return
	}
	response.OK(c, gin.H{"moved": moved})
}

func (h *AssetHandler) Content(c *gin.Context) {
	user, ok := auth.CurrentUser(c)
	if !ok {
		response.Error(c, http.StatusUnauthorized, "authentication required")
		return
	}

	scope := requestWorkspaceScope(c)
	content, err := h.assets.OpenContent(c.Request.Context(), c.Param("id"), user.ID, scope)
	if err != nil {
		if errors.Is(err, repository.ErrAssetNotFound) {
			response.Error(c, http.StatusNotFound, "asset not found")
			return
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer content.Reader.Close()

	thumbnailWidth, err := assetThumbnailWidth(c.Query("thumbnail"))
	if err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	download := queryBool(c.Query("download"))
	variant := ""
	if thumbnailWidth > 0 && !download && content.Asset.Type == "image" {
		variant = fmt.Sprintf("-thumb-%d", thumbnailWidth)
	}
	etag := fmt.Sprintf(`"asset-%s-%d-%d%s"`, content.Asset.ID, content.Object.Size, content.Object.ModifiedAt.UTC().Unix(), variant)
	if variant != "" {
		c.Header("Cache-Control", "private, max-age=86400")
	} else {
		c.Header("Cache-Control", "private, max-age=3600")
	}
	c.Header("ETag", etag)
	if !content.Object.ModifiedAt.IsZero() {
		c.Header("Last-Modified", content.Object.ModifiedAt.UTC().Format(http.TimeFormat))
	}
	if strings.TrimSpace(c.GetHeader("If-None-Match")) == etag {
		c.Status(http.StatusNotModified)
		return
	}
	contentType := firstNonEmpty(content.Asset.ContentType, content.Object.ContentType, "application/octet-stream")
	if h.usage != nil && download {
		_ = h.usage.RecordDownload(content.Asset.ID, user.ID, scope, response.RequestID(c))
		c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": content.Asset.Name}))
	}
	if variant != "" {
		original, readErr := io.ReadAll(content.Reader)
		if readErr != nil {
			response.Error(c, http.StatusInternalServerError, readErr.Error())
			return
		}
		if thumbnail, thumbnailType, ok := resizeAssetThumbnail(original, contentType, thumbnailWidth); ok {
			c.Data(http.StatusOK, thumbnailType, thumbnail)
			return
		}
		c.Data(http.StatusOK, contentType, original)
		return
	}
	c.DataFromReader(http.StatusOK, content.Object.Size, contentType, content.Reader, nil)
}

func assetThumbnailWidth(value string) (int, error) {
	switch strings.TrimSpace(value) {
	case "":
		return 0, nil
	case "320":
		return 320, nil
	case "640":
		return 640, nil
	default:
		return 0, errors.New("thumbnail must be 320 or 640")
	}
}

func resizeAssetThumbnail(original []byte, contentType string, targetWidth int) ([]byte, string, bool) {
	source, _, err := image.Decode(bytes.NewReader(original))
	if err != nil || targetWidth <= 0 {
		return nil, "", false
	}
	bounds := source.Bounds()
	if bounds.Dx() <= targetWidth || bounds.Dx() <= 0 || bounds.Dy() <= 0 {
		return nil, "", false
	}
	targetHeight := bounds.Dy() * targetWidth / bounds.Dx()
	if targetHeight < 1 {
		targetHeight = 1
	}
	target := image.NewRGBA(image.Rect(0, 0, targetWidth, targetHeight))
	for y := 0; y < targetHeight; y++ {
		sourceY := bounds.Min.Y + y*bounds.Dy()/targetHeight
		for x := 0; x < targetWidth; x++ {
			sourceX := bounds.Min.X + x*bounds.Dx()/targetWidth
			target.Set(x, y, source.At(sourceX, sourceY))
		}
	}
	var encoded bytes.Buffer
	if strings.EqualFold(contentType, "image/jpeg") {
		if err := jpeg.Encode(&encoded, target, &jpeg.Options{Quality: 82}); err != nil {
			return nil, "", false
		}
		return encoded.Bytes(), "image/jpeg", true
	}
	if err := png.Encode(&encoded, target); err != nil {
		return nil, "", false
	}
	return encoded.Bytes(), "image/png", true
}

func (h *AssetHandler) Stats(c *gin.Context) {
	if h.usage == nil {
		response.Error(c, http.StatusServiceUnavailable, "asset usage service is unavailable")
		return
	}
	user := auth.MustCurrentUser(c)
	result, err := h.usage.Stats(c.Param("id"), user.ID, requestWorkspaceScope(c))
	if err != nil {
		assetMutationError(c, err)
		return
	}
	response.OK(c, result)
}

func (h *AssetHandler) UserState(c *gin.Context) {
	if h.usage == nil {
		response.Error(c, http.StatusServiceUnavailable, "asset usage service is unavailable")
		return
	}
	user := auth.MustCurrentUser(c)
	result, err := h.usage.UserState(c.Param("id"), user.ID, requestWorkspaceScope(c))
	if err != nil {
		assetMutationError(c, err)
		return
	}
	response.OK(c, result)
}

func (h *AssetHandler) PutUserState(c *gin.Context) {
	if h.usage == nil {
		response.Error(c, http.StatusServiceUnavailable, "asset usage service is unavailable")
		return
	}
	var req struct {
		Reaction    string  `json:"reaction"`
		PrivateNote *string `json:"private_note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	user := auth.MustCurrentUser(c)
	result, err := h.usage.PutUserState(c.Param("id"), user.ID, requestWorkspaceScope(c), service.AssetUserStateInput{Reaction: req.Reaction, PrivateNote: req.PrivateNote})
	if errors.Is(err, service.ErrAssetReaction) || errors.Is(err, service.ErrAssetPrivateNote) {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if err != nil {
		assetMutationError(c, err)
		return
	}
	response.OK(c, result)
}

func (h *AssetHandler) UsageEvents(c *gin.Context) {
	if h.usage == nil {
		response.Error(c, http.StatusServiceUnavailable, "asset usage service is unavailable")
		return
	}
	user := auth.MustCurrentUser(c)
	result, err := h.usage.Events(c.Param("id"), user.ID, requestWorkspaceScope(c), queryPositiveInt(c.Query("page")), queryPositiveInt(c.Query("page_size")))
	if err != nil {
		assetMutationError(c, err)
		return
	}
	response.OK(c, result)
}

func (h *AssetHandler) Delete(c *gin.Context) {
	user, ok := auth.CurrentUser(c)
	if !ok {
		response.Error(c, http.StatusUnauthorized, "authentication required")
		return
	}

	scope := requestWorkspaceScope(c)
	if err := h.assets.Delete(c.Request.Context(), c.Param("id"), user.ID, scope); err != nil {
		if errors.Is(err, repository.ErrAssetNotFound) {
			response.Error(c, http.StatusNotFound, "asset not found")
			return
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, gin.H{})
}

func (h *AssetHandler) TrashPreflight(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		AssetIDs []string `json:"asset_ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.assets.TrashPreflight(req.AssetIDs, user.ID, requestWorkspaceScope(c))
	if err != nil {
		assetMutationError(c, err)
		return
	}
	response.OK(c, result)
}

func (h *AssetHandler) BulkTrash(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		AssetIDs []string `json:"asset_ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.assets.BulkTrash(req.AssetIDs, user.ID, requestWorkspaceScope(c))
	if err != nil {
		assetMutationError(c, err)
		return
	}
	response.OK(c, gin.H{"items": assetResponses(result.Items, ""), "count": result.Count, "total_bytes": result.TotalBytes})
}

func (h *AssetHandler) ListTrash(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	assets, err := h.assets.ListTrash(user.ID, requestWorkspaceScope(c))
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, assetResponses(assets, ""))
}

func (h *AssetHandler) ListTrashLibrary(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	createdFrom, err := optionalAssetTime(c.Query("created_from"))
	if err != nil {
		response.Error(c, http.StatusBadRequest, "created_from must be RFC3339")
		return
	}
	createdTo, err := optionalAssetTime(c.Query("created_to"))
	if err != nil {
		response.Error(c, http.StatusBadRequest, "created_to must be RFC3339")
		return
	}
	result, err := h.assets.ListTrashLibrary(user.ID, requestWorkspaceScope(c), service.AssetLibraryInput{
		Type: c.Query("type"), Category: c.Query("category"), SourceType: c.Query("source_type"),
		SourceProjectID: c.Query("source_project_id"), Keyword: c.Query("keyword"), CreatedFrom: createdFrom, CreatedTo: createdTo,
		Page: queryPositiveInt(c.Query("page")), PageSize: queryPositiveInt(c.Query("page_size")), Sort: c.Query("sort"),
	})
	if err != nil {
		if errors.Is(err, service.ErrAssetCategory) || errors.Is(err, service.ErrAssetSourceType) {
			response.Error(c, http.StatusBadRequest, err.Error())
			return
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, gin.H{"items": assetResponses(result.Items, ""), "total": result.Total, "page": result.Page, "page_size": result.PageSize})
}

func (h *AssetHandler) BulkRestore(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		AssetIDs []string `json:"asset_ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	restored, err := h.assets.BulkRestore(req.AssetIDs, user.ID, requestWorkspaceScope(c))
	if err != nil {
		assetMutationError(c, err)
		return
	}
	response.OK(c, gin.H{"items": assetResponses(restored, ""), "count": len(restored)})
}

func (h *AssetHandler) PermanentDelete(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	if err := h.assets.PermanentDelete(c.Request.Context(), c.Param("id"), user.ID, requestWorkspaceScope(c)); err != nil {
		assetMutationError(c, err)
		return
	}
	response.OK(c, gin.H{"deleted": true})
}

func (h *AssetHandler) EmptyTrash(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	result, err := h.assets.EmptyTrash(c.Request.Context(), user.ID, requestWorkspaceScope(c))
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, result)
}

func normalizeAssetType(value string, contentType string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "image", "video", "audio":
		return strings.TrimSpace(strings.ToLower(value))
	}
	if strings.HasPrefix(contentType, "image/") {
		return "image"
	}
	if strings.HasPrefix(contentType, "video/") {
		return "video"
	}
	if strings.HasPrefix(contentType, "audio/") {
		return "audio"
	}
	return ""
}

func inferAssetContentType(fileName string, contentType string, sniffedContentType string) string {
	normalized := cleanContentType(contentType)
	if normalized != "" && normalized != "application/octet-stream" {
		return normalized
	}
	if sniffedContentType != "" {
		return sniffedContentType
	}
	if hinted := contentTypeFromAssetFileName(fileName); hinted != "" {
		return hinted
	}
	if normalized != "" {
		return normalized
	}
	return "application/octet-stream"
}

func cleanContentType(contentType string) string {
	return strings.TrimSpace(strings.ToLower(strings.Split(contentType, ";")[0]))
}

func contentTypeFromAssetFileName(fileName string) string {
	switch strings.ToLower(filepath.Ext(fileName)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".mp4":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".mov":
		return "video/quicktime"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".m4a":
		return "audio/mp4"
	case ".ogg":
		return "audio/ogg"
	default:
		return ""
	}
}

func sniffAssetContentType(file io.ReadSeeker) string {
	buffer := make([]byte, 512)
	n, err := file.Read(buffer)
	_, _ = file.Seek(0, io.SeekStart)
	if err != nil && !errors.Is(err, io.EOF) {
		return ""
	}
	sample := buffer[:n]
	if len(sample) >= 12 && string(sample[0:4]) == "RIFF" && string(sample[8:12]) == "WEBP" {
		return "image/webp"
	}
	detected := cleanContentType(http.DetectContentType(sample))
	switch {
	case strings.HasPrefix(detected, "image/"), strings.HasPrefix(detected, "video/"), strings.HasPrefix(detected, "audio/"):
		return detected
	default:
		return ""
	}
}

func assetPayloadMatchesContentType(assetType string, contentType string, sniffedContentType string) bool {
	if assetType != "image" {
		return true
	}
	if !strings.HasPrefix(sniffedContentType, "image/") {
		return false
	}
	return contentType == "" || contentType == sniffedContentType
}

func ensureAssetContentTypeForType(contentType string, assetType string) (string, bool) {
	contentType = cleanContentType(contentType)
	switch assetType {
	case "image":
		switch contentType {
		case "image/png", "image/jpeg", "image/webp", "image/gif":
			return contentType, true
		default:
			return "", false
		}
	case "video":
		if strings.HasPrefix(contentType, "video/") {
			return contentType, true
		}
		return "", false
	case "audio":
		if strings.HasPrefix(contentType, "audio/") {
			return contentType, true
		}
		return "", false
	default:
		return contentType, contentType != "" && contentType != "application/octet-stream"
	}
}

func safeAssetExtension(fileName string, contentType string, assetType string) string {
	if extensions, err := mime.ExtensionsByType(contentType); err == nil && len(extensions) > 0 {
		return extensions[0]
	}
	extension := strings.ToLower(filepath.Ext(fileName))
	switch extension {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov", ".mp3", ".wav", ".m4a", ".ogg":
		return extension
	}
	switch assetType {
	case "image":
		return ".png"
	case "video":
		return ".mp4"
	case "audio":
		return ".mp3"
	default:
		return ".bin"
	}
}

func assetResponses(assets []model.Asset, contentType string) []gin.H {
	result := make([]gin.H, 0, len(assets))
	for _, asset := range assets {
		result = append(result, assetResponse(asset, contentType))
	}
	return result
}

func assetResponse(asset model.Asset, contentType string) gin.H {
	if strings.TrimSpace(asset.WorkspaceID) == "" {
		asset.WorkspaceID = workspaceIDForScope(WorkspaceScopePersonal, asset.UserID)
	}
	result := gin.H{
		"id":                asset.ID,
		"user_id":           asset.UserID,
		"workspace_id":      asset.WorkspaceID,
		"scope":             workspaceScopeFromID(asset.WorkspaceID),
		"type":              asset.Type,
		"name":              asset.Name,
		"url":               asset.URL,
		"size":              asset.Size,
		"content_type":      firstNonEmpty(asset.ContentType, contentType),
		"folder_id":         asset.FolderID,
		"category":          firstNonEmpty(asset.Category, model.AssetCategoryOther),
		"tags":              assetJSONValue(asset.Tags, []string{}),
		"note":              asset.Note,
		"source_type":       firstNonEmpty(asset.SourceType, model.AssetSourceUnknown),
		"source_project_id": asset.SourceProjectID,
		"source_batch_id":   asset.SourceBatchID,
		"source_item_id":    asset.SourceItemID,
		"source_job_id":     asset.SourceJobID,
		"source_metadata":   assetJSONValue(asset.SourceMetadata, gin.H{}),
		"content_sha256":    asset.ContentSHA256,
		"ingestion_mode":    asset.IngestionMode,
		"created_at":        asset.CreatedAt,
		"updated_at":        asset.UpdatedAt,
	}
	if asset.TrashedAt != nil {
		result["trashed_at"] = asset.TrashedAt
		result["trash_expires_at"] = asset.TrashExpiresAt
		result["trashed_by"] = asset.TrashedBy
		remaining := time.Duration(0)
		if asset.TrashExpiresAt != nil {
			remaining = time.Until(*asset.TrashExpiresAt)
			if remaining < 0 {
				remaining = 0
			}
		}
		result["trash_remaining_seconds"] = int64(remaining.Seconds())
		result["trash_risk_warning"] = asset.TrashExpiresAt != nil && remaining <= service.AssetTrashRiskWindow
	}
	return result
}

func assetMutationError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, repository.ErrAssetNotFound), errors.Is(err, repository.ErrAssetFolderNotFound):
		response.Error(c, http.StatusNotFound, err.Error())
	case errors.Is(err, service.ErrAssetCategory), errors.Is(err, service.ErrAssetSourceType), errors.Is(err, service.ErrAssetFolderParent), errors.Is(err, service.ErrAssetLineageParent), errors.Is(err, service.ErrAssetLineageRelation):
		response.Error(c, http.StatusBadRequest, err.Error())
	default:
		response.Error(c, http.StatusInternalServerError, err.Error())
	}
}

func optionalAssetTime(value string) (*time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func queryPositiveInt(value string) int {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	var result int
	_, _ = fmt.Sscanf(value, "%d", &result)
	return result
}

func queryBool(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func parseAssetTags(value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	var tags []string
	if json.Unmarshal([]byte(value), &tags) == nil {
		return tags
	}
	return strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == '，' })
}

func assetJSONValue(raw model.JSONB, fallback any) any {
	if len(raw) == 0 {
		return fallback
	}
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return fallback
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
