package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

type TagHandler struct {
	tags *service.TagService
}

func NewTagHandler(tags *service.TagService) *TagHandler {
	return &TagHandler{tags: tags}
}

func (h *TagHandler) List(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	parentID, filterParent := c.GetQuery("parent")
	result, err := h.tags.List(user.ID, requestWorkspaceScope(c), service.TagListInput{
		Scope: firstNonEmpty(c.Query("tag_scope"), c.Query("scope_type")), Usage: c.Query("usage"), ParentID: parentID, FilterParent: filterParent,
		Keyword: c.Query("keyword"), IncludeDescendants: queryBool(c.Query("include_descendants")),
		IncludeArchived: queryBool(c.Query("include_archived")), Page: queryPositiveInt(c.Query("page")), PageSize: queryPositiveInt(c.Query("page_size")),
	})
	if err != nil {
		tagError(c, err)
		return
	}
	response.OK(c, result)
}

func (h *TagHandler) Get(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	result, err := h.tags.Get(c.Param("tagId"), user.ID, requestWorkspaceScope(c))
	if err != nil {
		tagError(c, err)
		return
	}
	response.OK(c, result)
}

func (h *TagHandler) Create(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		ScopeType     string `json:"scope_type"`
		ParentID      string `json:"parent_id"`
		Name          string `json:"name"`
		Description   string `json:"description"`
		AssetEnabled  bool   `json:"asset_enabled"`
		PromptEnabled bool   `json:"prompt_enabled"`
		InheritMode   string `json:"inherit_mode"`
		SortOrder     int    `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	tag, err := h.tags.Create(user.ID, requestWorkspaceScope(c), service.TagCreateInput{
		ScopeType: req.ScopeType, ParentID: req.ParentID, Name: req.Name, Description: req.Description,
		AssetEnabled: req.AssetEnabled, PromptEnabled: req.PromptEnabled, InheritMode: req.InheritMode, SortOrder: req.SortOrder,
	})
	if err != nil {
		tagError(c, err)
		return
	}
	response.Created(c, tag)
}

func (h *TagHandler) Update(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		Name          string `json:"name"`
		Description   string `json:"description"`
		AssetEnabled  bool   `json:"asset_enabled"`
		PromptEnabled bool   `json:"prompt_enabled"`
		InheritMode   string `json:"inherit_mode"`
		Status        string `json:"status"`
		SortOrder     int    `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	tag, err := h.tags.Update(c.Param("tagId"), user.ID, requestWorkspaceScope(c), service.TagUpdateInput{
		Name: req.Name, Description: req.Description, AssetEnabled: req.AssetEnabled, PromptEnabled: req.PromptEnabled,
		InheritMode: req.InheritMode, Status: req.Status, SortOrder: req.SortOrder,
	})
	if err != nil {
		tagError(c, err)
		return
	}
	response.OK(c, tag)
}

func (h *TagHandler) Move(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		ParentID  string `json:"parent_id"`
		SortOrder int    `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	tag, err := h.tags.Move(c.Param("tagId"), req.ParentID, req.SortOrder, user.ID, requestWorkspaceScope(c))
	if err != nil {
		tagError(c, err)
		return
	}
	response.OK(c, tag)
}

func (h *TagHandler) BulkMove(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		TagIDs    []string `json:"tag_ids" binding:"required"`
		ParentID  string   `json:"parent_id"`
		SortOrder int      `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	items, err := h.tags.BulkMove(req.TagIDs, req.ParentID, req.SortOrder, user.ID, requestWorkspaceScope(c))
	if err != nil {
		tagError(c, err)
		return
	}
	response.OK(c, gin.H{"items": items, "count": len(items)})
}

func (h *TagHandler) Delete(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	items, err := h.tags.Archive(c.Param("tagId"), user.ID, requestWorkspaceScope(c))
	if err != nil {
		tagError(c, err)
		return
	}
	response.OK(c, gin.H{"items": items, "count": len(items)})
}

func (h *TagHandler) BulkDelete(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		TagIDs []string `json:"tag_ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	items, err := h.tags.BulkArchive(req.TagIDs, user.ID, requestWorkspaceScope(c))
	if err != nil {
		tagError(c, err)
		return
	}
	response.OK(c, gin.H{"items": items, "count": len(items)})
}

func (h *TagHandler) CreateAlias(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		Alias string `json:"alias"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	alias, err := h.tags.CreateAlias(c.Param("tagId"), req.Alias, user.ID, requestWorkspaceScope(c))
	if err != nil {
		tagError(c, err)
		return
	}
	response.Created(c, alias)
}

