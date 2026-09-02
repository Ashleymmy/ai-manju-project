package service

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

const (
	// AssetFolderMaxDepth limits pathological trees and keeps UI traversal bounded.
	AssetFolderMaxDepth = 6
	// AssetFolderMaxNameRunes is shared by create and rename validation.
	AssetFolderMaxNameRunes = 80
	// AssetLibraryDefaultPageSize avoids loading a whole workspace into one page.
	AssetLibraryDefaultPageSize = 40
	// AssetLibraryMaxPageSize is the public API hard limit.
	AssetLibraryMaxPageSize = 100
)

var (
	ErrAssetFolderNameRequired = errors.New("asset folder name is required")
	ErrAssetFolderNameTooLong  = errors.New("asset folder name is too long")
	ErrAssetFolderDepth        = errors.New("asset folder maximum depth exceeded")
	ErrAssetFolderCycle        = errors.New("asset folder cannot be moved below itself")
	ErrAssetFolderParent       = errors.New("asset folder parent is invalid")
	ErrAssetCategory           = errors.New("asset category is invalid")
	ErrAssetSourceType         = errors.New("asset source type is invalid")
)

type ActiveAssetFolderReferenceChecker interface {
	HasActiveOutputFolder(folderIDs []string, workspaceID string) (bool, error)
}

type AssetFolderService struct {
	folders       repository.AssetFolderRepository
	assets        repository.AssetRepository
	activeChecker ActiveAssetFolderReferenceChecker
	archiveZone   *time.Location
}

type AssetDefaultFolders struct {
	Root           model.AssetFolder
	Unsorted       model.AssetFolder
	Upload         model.AssetFolder
	ImageWorkbench model.AssetFolder
	Canvas         model.AssetFolder
	Comic          model.AssetFolder
}

type AssetFolderView struct {
	model.AssetFolder
	AssetCount           int64 `json:"asset_count"`
	DescendantAssetCount int64 `json:"descendant_asset_count"`
}

type AssetFolderCreateInput struct {
	Name      string
	ParentID  string
	SortOrder int
}

type AssetFolderUpdateInput struct {
	Name      string
	ParentID  string
	SortOrder int
}

type AssetRegistrationContext struct {
	AssetName         string         `json:"name"`
	FolderID          string         `json:"folder_id"`
	Category          string         `json:"category"`
	SourceType        string         `json:"source_type"`
	SourceProjectID   string         `json:"source_project_id"`
	SourceProjectName string         `json:"source_project_name"`
	SourceBatchID     string         `json:"source_batch_id"`
	SourceItemID      string         `json:"source_item_id"`
	SourceJobID       string         `json:"source_job_id"`
	ParentAssetIDs    []string       `json:"parent_asset_ids"`
	RelationType      string         `json:"relation_type"`
	SourceNodeID      string         `json:"source_node_id"`
	SourceMetadata    map[string]any `json:"source_metadata"`
}

func NewAssetFolderService(folderRepo repository.AssetFolderRepository, assetRepo repository.AssetRepository) *AssetFolderService {
	return &AssetFolderService{folders: folderRepo, assets: assetRepo, archiveZone: time.FixedZone("Asia/Shanghai", 8*60*60)}
}

func (s *AssetFolderService) SetArchiveTimezone(name string) error {
	name = strings.TrimSpace(name)
	if name == "" || name == "Asia/Shanghai" {
		s.archiveZone = time.FixedZone("Asia/Shanghai", 8*60*60)
		return nil
	}
	zone, err := time.LoadLocation(name)
	if err != nil {
		return err
	}
	s.archiveZone = zone
	return nil
}

func (s *AssetFolderService) SetActiveReferenceChecker(checker ActiveAssetFolderReferenceChecker) {
	s.activeChecker = checker
}

func (s *AssetFolderService) EnsureDefaults(userID string, scope string) (AssetDefaultFolders, error) {
	return s.ensureDefaultsForWorkspace(userID, WorkspaceIDForScope(scope, userID))
}

