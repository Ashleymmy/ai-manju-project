package handler

import (
	"encoding/json"
	"errors"
	"log"
	"mime"
	"net/http"
	"path"
	"strings"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

type ComicAssetHandler struct {
	assets *service.ComicAssetService
}

func NewComicAssetHandler(assets *service.ComicAssetService) *ComicAssetHandler {
	return &ComicAssetHandler{assets: assets}
}

type comicProjectRequest struct {
	Title            string            `json:"title"`
	StylePreset      string            `json:"style_preset"`
	DefaultTemplates map[string]string `json:"default_templates"`
}

type comicProjectUpdateRequest struct {
	Title            *string            `json:"title"`
	StylePreset      *string            `json:"style_preset"`
	DefaultTemplates *map[string]string `json:"default_templates"`
}

type comicProjectImportRequest struct {
	Title            string              `json:"title"`
	StylePreset      string              `json:"style_preset"`
	DefaultTemplates map[string]string   `json:"default_templates"`
	SourceType       string              `json:"source_type"`
	Assets           []comicAssetRequest `json:"assets"`
}

type comicAssetRequest struct {
	Code              *string `json:"code"`
	Class             *string `json:"class"`
	Name              *string `json:"name"`
	State             *string `json:"state"`
	Description       *string `json:"description"`
	VisualDescription *string `json:"visual_description"`
	ChangeRequest     *string `json:"change_request"`
	SourcePrompt      *string `json:"source_prompt"`
	PromptTemplate    *string `json:"prompt_template"`
	ArchiveStatus     *string `json:"archive_status"`
}

func (r comicAssetRequest) serviceInput() service.ComicAssetInput {
	return service.ComicAssetInput{
		Code: r.Code, Class: r.Class, Name: r.Name, State: r.State,
		Description: r.Description, VisualDescription: r.VisualDescription,
		ChangeRequest: r.ChangeRequest, SourcePrompt: r.SourcePrompt,
		PromptTemplate: r.PromptTemplate, ArchiveStatus: r.ArchiveStatus,
	}
}

func (h *ComicAssetHandler) ListProjects(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	projects, err := h.assets.ListProjects(user.ID, requestWorkspaceScope(c))
	if err != nil {
		writeComicAssetError(c, "list comic asset projects", err)
		return
	}
	response.OK(c, projects)
}

func (h *ComicAssetHandler) CreateProject(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	var req comicProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	detail, err := h.assets.CreateProject(user.ID, requestWorkspaceScope(c), service.CreateComicProjectInput{
		Title: req.Title, StylePreset: req.StylePreset, DefaultTemplates: req.DefaultTemplates,
	})
	if err != nil {
		writeComicAssetError(c, "create comic asset project", err)
		return
	}
	response.Created(c, detail)
}

func (h *ComicAssetHandler) ImportProject(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.ComicProjectSourceMaxBytes+(8<<20))
	if err := c.Request.ParseMultipartForm(2 << 20); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			response.Error(c, http.StatusRequestEntityTooLarge, service.ErrComicSourceTooLarge.Error())
			return
		}
		response.Error(c, http.StatusBadRequest, "valid multipart import is required")
		return
	}
	if c.Request.MultipartForm != nil {
		defer c.Request.MultipartForm.RemoveAll()
	}
	var req comicProjectImportRequest
	if err := json.Unmarshal([]byte(c.PostForm("payload")), &req); err != nil {
		response.Error(c, http.StatusBadRequest, "valid import payload is required")
		return
	}
	file, header, err := c.Request.FormFile("source_file")
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			response.Error(c, http.StatusRequestEntityTooLarge, service.ErrComicSourceTooLarge.Error())
			return
		}
		response.Error(c, http.StatusBadRequest, service.ErrComicSourceRequired.Error())
		return
	}
	defer file.Close()
	assets := make([]service.ComicAssetInput, 0, len(req.Assets))
	for _, candidate := range req.Assets {
		assets = append(assets, candidate.serviceInput())
	}
	detail, err := h.assets.ImportProject(c.Request.Context(), user.ID, requestWorkspaceScope(c), service.ImportComicProjectInput{
		CreateComicProjectInput: service.CreateComicProjectInput{
			Title: comicProjectImportTitle(req.Title, header.Filename), StylePreset: req.StylePreset, DefaultTemplates: req.DefaultTemplates,
		},
		SourceType:        req.SourceType,
		SourceFileName:    header.Filename,
		SourceContentType: header.Header.Get("Content-Type"),
		SourceSize:        header.Size,
		Source:            file,
		Assets:            assets,
	})
	if err != nil {
		writeComicAssetError(c, "import comic asset project", err)
		return
	}
	response.Created(c, detail)
}

