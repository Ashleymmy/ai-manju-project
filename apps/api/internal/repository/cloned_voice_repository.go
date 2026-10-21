package repository

import (
	"errors"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ClonedVoiceRepository 保存复刻音色的展示元数据（别名等），与服务商侧音色
// 本体解耦：服务商只认 voice_id，应用可以把中文名、属主放在这里。
type ClonedVoiceRepository interface {
	Upsert(meta model.ClonedVoiceMeta) (model.ClonedVoiceMeta, error)
	Get(voiceID string) (model.ClonedVoiceMeta, error)
	ListByVoiceIDs(voiceIDs []string) (map[string]model.ClonedVoiceMeta, error)
	// ListVisible 返回指定用户可见的音色：自己的；includeAll 时（超管）返回全部。
	ListVisible(userID string, includeAll bool) ([]model.ClonedVoiceMeta, error)
	// ListByReferenceAssetIDs 按参考音频资产反查音色（资产删除保护用）。
	ListByReferenceAssetIDs(assetIDs []string) ([]model.ClonedVoiceMeta, error)
	DeleteByVoiceID(voiceID string) error
}

type MemoryClonedVoiceRepository struct {
	mu    sync.RWMutex
	metas map[string]model.ClonedVoiceMeta
}

func NewMemoryClonedVoiceRepository() *MemoryClonedVoiceRepository {
	return &MemoryClonedVoiceRepository{metas: make(map[string]model.ClonedVoiceMeta)}
}

func (r *MemoryClonedVoiceRepository) Upsert(meta model.ClonedVoiceMeta) (model.ClonedVoiceMeta, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UTC()
	if current, exists := r.metas[meta.VoiceID]; exists {
		meta.CreatedAt = current.CreatedAt
	} else {
		meta.CreatedAt = now
	}
	meta.UpdatedAt = now
	r.metas[meta.VoiceID] = meta
	return meta, nil
}

func (r *MemoryClonedVoiceRepository) ListByVoiceIDs(voiceIDs []string) (map[string]model.ClonedVoiceMeta, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make(map[string]model.ClonedVoiceMeta, len(voiceIDs))
	for _, id := range voiceIDs {
		if meta, ok := r.metas[id]; ok {
			result[id] = meta
		}
	}
	return result, nil
}

func (r *MemoryClonedVoiceRepository) ListVisible(userID string, includeAll bool) ([]model.ClonedVoiceMeta, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]model.ClonedVoiceMeta, 0, len(r.metas))
	for _, meta := range r.metas {
		if includeAll || meta.OwnerID == userID {
			result = append(result, meta)
		}
	}
	return result, nil
}

var ErrClonedVoiceNotFound = errors.New("cloned voice not found")

func (r *MemoryClonedVoiceRepository) Get(voiceID string) (model.ClonedVoiceMeta, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	meta, ok := r.metas[voiceID]
	if !ok {
		return model.ClonedVoiceMeta{}, ErrClonedVoiceNotFound
	}
	return meta, nil
}

func (r *MemoryClonedVoiceRepository) ListByReferenceAssetIDs(assetIDs []string) ([]model.ClonedVoiceMeta, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	set := make(map[string]bool, len(assetIDs))
	for _, id := range assetIDs {
		set[id] = true
	}
	result := make([]model.ClonedVoiceMeta, 0)
	for _, meta := range r.metas {
		if meta.ReferenceAssetID != "" && set[meta.ReferenceAssetID] {
			result = append(result, meta)
		}
	}
	return result, nil
}

func (r *MemoryClonedVoiceRepository) DeleteByVoiceID(voiceID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.metas, voiceID)
	return nil
}

type GormClonedVoiceRepository struct {
	db *gorm.DB
}

func NewGormClonedVoiceRepository(db *gorm.DB) *GormClonedVoiceRepository {
	return &GormClonedVoiceRepository{db: db}
}

func (r *GormClonedVoiceRepository) Upsert(meta model.ClonedVoiceMeta) (model.ClonedVoiceMeta, error) {
	now := time.Now().UTC()
	meta.UpdatedAt = now
	err := r.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "voice_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"alias", "owner_id", "owner_name", "target_model", "updated_at",
		}),
	}).Create(&meta).Error
	if err != nil {
		return model.ClonedVoiceMeta{}, err
	}
	return meta, nil
}

func (r *GormClonedVoiceRepository) ListByVoiceIDs(voiceIDs []string) (map[string]model.ClonedVoiceMeta, error) {
	result := make(map[string]model.ClonedVoiceMeta, len(voiceIDs))
	if len(voiceIDs) == 0 {
		return result, nil
	}
	var rows []model.ClonedVoiceMeta
	if err := r.db.Where("voice_id IN ?", voiceIDs).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.VoiceID] = row
	}
	return result, nil
}

func (r *GormClonedVoiceRepository) ListVisible(userID string, includeAll bool) ([]model.ClonedVoiceMeta, error) {
	var rows []model.ClonedVoiceMeta
	query := r.db.Order("created_at DESC")
	if !includeAll {
		query = query.Where("owner_id = ?", userID)
	}
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func (r *GormClonedVoiceRepository) Get(voiceID string) (model.ClonedVoiceMeta, error) {
	var meta model.ClonedVoiceMeta
	if err := r.db.Where("voice_id = ?", voiceID).First(&meta).Error; err != nil {
		return model.ClonedVoiceMeta{}, ErrClonedVoiceNotFound
	}
	return meta, nil
}

func (r *GormClonedVoiceRepository) ListByReferenceAssetIDs(assetIDs []string) ([]model.ClonedVoiceMeta, error) {
	result := make([]model.ClonedVoiceMeta, 0)
	if len(assetIDs) == 0 {
		return result, nil
	}
	if err := r.db.Where("reference_asset_id IN ?", assetIDs).Find(&result).Error; err != nil {
		return nil, err
	}
	return result, nil
}

func (r *GormClonedVoiceRepository) DeleteByVoiceID(voiceID string) error {
	return r.db.Where("voice_id = ?", voiceID).Delete(&model.ClonedVoiceMeta{}).Error
}
