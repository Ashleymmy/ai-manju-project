package repository

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type AssetReferenceRepository interface {
	ReplaceForSource(workspaceID string, referenceType string, referenceID string, assetIDs []string) error
	ListByAssetIDs(workspaceID string, assetIDs []string) ([]model.AssetReference, error)
	DeleteForSource(workspaceID string, referenceType string, referenceID string) error
}

type MemoryAssetReferenceRepository struct {
	mu         sync.RWMutex
	references map[string]model.AssetReference
}

func NewMemoryAssetReferenceRepository() *MemoryAssetReferenceRepository {
	return &MemoryAssetReferenceRepository{references: make(map[string]model.AssetReference)}
}

func (r *MemoryAssetReferenceRepository) ReplaceForSource(workspaceID string, referenceType string, referenceID string, assetIDs []string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, reference := range r.references {
		if reference.WorkspaceID == workspaceID && reference.ReferenceType == referenceType && reference.ReferenceID == referenceID {
			delete(r.references, id)
		}
	}
	now := time.Now().UTC()
	for _, assetID := range uniqueAssetIDs(assetIDs) {
		reference := newAssetReference(workspaceID, assetID, referenceType, referenceID, now)
		r.references[reference.ID] = reference
	}
	return nil
}

func (r *MemoryAssetReferenceRepository) ListByAssetIDs(workspaceID string, assetIDs []string) ([]model.AssetReference, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	wanted := make(map[string]bool)
	for _, id := range uniqueAssetIDs(assetIDs) {
		wanted[id] = true
	}
	result := make([]model.AssetReference, 0)
	for _, reference := range r.references {
		if reference.WorkspaceID == workspaceID && wanted[reference.AssetID] {
			result = append(result, reference)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].AssetID != result[j].AssetID {
			return result[i].AssetID < result[j].AssetID
		}
		if result[i].ReferenceType != result[j].ReferenceType {
			return result[i].ReferenceType < result[j].ReferenceType
		}
		return result[i].ReferenceID < result[j].ReferenceID
	})
	return result, nil
}

func (r *MemoryAssetReferenceRepository) DeleteForSource(workspaceID string, referenceType string, referenceID string) error {
	return r.ReplaceForSource(workspaceID, referenceType, referenceID, nil)
}

type GormAssetReferenceRepository struct{ db *gorm.DB }

func NewGormAssetReferenceRepository(db *gorm.DB) *GormAssetReferenceRepository {
	return &GormAssetReferenceRepository{db: db}
}

func (r *GormAssetReferenceRepository) ReplaceForSource(workspaceID string, referenceType string, referenceID string, assetIDs []string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("workspace_id = ? AND reference_type = ? AND reference_id = ?", workspaceID, referenceType, referenceID).Delete(&model.AssetReference{}).Error; err != nil {
			return err
		}
		now := time.Now().UTC()
		rows := make([]model.AssetReference, 0)
		for _, assetID := range uniqueAssetIDs(assetIDs) {
			rows = append(rows, newAssetReference(workspaceID, assetID, referenceType, referenceID, now))
		}
		if len(rows) == 0 {
			return nil
		}
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&rows).Error
	})
}

func (r *GormAssetReferenceRepository) ListByAssetIDs(workspaceID string, assetIDs []string) ([]model.AssetReference, error) {
	ids := uniqueAssetIDs(assetIDs)
	if len(ids) == 0 {
		return []model.AssetReference{}, nil
	}
	var result []model.AssetReference
	err := r.db.Where("workspace_id = ? AND asset_id IN ?", workspaceID, ids).Order("asset_id ASC, reference_type ASC, reference_id ASC").Find(&result).Error
	return result, err
}

func (r *GormAssetReferenceRepository) DeleteForSource(workspaceID string, referenceType string, referenceID string) error {
	return r.db.Where("workspace_id = ? AND reference_type = ? AND reference_id = ?", workspaceID, referenceType, referenceID).Delete(&model.AssetReference{}).Error
}

func newAssetReference(workspaceID string, assetID string, referenceType string, referenceID string, now time.Time) model.AssetReference {
	workspaceID = strings.TrimSpace(workspaceID)
	assetID = strings.TrimSpace(assetID)
	referenceType = strings.TrimSpace(referenceType)
	referenceID = strings.TrimSpace(referenceID)
	digest := sha256.Sum256([]byte(strings.Join([]string{workspaceID, assetID, referenceType, referenceID}, "\x00")))
	return model.AssetReference{
		ID: "asset_ref_" + hex.EncodeToString(digest[:12]), WorkspaceID: workspaceID, AssetID: assetID,
		ReferenceType: referenceType, ReferenceID: referenceID, CreatedAt: now, UpdatedAt: now,
	}
}