func (s *AssetFolderService) ensureDefaultsForWorkspace(userID string, workspaceID string) (AssetDefaultFolders, error) {
	root, err := s.ensureSystemFolder(userID, workspaceID, "", "系统归档", model.AssetFolderSystemKeyRoot, "workspace", "", 0)
	if err != nil {
		return AssetDefaultFolders{}, err
	}
	definitions := []struct {
		name string
		key  string
		sort int
		dest *model.AssetFolder
	}{
		{name: "未分类", key: model.AssetFolderSystemKeyUnsorted, sort: 10},
		{name: "手动上传", key: model.AssetFolderSystemKeyUpload, sort: 20},
		{name: "生图工作台", key: model.AssetFolderSystemKeyImageWorkbench, sort: 30},
		{name: "画布工坊", key: model.AssetFolderSystemKeyCanvas, sort: 40},
		{name: "漫剧资产助手", key: model.AssetFolderSystemKeyComic, sort: 50},
	}
	created := make([]model.AssetFolder, 0, len(definitions))
	for _, definition := range definitions {
		folder, createErr := s.ensureSystemFolder(userID, workspaceID, root.ID, definition.name, definition.key, "workspace", "", definition.sort)
		if createErr != nil {
			return AssetDefaultFolders{}, createErr
		}
		created = append(created, folder)
	}
	return AssetDefaultFolders{Root: root, Unsorted: created[0], Upload: created[1], ImageWorkbench: created[2], Canvas: created[3], Comic: created[4]}, nil
}

func (s *AssetFolderService) List(userID string, scope string) ([]AssetFolderView, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	if _, err := s.ensureDefaultsForWorkspace(userID, workspaceID); err != nil {
		return nil, err
	}
	folders, err := s.folders.ListByWorkspace(workspaceID)
	if err != nil {
		return nil, err
	}
	counts, err := s.assets.CountByFolder(workspaceID)
	if err != nil {
		return nil, err
	}
	children := folderChildren(folders)
	result := make([]AssetFolderView, 0, len(folders))
	for _, folder := range folders {
		folder.Scope = WorkspaceScopeFromID(folder.WorkspaceID)
		descendantCount := counts[folder.ID]
		for _, id := range descendantFolderIDs(folder.ID, children) {
			descendantCount += counts[id]
		}
		result = append(result, AssetFolderView{AssetFolder: folder, AssetCount: counts[folder.ID], DescendantAssetCount: descendantCount})
	}
	return result, nil
}

func (s *AssetFolderService) Get(id string, userID string, scope string) (model.AssetFolder, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	folder, err := s.folders.GetByWorkspace(strings.TrimSpace(id), workspaceID)
	if err == nil {
		folder.Scope = WorkspaceScopeFromID(folder.WorkspaceID)
	}
	return folder, err
}

func (s *AssetFolderService) Create(userID string, scope string, input AssetFolderCreateInput) (model.AssetFolder, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	if _, err := s.ensureDefaultsForWorkspace(userID, workspaceID); err != nil {
		return model.AssetFolder{}, err
	}
	name, normalized, err := normalizeAssetFolderName(input.Name)
	if err != nil {
		return model.AssetFolder{}, err
	}
	parentID := strings.TrimSpace(input.ParentID)
	if parentID != "" {
		parent, getErr := s.folders.GetByWorkspace(parentID, workspaceID)
		if getErr != nil || parent.Kind != model.AssetFolderKindUser {
			return model.AssetFolder{}, ErrAssetFolderParent
		}
	}
	if err := s.validateDepth(workspaceID, parentID, ""); err != nil {
		return model.AssetFolder{}, err
	}
	folder, err := s.folders.Create(model.AssetFolder{
		ID: "asset_folder_" + randomHex(12), WorkspaceID: workspaceID, CreatedBy: userID,
		ParentID: parentID, Name: name, NormalizedName: normalized, Kind: model.AssetFolderKindUser, SortOrder: input.SortOrder,
	})
	if err == nil {
		folder.Scope = WorkspaceScopeFromID(folder.WorkspaceID)
	}
	return folder, err
}

