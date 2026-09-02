package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/storage"
)

var ErrPayloadTooLarge = errors.New("payload too large")

const (
	// AssetTrashRetention is fixed so API replicas and UI countdowns agree.
	AssetTrashRetention = 30 * 24 * time.Hour
	// AssetTrashRiskWindow drives the 72-hour expiry warning.
	AssetTrashRiskWindow = 72 * time.Hour
	// AssetTrashMaintenanceInterval bounds cleanup delay without polling storage aggressively.
	AssetTrashMaintenanceInterval = 10 * time.Minute
)

type AssetService struct {
	repo          repository.AssetRepository
	storage       storage.Storage
	folders       *AssetFolderService
	references    repository.AssetReferenceRepository
	tagSyncer     AssetTagSyncer
	tagFilterer   AssetTagFilterer
	usageFilterer AssetUsageFilterer
	lineage       *AssetLineageService
}

type AssetTagSyncer interface {
	SyncLegacyAssetTags(userID string, workspaceScope string, assetID string, names []string) error
	ReplaceAssetDirectTags(userID string, workspaceScope string, assetID string, tagIDs []string) error
}

type AssetTagFilterer interface {
	FilterAssetIDs(userID string, workspaceScope string, tagIDs []string, includeDescendants bool, matchAll bool) ([]string, error)
}

type AssetUsageFilterer interface {
	LibraryAssetIDs(userID string, scope string, view string) (AssetLibraryUsageIDs, error)
}

func NewAssetService(repo repository.AssetRepository, store storage.Storage) *AssetService {
	return &AssetService{repo: repo, storage: store}
}

func (s *AssetService) SetFolderService(folders *AssetFolderService) {
	s.folders = folders
}

func (s *AssetService) SetReferenceRepository(references repository.AssetReferenceRepository) {
	s.references = references
}

func (s *AssetService) SetTagSyncer(syncer AssetTagSyncer) {
	s.tagSyncer = syncer
}

func (s *AssetService) SetTagFilterer(filterer AssetTagFilterer) {
	s.tagFilterer = filterer
}

func (s *AssetService) SetUsageFilterer(filterer AssetUsageFilterer) {
	s.usageFilterer = filterer
}

func (s *AssetService) SetLineageService(lineage *AssetLineageService) {
	s.lineage = lineage
}

type AssetUploadInput struct {
	ID             string
	UserID         string
	Scope          string
	Type           string
	Name           string
	Extension      string
	SizeLimit      int64
	ContentType    string
	Reader         io.Reader
	Registration   AssetRegistrationContext
	Tags           []string
	TagIDs         []string
	Note           string
	ParentAssetIDs []string
	RelationType   string
	SourceNodeID   string
	IngestionMode  string
	IdempotencyKey string
}

type AssetLibraryInput struct {
	FolderID              string
	IncludeDescendants    bool
	TagIDs                []string
	TagMatch              string
	IncludeTagDescendants bool
	SmartView             string
	Type                  string
	Category              string
	SourceType            string
	SourceProjectID       string
	Keyword               string
	CreatedFrom           *time.Time
	CreatedTo             *time.Time
	Page                  int
	PageSize              int
	Sort                  string
}

type AssetLibraryResult struct {
	Items    []model.Asset `json:"items"`
	Total    int64         `json:"total"`
	Page     int           `json:"page"`
	PageSize int           `json:"page_size"`
}

type AssetMetadataInput struct {
	Name     *string
	FolderID *string
	Category *string
	Tags     *[]string
	TagIDs   *[]string
	Note     *string
}

type AssetContent struct {
	Asset  model.Asset
	Object storage.StorageObject
	Reader io.ReadCloser
}

type AssetTrashPreflight struct {
	Count      int                    `json:"count"`
	TotalBytes int64                  `json:"total_bytes"`
	References []model.AssetReference `json:"references"`
}

type AssetTrashMutationResult struct {
	Items      []model.Asset `json:"items"`
	Count      int           `json:"count"`
	TotalBytes int64         `json:"total_bytes"`
}

