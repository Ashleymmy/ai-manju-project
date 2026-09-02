package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

type comicAnalysisCreateRequest struct {
	Title            string            `json:"title"`
	StylePreset      string            `json:"style_preset"`
	DefaultTemplates map[string]string `json:"default_templates"`
	SourceType       string            `json:"source_type"`
	SourceText       string            `json:"source_text"`
	Instruction      string            `json:"instruction"`
	Model            string            `json:"model"`
}

func (h *ComicAssetHandler) CreateAnalysisSession(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.ComicProjectSourceMaxBytes+(2<<20))
	if err := c.Request.ParseMultipartForm(2 << 20); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			response.Error(c, http.StatusRequestEntityTooLarge, service.ErrComicSourceTooLarge.Error())
			return
		}
		response.Error(c, http.StatusBadRequest, "valid multipart analysis request is required")
		return
	}
	if c.Request.MultipartForm != nil {
		defer c.Request.MultipartForm.RemoveAll()
	}
	var req comicAnalysisCreateRequest
	if err := json.Unmarshal([]byte(c.PostForm("payload")), &req); err != nil {
		response.Error(c, http.StatusBadRequest, "valid analysis payload is required")
		return
	}
	file, header, err := c.Request.FormFile("source_file")
	if err != nil {
		response.Error(c, http.StatusBadRequest, service.ErrComicSourceRequired.Error())
		return
	}
	defer file.Close()
	detail, err := h.assets.CreateAnalysisSession(c.Request.Context(), user.ID, requestWorkspaceScope(c), service.CreateComicAnalysisSessionInput{
		CreateComicProjectInput: service.CreateComicProjectInput{
			Title: req.Title, StylePreset: req.StylePreset, DefaultTemplates: req.DefaultTemplates,
		},
		SourceType: req.SourceType, SourceFileName: header.Filename, SourceContentType: header.Header.Get("Content-Type"),
		SourceSize: header.Size, Source: file, SourceText: req.SourceText, InitialInstruction: req.Instruction, RequestedModel: req.Model,
	})
	if err != nil {
		writeComicAssetError(c, "create comic asset analysis session", err)
		return
	}
	response.Created(c, detail)
}

func (h *ComicAssetHandler) GetAnalysisSession(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	detail, err := h.assets.GetAnalysisSession(c.Param("sessionId"), user.ID, requestWorkspaceScope(c))
	if err != nil {
		writeComicAssetError(c, "get comic asset analysis session", err)
		return
	}
	response.OK(c, detail)
}

func (h *ComicAssetHandler) CreateAnalysisRevision(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	var req struct {
		Instruction              string                                  `json:"instruction"`
		Model                    string                                  `json:"model"`
		ParentRevisionID         string                                  `json:"parent_revision_id"`
		ExpectedActiveRevisionID string                                  `json:"expected_active_revision_id"`
		Source                   string                                  `json:"source"`
		Candidate                *service.ComicAnalysisCandidateSnapshot `json:"candidate"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	detail, err := h.assets.CreateAnalysisRevision(c.Request.Context(), c.Param("sessionId"), user.ID, requestWorkspaceScope(c), service.CreateComicAnalysisRevisionInput{
		Instruction: req.Instruction, RequestedModel: req.Model, ParentRevisionID: req.ParentRevisionID,
		ExpectedActiveRevisionID: req.ExpectedActiveRevisionID, Source: req.Source, Candidate: req.Candidate,
	})
	if err != nil {
		writeComicAssetError(c, "create comic asset analysis revision", err)
		return
	}
	response.Created(c, detail)
}

func (h *ComicAssetHandler) SetActiveAnalysisRevision(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	var req struct {
		RevisionID string `json:"revision_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	detail, err := h.assets.SetActiveAnalysisRevision(c.Param("sessionId"), req.RevisionID, user.ID, requestWorkspaceScope(c))
	if err != nil {
		writeComicAssetError(c, "set active comic asset analysis revision", err)
		return
	}
	response.OK(c, detail)
}

func (h *ComicAssetHandler) ConfirmAnalysisSession(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	var req struct {
		RevisionID string `json:"revision_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	detail, err := h.assets.ConfirmAnalysisSession(c.Param("sessionId"), req.RevisionID, user.ID, requestWorkspaceScope(c))
	if err != nil {
		writeComicAssetError(c, "confirm comic asset analysis session", err)
		return
	}
	response.Created(c, detail)
}

func (h *ComicAssetHandler) OptimizePrompt(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	var req struct {
		Direction             string `json:"direction"`
		Model                 string `json:"model"`
		Operation             string `json:"operation"`
		BaseContent           string `json:"base_content"`
		ExpectedPromptVersion int    `json:"expected_prompt_version"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.assets.OptimizePrompt(c.Request.Context(), c.Param("projectId"), c.Param("assetId"), user.ID, requestWorkspaceScope(c), service.OptimizeComicPromptInput{
		Direction: req.Direction, RequestedModel: req.Model, Operation: req.Operation,
		BaseContent: req.BaseContent, ExpectedPromptVersion: req.ExpectedPromptVersion,
	})
	if err != nil {
		writeComicAssetError(c, "optimize comic asset prompt", err)
		return
	}
	response.OK(c, result)
}

func (h *ComicAssetHandler) BulkApprovePrompts(c *gin.Context) {
	user, ok := comicCurrentUser(c)
	if !ok {
		return
	}
	var req struct {
		Approvals []service.BulkComicPromptApprovalInput `json:"approvals"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	results, err := h.assets.BulkApprovePrompts(c.Param("projectId"), user.ID, requestWorkspaceScope(c), req.Approvals)
	if err != nil {
		writeComicAssetError(c, "bulk approve comic asset prompts", err)
		return
	}
	response.OK(c, gin.H{"results": results})
}