func (s *AssetFolderService) Update(id string, userID string, scope string, input AssetFolderUpdateInput) (model.AssetFolder, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	folder, err := s.folders.GetByWorkspace(strings.TrimSpace(id), workspaceID)
	if err != nil {
		return model.AssetFolder{}, err
	}
	if folder.Kind != model.AssetFolderKindUser {
		return model.AssetFolder{}, repository.ErrAssetFolderProtected
	}
	name, normalized, err := normalizeAssetFolderName(input.Name)
	if err != nil {
		return model.AssetFolder{}, err
	}
	parentID := strings.TrimSpace(input.ParentID)
	if parentID == folder.ID {
		return model.AssetFolder{}, ErrAssetFolderCycle
	}
	if parentID != "" {
		parent, getErr := s.folders.GetByWorkspace(parentID, workspaceID)
		if getErr != nil || parent.Kind != model.AssetFolderKindUser {
			return model.AssetFolder{}, ErrAssetFolderParent
		}
	}
	if err := s.validateDepth(workspaceID, parentID, folder.ID); err != nil {
		return model.AssetFolder{}, err
	}
	folder.Name = name
	folder.NormalizedName = normalized
	folder.ParentID = parentID
	folder.SortOrder = input.SortOrder
	folder, err = s.folders.Update(folder, workspaceID)
	if err == nil {
		folder.Scope = WorkspaceScopeFromID(folder.WorkspaceID)
	}
	return folder, err
}

func (s *AssetFolderService) Delete(id string, userID string, scope string) (int64, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	folder, err := s.folders.GetByWorkspace(strings.TrimSpace(id), workspaceID)
	if err != nil {
		return 0, err
	}
	if folder.Kind != model.AssetFolderKindUser {
		return 0, repository.ErrAssetFolderProtected
	}
	folders, err := s.folders.ListByWorkspace(workspaceID)
	if err != nil {
		return 0, err
	}
	children := folderChildren(folders)
	ids := append([]string{folder.ID}, descendantFolderIDs(folder.ID, children)...)
	if s.activeChecker != nil {
		active, checkErr := s.activeChecker.HasActiveOutputFolder(ids, workspaceID)
		if checkErr != nil {
			return 0, checkErr
		}
		if active {
			return 0, repository.ErrAssetFolderInUse
		}
	}
	targetID := folder.ParentID
	if targetID == "" {
		defaults, ensureErr := s.ensureDefaultsForWorkspace(userID, workspaceID)
		if ensureErr != nil {
			return 0, ensureErr
		}
		targetID = defaults.Unsorted.ID
	}
	moved, err := s.assets.MoveByFolders(ids, targetID, workspaceID)
	if err != nil {
		return 0, err
	}
	if err := s.folders.DeleteByIDs(ids, workspaceID); err != nil {
		return 0, err
	}
	return moved, nil
}

func (s *AssetFolderService) ValidateDestination(folderID string, userID string, scope string) (model.AssetFolder, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	return s.validateDestinationForWorkspace(folderID, workspaceID)
}

func (s *AssetFolderService) validateDestinationForWorkspace(folderID string, workspaceID string) (model.AssetFolder, error) {
	folder, err := s.folders.GetByWorkspace(strings.TrimSpace(folderID), workspaceID)
	if err != nil {
		return model.AssetFolder{}, err
	}
	if folder.SystemKey == model.AssetFolderSystemKeyRoot {
		return model.AssetFolder{}, ErrAssetFolderParent
	}
	return folder, nil
}

func (s *AssetFolderService) ResolveRegistration(userID string, scope string, context AssetRegistrationContext) (AssetRegistrationContext, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	return s.resolveRegistrationForWorkspace(userID, workspaceID, context)
}

// EnsureCanvasArchiveFolderAt resolves the stable project/date archive folder
// for historical backfills without changing the asset file or URL.
func (s *AssetFolderService) EnsureCanvasArchiveFolderAt(userID string, scope string, projectID string, projectName string, createdAt time.Time) (model.AssetFolder, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	defaults, err := s.ensureDefaultsForWorkspace(userID, workspaceID)
	if err != nil {
		return model.AssetFolder{}, err
	}
	projectID = strings.TrimSpace(projectID)
	var parent model.AssetFolder
	if projectID == "" {
		parent, err = s.ensureSystemFolder(userID, workspaceID, defaults.Canvas.ID, "未归属画布", model.AssetFolderSystemKeyCanvasUnassigned, "canvas_unassigned", "", 0)
	} else {
		parent, err = s.ensureSystemFolder(userID, workspaceID, defaults.Canvas.ID, defaultFolderName(projectName, "未命名画布"), model.AssetFolderSystemKeyCanvasProject, "canvas_project", projectID, 0)
	}
	if err != nil {
		return model.AssetFolder{}, err
	}
	if createdAt.IsZero() {
		createdAt = time.Now()
	}
	date := createdAt.In(s.archiveZone).Format("2006-01-02")
	return s.ensureSystemFolder(userID, workspaceID, parent.ID, date, model.AssetFolderSystemKeyCanvasProjectDate, "canvas_project_date", projectID+":"+date, 0)
}

