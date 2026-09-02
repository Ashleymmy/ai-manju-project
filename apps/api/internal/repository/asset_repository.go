package repository

import (
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrAssetNotFound = errors.New("asset not found")

type AssetRepository interface {
	ListByUser(userID string) ([]model.Asset, error)
	ListByWorkspace(workspaceID string) ([]model.Asset, error)
	GetByUser(id string, userID string) (model.Asset, error)
	GetByWorkspace(id string, workspaceID string) (model.Asset, error)
	ListByWorkspaceIDs(ids []string, workspaceID string) ([]model.Asset, error)
	Create(asset model.Asset) (model.Asset, error)
	ListLibrary(filter AssetLibraryFilter) ([]model.Asset, int64, error)
	UpdateMutable(id string, workspaceID string, input AssetMutableUpdate) (model.Asset, error)
	ApplyRegistration(id string, workspaceID string, input AssetRegistrationUpdate) (model.Asset, error)
	BulkMove(ids []string, folderID string, workspaceID string) (int64, error)
	MoveByFolders(folderIDs []string, targetFolderID string, workspaceID string) (int64, error)
	CountByFolder(workspaceID string) (map[string]int64, error)
	ListTrash(workspaceID string) ([]model.Asset, error)
	TrashByWorkspace(ids []string, workspaceID string, trashedBy string, trashedAt time.Time, expiresAt time.Time) ([]model.Asset, error)
	RestoreByWorkspace(targets []AssetRestoreTarget, workspaceID string) ([]model.Asset, error)
	ListExpiredTrash(now time.Time, limit int) ([]model.Asset, error)
	DeleteByWorkspace(id string, workspaceID string) error
}

type AssetLibraryFilter struct {
	WorkspaceID     string
	AssetIDs        []string
	ExcludeAssetIDs []string
	FilterAssetIDs  bool
	FolderIDs       []string
	FilterFolder    bool
	Type            string
	Category        string
	SourceType      string
	SourceProjectID string
	Keyword         string
	CreatedFrom     *time.Time
	CreatedTo       *time.Time
	Page            int
	PageSize        int
	Sort            string
	Trashed         bool
}

type AssetMutableUpdate struct {
	Name     string
	FolderID string
	Category string
	Tags     model.JSONB
	Note     string
}

type AssetRegistrationUpdate struct {
	FolderID        string
	Category        string
	SourceType      string
	SourceProjectID string
	SourceBatchID   string
	SourceItemID    string
	SourceJobID     string
	SourceMetadata  model.JSONB
}

type AssetRestoreTarget struct {
	ID       string
	FolderID string
}

type MemoryAssetRepository struct {
	mu     sync.RWMutex
	assets map[string]model.Asset
}

func NewMemoryAssetRepository() *MemoryAssetRepository {
	return &MemoryAssetRepository{assets: make(map[string]model.Asset)}
}

func (r *MemoryAssetRepository) ListByUser(userID string) ([]model.Asset, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	assets := make([]model.Asset, 0)
	for _, asset := range r.assets {
		if asset.UserID == userID && asset.TrashedAt == nil {
			assets = append(assets, asset)
		}
	}
	sort.Slice(assets, func(i, j int) bool {
		return assets[i].CreatedAt.After(assets[j].CreatedAt)
	})
	return assets, nil
}

func (r *MemoryAssetRepository) ListByWorkspace(workspaceID string) ([]model.Asset, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	assets := make([]model.Asset, 0)
	for _, asset := range r.assets {
		if asset.TrashedAt == nil && (asset.WorkspaceID == workspaceID || (asset.WorkspaceID == "" && workspaceID == "default:"+asset.UserID)) {
			assets = append(assets, asset)
		}
	}
	sort.Slice(assets, func(i, j int) bool {
		return assets[i].CreatedAt.After(assets[j].CreatedAt)
	})
	return assets, nil
}

func (r *MemoryAssetRepository) GetByUser(id string, userID string) (model.Asset, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	asset, ok := r.assets[id]
	if !ok || asset.UserID != userID {
		return model.Asset{}, ErrAssetNotFound
	}
	return asset, nil
}

func (r *MemoryAssetRepository) GetByWorkspace(id string, workspaceID string) (model.Asset, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	asset, ok := r.assets[id]
	if !ok || (asset.WorkspaceID != workspaceID && !(asset.WorkspaceID == "" && workspaceID == "default:"+asset.UserID)) {
		return model.Asset{}, ErrAssetNotFound
	}
	return asset, nil
}

func (r *MemoryAssetRepository) ListByWorkspaceIDs(ids []string, workspaceID string) ([]model.Asset, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]model.Asset, 0, len(ids))
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		asset, ok := r.assets[id]
		if ok && assetBelongsToWorkspace(asset, workspaceID) {
			result = append(result, asset)
		}
	}
	return result, nil
}