// comicProjectImportTitle keeps already-open clients recoverable when a
// multi-step preview omits the unmounted title field. Explicit titles always
// win; only multipart imports may fall back to the source file base name.
func comicProjectImportTitle(title string, sourceFileName string) string {
	if title = strings.TrimSpace(title); title != "" {
		return title
	}
	baseName := path.Base(strings.ReplaceAll(strings.TrimSpace(sourceFileName), "\\", "/"))
	return strings.TrimSpace(strings.TrimSuffix(baseName, path.Ext(baseName)))
}

func (h *ComicAssetHandler) ProjectSource(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	content, err := h.assets.OpenProjectSource(c.Request.Context(), c.Param("projectId"), user.ID, requestWorkspaceScope(c))
	if err != nil {
		writeComicAssetError(c, "download comic asset project source", err)
		return
	}
	defer content.Reader.Close()
	if disposition := mime.FormatMediaType("attachment", map[string]string{"filename": content.Project.SourceFileName}); disposition != "" {
		c.Header("Content-Disposition", disposition)
	}
	contentType := content.Project.SourceContentType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.DataFromReader(http.StatusOK, content.Object.Size, contentType, content.Reader, nil)
}

func (h *ComicAssetHandler) GetProject(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	detail, err := h.assets.GetProject(c.Param("projectId"), user.ID, requestWorkspaceScope(c))
	if err != nil {
		writeComicAssetError(c, "get comic asset project", err)
		return
	}
	response.OK(c, detail)
}

func (h *ComicAssetHandler) UpdateProject(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	var req comicProjectUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	detail, err := h.assets.UpdateProject(c.Param("projectId"), user.ID, requestWorkspaceScope(c), service.UpdateComicProjectInput{
		Title: req.Title, StylePreset: req.StylePreset, DefaultTemplates: req.DefaultTemplates,
	})
	if err != nil {
		writeComicAssetError(c, "update comic asset project", err)
		return
	}
	response.OK(c, detail)
}

func (h *ComicAssetHandler) DeleteProject(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	if err := h.assets.DeleteProject(c.Param("projectId"), user.ID, requestWorkspaceScope(c)); err != nil {
		writeComicAssetError(c, "delete comic asset project", err)
		return
	}
	response.NoContent(c)
}

func (h *ComicAssetHandler) CreateAsset(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	var req comicAssetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	asset, err := h.assets.CreateAsset(c.Param("projectId"), user.ID, requestWorkspaceScope(c), req.serviceInput())
	if err != nil {
		writeComicAssetError(c, "create comic asset", err)
		return
	}
	response.Created(c, asset)
}

func (h *ComicAssetHandler) UpdateAsset(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	var req comicAssetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	asset, err := h.assets.UpdateAsset(c.Param("projectId"), c.Param("assetId"), user.ID, requestWorkspaceScope(c), req.serviceInput())
	if err != nil {
		writeComicAssetError(c, "update comic asset", err)
		return
	}
	response.OK(c, asset)
}

func (h *ComicAssetHandler) DeleteAsset(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	if err := h.assets.DeleteAsset(c.Param("projectId"), c.Param("assetId"), user.ID, requestWorkspaceScope(c)); err != nil {
		writeComicAssetError(c, "delete comic asset", err)
		return
	}
	response.NoContent(c)
}

func (h *ComicAssetHandler) PreviewPrompt(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	preview, err := h.assets.PreviewPrompt(c.Param("projectId"), c.Param("assetId"), user.ID, requestWorkspaceScope(c))
	if err != nil {
		writeComicAssetError(c, "preview comic asset prompt", err)
		return
	}
	response.OK(c, preview)
}