func (s *AssetFolderService) resolveRegistrationForWorkspace(userID string, workspaceID string, context AssetRegistrationContext) (AssetRegistrationContext, error) {
	category, err := NormalizeAssetCategory(context.Category)
	if err != nil {
		return AssetRegistrationContext{}, err
	}
	sourceType, err := NormalizeAssetSourceType(context.SourceType)
	if err != nil {
		return AssetRegistrationContext{}, err
	}
	context.Category = category
	context.SourceType = sourceType
	context.SourceMetadata = sanitizeAssetSourceMetadata(context.SourceMetadata)
	if strings.TrimSpace(context.FolderID) != "" {
		folder, validateErr := s.validateDestinationForWorkspace(context.FolderID, workspaceID)
		if validateErr != nil {
			return AssetRegistrationContext{}, validateErr
		}
		context.FolderID = folder.ID
		return context, nil
	}
	defaults, err := s.ensureDefaultsForWorkspace(userID, workspaceID)
	if err != nil {
		return AssetRegistrationContext{}, err
	}
	var folder model.AssetFolder
	switch sourceType {
	case model.AssetSourceManualUpload:
		folder = defaults.Upload
	case model.AssetSourceImageWorkbench:
		folder, err = s.ensureSystemFolder(userID, workspaceID, defaults.ImageWorkbench.ID, time.Now().UTC().Format("2006-01"), model.AssetFolderSystemKeyImageWorkbenchMonth, "month", time.Now().UTC().Format("2006-01"), 0)
	case model.AssetSourceCanvas:
		folder, err = s.EnsureCanvasArchiveFolderAt(userID, WorkspaceScopeFromID(workspaceID), context.SourceProjectID, context.SourceProjectName, time.Now())
	case model.AssetSourceComicBatch:
		if strings.TrimSpace(context.SourceProjectID) == "" {
			folder = defaults.Comic
		} else {
			projectFolder, ensureErr := s.ensureSystemFolder(userID, workspaceID, defaults.Comic.ID, defaultFolderName(context.SourceProjectName, "未命名漫剧项目"), model.AssetFolderSystemKeyComicProject, "comic_project", context.SourceProjectID, 0)
			if ensureErr != nil {
				err = ensureErr
				break
			}
			folder, err = s.ensureSystemFolder(userID, workspaceID, projectFolder.ID, AssetCategoryLabel(category), model.AssetFolderSystemKeyComicCategory, "comic_category", context.SourceProjectID+":"+category, assetCategorySort(category))
		}
	default:
		folder = defaults.Unsorted
	}
	if err != nil {
		return AssetRegistrationContext{}, err
	}
	context.FolderID = folder.ID
	return context, nil
}

func sanitizeAssetSourceMetadata(value map[string]any) map[string]any {
	if len(value) == 0 {
		return map[string]any{}
	}
	allowed := map[string]bool{
		"node_id": true, "candidate_index": true, "variant_index": true,
		"version": true, "asset_code": true, "operation": true,
	}
	result := make(map[string]any)
	for key, item := range value {
		key = strings.TrimSpace(strings.ToLower(key))
		if !allowed[key] {
			continue
		}
		switch typed := item.(type) {
		case string:
			runes := []rune(strings.TrimSpace(typed))
			if len(runes) > 128 {
				runes = runes[:128]
			}
			result[key] = string(runes)
		case float64, float32, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, bool:
			result[key] = item
		}
	}
	return result
}

