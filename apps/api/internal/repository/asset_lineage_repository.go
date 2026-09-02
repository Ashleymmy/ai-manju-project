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

type AssetLineageRepository interface {
	CreateMany(items []model.AssetLineage) ([]model.AssetLineage, error)
	ListByChild(workspaceID string, childAssetID string) ([]model.AssetLineage, error)
	ListByParent(workspaceID string, parentAssetID string) ([]model.AssetLineage, error)
	ListByParents(workspaceID string, parentAssetIDs []string) ([]model.AssetLineage, error)
}

type MemoryAssetLineageRepository struct {
	mu    sync.RWMutex
	items map[string]model.AssetLineage
}

func NewMemoryAssetLineageRepository() *MemoryAssetLineageRepository {
	return &MemoryAssetLineageRepository{items: map[string]model.AssetLineage{}}
}

func (r *MemoryAssetLineageRepository) CreateMany(items []model.AssetLineage) ([]model.AssetLineage, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UTC()
	result := make([]model.AssetLineage, 0, len(items))
	for _, item := range items {
		if existing, ok := r.findIdentityLocked(item); ok {
			result = append(result, existing)
			continue
		}
		item.CreatedAt, item.UpdatedAt = now, now
		r.items[item.ID] = item
		result = append(result, item)
	}
	return result, nil
}

func (r *MemoryAssetLineageRepository) ListByChild(workspaceID string, childAssetID string) ([]model.AssetLineage, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]model.AssetLineage, 0)
	for _, item := range r.items {
		if item.WorkspaceID == workspaceID && item.ChildAssetID == childAssetID {
			result = append(result, item)
		}
	}
	sortAssetLineage(result)
	return result, nil
}

func (r *MemoryAssetLineageRepository) ListByParent(workspaceID string, parentAssetID string) ([]model.AssetLineage, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]model.AssetLineage, 0)
	for _, item := range r.items {
		if item.WorkspaceID == workspaceID && item.ParentAssetID == parentAssetID {
			result = append(result, item)
		}
	}
	sortAssetLineage(result)
	return result, nil
}

func (r *MemoryAssetLineageRepository) ListByParents(workspaceID string, parentAssetIDs []string) ([]model.AssetLineage, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	wanted := map[string]bool{}
	for _, id := range parentAssetIDs {
		if id = strings.TrimSpace(id); id != "" {
			wanted[id] = true
		}
	}
	result := make([]model.AssetLineage, 0)
	for _, item := range r.items {
		if item.WorkspaceID == workspaceID && wanted[item.ParentAssetID] {
			result = append(result, item)
		}
	}
	sortAssetLineage(result)
	return result, nil
}

func (r *MemoryAssetLineageRepository) findIdentityLocked(item model.AssetLineage) (model.AssetLineage, bool) {
	for _, existing := range r.items {
		if existing.WorkspaceID == item.WorkspaceID && existing.ParentAssetID == item.ParentAssetID && existing.ChildAssetID == item.ChildAssetID && existing.RelationType == item.RelationType && existing.InputOrdinal == item.InputOrdinal {
			return existing, true
		}
	}
	return model.AssetLineage{}, false
}

type GormAssetLineageRepository struct{ db *gorm.DB }

func NewGormAssetLineageRepository(db *gorm.DB) *GormAssetLineageRepository {
	return &GormAssetLineageRepository{db: db}
}

func (r *GormAssetLineageRepository) CreateMany(items []model.AssetLineage) ([]model.AssetLineage, error) {
	if len(items) == 0 {
		return []model.AssetLineage{}, nil
	}
	now := time.Now().UTC()
	for index := range items {
		items[index].CreatedAt, items[index].UpdatedAt = now, now
	}
	if err := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&items).Error; err != nil {
		return nil, err
	}
	result := make([]model.AssetLineage, 0, len(items))
	for _, item := range items {
		var stored model.AssetLineage
		err := r.db.First(&stored, "workspace_id = ? AND parent_asset_id = ? AND child_asset_id = ? AND relation_type = ? AND input_ordinal = ?", item.WorkspaceID, item.ParentAssetID, item.ChildAssetID, item.RelationType, item.InputOrdinal).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		result = append(result, stored)
	}
	return result, nil
}

func (r *GormAssetLineageRepository) ListByChild(workspaceID string, childAssetID string) ([]model.AssetLineage, error) {
	var items []model.AssetLineage
	err := r.db.Where("workspace_id = ? AND child_asset_id = ?", workspaceID, childAssetID).Order("input_ordinal ASC, parent_asset_id ASC").Find(&items).Error
	return items, err
}

func (r *GormAssetLineageRepository) ListByParent(workspaceID string, parentAssetID string) ([]model.AssetLineage, error) {
	var items []model.AssetLineage
	err := r.db.Where("workspace_id = ? AND parent_asset_id = ?", workspaceID, parentAssetID).Order("created_at DESC, child_asset_id ASC").Find(&items).Error
	return items, err
}

func (r *GormAssetLineageRepository) ListByParents(workspaceID string, parentAssetIDs []string) ([]model.AssetLineage, error) {
	ids := uniqueAssetIDs(parentAssetIDs)
	if len(ids) == 0 {
		return []model.AssetLineage{}, nil
	}
	var items []model.AssetLineage
	err := r.db.Where("workspace_id = ? AND parent_asset_id IN ?", workspaceID, ids).Order("parent_asset_id ASC, created_at DESC, child_asset_id ASC").Find(&items).Error
	return items, err
}

func sortAssetLineage(items []model.AssetLineage) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].InputOrdinal != items[j].InputOrdinal {
			return items[i].InputOrdinal < items[j].InputOrdinal
		}
		if items[i].CreatedAt != items[j].CreatedAt {
			return items[i].CreatedAt.Before(items[j].CreatedAt)
		}
		return items[i].ID < items[j].ID
	})
}