func (h *ComicAssetHandler) SavePrompt(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	var req struct {
		Content string `json:"content"`
		Source  string `json:"source"`
		Action  string `json:"action"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	asset, err := h.assets.SavePrompt(c.Param("projectId"), c.Param("assetId"), user.ID, requestWorkspaceScope(c), service.SaveComicPromptInput{
		Content: req.Content, Source: req.Source, Action: req.Action,
	})
	if err != nil {
		writeComicAssetError(c, "save comic asset prompt", err)
		return
	}
	response.OK(c, asset)
}

func (h *ComicAssetHandler) CreateBatch(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	var req struct {
		AssetIDs                 []string                                  `json:"asset_ids"`
		ModelSelector            string                                    `json:"model_selector"`
		Size                     string                                    `json:"size"`
		Quality                  string                                    `json:"quality"`
		OutputFormat             string                                    `json:"output_format"`
		SystemPrompt             string                                    `json:"system_prompt"`
		VariantsPerAsset         int                                       `json:"variants_per_asset"`
		ReferenceAssetIDs        []string                                  `json:"reference_asset_ids"`
		AssetConfigs             []service.ComicAssetGenerationConfigInput `json:"asset_configs"`
		Concurrency              int                                       `json:"concurrency"`
		DestinationMode          string                                    `json:"destination_mode"`
		DestinationFolderID      string                                    `json:"destination_folder_id"`
		CreateCategorySubfolders *bool                                     `json:"create_category_subfolders"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	detail, err := h.assets.CreateBatch(c.Param("projectId"), user.ID, requestWorkspaceScope(c), service.CreateComicBatchInput{
		AssetIDs: req.AssetIDs, ModelSelector: req.ModelSelector, Size: req.Size, Quality: req.Quality,
		OutputFormat: req.OutputFormat, SystemPrompt: req.SystemPrompt, VariantsPerAsset: req.VariantsPerAsset,
		ReferenceAssetIDs: req.ReferenceAssetIDs, AssetConfigs: req.AssetConfigs, Concurrency: req.Concurrency,
		DestinationMode: req.DestinationMode, DestinationFolderID: req.DestinationFolderID, CreateCategorySubfolders: req.CreateCategorySubfolders,
		IdempotencyKey: c.GetHeader("Idempotency-Key"),
	})
	if err != nil {
		writeComicAssetError(c, "create comic asset generation batch", err)
		return
	}
	response.Accepted(c, detail)
}

func (h *ComicAssetHandler) ListBatches(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	batches, err := h.assets.ListBatches(c.Param("projectId"), user.ID, requestWorkspaceScope(c))
	if err != nil {
		writeComicAssetError(c, "list comic asset generation batches", err)
		return
	}
	response.OK(c, batches)
}

func (h *ComicAssetHandler) GetBatch(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	detail, err := h.assets.GetBatch(c.Param("batchId"), user.ID, requestWorkspaceScope(c))
	if err != nil {
		writeComicAssetError(c, "get comic asset generation batch", err)
		return
	}
	response.OK(c, detail)
}

func (h *ComicAssetHandler) PauseBatch(c *gin.Context)  { h.controlBatch(c, "pause") }
func (h *ComicAssetHandler) ResumeBatch(c *gin.Context) { h.controlBatch(c, "resume") }
func (h *ComicAssetHandler) StopBatch(c *gin.Context)   { h.controlBatch(c, "stop") }

func (h *ComicAssetHandler) controlBatch(c *gin.Context, action string) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	detail, err := h.assets.ControlBatch(c.Param("batchId"), user.ID, requestWorkspaceScope(c), action)
	if err != nil {
		writeComicAssetError(c, action+" comic asset generation batch", err)
		return
	}
	response.OK(c, detail)
}

func (h *ComicAssetHandler) RetryItem(c *gin.Context) {
	h.retryItems(c, []string{c.Param("itemId")})
}

func (h *ComicAssetHandler) RetryFailed(c *gin.Context) {
	h.retryItems(c, nil)
}