func (s *AssetFolderService) EnsureCategoryChild(userID string, scope string, parentID string, category string) (model.AssetFolder, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	category, err := NormalizeAssetCategory(category)
	if err != nil {
		return model.AssetFolder{}, err
	}
	parent, err := s.validateDestinationForWorkspace(parentID, workspaceID)
	if err != nil {
		return model.AssetFolder{}, err
	}
	return s.ensureUserChild(userID, workspaceID, parent, AssetCategoryLabel(category), assetCategorySort(category))
}

func (s *AssetFolderService) EnsureComicProjectFolders(userID string, scope string, projectID string, projectName string) (map[string]model.AssetFolder, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	defaults, err := s.ensureDefaultsForWorkspace(userID, workspaceID)
	if err != nil {
		return nil, err
	}
	projectFolder, err := s.ensureSystemFolder(userID, workspaceID, defaults.Comic.ID, defaultFolderName(projectName, "未命名漫剧项目"), model.AssetFolderSystemKeyComicProject, "comic_project", strings.TrimSpace(projectID), 0)
	if err != nil {
		return nil, err
	}
	categories := []string{
		model.AssetCategoryCharacter,
		model.AssetCategoryEnvironment,
		model.AssetCategoryProp,
		model.AssetCategoryCostume,
		model.AssetCategoryUI,
		model.AssetCategoryOther,
	}
	result := make(map[string]model.AssetFolder, len(categories))
	for _, category := range categories {
		folder, ensureErr := s.ensureSystemFolder(userID, workspaceID, projectFolder.ID, AssetCategoryLabel(category), model.AssetFolderSystemKeyComicCategory, "comic_category", strings.TrimSpace(projectID)+":"+category, assetCategorySort(category))
		if ensureErr != nil {
			return nil, ensureErr
		}
		result[category] = folder
	}
	return result, nil
}

func (s *AssetFolderService) FolderIDsForQuery(folderID string, includeDescendants bool, userID string, scope string) ([]string, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return nil, nil
	}
	if _, err := s.folders.GetByWorkspace(folderID, workspaceID); err != nil {
		return nil, err
	}
	ids := []string{folderID}
	if !includeDescendants {
		return ids, nil
	}
	folders, err := s.folders.ListByWorkspace(workspaceID)
	if err != nil {
		return nil, err
	}
	return append(ids, descendantFolderIDs(folderID, folderChildren(folders))...), nil
}

func (s *AssetFolderService) ensureSystemFolder(userID string, workspaceID string, parentID string, name string, systemKey string, sourceRefType string, sourceRefID string, sortOrder int) (model.AssetFolder, error) {
	name, normalized, err := normalizeAssetFolderName(name)
	if err != nil {
		return model.AssetFolder{}, err
	}
	identity := strings.Join([]string{workspaceID, systemKey, sourceRefID}, "|")
	return s.folders.EnsureSystem(model.AssetFolder{
		ID: "asset_folder_" + randomHex(12), WorkspaceID: workspaceID, CreatedBy: userID,
		ParentID: parentID, Name: name, NormalizedName: normalized, Kind: model.AssetFolderKindSystem,
		SystemKey: systemKey, SourceRefType: sourceRefType, SourceRefID: sourceRefID,
		SystemIdentity: &identity, SortOrder: sortOrder,
	})
}

func (s *AssetFolderService) ensureUserChild(userID string, workspaceID string, parent model.AssetFolder, name string, sortOrder int) (model.AssetFolder, error) {
	name, normalized, err := normalizeAssetFolderName(name)
	if err != nil {
		return model.AssetFolder{}, err
	}
	folders, err := s.folders.ListByWorkspace(workspaceID)
	if err != nil {
		return model.AssetFolder{}, err
	}
	for _, folder := range folders {
		if folder.ParentID == parent.ID && folder.NormalizedName == normalized {
			return folder, nil
		}
	}
	created, err := s.folders.Create(model.AssetFolder{
		ID: "asset_folder_" + randomHex(12), WorkspaceID: workspaceID, CreatedBy: userID,
		ParentID: parent.ID, Name: name, NormalizedName: normalized, Kind: model.AssetFolderKindUser, SortOrder: sortOrder,
	})
	if err == nil {
		return created, nil
	}
	if !errors.Is(err, repository.ErrAssetFolderConflict) {
		return model.AssetFolder{}, err
	}
	// A second API replica may have created the same category child between
	// the list and insert. Resolve that winner instead of failing the batch.
	folders, listErr := s.folders.ListByWorkspace(workspaceID)
	if listErr != nil {
		return model.AssetFolder{}, listErr
	}
	for _, folder := range folders {
		if folder.ParentID == parent.ID && folder.NormalizedName == normalized {
			return folder, nil
		}
	}
	return model.AssetFolder{}, err
}