func (r *MemoryAssetRepository) Create(asset model.Asset) (model.Asset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	asset.CreatedAt = now
	asset.UpdatedAt = now
	r.assets[asset.ID] = asset
	return asset, nil
}

func (r *MemoryAssetRepository) ListLibrary(filter AssetLibraryFilter) ([]model.Asset, int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if filter.FilterAssetIDs && len(filter.AssetIDs) == 0 {
		return []model.Asset{}, 0, nil
	}
	assetIDs := make(map[string]bool, len(filter.AssetIDs))
	for _, id := range filter.AssetIDs {
		assetIDs[id] = true
	}
	excludedAssetIDs := make(map[string]bool, len(filter.ExcludeAssetIDs))
	for _, id := range filter.ExcludeAssetIDs {
		excludedAssetIDs[id] = true
	}
	folderIDs := make(map[string]bool, len(filter.FolderIDs))
	for _, id := range filter.FolderIDs {
		folderIDs[id] = true
	}
	query := strings.ToLower(strings.TrimSpace(filter.Keyword))
	assets := make([]model.Asset, 0)
	for _, asset := range r.assets {
		if !assetBelongsToWorkspace(asset, filter.WorkspaceID) {
			continue
		}
		if (filter.FilterAssetIDs && !assetIDs[asset.ID]) || excludedAssetIDs[asset.ID] {
			continue
		}
		if (filter.Trashed && asset.TrashedAt == nil) || (!filter.Trashed && asset.TrashedAt != nil) {
			continue
		}
		if filter.FilterFolder && !folderIDs[asset.FolderID] {
			continue
		}
		if filter.Type != "" && asset.Type != filter.Type {
			continue
		}
		if filter.Category != "" && asset.Category != filter.Category {
			continue
		}
		if filter.SourceType != "" && asset.SourceType != filter.SourceType {
			continue
		}
		if filter.SourceProjectID != "" && asset.SourceProjectID != filter.SourceProjectID {
			continue
		}
		if filter.CreatedFrom != nil && asset.CreatedAt.Before(*filter.CreatedFrom) {
			continue
		}
		if filter.CreatedTo != nil && asset.CreatedAt.After(*filter.CreatedTo) {
			continue
		}
		if query != "" && !strings.Contains(strings.ToLower(strings.Join([]string{asset.ID, asset.Name, asset.Note, string(asset.Tags), asset.Category, asset.SourceType, asset.SourceProjectID}, " ")), query) {
			continue
		}
		assets = append(assets, asset)
	}
	sort.Slice(assets, func(i, j int) bool {
		switch filter.Sort {
		case "created_at_asc":
			return assets[i].CreatedAt.Before(assets[j].CreatedAt)
		case "name_asc":
			if assets[i].Name != assets[j].Name {
				return assets[i].Name < assets[j].Name
			}
			return assets[i].ID < assets[j].ID
		case "name_desc":
			if assets[i].Name != assets[j].Name {
				return assets[i].Name > assets[j].Name
			}
			return assets[i].ID > assets[j].ID
		default:
			return assets[i].CreatedAt.After(assets[j].CreatedAt)
		}
	})
	total := int64(len(assets))
	start := (filter.Page - 1) * filter.PageSize
	if start < 0 {
		start = 0
	}
	if start >= len(assets) {
		return []model.Asset{}, total, nil
	}
	end := start + filter.PageSize
	if end > len(assets) {
		end = len(assets)
	}
	return append([]model.Asset(nil), assets[start:end]...), total, nil
}