type AssetPermanentDeleteResult struct {
	Deleted int      `json:"deleted"`
	Failed  int      `json:"failed"`
	Errors  []string `json:"errors,omitempty"`
}

func (s *AssetService) List(userID string, scope string) ([]model.Asset, error) {
	return s.repo.ListByWorkspace(WorkspaceIDForScope(scope, userID))
}

func (s *AssetService) ListLibrary(userID string, scope string, input AssetLibraryInput) (AssetLibraryResult, error) {
	return s.listLibrary(userID, scope, input, false)
}

func (s *AssetService) ListTrashLibrary(userID string, scope string, input AssetLibraryInput) (AssetLibraryResult, error) {
	return s.listLibrary(userID, scope, input, true)
}

func (s *AssetService) listLibrary(userID string, scope string, input AssetLibraryInput, trashed bool) (AssetLibraryResult, error) {
	page := input.Page
	if page < 1 {
		page = 1
	}
	pageSize := input.PageSize
	if pageSize <= 0 {
		pageSize = AssetLibraryDefaultPageSize
	}
	if pageSize > AssetLibraryMaxPageSize {
		pageSize = AssetLibraryMaxPageSize
	}
	filter, err := s.assetLibraryFilter(userID, scope, input)
	if err != nil {
		return AssetLibraryResult{}, err
	}
	filter.Page, filter.PageSize, filter.Sort, filter.Trashed = page, pageSize, strings.TrimSpace(input.Sort), trashed
	items, total, err := s.repo.ListLibrary(filter)
	if err != nil {
		return AssetLibraryResult{}, err
	}
	s.setAssetScopes(items, scope)
	return AssetLibraryResult{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

func (s *AssetService) listLibraryForExport(userID string, scope string, input AssetLibraryInput, limit int) ([]model.Asset, int64, error) {
	if limit <= 0 {
		return nil, 0, errors.New("asset export limit must be positive")
	}
	filter, err := s.assetLibraryFilter(userID, scope, input)
	if err != nil {
		return nil, 0, err
	}
	filter.Page, filter.PageSize, filter.Sort = 1, limit+1, strings.TrimSpace(input.Sort)
	items, total, err := s.repo.ListLibrary(filter)
	if err != nil {
		return nil, 0, err
	}
	s.setAssetScopes(items, scope)
	return items, total, nil
}

func (s *AssetService) assetLibraryFilter(userID string, scope string, input AssetLibraryInput) (repository.AssetLibraryFilter, error) {
	category := ""
	var err error
	if strings.TrimSpace(input.Category) != "" {
		category, err = NormalizeAssetCategory(input.Category)
		if err != nil {
			return repository.AssetLibraryFilter{}, err
		}
	}
	sourceType := ""
	if strings.TrimSpace(input.SourceType) != "" {
		sourceType, err = NormalizeAssetSourceType(input.SourceType)
		if err != nil {
			return repository.AssetLibraryFilter{}, err
		}
	}
	folderIDs := []string(nil)
	filterFolder := strings.TrimSpace(input.FolderID) != ""
	if filterFolder {
		if s.folders == nil {
			return repository.AssetLibraryFilter{}, repository.ErrAssetFolderNotFound
		}
		folderIDs, err = s.folders.FolderIDsForQuery(input.FolderID, input.IncludeDescendants, userID, scope)
		if err != nil {
			return repository.AssetLibraryFilter{}, err
		}
	}
	includeAssetIDs := []string(nil)
	filterAssetIDs := false
	if tagIDs := uniqueAssetStrings(input.TagIDs); len(tagIDs) > 0 {
		if s.tagFilterer == nil {
			return repository.AssetLibraryFilter{}, errors.New("asset tag filter is unavailable")
		}
		matchMode := strings.TrimSpace(strings.ToLower(input.TagMatch))
		if matchMode == "" {
			matchMode = "and"
		}
		if matchMode != "and" && matchMode != "or" {
			return repository.AssetLibraryFilter{}, ErrTagMatchMode
		}
		includeAssetIDs, err = s.tagFilterer.FilterAssetIDs(userID, scope, tagIDs, input.IncludeTagDescendants, matchMode == "and")
		if err != nil {
			return repository.AssetLibraryFilter{}, err
		}
		filterAssetIDs = true
	}
	excludeAssetIDs := []string(nil)
	if smartView := strings.TrimSpace(input.SmartView); smartView != "" {
		if s.usageFilterer == nil {
			return repository.AssetLibraryFilter{}, errors.New("asset usage filter is unavailable")
		}
		usageIDs, usageErr := s.usageFilterer.LibraryAssetIDs(userID, scope, smartView)
		if usageErr != nil {
			return repository.AssetLibraryFilter{}, usageErr
		}
		if usageIDs.Exclude {
			excludeAssetIDs = usageIDs.IDs
		} else if filterAssetIDs {
			includeAssetIDs = intersectAssetIDs(includeAssetIDs, usageIDs.IDs)
		} else {
			includeAssetIDs = usageIDs.IDs
			filterAssetIDs = true
		}
	}
	return repository.AssetLibraryFilter{
		WorkspaceID: WorkspaceIDForScope(scope, userID), AssetIDs: includeAssetIDs, ExcludeAssetIDs: excludeAssetIDs, FilterAssetIDs: filterAssetIDs,
		FolderIDs: folderIDs, FilterFolder: filterFolder,
		Type: strings.TrimSpace(strings.ToLower(input.Type)), Category: category, SourceType: sourceType,
		SourceProjectID: strings.TrimSpace(input.SourceProjectID), Keyword: strings.TrimSpace(input.Keyword),
		CreatedFrom: input.CreatedFrom, CreatedTo: input.CreatedTo,
	}, nil
}

func intersectAssetIDs(left []string, right []string) []string {
	wanted := map[string]bool{}
	for _, id := range uniqueAssetStrings(right) {
		wanted[id] = true
	}
	result := make([]string, 0)
	for _, id := range uniqueAssetStrings(left) {
		if wanted[id] {
			result = append(result, id)
		}
	}
	return result
}

func (s *AssetService) setAssetScopes(items []model.Asset, fallbackScope string) {
	for index := range items {
		items[index].Scope = WorkspaceScopeFromID(defaultStringValue(items[index].WorkspaceID, WorkspaceIDForScope(fallbackScope, items[index].UserID)))
	}
}

func (s *AssetService) Get(id string, userID string, scope string) (model.Asset, error) {
	asset, err := s.repo.GetByWorkspace(id, WorkspaceIDForScope(scope, userID))
	if err == nil && asset.TrashedAt != nil {
		return model.Asset{}, repository.ErrAssetNotFound
	}
	return asset, err
}

func (s *AssetService) Upload(ctx context.Context, input AssetUploadInput) (model.Asset, error) {
	workspaceID := WorkspaceIDForScope(input.Scope, input.UserID)
	if key := strings.TrimSpace(input.IdempotencyKey); key != "" {
		input.ID = assetIngestionID(workspaceID, key)
		if existing, err := s.repo.GetByWorkspace(input.ID, workspaceID); err == nil {
			if existing.TrashedAt != nil {
				return model.Asset{}, errors.New("asset ingestion conflicts with a trashed asset")
			}
			if err := s.recordAssetLineage(input, existing); err != nil {
				return model.Asset{}, err
			}
			return existing, nil
		} else if !errors.Is(err, repository.ErrAssetNotFound) {
			return model.Asset{}, err
		}
	}
	registration := input.Registration
	if strings.TrimSpace(registration.SourceType) == "" {
		registration.SourceType = model.AssetSourceManualUpload
	}
	if s.folders != nil {
		resolved, err := s.folders.ResolveRegistration(input.UserID, input.Scope, registration)
		if err != nil {
			return model.Asset{}, err
		}
		registration = resolved
	} else {
		category, _ := NormalizeAssetCategory(registration.Category)
		sourceType, _ := NormalizeAssetSourceType(registration.SourceType)
		registration.Category = category
		registration.SourceType = sourceType
	}
	tags, err := encodeAssetTags(input.Tags)
	if err != nil {
		return model.Asset{}, err
	}
	sourceMetadata, err := encodeAssetSourceMetadata(registration.SourceMetadata)
	if err != nil {
		return model.Asset{}, err
	}
	key := AssetStorageKey(workspaceID, input.ID, input.Extension)
	hasher := sha256.New()
	object, err := s.storage.Put(ctx, key, io.TeeReader(input.Reader, hasher), storage.PutMeta{ContentType: input.ContentType, Size: input.SizeLimit})
	if err != nil {
		return model.Asset{}, err
	}
	if input.SizeLimit > 0 && object.Size > input.SizeLimit {
		_ = s.storage.Delete(ctx, key)
		return model.Asset{}, ErrPayloadTooLarge
	}

	asset, err := s.repo.Create(model.Asset{
		ID:              input.ID,
		UserID:          input.UserID,
		WorkspaceID:     workspaceID,
		Type:            input.Type,
		Name:            input.Name,
		URL:             object.URL,
		Size:            object.Size,
		ContentType:     input.ContentType,
		FolderID:        registration.FolderID,
		Category:        registration.Category,
		Tags:            tags,
		Note:            strings.TrimSpace(input.Note),
		SourceType:      registration.SourceType,
		SourceProjectID: strings.TrimSpace(registration.SourceProjectID),
		SourceBatchID:   strings.TrimSpace(registration.SourceBatchID),
		SourceItemID:    strings.TrimSpace(registration.SourceItemID),
		SourceJobID:     strings.TrimSpace(registration.SourceJobID),
		SourceMetadata:  sourceMetadata,
		ContentSHA256:   hex.EncodeToString(hasher.Sum(nil)),
		IngestionMode:   normalizeAssetIngestionMode(input.IngestionMode, registration.SourceType),
	})
	if err != nil {
		_ = s.storage.Delete(ctx, key)
		return model.Asset{}, err
	}
	if s.tagSyncer != nil && (len(input.TagIDs) > 0 || len(input.Tags) > 0) {
		var tagErr error
		if len(input.TagIDs) > 0 {
			tagErr = s.tagSyncer.ReplaceAssetDirectTags(input.UserID, input.Scope, asset.ID, input.TagIDs)
		} else {
			tagErr = s.tagSyncer.SyncLegacyAssetTags(input.UserID, input.Scope, asset.ID, input.Tags)
		}
		if tagErr != nil {
			_ = s.repo.DeleteByWorkspace(asset.ID, workspaceID)
			_ = s.storage.Delete(ctx, key)
			return model.Asset{}, tagErr
		}
		asset, err = s.repo.GetByWorkspace(asset.ID, workspaceID)
		if err != nil {
			return model.Asset{}, err
		}
	}
	if err := s.recordAssetLineage(input, asset); err != nil {
		return model.Asset{}, err
	}
	return asset, nil
}

func (s *AssetService) recordAssetLineage(input AssetUploadInput, asset model.Asset) error {
	if s.lineage == nil || len(uniqueAssetStrings(input.ParentAssetIDs)) == 0 {
		return nil
	}
	sourceNodeID := strings.TrimSpace(input.SourceNodeID)
	if sourceNodeID == "" && input.Registration.SourceMetadata != nil {
		sourceNodeID, _ = input.Registration.SourceMetadata["node_id"].(string)
	}
	relation := strings.TrimSpace(input.RelationType)
	if relation == "" {
		relation = model.AssetLineageGeneration
	}
	_, err := s.lineage.Record(input.UserID, input.Scope, AssetLineageRecordInput{
		ParentAssetIDs: input.ParentAssetIDs, ChildAssetID: asset.ID, RelationType: relation,
		SourceProject: input.Registration.SourceProjectID, SourceNode: sourceNodeID, SourceJob: input.Registration.SourceJobID,
	})
	return err
}

func (s *AssetService) UpdateMetadata(id string, userID string, scope string, input AssetMetadataInput) (model.Asset, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	asset, err := s.repo.GetByWorkspace(strings.TrimSpace(id), workspaceID)
	if err != nil {
		return model.Asset{}, err
	}
	name := asset.Name
	if input.Name != nil {
		name = strings.TrimSpace(*input.Name)
		if name == "" {
			return model.Asset{}, errors.New("asset name is required")
		}
	}
	folderID := asset.FolderID
	if input.FolderID != nil {
		folderID = strings.TrimSpace(*input.FolderID)
		if s.folders == nil {
			return model.Asset{}, repository.ErrAssetFolderNotFound
		}
		folder, validateErr := s.folders.ValidateDestination(folderID, userID, scope)
		if validateErr != nil {
			return model.Asset{}, validateErr
		}
		folderID = folder.ID
	}
	category := asset.Category
	if input.Category != nil {
		category, err = NormalizeAssetCategory(*input.Category)
		if err != nil {
			return model.Asset{}, err
		}
	}
	tags := asset.Tags
	if input.TagIDs != nil && s.tagSyncer != nil {
		if err = s.tagSyncer.ReplaceAssetDirectTags(userID, scope, asset.ID, *input.TagIDs); err != nil {
			return model.Asset{}, err
		}
		asset, err = s.repo.GetByWorkspace(asset.ID, workspaceID)
		if err != nil {
			return model.Asset{}, err
		}
		tags = asset.Tags
	} else if input.Tags != nil {
		tags, err = encodeAssetTags(*input.Tags)
		if err != nil {
			return model.Asset{}, err
		}
		if s.tagSyncer != nil {
			if err = s.tagSyncer.SyncLegacyAssetTags(userID, scope, asset.ID, *input.Tags); err != nil {
				return model.Asset{}, err
			}
			asset, err = s.repo.GetByWorkspace(asset.ID, workspaceID)
			if err != nil {
				return model.Asset{}, err
			}
			tags = asset.Tags
		}
	}
	note := asset.Note
	if input.Note != nil {
		note = strings.TrimSpace(*input.Note)
	}
	return s.repo.UpdateMutable(asset.ID, workspaceID, repository.AssetMutableUpdate{Name: name, FolderID: folderID, Category: category, Tags: tags, Note: note})
}

func (s *AssetService) BulkMove(ids []string, folderID string, userID string, scope string) (int64, error) {
	if s.folders == nil {
		return 0, repository.ErrAssetFolderNotFound
	}
	folder, err := s.folders.ValidateDestination(folderID, userID, scope)
	if err != nil {
		return 0, err
	}
	unique := uniqueAssetStrings(ids)
	if len(unique) == 0 {
		return 0, errors.New("asset ids are required")
	}
	moved, err := s.repo.BulkMove(unique, folder.ID, WorkspaceIDForScope(scope, userID))
	if err != nil {
		return 0, err
	}
	if moved != int64(len(unique)) {
		return 0, repository.ErrAssetNotFound
	}
	return moved, nil
}

func (s *AssetService) ApplyRegistration(id string, userID string, scope string, context AssetRegistrationContext) (model.Asset, error) {
	if s.folders == nil {
		return model.Asset{}, repository.ErrAssetFolderNotFound
	}
	resolved, err := s.folders.ResolveRegistration(userID, scope, context)
	if err != nil {
		return model.Asset{}, err
	}
	metadata, err := encodeAssetSourceMetadata(resolved.SourceMetadata)
	if err != nil {
		return model.Asset{}, err
	}
	return s.repo.ApplyRegistration(strings.TrimSpace(id), WorkspaceIDForScope(scope, userID), repository.AssetRegistrationUpdate{
		FolderID: resolved.FolderID, Category: resolved.Category, SourceType: resolved.SourceType,
		SourceProjectID: strings.TrimSpace(resolved.SourceProjectID), SourceBatchID: strings.TrimSpace(resolved.SourceBatchID),
		SourceItemID: strings.TrimSpace(resolved.SourceItemID), SourceJobID: strings.TrimSpace(resolved.SourceJobID), SourceMetadata: metadata,
	})
}

func (s *AssetService) OpenContent(ctx context.Context, id string, userID string, scope string) (AssetContent, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	asset, err := s.repo.GetByWorkspace(id, workspaceID)
	if err != nil {
		return AssetContent{}, err
	}
	return s.openContentForAsset(ctx, asset, userID, scope)
}

func (s *AssetService) openContentForAsset(ctx context.Context, asset model.Asset, userID string, scope string) (AssetContent, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	key, object, err := s.resolveAssetObject(ctx, workspaceID, asset, scope, userID)
	if err != nil {
		return AssetContent{}, err
	}
	reader, object, err := s.storage.Get(ctx, key)
	if err != nil {
		return AssetContent{}, err
	}
	return AssetContent{Asset: asset, Object: object, Reader: reader}, nil
}

func (s *AssetService) Delete(ctx context.Context, id string, userID string, scope string) error {
	_, err := s.BulkTrash([]string{id}, userID, scope)
	return err
}

func (s *AssetService) TrashPreflight(ids []string, userID string, scope string) (AssetTrashPreflight, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	assets, totalBytes, err := s.activeAssetsForMutation(ids, workspaceID)
	if err != nil {
		return AssetTrashPreflight{}, err
	}
	references := []model.AssetReference{}
	if s.references != nil {
		references, err = s.references.ListByAssetIDs(workspaceID, assetIDs(assets))
		if err != nil {
			return AssetTrashPreflight{}, err
		}
	}
	return AssetTrashPreflight{Count: len(assets), TotalBytes: totalBytes, References: references}, nil
}

func (s *AssetService) BulkTrash(ids []string, userID string, scope string) (AssetTrashMutationResult, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	assets, totalBytes, err := s.activeAssetsForMutation(ids, workspaceID)
	if err != nil {
		return AssetTrashMutationResult{}, err
	}
	now := time.Now().UTC()
	trashed, err := s.repo.TrashByWorkspace(assetIDs(assets), workspaceID, userID, now, now.Add(AssetTrashRetention))
	if err != nil {
		return AssetTrashMutationResult{}, err
	}
	for index := range trashed {
		trashed[index].Scope = WorkspaceScopeFromID(defaultStringValue(trashed[index].WorkspaceID, workspaceID))
	}
	return AssetTrashMutationResult{Items: trashed, Count: len(trashed), TotalBytes: totalBytes}, nil
}

func (s *AssetService) ListTrash(userID string, scope string) ([]model.Asset, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	assets, err := s.repo.ListTrash(workspaceID)
	if err != nil {
		return nil, err
	}
	for index := range assets {
		assets[index].Scope = WorkspaceScopeFromID(defaultStringValue(assets[index].WorkspaceID, workspaceID))
	}
	return assets, nil
}

func (s *AssetService) BulkRestore(ids []string, userID string, scope string) ([]model.Asset, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	unique := uniqueAssetStrings(ids)
	if len(unique) == 0 {
		return nil, errors.New("asset ids are required")
	}
	assets, err := s.repo.ListByWorkspaceIDs(unique, workspaceID)
	if err != nil || len(assets) != len(unique) {
		return nil, repository.ErrAssetNotFound
	}
	targets := make([]repository.AssetRestoreTarget, 0, len(unique))
	for _, asset := range assets {
		if asset.TrashedAt == nil {
			return nil, repository.ErrAssetNotFound
		}
		folderID := asset.FolderID
		if s.folders != nil {
			if _, folderErr := s.folders.ValidateDestination(folderID, userID, scope); folderErr != nil {
				resolved, resolveErr := s.folders.ResolveRegistration(userID, scope, AssetRegistrationContext{
					Category: asset.Category, SourceType: asset.SourceType, SourceProjectID: asset.SourceProjectID,
					SourceBatchID: asset.SourceBatchID, SourceItemID: asset.SourceItemID, SourceJobID: asset.SourceJobID,
				})
				if resolveErr != nil {
					return nil, resolveErr
				}
				folderID = resolved.FolderID
			}
		}
		targets = append(targets, repository.AssetRestoreTarget{ID: asset.ID, FolderID: folderID})
	}
	restored, err := s.repo.RestoreByWorkspace(targets, workspaceID)
	if err != nil {
		return nil, err
	}
	for index := range restored {
		restored[index].Scope = WorkspaceScopeFromID(defaultStringValue(restored[index].WorkspaceID, workspaceID))
	}
	return restored, nil
}

func (s *AssetService) PermanentDelete(ctx context.Context, id string, userID string, scope string) error {
	workspaceID := WorkspaceIDForScope(scope, userID)
	asset, err := s.repo.GetByWorkspace(strings.TrimSpace(id), workspaceID)
	if err != nil || asset.TrashedAt == nil {
		return repository.ErrAssetNotFound
	}
	return s.permanentDeleteAsset(ctx, asset)
}

func (s *AssetService) EmptyTrash(ctx context.Context, userID string, scope string) (AssetPermanentDeleteResult, error) {
	assets, err := s.repo.ListTrash(WorkspaceIDForScope(scope, userID))
	if err != nil {
		return AssetPermanentDeleteResult{}, err
	}
	result := AssetPermanentDeleteResult{}
	for _, asset := range assets {
		if deleteErr := s.permanentDeleteAsset(ctx, asset); deleteErr != nil {
			result.Failed++
			result.Errors = append(result.Errors, asset.ID+": "+deleteErr.Error())
			continue
		}
		result.Deleted++
	}
	return result, nil
}

func (s *AssetService) PurgeExpiredTrash(ctx context.Context) (AssetPermanentDeleteResult, error) {
	assets, err := s.repo.ListExpiredTrash(time.Now().UTC(), 100)
	if err != nil {
		return AssetPermanentDeleteResult{}, err
	}
	result := AssetPermanentDeleteResult{}
	for _, asset := range assets {
		if deleteErr := s.permanentDeleteAsset(ctx, asset); deleteErr != nil {
			result.Failed++
			result.Errors = append(result.Errors, asset.ID+": "+deleteErr.Error())
		} else {
			result.Deleted++
		}
	}
	return result, nil
}

func (s *AssetService) StartTrashMaintenance(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = AssetTrashMaintenanceInterval
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			_, _ = s.PurgeExpiredTrash(context.WithoutCancel(ctx))
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

func (s *AssetService) activeAssetsForMutation(ids []string, workspaceID string) ([]model.Asset, int64, error) {
	unique := uniqueAssetStrings(ids)
	if len(unique) == 0 {
		return nil, 0, errors.New("asset ids are required")
	}
	assets, err := s.repo.ListByWorkspaceIDs(unique, workspaceID)
	if err != nil || len(assets) != len(unique) {
		return nil, 0, repository.ErrAssetNotFound
	}
	var totalBytes int64
	for _, asset := range assets {
		if asset.TrashedAt != nil {
			return nil, 0, repository.ErrAssetNotFound
		}
		totalBytes += asset.Size
	}
	return assets, totalBytes, nil
}

func assetIDs(assets []model.Asset) []string {
	result := make([]string, 0, len(assets))
	for _, asset := range assets {
		result = append(result, asset.ID)
	}
	return result
}

func (s *AssetService) permanentDeleteAsset(ctx context.Context, asset model.Asset) error {
	workspaceID := defaultStringValue(asset.WorkspaceID, WorkspaceIDForScope(WorkspaceScopePersonal, asset.UserID))
	for _, key := range s.assetCandidateKeys(workspaceID, asset, WorkspaceScopeFromID(workspaceID), asset.UserID) {
		if err := s.storage.Delete(ctx, key); err != nil {
			return err
		}
	}
	if err := s.repo.DeleteByWorkspace(asset.ID, workspaceID); err != nil {
		return err
	}
	return nil
}

func (s *AssetService) resolveAssetObject(ctx context.Context, workspaceID string, asset model.Asset, scope string, userID string) (string, storage.StorageObject, error) {
	for _, key := range s.assetCandidateKeys(workspaceID, asset, scope, userID) {
		object, err := s.storage.Stat(ctx, key)
		if err == nil {
			return key, object, nil
		}
	}
	return "", storage.StorageObject{}, repository.ErrAssetNotFound
}

func (s *AssetService) assetCandidateKeys(workspaceID string, asset model.Asset, scope string, userID string) []string {
	extensions := candidateAssetExtensions(asset)
	keys := make([]string, 0, len(extensions)*2)
	for _, extension := range extensions {
		keys = append(keys, AssetStorageKey(workspaceID, asset.ID, extension))
	}
	if scope == WorkspaceScopePersonal && strings.TrimSpace(asset.WorkspaceID) == "" {
		for _, extension := range extensions {
			keys = append(keys, filepath.ToSlash(filepath.Join(userID, asset.ID+extension)))
		}
	}
	return keys
}

func AssetStorageKey(workspaceID string, assetID string, extension string) string {
	return filepath.ToSlash(filepath.Join(assetWorkspacePath(workspaceID), assetID+extension))
}

func assetWorkspacePath(workspaceID string) string {
	if workspaceID == TeamWorkspaceID {
		return filepath.Join("team", "default")
	}
	return filepath.Join("personal", strings.TrimPrefix(workspaceID, "default:"))
}

func candidateAssetExtensions(asset model.Asset) []string {
	seen := make(map[string]bool)
	extensions := make([]string, 0, 10)
	add := func(extension string) {
		if extension == "" || seen[extension] {
			return
		}
		seen[extension] = true
		extensions = append(extensions, extension)
	}
	add(filepath.Ext(asset.URL))
	switch strings.TrimSpace(strings.ToLower(asset.ContentType)) {
	case "image/png":
		add(".png")
	case "image/jpeg":
		add(".jpeg")
		add(".jpg")
	case "image/webp":
		add(".webp")
	case "image/gif":
		add(".gif")
	case "video/mp4":
		add(".mp4")
	case "video/webm":
		add(".webm")
	case "video/quicktime":
		add(".mov")
	case "audio/mpeg":
		add(".mp3")
	case "audio/wav":
		add(".wav")
	case "audio/mp4":
		add(".m4a")
	case "audio/ogg":
		add(".ogg")
	}
	for _, extension := range []string{".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov", ".mp3", ".wav", ".m4a", ".ogg", ".bin"} {
		add(extension)
	}
	return extensions
}

func encodeAssetTags(values []string) (model.JSONB, error) {
	unique := make([]string, 0, len(values))
	seen := make(map[string]bool)
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[strings.ToLower(value)] {
			continue
		}
		if len([]rune(value)) > 32 {
			return nil, errors.New("asset tag is too long")
		}
		seen[strings.ToLower(value)] = true
		unique = append(unique, value)
		if len(unique) > 20 {
			return nil, errors.New("asset tags cannot exceed 20")
		}
	}
	payload, err := json.Marshal(unique)
	return model.JSONB(payload), err
}

func encodeAssetSourceMetadata(value map[string]any) (model.JSONB, error) {
	if value == nil {
		return model.JSONB("{}"), nil
	}
	payload, err := json.Marshal(value)
	return model.JSONB(payload), err
}

func uniqueAssetStrings(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]bool)
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	return result
}

func normalizeAssetIngestionMode(value string, sourceType string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case model.AssetIngestionAutomatic:
		return model.AssetIngestionAutomatic
	case model.AssetIngestionManual:
		return model.AssetIngestionManual
	case model.AssetIngestionMigrated:
		return model.AssetIngestionMigrated
	}
	if sourceType == model.AssetSourceManualUpload {
		return model.AssetIngestionManual
	}
	return model.AssetIngestionAutomatic
}

func assetIngestionID(workspaceID string, idempotencyKey string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(workspaceID) + "\x00" + strings.TrimSpace(idempotencyKey)))
	return "asset_" + hex.EncodeToString(digest[:12])
}
