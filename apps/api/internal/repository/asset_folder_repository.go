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

var (
	ErrAssetFolderNotFound  = errors.New("asset folder not found")
	ErrAssetFolderConflict  = errors.New("asset folder already exists")
	ErrAssetFolderProtected = errors.New("system asset folder is protected")
	ErrAssetFolderInUse     = errors.New("asset folder is referenced by an active batch")
)

type AssetFolderRepository interface {
	ListByWorkspace(workspaceID string) ([]model.AssetFolder, error)
	GetByWorkspace(id string, workspaceID string) (model.AssetFolder, error)
	FindSystem(workspaceID string, systemKey string, sourceRefID string) (model.AssetFolder, error)
	Create(folder model.AssetFolder) (model.AssetFolder, error)
	EnsureSystem(folder model.AssetFolder) (model.AssetFolder, error)
	Update(folder model.AssetFolder, workspaceID string) (model.AssetFolder, error)
	DeleteByIDs(ids []string, workspaceID string) error
}

type MemoryAssetFolderRepository struct {
	mu      sync.RWMutex
	folders map[string]model.AssetFolder
}

func NewMemoryAssetFolderRepository() *MemoryAssetFolderRepository {
	return &MemoryAssetFolderRepository{folders: make(map[string]model.AssetFolder)}
}

func (r *MemoryAssetFolderRepository) ListByWorkspace(workspaceID string) ([]model.AssetFolder, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]model.AssetFolder, 0)
	for _, folder := range r.folders {
		if folder.WorkspaceID == workspaceID {
			items = append(items, cloneAssetFolder(folder))
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].SortOrder != items[j].SortOrder {
			return items[i].SortOrder < items[j].SortOrder
		}
		if items[i].Name != items[j].Name {
			return items[i].Name < items[j].Name
		}
		return items[i].ID < items[j].ID
	})
	return items, nil
}

func (r *MemoryAssetFolderRepository) GetByWorkspace(id string, workspaceID string) (model.AssetFolder, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	folder, ok := r.folders[id]
	if !ok || folder.WorkspaceID != workspaceID {
		return model.AssetFolder{}, ErrAssetFolderNotFound
	}
	return cloneAssetFolder(folder), nil
}

func (r *MemoryAssetFolderRepository) FindSystem(workspaceID string, systemKey string, sourceRefID string) (model.AssetFolder, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, folder := range r.folders {
		if folder.WorkspaceID == workspaceID && folder.SystemKey == systemKey && folder.SourceRefID == sourceRefID {
			return cloneAssetFolder(folder), nil
		}
	}
	return model.AssetFolder{}, ErrAssetFolderNotFound
}

func (r *MemoryAssetFolderRepository) Create(folder model.AssetFolder) (model.AssetFolder, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.createLocked(folder, false)
}

func (r *MemoryAssetFolderRepository) EnsureSystem(folder model.AssetFolder) (model.AssetFolder, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, existing := range r.folders {
		if existing.WorkspaceID == folder.WorkspaceID && existing.SystemKey == folder.SystemKey && existing.SourceRefID == folder.SourceRefID {
			return cloneAssetFolder(existing), nil
		}
	}
	return r.createLocked(folder, true)
}

func (r *MemoryAssetFolderRepository) createLocked(folder model.AssetFolder, system bool) (model.AssetFolder, error) {
	if _, exists := r.folders[folder.ID]; exists {
		return model.AssetFolder{}, ErrAssetFolderConflict
	}
	for _, existing := range r.folders {
		if existing.WorkspaceID == folder.WorkspaceID && existing.ParentID == folder.ParentID && existing.NormalizedName == folder.NormalizedName {
			if system && existing.SystemKey == folder.SystemKey && existing.SourceRefID == folder.SourceRefID {
				return cloneAssetFolder(existing), nil
			}
			return model.AssetFolder{}, ErrAssetFolderConflict
		}
	}
	now := time.Now().UTC()
	folder.CreatedAt = now
	folder.UpdatedAt = now
	r.folders[folder.ID] = cloneAssetFolder(folder)
	return cloneAssetFolder(folder), nil
}

func (r *MemoryAssetFolderRepository) Update(folder model.AssetFolder, workspaceID string) (model.AssetFolder, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, ok := r.folders[folder.ID]
	if !ok || current.WorkspaceID != workspaceID {
		return model.AssetFolder{}, ErrAssetFolderNotFound
	}
	for id, existing := range r.folders {
		if id != folder.ID && existing.WorkspaceID == workspaceID && existing.ParentID == folder.ParentID && existing.NormalizedName == folder.NormalizedName {
			return model.AssetFolder{}, ErrAssetFolderConflict
		}
	}
	folder.WorkspaceID = current.WorkspaceID
	folder.CreatedBy = current.CreatedBy
	folder.Kind = current.Kind
	folder.SystemKey = current.SystemKey
	folder.SourceRefType = current.SourceRefType
	folder.SourceRefID = current.SourceRefID
	folder.SystemIdentity = current.SystemIdentity
	folder.CreatedAt = current.CreatedAt
	folder.UpdatedAt = time.Now().UTC()
	r.folders[folder.ID] = cloneAssetFolder(folder)
	return cloneAssetFolder(folder), nil
}