func (r *MemoryAssetRepository) UpdateMutable(id string, workspaceID string, input AssetMutableUpdate) (model.Asset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	asset, ok := r.assets[id]
	if !ok || !assetBelongsToWorkspace(asset, workspaceID) || asset.TrashedAt != nil {
		return model.Asset{}, ErrAssetNotFound
	}
	asset.Name = input.Name
	asset.FolderID = input.FolderID
	asset.Category = input.Category
	asset.Tags = append(model.JSONB(nil), input.Tags...)
	asset.Note = input.Note
	asset.UpdatedAt = time.Now().UTC()
	r.assets[id] = asset
	return asset, nil
}

func (r *MemoryAssetRepository) ApplyRegistration(id string, workspaceID string, input AssetRegistrationUpdate) (model.Asset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	asset, ok := r.assets[id]
	if !ok || !assetBelongsToWorkspace(asset, workspaceID) || asset.TrashedAt != nil {
		return model.Asset{}, ErrAssetNotFound
	}
	asset.FolderID = input.FolderID
	asset.Category = input.Category
	asset.SourceType = input.SourceType
	asset.SourceProjectID = input.SourceProjectID
	asset.SourceBatchID = input.SourceBatchID
	asset.SourceItemID = input.SourceItemID
	asset.SourceJobID = input.SourceJobID
	asset.SourceMetadata = append(model.JSONB(nil), input.SourceMetadata...)
	asset.UpdatedAt = time.Now().UTC()
	r.assets[id] = asset
	return asset, nil
}

func (r *MemoryAssetRepository) BulkMove(ids []string, folderID string, workspaceID string) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	unique := make(map[string]bool, len(ids))
	for _, id := range ids {
		if id != "" {
			unique[id] = true
		}
	}
	for id := range unique {
		asset, ok := r.assets[id]
		if !ok || !assetBelongsToWorkspace(asset, workspaceID) || asset.TrashedAt != nil {
			return 0, ErrAssetNotFound
		}
	}
	now := time.Now().UTC()
	for id := range unique {
		asset := r.assets[id]
		asset.FolderID = folderID
		asset.UpdatedAt = now
		r.assets[id] = asset
	}
	return int64(len(unique)), nil
}

func (r *MemoryAssetRepository) MoveByFolders(folderIDs []string, targetFolderID string, workspaceID string) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	wanted := make(map[string]bool, len(folderIDs))
	for _, id := range folderIDs {
		wanted[id] = true
	}
	var moved int64
	now := time.Now().UTC()
	for id, asset := range r.assets {
		if assetBelongsToWorkspace(asset, workspaceID) && asset.TrashedAt == nil && wanted[asset.FolderID] {
			asset.FolderID = targetFolderID
			asset.UpdatedAt = now
			r.assets[id] = asset
			moved++
		}
	}
	return moved, nil
}

func (r *MemoryAssetRepository) CountByFolder(workspaceID string) (map[string]int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	counts := make(map[string]int64)
	for _, asset := range r.assets {
		if assetBelongsToWorkspace(asset, workspaceID) && asset.TrashedAt == nil {
			counts[asset.FolderID]++
		}
	}
	return counts, nil
}

func (r *MemoryAssetRepository) ListTrash(workspaceID string) ([]model.Asset, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	assets := make([]model.Asset, 0)
	for _, asset := range r.assets {
		if assetBelongsToWorkspace(asset, workspaceID) && asset.TrashedAt != nil {
			assets = append(assets, asset)
		}
	}
	sort.Slice(assets, func(i, j int) bool { return assets[i].TrashedAt.After(*assets[j].TrashedAt) })
	return assets, nil
}

