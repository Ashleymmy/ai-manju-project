package handler

import (
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

const (
	WorkspaceScopePersonal = service.WorkspaceScopePersonal
	WorkspaceScopeTeam     = service.WorkspaceScopeTeam
	TeamWorkspaceID        = service.TeamWorkspaceID
)

type ProjectHandler struct {
	projects *service.ProjectService
}

func NewProjectHandler(repo repository.ProjectRepository) *ProjectHandler {
	return NewProjectHandlerWithService(service.NewProjectService(repo))
}

func NewProjectHandlerWithService(projects *service.ProjectService) *ProjectHandler {
	return &ProjectHandler{projects: projects}
}

// GetProjects 获取项目列表
func (h *ProjectHandler) GetProjects(c *gin.Context) {
	user, ok := auth.CurrentUser(c)
	if !ok {
		response.Error(c, http.StatusUnauthorized, "authentication required")
		return
	}

	scope := requestWorkspaceScope(c)
	projects, err := h.projects.List(user.ID, scope)
	if err != nil {
		logRepositoryError(c, "list projects", err)
		response.Error(c, 500, err.Error())
		return
	}

	response.OK(c, projectResponses(projects))
}

// GetProject 获取单个项目
func (h *ProjectHandler) GetProject(c *gin.Context) {
	user, ok := auth.CurrentUser(c)
	if !ok {
		response.Error(c, http.StatusUnauthorized, "authentication required")
		return
	}

	scope := requestWorkspaceScope(c)
	project, err := h.projects.Get(c.Param("id"), user.ID, scope)
	if err != nil {
		logRepositoryError(c, "get project", err)
		writeRepositoryError(c, err)
		return
	}

	response.OK(c, projectResponse(project))
}

// CreateProject 创建项目
func (h *ProjectHandler) CreateProject(c *gin.Context) {
	user, ok := auth.CurrentUser(c)
	if !ok {
		response.Error(c, http.StatusUnauthorized, "authentication required")
		return
	}

	var req struct {
		Title   string       `json:"title" binding:"required"`
		OwnerID string       `json:"owner_id"`
		Data    *model.JSONB `json:"data"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, 400, err.Error())
		return
	}

	scope := requestWorkspaceScope(c)
	project, err := h.projects.Create(user.ID, scope, service.CreateProjectInput{
		Title: req.Title,
		Data:  req.Data,
	})
	if errors.Is(err, service.ErrTitleRequired) {
		response.Error(c, 400, "title is required")
		return
	}
	if err != nil {
		logRepositoryError(c, "create project", err)
		response.Error(c, 500, err.Error())
		return
	}

	response.Created(c, projectResponse(project))
}

// UpdateProject 更新项目
func (h *ProjectHandler) UpdateProject(c *gin.Context) {
	user, ok := auth.CurrentUser(c)
	if !ok {
		response.Error(c, http.StatusUnauthorized, "authentication required")
		return
	}

	scope := requestWorkspaceScope(c)
	var req struct {
		Title        *string      `json:"title"`
		OwnerID      *string      `json:"owner_id"`
		Data         *model.JSONB `json:"data"`
		CoverAssetID *string      `json:"cover_asset_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, 400, err.Error())
		return
	}

	project, err := h.projects.Update(c.Param("id"), user.ID, scope, service.UpdateProjectInput{
		Title:        req.Title,
		Data:         req.Data,
		CoverAssetID: req.CoverAssetID,
	})
	if errors.Is(err, service.ErrTitleRequired) {
		response.Error(c, 400, "title is required")
		return
	}
	if err != nil {
		logRepositoryError(c, "update project", err)
		writeRepositoryError(c, err)
		return
	}

	response.OK(c, projectResponse(project))
}

// DeleteProject 删除项目
func (h *ProjectHandler) DeleteProject(c *gin.Context) {
	user, ok := auth.CurrentUser(c)
	if !ok {
		response.Error(c, http.StatusUnauthorized, "authentication required")
		return
	}

	scope := requestWorkspaceScope(c)
	if err := h.projects.Delete(c.Param("id"), user.ID, scope); err != nil {
		logRepositoryError(c, "delete project", err)
		writeRepositoryError(c, err)
		return
	}

	response.NoContent(c)
}

// GetCanvasSnapshot 获取项目画布快照
func (h *ProjectHandler) GetCanvasSnapshot(c *gin.Context) {
	user, ok := auth.CurrentUser(c)
	if !ok {
		response.Error(c, http.StatusUnauthorized, "authentication required")
		return
	}

	scope := requestWorkspaceScope(c)
	snapshot, err := h.projects.GetSnapshot(c.Param("id"), user.ID, scope)
	if err != nil {
		logRepositoryError(c, "get canvas snapshot", err)
		writeRepositoryError(c, err)
		return
	}

	response.OK(c, snapshot)
}

// UpdateCanvasSnapshot 更新项目画布快照
func (h *ProjectHandler) UpdateCanvasSnapshot(c *gin.Context) {
	user, ok := auth.CurrentUser(c)
	if !ok {
		response.Error(c, http.StatusUnauthorized, "authentication required")
		return
	}

	var req struct {
		Data *model.JSONB `json:"data" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, 400, err.Error())
		return
	}

	scope := requestWorkspaceScope(c)
	snapshot, err := h.projects.UpdateSnapshot(c.Param("id"), user.ID, scope, req.Data)
	if err != nil {
		logRepositoryError(c, "upsert canvas snapshot", err)
		writeRepositoryError(c, err)
		return
	}

	response.OK(c, snapshot)
}

func writeRepositoryError(c *gin.Context, err error) {
	if errors.Is(err, repository.ErrNotFound) {
		response.Error(c, 404, err.Error())
		return
	}

	response.Error(c, 500, err.Error())
}

func logRepositoryError(c *gin.Context, operation string, err error) {
	log.Printf("request_id=%s operation=%s project_id=%s error=%v", response.RequestID(c), operation, c.Param("id"), err)
}

func defaultString(value string, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}

	return trimmed
}

func requestWorkspaceScope(c *gin.Context) string {
	return service.NormalizeWorkspaceScope(c.Query("scope"))
}

func workspaceIDForScope(scope string, userID string) string {
	return service.WorkspaceIDForScope(scope, userID)
}

func workspaceScopeFromID(workspaceID string) string {
	return service.WorkspaceScopeFromID(workspaceID)
}

func projectResponses(projects []model.Project) []model.Project {
	result := make([]model.Project, 0, len(projects))
	for _, project := range projects {
		result = append(result, projectResponse(project))
	}
	return result
}

func projectResponse(project model.Project) model.Project {
	if strings.TrimSpace(project.WorkspaceID) == "" {
		project.WorkspaceID = "default:" + project.OwnerID
	}
	project.Scope = workspaceScopeFromID(project.WorkspaceID)
	return project
}
