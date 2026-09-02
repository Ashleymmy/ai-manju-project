package service

import (
	"errors"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

const (
	TagMaxDepth       = 8
	TagMaxNameRunes   = 64
	TagMaxAliasRunes  = 64
	TagMaxDescription = 1000
	TagDefaultPage    = 40
	TagMaxPage        = 100
	legacyTagRootName = "历史标签"
)

var (
	ErrTagNameRequired       = errors.New("tag name is required")
	ErrTagNameTooLong        = errors.New("tag name is too long")
	ErrTagAliasRequired      = errors.New("tag alias is required")
	ErrTagAliasTooLong       = errors.New("tag alias is too long")
	ErrTagDescriptionTooLong = errors.New("tag description is too long")
	ErrTagScope              = errors.New("tag scope is invalid")
	ErrTagParent             = errors.New("tag parent is invalid")
	ErrTagUsageRequired      = errors.New("at least one tag usage is required")
	ErrTagInheritMode        = errors.New("tag inherit mode is invalid")
	ErrTagStatus             = errors.New("tag status is invalid")
	ErrTagUsageInUse         = errors.New("tag usage cannot be disabled while bindings exist")
	ErrTagMatchMode          = errors.New("tag match mode is invalid")
)

type TagService struct {
	repo   repository.TagRepository
	assets repository.AssetRepository
}

func NewTagService(repo repository.TagRepository, assets repository.AssetRepository) *TagService {
	return &TagService{repo: repo, assets: assets}
}

type TagCreateInput struct {
	ScopeType     string
	ParentID      string
	Name          string
	Description   string
	AssetEnabled  bool
	PromptEnabled bool
	InheritMode   string
	SortOrder     int
}

type TagUpdateInput struct {
	Name          string
	Description   string
	AssetEnabled  bool
	PromptEnabled bool
	InheritMode   string
	Status        string
	SortOrder     int
}

type TagListInput struct {
	Scope              string
	Usage              string
	ParentID           string
	FilterParent       bool
	Keyword            string
	IncludeDescendants bool
	IncludeArchived    bool
	Page               int
	PageSize           int
}

type TagView struct {
	model.Tag
	Aliases     []model.TagAlias `json:"aliases"`
	AssetCount  int64            `json:"asset_count"`
	PromptCount int64            `json:"prompt_count"`
	Editable    bool             `json:"editable"`
	Children    int              `json:"children_count"`
}

type TagListResult struct {
	Items    []TagView `json:"items"`
	Total    int       `json:"total"`
	Page     int       `json:"page"`
	PageSize int       `json:"page_size"`
}

type TagAssetResult struct {
	Items    []model.Asset `json:"items"`
	Total    int           `json:"total"`
	Page     int           `json:"page"`
	PageSize int           `json:"page_size"`
}

func (s *TagService) List(userID string, workspaceScope string, input TagListInput) (TagListResult, error) {
	page, pageSize := normalizeTagPage(input.Page, input.PageSize)
	scopeType := strings.TrimSpace(strings.ToLower(input.Scope))
	if scopeType != "" && scopeType != "all" && !validTagScope(scopeType) {
		return TagListResult{}, ErrTagScope
	}
	usage := strings.TrimSpace(strings.ToLower(input.Usage))
	if usage != "" && usage != "asset" && usage != "prompt" {
		return TagListResult{}, repository.ErrTagUsage
	}
	scopeKeys := tagVisibleScopeKeys(userID, workspaceScope)
	tags, err := s.repo.List(scopeKeys)
	if err != nil {
		return TagListResult{}, err
	}
	ids := make([]string, 0, len(tags))
	for _, tag := range tags {
		ids = append(ids, tag.ID)
	}
	aliases, err := s.repo.ListAliases(ids)
	if err != nil {
		return TagListResult{}, err
	}
	aliasesByTag := map[string][]model.TagAlias{}
	for _, alias := range aliases {
		aliasesByTag[alias.TagID] = append(aliasesByTag[alias.TagID], alias)
	}
	allowedByParent := map[string]bool{}
	if input.FilterParent && input.IncludeDescendants && strings.TrimSpace(input.ParentID) != "" {
		descendants, descendantErr := s.repo.DescendantIDs(strings.TrimSpace(input.ParentID), scopeKeys, false)
		if descendantErr != nil {
			return TagListResult{}, descendantErr
		}
		allowedByParent = stringBoolSet(descendants)
	}
	keyword := normalizeTagText(input.Keyword)
	filtered := make([]model.Tag, 0, len(tags))
	for _, tag := range tags {
		if scopeType != "" && scopeType != "all" && tag.ScopeType != scopeType {
			continue
		}
		if usage == "asset" && !tag.AssetEnabled {
			continue
		}
		if usage == "prompt" && !tag.PromptEnabled {
			continue
		}
		if !input.IncludeArchived && tag.Status != model.TagStatusActive {
			continue
		}
		if input.FilterParent {
			if input.IncludeDescendants && strings.TrimSpace(input.ParentID) != "" {
				if !allowedByParent[tag.ID] {
					continue
				}
			} else if tag.ParentID != strings.TrimSpace(input.ParentID) {
				continue
			}
		}
		if keyword != "" && tag.NormalizedName != keyword && !strings.Contains(tag.NormalizedName, keyword) && !tagAliasesMatch(aliasesByTag[tag.ID], keyword) {
			continue
		}
		filtered = append(filtered, tag)
	}
	total := len(filtered)
	start := (page - 1) * pageSize
	if start > total {
		start = total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	pageTags := filtered[start:end]
	pageIDs := make([]string, 0, len(pageTags))
	children := map[string]int{}
	for _, tag := range tags {
		children[tag.ParentID]++
	}
	for _, tag := range pageTags {
		pageIDs = append(pageIDs, tag.ID)
	}
	counts, err := s.repo.Counts(pageIDs)
	if err != nil {
		return TagListResult{}, err
	}
	views := make([]TagView, 0, len(pageTags))
	for _, tag := range pageTags {
		count := counts[tag.ID]
		views = append(views, TagView{Tag: tag, Aliases: nonNilTagAliases(aliasesByTag[tag.ID]), AssetCount: count.AssetCount, PromptCount: count.PromptCount, Editable: tagEditable(tag, userID, workspaceScope), Children: children[tag.ID]})
	}
	return TagListResult{Items: views, Total: total, Page: page, PageSize: pageSize}, nil
}

func (s *TagService) Get(id string, userID string, workspaceScope string) (TagView, error) {
	scopeKeys := tagVisibleScopeKeys(userID, workspaceScope)
	tag, err := s.repo.Get(strings.TrimSpace(id), scopeKeys)
	if err != nil {
		return TagView{}, err
	}
	aliases, err := s.repo.ListAliases([]string{tag.ID})
	if err != nil {
		return TagView{}, err
	}
	counts, err := s.repo.Counts([]string{tag.ID})
	if err != nil {
		return TagView{}, err
	}
	directChildren := 0
	allTags, err := s.repo.List(scopeKeys)
	if err != nil {
		return TagView{}, err
	}
	for _, item := range allTags {
		if item.ParentID == tag.ID {
			directChildren++
		}
	}
	count := counts[tag.ID]
	return TagView{Tag: tag, Aliases: nonNilTagAliases(aliases), AssetCount: count.AssetCount, PromptCount: count.PromptCount, Editable: tagEditable(tag, userID, workspaceScope), Children: directChildren}, nil
}

func nonNilTagAliases(aliases []model.TagAlias) []model.TagAlias {
	if aliases == nil {
		return []model.TagAlias{}
	}
	return aliases
}

func (s *TagService) Create(userID string, workspaceScope string, input TagCreateInput) (model.Tag, error) {
	name, normalized, err := normalizeTagName(input.Name)
	if err != nil {
		return model.Tag{}, err
	}
	description, err := normalizeTagDescription(input.Description)
	if err != nil {
		return model.Tag{}, err
	}
	if !input.AssetEnabled && !input.PromptEnabled {
		return model.Tag{}, ErrTagUsageRequired
	}
	scopeType := strings.TrimSpace(strings.ToLower(input.ScopeType))
	if scopeType == "" {
		scopeType = model.TagScopeWorkspace
	}
	if scopeType != model.TagScopeWorkspace && scopeType != model.TagScopeUser {
		return model.Tag{}, ErrTagScope
	}
	if scopeType == model.TagScopeUser && input.AssetEnabled {
		return model.Tag{}, ErrTagScope
	}
	scopeKey := WorkspaceIDForScope(workspaceScope, userID)
	if scopeType == model.TagScopeUser {
		scopeKey = userID
	}
	parentID := strings.TrimSpace(input.ParentID)
	if parentID != "" {
		parent, getErr := s.repo.Get(parentID, []string{scopeKey})
		if getErr != nil || parent.ScopeType != scopeType || parent.ScopeKey != scopeKey {
			return model.Tag{}, ErrTagParent
		}
	}
	inheritMode, err := normalizeTagInheritMode(input.InheritMode)
	if err != nil {
		return model.Tag{}, err
	}
	return s.repo.Create(model.Tag{
		ID: "tag_" + randomHex(12), ScopeType: scopeType, ScopeKey: scopeKey, CreatedBy: userID, ParentID: parentID,
		Name: name, NormalizedName: normalized, Description: description, AssetEnabled: input.AssetEnabled,
		PromptEnabled: input.PromptEnabled, InheritMode: inheritMode, Status: model.TagStatusActive, SortOrder: input.SortOrder,
	}, TagMaxDepth)
}

func (s *TagService) Update(id string, userID string, workspaceScope string, input TagUpdateInput) (model.Tag, error) {
	tag, err := s.repo.Get(strings.TrimSpace(id), tagVisibleScopeKeys(userID, workspaceScope))
	if err != nil {
		return model.Tag{}, err
	}
	if !tagEditable(tag, userID, workspaceScope) {
		return model.Tag{}, repository.ErrTagProtected
	}
	name, normalized, err := normalizeTagName(input.Name)
	if err != nil {
		return model.Tag{}, err
	}
	description, err := normalizeTagDescription(input.Description)
	if err != nil {
		return model.Tag{}, err
	}
	if !input.AssetEnabled && !input.PromptEnabled {
		return model.Tag{}, ErrTagUsageRequired
	}
	if tag.ScopeType == model.TagScopeUser && input.AssetEnabled {
		return model.Tag{}, ErrTagScope
	}
	inheritMode, err := normalizeTagInheritMode(input.InheritMode)
	if err != nil {
		return model.Tag{}, err
	}
	status := strings.TrimSpace(strings.ToLower(input.Status))
	if status == "" {
		status = model.TagStatusActive
	}
	if status != model.TagStatusActive && status != model.TagStatusArchived {
		return model.Tag{}, ErrTagStatus
	}
	counts, err := s.repo.Counts([]string{tag.ID})
	if err != nil {
		return model.Tag{}, err
	}
	if (!input.AssetEnabled && tag.AssetEnabled && counts[tag.ID].AssetCount > 0) || (!input.PromptEnabled && tag.PromptEnabled && counts[tag.ID].PromptCount > 0) {
		return model.Tag{}, ErrTagUsageInUse
	}
	tag.Name, tag.NormalizedName, tag.Description = name, normalized, description
	tag.AssetEnabled, tag.PromptEnabled, tag.InheritMode, tag.Status, tag.SortOrder = input.AssetEnabled, input.PromptEnabled, inheritMode, status, input.SortOrder
	updated, err := s.repo.Update(tag, tag.ScopeKey)
	if err == nil {
		err = s.repo.RefreshTagMirrors(tag.ID)
	}
	return updated, err
}

func (s *TagService) Move(id string, parentID string, sortOrder int, userID string, workspaceScope string) (model.Tag, error) {
	tag, err := s.repo.Get(strings.TrimSpace(id), tagVisibleScopeKeys(userID, workspaceScope))
	if err != nil {
		return model.Tag{}, err
	}
	if !tagEditable(tag, userID, workspaceScope) {
		return model.Tag{}, repository.ErrTagProtected
	}
	parentID = strings.TrimSpace(parentID)
	if parentID != "" {
		parent, getErr := s.repo.Get(parentID, []string{tag.ScopeKey})
		if getErr != nil || parent.ScopeType != tag.ScopeType || !tagEditable(parent, userID, workspaceScope) {
			return model.Tag{}, ErrTagParent
		}
	}
	return s.repo.Move(tag.ID, parentID, sortOrder, tag.ScopeKey, TagMaxDepth)
}

func (s *TagService) BulkMove(ids []string, parentID string, sortOrder int, userID string, workspaceScope string) ([]model.Tag, error) {
	ids = uniqueAssetStrings(ids)
	if len(ids) == 0 {
		return nil, repository.ErrTagNotFound
	}
	visibleScopes := tagVisibleScopeKeys(userID, workspaceScope)
	var scopeKey string
	var scopeType string
	for _, id := range ids {
		tag, err := s.repo.Get(id, visibleScopes)
		if err != nil {
			return nil, err
		}
		if !tagEditable(tag, userID, workspaceScope) {
			return nil, repository.ErrTagProtected
		}
		if scopeKey == "" {
			scopeKey, scopeType = tag.ScopeKey, tag.ScopeType
		} else if tag.ScopeKey != scopeKey || tag.ScopeType != scopeType {
			return nil, ErrTagScope
		}
	}
	parentID = strings.TrimSpace(parentID)
	if parentID != "" {
		parent, err := s.repo.Get(parentID, []string{scopeKey})
		if err != nil || parent.ScopeType != scopeType || !tagEditable(parent, userID, workspaceScope) {
			return nil, ErrTagParent
		}
	}
	return s.repo.BulkMove(ids, parentID, sortOrder, scopeKey, TagMaxDepth)
}

func (s *TagService) Archive(id string, userID string, workspaceScope string) ([]model.Tag, error) {
	return s.BulkArchive([]string{id}, userID, workspaceScope)
}

func (s *TagService) BulkArchive(ids []string, userID string, workspaceScope string) ([]model.Tag, error) {
	ids = uniqueAssetStrings(ids)
	if len(ids) == 0 {
		return nil, repository.ErrTagNotFound
	}
	visibleScopes := tagVisibleScopeKeys(userID, workspaceScope)
	var scopeKey string
	for _, id := range ids {
		tag, err := s.repo.Get(id, visibleScopes)
		if err != nil {
			return nil, err
		}
		if !tagEditable(tag, userID, workspaceScope) {
			return nil, repository.ErrTagProtected
		}
		if scopeKey == "" {
			scopeKey = tag.ScopeKey
		} else if tag.ScopeKey != scopeKey {
			return nil, ErrTagScope
		}
	}
	archived, err := s.repo.ArchiveSubtrees(ids, scopeKey)
	if err != nil {
		return nil, err
	}
	return archived, nil
}

func (s *TagService) CreateAlias(tagID string, aliasValue string, userID string, workspaceScope string) (model.TagAlias, error) {
	tag, err := s.repo.Get(strings.TrimSpace(tagID), tagVisibleScopeKeys(userID, workspaceScope))
	if err != nil {
		return model.TagAlias{}, err
	}
	if !tagEditable(tag, userID, workspaceScope) {
		return model.TagAlias{}, repository.ErrTagProtected
	}
	alias, normalized, err := normalizeTagAlias(aliasValue)
	if err != nil {
		return model.TagAlias{}, err
	}
	return s.repo.CreateAlias(model.TagAlias{ID: "tag_alias_" + randomHex(12), TagID: tag.ID, Alias: alias, NormalizedAlias: normalized}, tag.ScopeKey)
}

func (s *TagService) DeleteAlias(tagID string, aliasID string, userID string, workspaceScope string) error {
	tag, err := s.repo.Get(strings.TrimSpace(tagID), tagVisibleScopeKeys(userID, workspaceScope))
	if err != nil {
		return err
	}
	if !tagEditable(tag, userID, workspaceScope) {
		return repository.ErrTagProtected
	}
	return s.repo.DeleteAlias(tag.ID, strings.TrimSpace(aliasID), tag.ScopeKey)
}

func (s *TagService) BindAssets(assetIDs []string, tagIDs []string, userID string, workspaceScope string) ([]model.AssetTagBinding, error) {
	workspaceID := WorkspaceIDForScope(workspaceScope, userID)
	return s.repo.BindAssets(workspaceID, userID, uniqueAssetStrings(assetIDs), uniqueAssetStrings(tagIDs), model.AssetTagOriginDirect)
}

func (s *TagService) ReplaceAssetDirectTags(userID string, workspaceScope string, assetID string, tagIDs []string) error {
	return s.repo.ReplaceAssetDirectTags(
		WorkspaceIDForScope(workspaceScope, userID),
		userID,
		strings.TrimSpace(assetID),
		uniqueAssetStrings(tagIDs),
		model.AssetTagOriginDirect,
	)
}

func (s *TagService) AssetTagDetails(assetID string, userID string, workspaceScope string) ([]repository.AssetTagBindingDetail, error) {
	workspaceID := WorkspaceIDForScope(workspaceScope, userID)
	assetID = strings.TrimSpace(assetID)
	if _, err := s.assets.GetByWorkspace(assetID, workspaceID); err != nil {
		return nil, err
	}
	return s.repo.ListAssetTagDetails(workspaceID, []string{assetID}, tagVisibleScopeKeys(userID, workspaceScope))
}

func (s *TagService) RemoveAssetTags(assetIDs []string, tagIDs []string, userID string, workspaceScope string) error {
	return s.repo.RemoveAssetTags(WorkspaceIDForScope(workspaceScope, userID), uniqueAssetStrings(assetIDs), uniqueAssetStrings(tagIDs))
}

func (s *TagService) Assets(tagID string, includeDescendants bool, page int, pageSize int, userID string, workspaceScope string) (TagAssetResult, error) {
	page, pageSize = normalizeTagPage(page, pageSize)
	scopeKeys := tagVisibleScopeKeys(userID, workspaceScope)
	tag, err := s.repo.Get(strings.TrimSpace(tagID), scopeKeys)
	if err != nil {
		return TagAssetResult{}, err
	}
	if !tag.AssetEnabled {
		return TagAssetResult{}, repository.ErrTagUsage
	}
	tagIDs := []string{tag.ID}
	if includeDescendants {
		tagIDs, err = s.repo.DescendantIDs(tag.ID, scopeKeys, true)
		if err != nil {
			return TagAssetResult{}, err
		}
	}
	workspaceID := WorkspaceIDForScope(workspaceScope, userID)
	assetIDs, err := s.repo.ListAssetIDs(workspaceID, tagIDs, false)
	if err != nil {
		return TagAssetResult{}, err
	}
	assets, err := s.assets.ListByWorkspaceIDs(assetIDs, workspaceID)
	if err != nil {
		return TagAssetResult{}, err
	}
	active := make([]model.Asset, 0, len(assets))
	for _, asset := range assets {
		if asset.TrashedAt == nil {
			asset.Scope = WorkspaceScopeFromID(workspaceID)
			active = append(active, asset)
		}
	}
	sort.Slice(active, func(i, j int) bool { return active[i].CreatedAt.After(active[j].CreatedAt) })
	total := len(active)
	start := (page - 1) * pageSize
	if start > total {
		start = total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	return TagAssetResult{Items: active[start:end], Total: total, Page: page, PageSize: pageSize}, nil
}

// FilterAssetIDs resolves every selected tag into its own descendant group.
// AND means an asset must match at least one tag from every selected group;
// OR means a match in any group is sufficient.
func (s *TagService) FilterAssetIDs(userID string, workspaceScope string, tagIDs []string, includeDescendants bool, matchAll bool) ([]string, error) {
	selected := uniqueAssetStrings(tagIDs)
	if len(selected) == 0 {
		return []string{}, nil
	}
	scopeKeys := tagVisibleScopeKeys(userID, workspaceScope)
	workspaceID := WorkspaceIDForScope(workspaceScope, userID)
	var combined map[string]bool
	for _, tagID := range selected {
		tag, err := s.repo.Get(tagID, scopeKeys)
		if err != nil {
			return nil, err
		}
		if !tag.AssetEnabled || tag.Status != model.TagStatusActive {
			return nil, repository.ErrTagUsage
		}
		group := []string{tag.ID}
		if includeDescendants {
			group, err = s.repo.DescendantIDs(tag.ID, scopeKeys, true)
			if err != nil {
				return nil, err
			}
		}
		matches, err := s.repo.ListAssetIDs(workspaceID, group, false)
		if err != nil {
			return nil, err
		}
		current := stringBoolSet(matches)
		if combined == nil {
			combined = current
			continue
		}
		if matchAll {
			for assetID := range combined {
				if !current[assetID] {
					delete(combined, assetID)
				}
			}
		} else {
			for assetID := range current {
				combined[assetID] = true
			}
		}
	}
	result := make([]string, 0, len(combined))
	for assetID := range combined {
		result = append(result, assetID)
	}
	sort.Strings(result)
	return result, nil
}

func (s *TagService) PromptIDs(tagID string, includeDescendants bool, userID string, workspaceScope string) ([]string, error) {
	scopeKeys := tagVisibleScopeKeys(userID, workspaceScope)
	tag, err := s.repo.Get(strings.TrimSpace(tagID), scopeKeys)
	if err != nil {
		return nil, err
	}
	if !tag.PromptEnabled {
		return nil, repository.ErrTagUsage
	}
	tagIDs := []string{tag.ID}
	if includeDescendants {
		tagIDs, err = s.repo.DescendantIDs(tag.ID, scopeKeys, true)
		if err != nil {
			return nil, err
		}
	}
	return s.repo.ListPromptIDs(tagIDs)
}

// SyncLegacyAssetTags keeps the old string-array API operational while the
// relation table becomes the source of truth. Unknown names are placed below
// a workspace-local "历史标签" root without guessing a hierarchy.
func (s *TagService) SyncLegacyAssetTags(userID string, workspaceScope string, assetID string, names []string) error {
	workspaceID := WorkspaceIDForScope(workspaceScope, userID)
	cleanNames := uniqueTagNames(names)
	visible, err := s.repo.List([]string{model.TagGlobalScopeKey, workspaceID})
	if err != nil {
		return err
	}
	tagIDs := make([]string, 0, len(cleanNames))
	for _, name := range cleanNames {
		normalized := normalizeTagText(name)
		if tag := preferredLegacyTag(visible, normalized, workspaceID); tag.ID != "" {
			tagIDs = append(tagIDs, tag.ID)
			continue
		}
		root, ensureErr := s.ensureLegacyRoot(userID, workspaceID)
		if ensureErr != nil {
			return ensureErr
		}
		created, createErr := s.repo.Create(model.Tag{
			ID: "tag_" + randomHex(12), ScopeType: model.TagScopeWorkspace, ScopeKey: workspaceID, CreatedBy: userID,
			ParentID: root.ID, Name: strings.TrimSpace(name), NormalizedName: normalized, AssetEnabled: true,
			PromptEnabled: false, InheritMode: model.TagInheritAuto, Status: model.TagStatusActive,
		}, TagMaxDepth)
		if errors.Is(createErr, repository.ErrTagConflict) {
			visible, createErr = s.repo.List([]string{model.TagGlobalScopeKey, workspaceID})
			if createErr == nil {
				created = preferredLegacyTag(visible, normalized, workspaceID)
			}
		}
		if createErr != nil || created.ID == "" {
			return createErr
		}
		visible = append(visible, created)
		tagIDs = append(tagIDs, created.ID)
	}
	return s.repo.ReplaceAssetDirectTags(workspaceID, userID, strings.TrimSpace(assetID), tagIDs, model.AssetTagOriginMigrated)
}

func (s *TagService) ensureLegacyRoot(userID string, workspaceID string) (model.Tag, error) {
	tags, err := s.repo.List([]string{workspaceID})
	if err != nil {
		return model.Tag{}, err
	}
	normalized := normalizeTagText(legacyTagRootName)
	for _, tag := range tags {
		if tag.ScopeType == model.TagScopeWorkspace && tag.ParentID == "" && tag.NormalizedName == normalized {
			if !tag.AssetEnabled {
				tag.AssetEnabled = true
				return s.repo.Update(tag, workspaceID)
			}
			return tag, nil
		}
	}
	return s.repo.Create(model.Tag{
		ID: "tag_" + randomHex(12), ScopeType: model.TagScopeWorkspace, ScopeKey: workspaceID, CreatedBy: userID,
		Name: legacyTagRootName, NormalizedName: normalized, AssetEnabled: true, PromptEnabled: false,
		InheritMode: model.TagInheritAuto, Status: model.TagStatusActive, SortOrder: 9000,
	}, TagMaxDepth)
}

func normalizeTagName(value string) (string, string, error) {
	name := strings.TrimSpace(strings.Join(strings.Fields(value), " "))
	if name == "" {
		return "", "", ErrTagNameRequired
	}
	if utf8.RuneCountInString(name) > TagMaxNameRunes {
		return "", "", ErrTagNameTooLong
	}
	return name, normalizeTagText(name), nil
}

func normalizeTagAlias(value string) (string, string, error) {
	alias := strings.TrimSpace(strings.Join(strings.Fields(value), " "))
	if alias == "" {
		return "", "", ErrTagAliasRequired
	}
	if utf8.RuneCountInString(alias) > TagMaxAliasRunes {
		return "", "", ErrTagAliasTooLong
	}
	return alias, normalizeTagText(alias), nil
}

func normalizeTagDescription(value string) (string, error) {
	description := strings.TrimSpace(value)
	if utf8.RuneCountInString(description) > TagMaxDescription {
		return "", ErrTagDescriptionTooLong
	}
	return description, nil
}

func normalizeTagText(value string) string {
	return strings.ToLower(strings.TrimSpace(strings.Join(strings.Fields(value), " ")))
}

func normalizeTagInheritMode(value string) (string, error) {
	mode := strings.TrimSpace(strings.ToLower(value))
	if mode == "" {
		mode = model.TagInheritAuto
	}
	if mode != model.TagInheritAuto && mode != model.TagInheritManual && mode != model.TagInheritNever {
		return "", ErrTagInheritMode
	}
	return mode, nil
}

func normalizeTagPage(page int, pageSize int) (int, int) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = TagDefaultPage
	}
	if pageSize > TagMaxPage {
		pageSize = TagMaxPage
	}
	return page, pageSize
}

func validTagScope(scope string) bool {
	return scope == model.TagScopeSystem || scope == model.TagScopePublic || scope == model.TagScopeWorkspace || scope == model.TagScopeUser
}

func tagVisibleScopeKeys(userID string, workspaceScope string) []string {
	return []string{model.TagGlobalScopeKey, WorkspaceIDForScope(workspaceScope, userID), userID}
}

func tagEditable(tag model.Tag, userID string, workspaceScope string) bool {
	return (tag.ScopeType == model.TagScopeWorkspace && tag.ScopeKey == WorkspaceIDForScope(workspaceScope, userID)) ||
		(tag.ScopeType == model.TagScopeUser && tag.ScopeKey == userID)
}

func tagAliasesMatch(aliases []model.TagAlias, keyword string) bool {
	for _, alias := range aliases {
		if strings.Contains(alias.NormalizedAlias, keyword) {
			return true
		}
	}
	return false
}

func stringBoolSet(values []string) map[string]bool {
	result := make(map[string]bool, len(values))
	for _, value := range values {
		result[value] = true
	}
	return result
}

func uniqueTagNames(values []string) []string {
	result, seen := make([]string, 0, len(values)), map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		key := normalizeTagText(value)
		if key != "" && !seen[key] {
			seen[key] = true
			result = append(result, value)
		}
	}
	return result
}

func preferredLegacyTag(tags []model.Tag, normalized string, workspaceID string) model.Tag {
	var global model.Tag
	for _, tag := range tags {
		if tag.NormalizedName != normalized || !tag.AssetEnabled || tag.Status != model.TagStatusActive {
			continue
		}
		if tag.ScopeType == model.TagScopeWorkspace && tag.ScopeKey == workspaceID {
			return tag
		}
		if tag.ScopeKey == model.TagGlobalScopeKey && global.ID == "" {
			global = tag
		}
	}
	return global
}