func (r *MemoryAssetRepository) TrashByWorkspace(ids []string, workspaceID string, trashedBy string, trashedAt time.Time, expiresAt time.Time) ([]model.Asset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	unique := uniqueAssetIDs(ids)
	for _, id := range unique {
		asset, ok := r.assets[id]
		if !ok || !assetBelongsToWorkspace(asset, workspaceID) || asset.TrashedAt != nil {
			return nil, ErrAssetNotFound
		}
	}
	result := make([]model.Asset, 0, len(unique))
	for _, id := range unique {
		asset := r.assets[id]
		trashedAtCopy, expiresAtCopy := trashedAt, expiresAt
		asset.TrashedAt = &trashedAtCopy
		asset.TrashExpiresAt = &expiresAtCopy
		asset.TrashedBy = trashedBy
		asset.UpdatedAt = trashedAt
		r.assets[id] = asset
		result = append(result, asset)
	}
	return result, nil
}

func (r *MemoryAssetRepository) RestoreByWorkspace(targets []AssetRestoreTarget, workspaceID string) ([]model.Asset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	seen := make(map[string]bool, len(targets))
	for _, target := range targets {
		asset, ok := r.assets[target.ID]
		if target.ID == "" || seen[target.ID] || !ok || !assetBelongsToWorkspace(asset, workspaceID) || asset.TrashedAt == nil {
			return nil, ErrAssetNotFound
		}
		seen[target.ID] = true
	}
	now := time.Now().UTC()
	result := make([]model.Asset, 0, len(targets))
	for _, target := range targets {
		asset := r.assets[target.ID]
		asset.FolderID = target.FolderID
		asset.TrashedAt = nil
		asset.TrashExpiresAt = nil
		asset.TrashedBy = ""
		asset.UpdatedAt = now
		r.assets[target.ID] = asset
		result = append(result, asset)
	}
	return result, nil
}

func (r *MemoryAssetRepository) ListExpiredTrash(now time.Time, limit int) ([]model.Asset, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	assets := make([]model.Asset, 0)
	for _, asset := range r.assets {
		if asset.TrashedAt != nil && asset.TrashExpiresAt != nil && !asset.TrashExpiresAt.After(now) {
			assets = append(assets, asset)
		}
	}
	sort.Slice(assets, func(i, j int) bool { return assets[i].TrashExpiresAt.Before(*assets[j].TrashExpiresAt) })
	if limit > 0 && len(assets) > limit {
		assets = assets[:limit]
	}
	return assets, nil
}

func (r *MemoryAssetRepository) DeleteByWorkspace(id string, workspaceID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	asset, ok := r.assets[id]
	if !ok || (asset.WorkspaceID != workspaceID && !(asset.WorkspaceID == "" && workspaceID == "default:"+asset.UserID)) {
		return ErrAssetNotFound
	}
	delete(r.assets, id)
	return nil
}

type GormAssetRepository struct {
	db *gorm.DB
}

func NewGormAssetRepository(db *gorm.DB) *GormAssetRepository {
	return &GormAssetRepository{db: db}
}

func (r *GormAssetRepository) ListByUser(userID string) ([]model.Asset, error) {
	var assets []model.Asset
	if err := r.db.Where("user_id = ? AND trashed_at IS NULL", userID).Order("created_at DESC").Find(&assets).Error; err != nil {
		return nil, err
	}
	return assets, nil
}

func (r *GormAssetRepository) ListByWorkspace(workspaceID string) ([]model.Asset, error) {
	var assets []model.Asset
	query := r.db.Where("workspace_id = ? AND trashed_at IS NULL", workspaceID)
	if userID, ok := legacyPersonalUserID(workspaceID); ok {
		query = r.db.Where("(workspace_id = ? OR ((workspace_id = '' OR workspace_id IS NULL) AND user_id = ?)) AND trashed_at IS NULL", workspaceID, userID)
	}
	if err := query.Order("created_at DESC").Find(&assets).Error; err != nil {
		return nil, err
	}
	return assets, nil
}

func (r *GormAssetRepository) GetByUser(id string, userID string) (model.Asset, error) {
	var asset model.Asset
	if err := r.db.First(&asset, "id = ? AND user_id = ?", id, userID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.Asset{}, ErrAssetNotFound
		}
		return model.Asset{}, err
	}
	return asset, nil
}