func (s *AssetFolderService) validateDepth(workspaceID string, parentID string, movingID string) error {
	folders, err := s.folders.ListByWorkspace(workspaceID)
	if err != nil {
		return err
	}
	byID := make(map[string]model.AssetFolder, len(folders))
	for _, folder := range folders {
		byID[folder.ID] = folder
	}
	depth := 1
	current := parentID
	for current != "" {
		if current == movingID {
			return ErrAssetFolderCycle
		}
		parent, ok := byID[current]
		if !ok {
			return ErrAssetFolderParent
		}
		depth++
		if depth > AssetFolderMaxDepth {
			return ErrAssetFolderDepth
		}
		current = parent.ParentID
	}
	return nil
}

func normalizeAssetFolderName(value string) (string, string, error) {
	name := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if name == "" {
		return "", "", ErrAssetFolderNameRequired
	}
	if utf8.RuneCountInString(name) > AssetFolderMaxNameRunes {
		return "", "", ErrAssetFolderNameTooLong
	}
	if strings.ContainsAny(name, "/\\") || name == "." || name == ".." {
		return "", "", ErrAssetFolderNameRequired
	}
	return name, strings.ToLower(name), nil
}

func NormalizeAssetCategory(value string) (string, error) {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return model.AssetCategoryOther, nil
	}
	switch value {
	case model.AssetCategoryCharacter, model.AssetCategoryEnvironment, model.AssetCategoryCostume,
		model.AssetCategoryProp, model.AssetCategoryUI, model.AssetCategoryReference, model.AssetCategoryOther:
		return value, nil
	default:
		return "", ErrAssetCategory
	}
}

func NormalizeAssetSourceType(value string) (string, error) {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return model.AssetSourceUnknown, nil
	}
	switch value {
	case model.AssetSourceManualUpload, model.AssetSourceImageWorkbench, model.AssetSourceCanvas,
		model.AssetSourceComicBatch, model.AssetSourceLegacy, model.AssetSourceUnknown:
		return value, nil
	default:
		return "", ErrAssetSourceType
	}
}

func AssetCategoryLabel(category string) string {
	switch category {
	case model.AssetCategoryCharacter:
		return "人物"
	case model.AssetCategoryEnvironment:
		return "场景"
	case model.AssetCategoryCostume:
		return "服饰"
	case model.AssetCategoryProp:
		return "道具"
	case model.AssetCategoryUI:
		return "UI"
	case model.AssetCategoryReference:
		return "参考图"
	default:
		return "其他"
	}
}

func assetCategorySort(category string) int {
	order := map[string]int{
		model.AssetCategoryCharacter: 10, model.AssetCategoryEnvironment: 20, model.AssetCategoryProp: 30,
		model.AssetCategoryCostume: 40, model.AssetCategoryUI: 50, model.AssetCategoryReference: 60, model.AssetCategoryOther: 70,
	}
	return order[category]
}

func folderChildren(folders []model.AssetFolder) map[string][]string {
	children := make(map[string][]string)
	for _, folder := range folders {
		children[folder.ParentID] = append(children[folder.ParentID], folder.ID)
	}
	for parentID := range children {
		sort.Strings(children[parentID])
	}
	return children
}

func descendantFolderIDs(folderID string, children map[string][]string) []string {
	result := make([]string, 0)
	queue := append([]string(nil), children[folderID]...)
	seen := map[string]bool{folderID: true}
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		if seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, id)
		queue = append(queue, children[id]...)
	}
	return result
}

func defaultFolderName(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	if utf8.RuneCountInString(value) > AssetFolderMaxNameRunes {
		runes := []rune(value)
		value = string(runes[:AssetFolderMaxNameRunes])
	}
	name, _, err := normalizeAssetFolderName(value)
	if err != nil {
		return fmt.Sprintf("%s-%s", fallback, randomHex(3))
	}
	return name
}