func (h *ComicAssetHandler) retryItems(c *gin.Context, itemIDs []string) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	detail, err := h.assets.RetryBatchItems(c.Param("batchId"), itemIDs, user.ID, requestWorkspaceScope(c))
	if err != nil {
		writeComicAssetError(c, "retry comic asset generation items", err)
		return
	}
	response.OK(c, detail)
}

func comicCurrentUser(c *gin.Context) (user struct{ ID string }, ok bool) {
	current, exists := auth.CurrentUser(c)
	if !exists {
		response.Error(c, http.StatusUnauthorized, "authentication required")
		return user, false
	}
	user.ID = current.ID
	return user, true
}

func writeComicAssetError(c *gin.Context, operation string, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, repository.ErrComicAssetProjectNotFound),
		errors.Is(err, repository.ErrComicAssetNotFound),
		errors.Is(err, repository.ErrComicAssetBatchNotFound),
		errors.Is(err, repository.ErrComicAssetBatchItemNotFound),
		errors.Is(err, repository.ErrComicAnalysisSessionNotFound),
		errors.Is(err, repository.ErrComicAnalysisRevisionNotFound),
		errors.Is(err, repository.ErrAssetFolderNotFound):
		status = http.StatusNotFound
	case errors.Is(err, service.ErrComicAnalysisExpired):
		status = http.StatusGone
	case errors.Is(err, repository.ErrComicAssetConflict), errors.Is(err, repository.ErrAssetFolderConflict), errors.Is(err, repository.ErrAssetFolderProtected), errors.Is(err, repository.ErrAssetFolderInUse):
		status = http.StatusConflict
	case errors.Is(err, repository.ErrComicAssetInvalidState),
		errors.Is(err, repository.ErrModelProviderNotFound),
		errors.Is(err, service.ErrComicTitleRequired),
		errors.Is(err, service.ErrComicAssetNameRequired),
		errors.Is(err, service.ErrComicAssetClassInvalid),
		errors.Is(err, service.ErrComicPromptRequired),
		errors.Is(err, service.ErrComicPromptNotApproved),
		errors.Is(err, service.ErrComicBatchEmpty),
		errors.Is(err, service.ErrComicBatchConcurrency),
		errors.Is(err, service.ErrComicImageModelRequired),
		errors.Is(err, service.ErrComicImageProvider),
		errors.Is(err, service.ErrComicImageVariants),
		errors.Is(err, service.ErrComicImageOutputFormat),
		errors.Is(err, service.ErrComicReferenceAsset),
		errors.Is(err, service.ErrComicDestinationMode),
		errors.Is(err, service.ErrComicDestinationFolder),
		errors.Is(err, service.ErrImageGenerationQualityInvalid),
		errors.Is(err, service.ErrImageGenerationSizeInvalid),
		errors.Is(err, service.ErrComicImportEmpty),
		errors.Is(err, service.ErrComicImportTooMany),
		errors.Is(err, service.ErrComicSourceRequired),
		errors.Is(err, service.ErrComicSourceInvalid),
		errors.Is(err, service.ErrComicSourceUnavailable),
		errors.Is(err, service.ErrComicAnalysisInstruction),
		errors.Is(err, service.ErrComicAnalysisCandidate),
		errors.Is(err, service.ErrComicAnalysisScriptRequired),
		errors.Is(err, service.ErrComicAnalysisScriptTooLarge),
		errors.Is(err, service.ErrComicPromptDirectionRequired),
		errors.Is(err, service.ErrComicPromptOperationInvalid),
		errors.Is(err, service.ErrComicPromptMergeBaseRequired),
		errors.Is(err, service.ErrComicPromptMergeBaseInvalid),
		errors.Is(err, service.ErrComicTextModelRequired),
		errors.Is(err, service.ErrComicTextProvider):
		status = http.StatusBadRequest
	case errors.Is(err, service.ErrComicSourceTooLarge):
		status = http.StatusRequestEntityTooLarge
	}
	if status >= http.StatusInternalServerError {
		log.Printf("request_id=%s operation=%s error=%v", response.RequestID(c), operation, err)
	}
	response.Error(c, status, err.Error())
}