func (r *GormAssetRepository) GetByWorkspace(id string, workspaceID string) (model.Asset, error) {
	var asset model.Asset
	query := r.db.Where("id = ? AND workspace_id = ?", id, workspaceID)
	if userID, ok := legacyPersonalUserID(workspaceID); ok {
		query = r.db.Where("id = ? AND (workspace_id = ? OR ((workspace_id = '' OR workspace_id IS NULL) AND user_id = ?))", id, workspaceID, userID)
	}
	if err := query.First(&asset).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.Asset{}, ErrAssetNotFound
		}
		return model.Asset{}, err
	}
	return asset, nil
}

func (r *GormAssetRepository) ListByWorkspaceIDs(ids []string, workspaceID string) ([]model.Asset, error) {
	return r.assetsByIDs(workspaceID, uniqueAssetIDs(ids))
}

func legacyPersonalUserID(workspaceID string) (string, bool) {
	if len(workspaceID) <= len("default:") || workspaceID[:len("default:")] != "default:" {
		return "", false
	}
	return workspaceID[len("default:"):], true
}

func (r *GormAssetRepository) Create(asset model.Asset) (model.Asset, error) {
	now := time.Now().UTC()
	asset.CreatedAt = now
	asset.UpdatedAt = now
	if err := r.db.Create(&asset).Error; err != nil {
		return model.Asset{}, err
	}
	return asset, nil
}