func (r *MemoryAssetFolderRepository) DeleteByIDs(ids []string, workspaceID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, id := range ids {
		if folder, ok := r.folders[id]; !ok || folder.WorkspaceID != workspaceID {
			return ErrAssetFolderNotFound
		}
	}
	for _, id := range ids {
		delete(r.folders, id)
	}
	return nil
}

type GormAssetFolderRepository struct {
	db *gorm.DB
}

func NewGormAssetFolderRepository(db *gorm.DB) *GormAssetFolderRepository {
	return &GormAssetFolderRepository{db: db}
}

func (r *GormAssetFolderRepository) ListByWorkspace(workspaceID string) ([]model.AssetFolder, error) {
	var folders []model.AssetFolder
	err := r.db.Where("workspace_id = ?", workspaceID).Order("sort_order ASC, name ASC, id ASC").Find(&folders).Error
	return folders, err
}

func (r *GormAssetFolderRepository) GetByWorkspace(id string, workspaceID string) (model.AssetFolder, error) {
	var folder model.AssetFolder
	err := r.db.First(&folder, "id = ? AND workspace_id = ?", id, workspaceID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.AssetFolder{}, ErrAssetFolderNotFound
	}
	return folder, err
}

func (r *GormAssetFolderRepository) FindSystem(workspaceID string, systemKey string, sourceRefID string) (model.AssetFolder, error) {
	var folder model.AssetFolder
	err := r.db.First(&folder, "workspace_id = ? AND system_key = ? AND source_ref_id = ?", workspaceID, systemKey, sourceRefID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.AssetFolder{}, ErrAssetFolderNotFound
	}
	return folder, err
}

func (r *GormAssetFolderRepository) Create(folder model.AssetFolder) (model.AssetFolder, error) {
	now := time.Now().UTC()
	folder.CreatedAt = now
	folder.UpdatedAt = now
	if err := r.db.Create(&folder).Error; err != nil {
		return model.AssetFolder{}, mapAssetFolderConflict(err)
	}
	return folder, nil
}

func (r *GormAssetFolderRepository) EnsureSystem(folder model.AssetFolder) (model.AssetFolder, error) {
	if folder.SystemIdentity == nil || strings.TrimSpace(*folder.SystemIdentity) == "" {
		return model.AssetFolder{}, errors.New("system asset folder identity is required")
	}
	now := time.Now().UTC()
	folder.CreatedAt = now
	folder.UpdatedAt = now
	// A concurrent creator can race on either the system identity or the
	// sibling-name index. Ignore both conflicts, then resolve the canonical
	// system folder by its stable identity below.
	result := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&folder)
	if result.Error != nil {
		return model.AssetFolder{}, mapAssetFolderConflict(result.Error)
	}
	if result.RowsAffected > 0 {
		return folder, nil
	}
	return r.FindSystem(folder.WorkspaceID, folder.SystemKey, folder.SourceRefID)
}

func (r *GormAssetFolderRepository) Update(folder model.AssetFolder, workspaceID string) (model.AssetFolder, error) {
	current, err := r.GetByWorkspace(folder.ID, workspaceID)
	if err != nil {
		return model.AssetFolder{}, err
	}
	folder.WorkspaceID = current.WorkspaceID
	folder.CreatedBy = current.CreatedBy
	folder.Kind = current.Kind
	folder.SystemKey = current.SystemKey
	folder.SourceRefType = current.SourceRefType
	folder.SourceRefID = current.SourceRefID
	folder.SystemIdentity = current.SystemIdentity
	folder.CreatedAt = current.CreatedAt
	folder.UpdatedAt = time.Now().UTC()
	if err := r.db.Save(&folder).Error; err != nil {
		return model.AssetFolder{}, mapAssetFolderConflict(err)
	}
	return folder, nil
}

func (r *GormAssetFolderRepository) DeleteByIDs(ids []string, workspaceID string) error {
	if len(ids) == 0 {
		return nil
	}
	var count int64
	if err := r.db.Model(&model.AssetFolder{}).Where("workspace_id = ? AND id IN ?", workspaceID, ids).Count(&count).Error; err != nil {
		return err
	}
	if count != int64(len(ids)) {
		return ErrAssetFolderNotFound
	}
	return r.db.Where("workspace_id = ? AND id IN ?", workspaceID, ids).Delete(&model.AssetFolder{}).Error
}

func mapAssetFolderConflict(err error) error {
	if err == nil {
		return nil
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "duplicate key") || strings.Contains(message, "unique constraint") || strings.Contains(message, "unique failed") {
		return ErrAssetFolderConflict
	}
	return err
}

func cloneAssetFolder(folder model.AssetFolder) model.AssetFolder {
	if folder.SystemIdentity != nil {
		identity := *folder.SystemIdentity
		folder.SystemIdentity = &identity
	}
	return folder
}