func (h *TagHandler) DeleteAlias(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	if err := h.tags.DeleteAlias(c.Param("tagId"), c.Param("aliasId"), user.ID, requestWorkspaceScope(c)); err != nil {
		tagError(c, err)
		return
	}
	response.OK(c, gin.H{})
}

func (h *TagHandler) Assets(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	result, err := h.tags.Assets(c.Param("tagId"), queryBool(c.Query("include_descendants")), queryPositiveInt(c.Query("page")), queryPositiveInt(c.Query("page_size")), user.ID, requestWorkspaceScope(c))
	if err != nil {
		tagError(c, err)
		return
	}
	response.OK(c, gin.H{"items": assetResponses(result.Items, ""), "total": result.Total, "page": result.Page, "page_size": result.PageSize})
}

func (h *TagHandler) Prompts(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	ids, err := h.tags.PromptIDs(c.Param("tagId"), queryBool(c.Query("include_descendants")), user.ID, requestWorkspaceScope(c))
	if err != nil {
		tagError(c, err)
		return
	}
	response.OK(c, gin.H{"items": ids, "total": len(ids)})
}

func (h *TagHandler) BindAsset(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		TagIDs []string `json:"tag_ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	bindings, err := h.tags.BindAssets([]string{c.Param("id")}, req.TagIDs, user.ID, requestWorkspaceScope(c))
	if err != nil {
		tagError(c, err)
		return
	}
	response.OK(c, gin.H{"items": bindings, "count": len(bindings)})
}

func (h *TagHandler) AssetTags(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	items, err := h.tags.AssetTagDetails(c.Param("id"), user.ID, requestWorkspaceScope(c))
	if err != nil {
		tagError(c, err)
		return
	}
	response.OK(c, gin.H{"items": items, "total": len(items)})
}

func (h *TagHandler) RemoveAssetTag(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	if err := h.tags.RemoveAssetTags([]string{c.Param("id")}, []string{c.Param("tagId")}, user.ID, requestWorkspaceScope(c)); err != nil {
		tagError(c, err)
		return
	}
	response.OK(c, gin.H{})
}

func (h *TagHandler) BulkAssetTags(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		AssetIDs []string `json:"asset_ids" binding:"required"`
		TagIDs   []string `json:"tag_ids" binding:"required"`
		Action   string   `json:"action"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	action := strings.TrimSpace(strings.ToLower(req.Action))
	if action == "" || action == "add" {
		bindings, err := h.tags.BindAssets(req.AssetIDs, req.TagIDs, user.ID, requestWorkspaceScope(c))
		if err != nil {
			tagError(c, err)
			return
		}
		response.OK(c, gin.H{"count": len(bindings)})
		return
	}
	if action != "remove" {
		response.Error(c, http.StatusBadRequest, "action must be add or remove")
		return
	}
	if err := h.tags.RemoveAssetTags(req.AssetIDs, req.TagIDs, user.ID, requestWorkspaceScope(c)); err != nil {
		tagError(c, err)
		return
	}
	response.OK(c, gin.H{"count": len(req.AssetIDs) * len(req.TagIDs)})
}

func tagError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, repository.ErrTagNotFound), errors.Is(err, repository.ErrTagAliasNotFound), errors.Is(err, repository.ErrAssetNotFound):
		response.Error(c, http.StatusNotFound, err.Error())
	case errors.Is(err, repository.ErrTagConflict), errors.Is(err, repository.ErrTagProtected), errors.Is(err, service.ErrTagUsageInUse):
		response.Error(c, http.StatusConflict, err.Error())
	case errors.Is(err, repository.ErrTagCycle), errors.Is(err, repository.ErrTagDepth), errors.Is(err, repository.ErrTagUsage),
		errors.Is(err, service.ErrTagNameRequired), errors.Is(err, service.ErrTagNameTooLong), errors.Is(err, service.ErrTagAliasRequired),
		errors.Is(err, service.ErrTagAliasTooLong), errors.Is(err, service.ErrTagDescriptionTooLong), errors.Is(err, service.ErrTagScope),
		errors.Is(err, service.ErrTagParent), errors.Is(err, service.ErrTagUsageRequired), errors.Is(err, service.ErrTagInheritMode),
		errors.Is(err, service.ErrTagStatus), errors.Is(err, service.ErrTagMatchMode):
		response.Error(c, http.StatusBadRequest, err.Error())
	default:
		response.Error(c, http.StatusInternalServerError, err.Error())
	}
}