func (r *GormAssetRepository) ListLibrary(filter AssetLibraryFilter) ([]model.Asset, int64, error) {
	if filter.FilterAssetIDs && len(filter.AssetIDs) == 0 {
		return []model.Asset{}, 0, nil
	}
	query := r.workspaceQuery(filter.WorkspaceID)
	if filter.FilterAssetIDs {
		query = query.Where("id IN ?", uniqueAssetIDs(filter.AssetIDs))
	}
	if excluded := uniqueAssetIDs(filter.ExcludeAssetIDs); len(excluded) > 0 {
		query = query.Where("id NOT IN ?", excluded)
	}
	if filter.Trashed {
		query = query.Where("trashed_at IS NOT NULL")
	} else {
		query = query.Where("trashed_at IS NULL")
	}
	if filter.FilterFolder {
		query = query.Where("folder_id IN ?", filter.FolderIDs)
	}
	if filter.Type != "" {
		query = query.Where("type = ?", filter.Type)
	}
	if filter.Category != "" {
		query = query.Where("category = ?", filter.Category)
	}
	if filter.SourceType != "" {
		query = query.Where("source_type = ?", filter.SourceType)
	}
	if filter.SourceProjectID != "" {
		query = query.Where("source_project_id = ?", filter.SourceProjectID)
	}
	if filter.Keyword != "" {
		like := "%" + strings.ToLower(filter.Keyword) + "%"
		query = query.Where("LOWER(id) LIKE ? OR LOWER(name) LIKE ? OR LOWER(note) LIKE ? OR LOWER(CAST(tags AS TEXT)) LIKE ? OR LOWER(category) LIKE ? OR LOWER(source_type) LIKE ? OR LOWER(source_project_id) LIKE ?", like, like, like, like, like, like, like)
	}
	if filter.CreatedFrom != nil {
		query = query.Where("created_at >= ?", *filter.CreatedFrom)
	}
	if filter.CreatedTo != nil {
		query = query.Where("created_at <= ?", *filter.CreatedTo)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	order := "created_at DESC, id DESC"
	switch filter.Sort {
	case "created_at_asc":
		order = "created_at ASC, id ASC"
	case "name_asc":
		order = "name ASC, id ASC"
	case "name_desc":
		order = "name DESC, id DESC"
	}
	var assets []model.Asset
	err := query.Order(order).Offset((filter.Page - 1) * filter.PageSize).Limit(filter.PageSize).Find(&assets).Error
	return assets, total, err
}

func (r *GormAssetRepository) UpdateMutable(id string, workspaceID string, input AssetMutableUpdate) (model.Asset, error) {
	asset, err := r.GetByWorkspace(id, workspaceID)
	if err != nil {
		return model.Asset{}, err
	}
	if asset.TrashedAt != nil {
		return model.Asset{}, ErrAssetNotFound
	}
	updates := map[string]any{
		"name": input.Name, "folder_id": input.FolderID, "category": input.Category,
		"tags": input.Tags, "note": input.Note, "updated_at": time.Now().UTC(),
	}
	if err := r.db.Model(&model.Asset{}).Where("id = ?", asset.ID).Updates(updates).Error; err != nil {
		return model.Asset{}, err
	}
	return r.GetByWorkspace(id, workspaceID)
}

func (r *GormAssetRepository) ApplyRegistration(id string, workspaceID string, input AssetRegistrationUpdate) (model.Asset, error) {
	asset, err := r.GetByWorkspace(id, workspaceID)
	if err != nil {
		return model.Asset{}, err
	}
	if asset.TrashedAt != nil {
		return model.Asset{}, ErrAssetNotFound
	}
	updates := map[string]any{
		"folder_id": input.FolderID, "category": input.Category, "source_type": input.SourceType,
		"source_project_id": input.SourceProjectID, "source_batch_id": input.SourceBatchID,
		"source_item_id": input.SourceItemID, "source_job_id": input.SourceJobID,
		"source_metadata": input.SourceMetadata, "updated_at": time.Now().UTC(),
	}
	if err := r.db.Model(&model.Asset{}).Where("id = ?", asset.ID).Updates(updates).Error; err != nil {
		return model.Asset{}, err
	}
	return r.GetByWorkspace(id, workspaceID)
}

func (r *GormAssetRepository) BulkMove(ids []string, folderID string, workspaceID string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	query := r.workspaceQuery(workspaceID).Where("trashed_at IS NULL AND id IN ?", ids)
	result := query.Updates(map[string]any{"folder_id": folderID, "updated_at": time.Now().UTC()})
	return result.RowsAffected, result.Error
}

func (r *GormAssetRepository) MoveByFolders(folderIDs []string, targetFolderID string, workspaceID string) (int64, error) {
	if len(folderIDs) == 0 {
		return 0, nil
	}
	result := r.workspaceQuery(workspaceID).Where("trashed_at IS NULL AND folder_id IN ?", folderIDs).Updates(map[string]any{"folder_id": targetFolderID, "updated_at": time.Now().UTC()})
	return result.RowsAffected, result.Error
}

func (r *GormAssetRepository) CountByFolder(workspaceID string) (map[string]int64, error) {
	type folderCount struct {
		FolderID string
		Count    int64
	}
	var rows []folderCount
	if err := r.workspaceQuery(workspaceID).Where("trashed_at IS NULL").Select("folder_id, COUNT(*) AS count").Group("folder_id").Scan(&rows).Error; err != nil {
		return nil, err
	}
	counts := make(map[string]int64, len(rows))
	for _, row := range rows {
		counts[row.FolderID] = row.Count
	}
	return counts, nil
}

func (r *GormAssetRepository) ListTrash(workspaceID string) ([]model.Asset, error) {
	var assets []model.Asset
	err := r.workspaceQuery(workspaceID).Where("trashed_at IS NOT NULL").Order("trashed_at DESC, id DESC").Find(&assets).Error
	return assets, err
}

func (r *GormAssetRepository) TrashByWorkspace(ids []string, workspaceID string, trashedBy string, trashedAt time.Time, expiresAt time.Time) ([]model.Asset, error) {
	unique := uniqueAssetIDs(ids)
	if len(unique) == 0 {
		return nil, ErrAssetNotFound
	}
	var result []model.Asset
	err := r.db.Transaction(func(tx *gorm.DB) error {
		query := r.workspaceQueryOn(tx, workspaceID).Where("id IN ? AND trashed_at IS NULL", unique).Clauses(clause.Locking{Strength: "UPDATE"})
		if err := query.Find(&result).Error; err != nil {
			return err
		}
		if len(result) != len(unique) {
			return ErrAssetNotFound
		}
		return r.workspaceQueryOn(tx, workspaceID).Where("id IN ? AND trashed_at IS NULL", unique).Updates(map[string]any{
			"trashed_at": trashedAt, "trash_expires_at": expiresAt, "trashed_by": trashedBy, "updated_at": trashedAt,
		}).Error
	})
	if err != nil {
		return nil, err
	}
	for index := range result {
		trashedAtCopy, expiresAtCopy := trashedAt, expiresAt
		result[index].TrashedAt = &trashedAtCopy
		result[index].TrashExpiresAt = &expiresAtCopy
		result[index].TrashedBy = trashedBy
		result[index].UpdatedAt = trashedAt
	}
	return result, nil
}

func (r *GormAssetRepository) RestoreByWorkspace(targets []AssetRestoreTarget, workspaceID string) ([]model.Asset, error) {
	if len(targets) == 0 {
		return nil, ErrAssetNotFound
	}
	ids := make([]string, 0, len(targets))
	seen := make(map[string]bool, len(targets))
	for _, target := range targets {
		if target.ID == "" || seen[target.ID] {
			return nil, ErrAssetNotFound
		}
		seen[target.ID] = true
		ids = append(ids, target.ID)
	}
	var result []model.Asset
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := r.workspaceQueryOn(tx, workspaceID).Where("id IN ? AND trashed_at IS NOT NULL", ids).Clauses(clause.Locking{Strength: "UPDATE"}).Find(&result).Error; err != nil {
			return err
		}
		if len(result) != len(ids) {
			return ErrAssetNotFound
		}
		now := time.Now().UTC()
		for _, target := range targets {
			if err := r.workspaceQueryOn(tx, workspaceID).Where("id = ? AND trashed_at IS NOT NULL", target.ID).Updates(map[string]any{
				"folder_id": target.FolderID, "trashed_at": nil, "trash_expires_at": nil, "trashed_by": "", "updated_at": now,
			}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return r.assetsByIDs(workspaceID, ids)
}

func (r *GormAssetRepository) ListExpiredTrash(now time.Time, limit int) ([]model.Asset, error) {
	if limit <= 0 {
		limit = 100
	}
	var assets []model.Asset
	err := r.db.Where("trashed_at IS NOT NULL AND trash_expires_at IS NOT NULL AND trash_expires_at <= ?", now).Order("trash_expires_at ASC").Limit(limit).Find(&assets).Error
	return assets, err
}

func (r *GormAssetRepository) workspaceQuery(workspaceID string) *gorm.DB {
	return r.workspaceQueryOn(r.db, workspaceID)
}

func (r *GormAssetRepository) workspaceQueryOn(db *gorm.DB, workspaceID string) *gorm.DB {
	query := db.Model(&model.Asset{}).Where("workspace_id = ?", workspaceID)
	if userID, ok := legacyPersonalUserID(workspaceID); ok {
		query = r.db.Model(&model.Asset{}).Where("workspace_id = ? OR ((workspace_id = '' OR workspace_id IS NULL) AND user_id = ?)", workspaceID, userID)
	}
	return query
}

func (r *GormAssetRepository) assetsByIDs(workspaceID string, ids []string) ([]model.Asset, error) {
	var assets []model.Asset
	if err := r.workspaceQuery(workspaceID).Where("id IN ?", ids).Find(&assets).Error; err != nil {
		return nil, err
	}
	byID := make(map[string]model.Asset, len(assets))
	for _, asset := range assets {
		byID[asset.ID] = asset
	}
	ordered := make([]model.Asset, 0, len(ids))
	for _, id := range ids {
		if asset, ok := byID[id]; ok {
			ordered = append(ordered, asset)
		}
	}
	return ordered, nil
}

func (r *GormAssetRepository) DeleteByWorkspace(id string, workspaceID string) error {
	asset, err := r.GetByWorkspace(id, workspaceID)
	if err != nil {
		return err
	}
	if err := r.db.Delete(&model.Asset{}, "id = ?", asset.ID).Error; err != nil {
		return err
	}
	return nil
}

func assetBelongsToWorkspace(asset model.Asset, workspaceID string) bool {
	return asset.WorkspaceID == workspaceID || (asset.WorkspaceID == "" && workspaceID == "default:"+asset.UserID)
}

func uniqueAssetIDs(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	return result
}
