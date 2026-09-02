package repository

import (
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
)

var ErrSeedanceAssetNotFound = errors.New("seedance asset not found")
var ErrSeedanceAssetTagNotFound = errors.New("seedance asset tag not found")

type SeedanceAssetFilter struct {
	Status     string
	Type       string
	TagID      string
	Search     string
	ActiveOnly bool
	Limit      int
	Offset     int
}

type SeedanceAssetRepository interface {
	GetGroupByProvider(providerID string) (model.SeedanceAssetGroup, error)
	UpsertGroup(group model.SeedanceAssetGroup) (model.SeedanceAssetGroup, error)
	ListAssets(filter SeedanceAssetFilter) ([]model.SeedanceAsset, int64, error)
	ListPendingAssets(limit int) ([]model.SeedanceAsset, error)
	GetAsset(id string) (model.SeedanceAsset, error)
	GetAssetByVolcanoID(volcanoAssetID string) (model.SeedanceAsset, error)
	UpsertAsset(asset model.SeedanceAsset) (model.SeedanceAsset, error)
	UpdateAsset(asset model.SeedanceAsset) (model.SeedanceAsset, error)
	DeleteAsset(id string) error
	ListTags() ([]model.SeedanceAssetTag, error)
	GetTag(id string) (model.SeedanceAssetTag, error)
	UpsertTag(tag model.SeedanceAssetTag) (model.SeedanceAssetTag, error)
	DeleteTag(id string) error
	AddTag(assetID string, tagID string) error
	RemoveTag(assetID string, tagID string) error
	SetAssetTags(assetID string, tagIDs []string) error
}

type MemorySeedanceAssetRepository struct {
	mu       sync.RWMutex
	groups   map[string]model.SeedanceAssetGroup
	assets   map[string]model.SeedanceAsset
	tags     map[string]model.SeedanceAssetTag
	bindings map[string]map[string]bool
}

func NewMemorySeedanceAssetRepository() *MemorySeedanceAssetRepository {
	return &MemorySeedanceAssetRepository{
		groups:   make(map[string]model.SeedanceAssetGroup),
		assets:   make(map[string]model.SeedanceAsset),
		tags:     make(map[string]model.SeedanceAssetTag),
		bindings: make(map[string]map[string]bool),
	}
}

func (r *MemorySeedanceAssetRepository) GetGroupByProvider(providerID string) (model.SeedanceAssetGroup, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, group := range r.groups {
		if group.ProviderID == providerID {
			return group, nil
		}
	}
	return model.SeedanceAssetGroup{}, ErrSeedanceAssetNotFound
}

func (r *MemorySeedanceAssetRepository) UpsertGroup(group model.SeedanceAssetGroup) (model.SeedanceAssetGroup, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UTC()
	if existing, ok := r.groups[group.ID]; ok {
		group.CreatedAt = existing.CreatedAt
	} else {
		group.CreatedAt = now
	}
	group.UpdatedAt = now
	r.groups[group.ID] = group
	return group, nil
}

func (r *MemorySeedanceAssetRepository) ListAssets(filter SeedanceAssetFilter) ([]model.SeedanceAsset, int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	all := make([]model.SeedanceAsset, 0)
	for _, asset := range r.assets {
		if !seedanceAssetMatches(asset, filter, r.bindings) {
			continue
		}
		all = append(all, r.attachTagsLocked(asset))
	}
	sort.Slice(all, func(i, j int) bool {
		return all[i].CreatedAt.After(all[j].CreatedAt)
	})
	total := int64(len(all))
	return paginateSeedanceAssets(all, filter.Limit, filter.Offset), total, nil
}

func (r *MemorySeedanceAssetRepository) ListPendingAssets(limit int) ([]model.SeedanceAsset, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]model.SeedanceAsset, 0)
	for _, asset := range r.assets {
		if !isPendingSeedanceAssetStatus(asset.Status) {
			continue
		}
		items = append(items, r.attachTagsLocked(asset))
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].UpdatedAt.Before(items[j].UpdatedAt)
	})
	return paginateSeedanceAssets(items, limit, 0), nil
}

func (r *MemorySeedanceAssetRepository) GetAsset(id string) (model.SeedanceAsset, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	asset, ok := r.assets[id]
	if !ok {
		return model.SeedanceAsset{}, ErrSeedanceAssetNotFound
	}
	return r.attachTagsLocked(asset), nil
}

func (r *MemorySeedanceAssetRepository) GetAssetByVolcanoID(volcanoAssetID string) (model.SeedanceAsset, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, asset := range r.assets {
		if asset.VolcanoAssetID == volcanoAssetID {
			return r.attachTagsLocked(asset), nil
		}
	}
	return model.SeedanceAsset{}, ErrSeedanceAssetNotFound
}

func (r *MemorySeedanceAssetRepository) UpsertAsset(asset model.SeedanceAsset) (model.SeedanceAsset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UTC()
	for id, existing := range r.assets {
		if existing.VolcanoAssetID == asset.VolcanoAssetID && id != asset.ID {
			asset.ID = id
			asset.CreatedAt = existing.CreatedAt
			break
		}
	}
	if existing, ok := r.assets[asset.ID]; ok && !existing.CreatedAt.IsZero() {
		asset.CreatedAt = existing.CreatedAt
	}
	if asset.CreatedAt.IsZero() {
		asset.CreatedAt = now
	}
	asset.UpdatedAt = now
	r.assets[asset.ID] = asset
	return r.attachTagsLocked(asset), nil
}

func (r *MemorySeedanceAssetRepository) UpdateAsset(asset model.SeedanceAsset) (model.SeedanceAsset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	existing, ok := r.assets[asset.ID]
	if !ok {
		return model.SeedanceAsset{}, ErrSeedanceAssetNotFound
	}
	asset.CreatedAt = existing.CreatedAt
	asset.UpdatedAt = time.Now().UTC()
	r.assets[asset.ID] = asset
	return r.attachTagsLocked(asset), nil
}

func (r *MemorySeedanceAssetRepository) DeleteAsset(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.assets[id]; !ok {
		return ErrSeedanceAssetNotFound
	}
	delete(r.assets, id)
	delete(r.bindings, id)
	return nil
}

func (r *MemorySeedanceAssetRepository) ListTags() ([]model.SeedanceAssetTag, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	tags := make([]model.SeedanceAssetTag, 0, len(r.tags))
	for _, tag := range r.tags {
		tags = append(tags, tag)
	}
	sort.Slice(tags, func(i, j int) bool {
		return strings.ToLower(tags[i].Name) < strings.ToLower(tags[j].Name)
	})
	return tags, nil
}

func (r *MemorySeedanceAssetRepository) GetTag(id string) (model.SeedanceAssetTag, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	tag, ok := r.tags[id]
	if !ok {
		return model.SeedanceAssetTag{}, ErrSeedanceAssetTagNotFound
	}
	return tag, nil
}

func (r *MemorySeedanceAssetRepository) UpsertTag(tag model.SeedanceAssetTag) (model.SeedanceAssetTag, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UTC()
	for id, existing := range r.tags {
		if strings.EqualFold(existing.Name, tag.Name) && existing.Scope == tag.Scope && id != tag.ID {
			tag.ID = id
			tag.CreatedAt = existing.CreatedAt
			break
		}
	}
	if existing, ok := r.tags[tag.ID]; ok && !existing.CreatedAt.IsZero() {
		tag.CreatedAt = existing.CreatedAt
	}
	if tag.CreatedAt.IsZero() {
		tag.CreatedAt = now
	}
	tag.UpdatedAt = now
	r.tags[tag.ID] = tag
	return tag, nil
}

func (r *MemorySeedanceAssetRepository) DeleteTag(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.tags[id]; !ok {
		return ErrSeedanceAssetTagNotFound
	}
	delete(r.tags, id)
	for assetID := range r.bindings {
		delete(r.bindings[assetID], id)
	}
	return nil
}

func (r *MemorySeedanceAssetRepository) AddTag(assetID string, tagID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.assets[assetID]; !ok {
		return ErrSeedanceAssetNotFound
	}
	if _, ok := r.tags[tagID]; !ok {
		return ErrSeedanceAssetTagNotFound
	}
	if r.bindings[assetID] == nil {
		r.bindings[assetID] = make(map[string]bool)
	}
	r.bindings[assetID][tagID] = true
	return nil
}

func (r *MemorySeedanceAssetRepository) RemoveTag(assetID string, tagID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.assets[assetID]; !ok {
		return ErrSeedanceAssetNotFound
	}
	delete(r.bindings[assetID], tagID)
	return nil
}

func (r *MemorySeedanceAssetRepository) SetAssetTags(assetID string, tagIDs []string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.assets[assetID]; !ok {
		return ErrSeedanceAssetNotFound
	}
	next := make(map[string]bool)
	for _, tagID := range uniqueNonEmptyRepositoryStrings(tagIDs) {
		if _, ok := r.tags[tagID]; !ok {
			return ErrSeedanceAssetTagNotFound
		}
		next[tagID] = true
	}
	r.bindings[assetID] = next
	return nil
}

func (r *MemorySeedanceAssetRepository) attachTagsLocked(asset model.SeedanceAsset) model.SeedanceAsset {
	tags := make([]model.SeedanceAssetTag, 0)
	for tagID := range r.bindings[asset.ID] {
		if tag, ok := r.tags[tagID]; ok {
			tags = append(tags, tag)
		}
	}
	sort.Slice(tags, func(i, j int) bool {
		return strings.ToLower(tags[i].Name) < strings.ToLower(tags[j].Name)
	})
	asset.Tags = tags
	return asset
}

type GormSeedanceAssetRepository struct {
	db *gorm.DB
}

func NewGormSeedanceAssetRepository(db *gorm.DB) *GormSeedanceAssetRepository {
	return &GormSeedanceAssetRepository{db: db}
}

func (r *GormSeedanceAssetRepository) GetGroupByProvider(providerID string) (model.SeedanceAssetGroup, error) {
	var group model.SeedanceAssetGroup
	if err := r.db.First(&group, "provider_id = ?", providerID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.SeedanceAssetGroup{}, ErrSeedanceAssetNotFound
		}
		return model.SeedanceAssetGroup{}, err
	}
	return group, nil
}

func (r *GormSeedanceAssetRepository) UpsertGroup(group model.SeedanceAssetGroup) (model.SeedanceAssetGroup, error) {
	var existing model.SeedanceAssetGroup
	err := r.db.First(&existing, "provider_id = ? OR volcano_group_id = ?", group.ProviderID, group.VolcanoGroupID).Error
	now := time.Now().UTC()
	if err == nil {
		group.ID = existing.ID
		group.CreatedAt = existing.CreatedAt
		group.UpdatedAt = now
		return group, r.db.Save(&group).Error
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return model.SeedanceAssetGroup{}, err
	}
	group.CreatedAt = now
	group.UpdatedAt = now
	return group, r.db.Create(&group).Error
}

func (r *GormSeedanceAssetRepository) ListAssets(filter SeedanceAssetFilter) ([]model.SeedanceAsset, int64, error) {
	query := r.db.Model(&model.SeedanceAsset{})
	query = applySeedanceAssetGormFilter(query, filter)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	find := applySeedanceAssetGormFilter(r.db.Preload("Tags").Order("created_at DESC"), filter)
	if filter.Limit > 0 {
		find = find.Limit(filter.Limit)
	}
	if filter.Offset > 0 {
		find = find.Offset(filter.Offset)
	}
	var assets []model.SeedanceAsset
	if err := find.Find(&assets).Error; err != nil {
		return nil, 0, err
	}
	return assets, total, nil
}

func (r *GormSeedanceAssetRepository) ListPendingAssets(limit int) ([]model.SeedanceAsset, error) {
	var assets []model.SeedanceAsset
	query := r.db.Preload("Tags").Where("status IN ?", []string{model.SeedanceAssetStatusQueued, model.SeedanceAssetStatusCreating, model.SeedanceAssetStatusProcessing}).Order("updated_at ASC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Find(&assets).Error; err != nil {
		return nil, err
	}
	return assets, nil
}

func (r *GormSeedanceAssetRepository) GetAsset(id string) (model.SeedanceAsset, error) {
	var asset model.SeedanceAsset
	if err := r.db.Preload("Tags").First(&asset, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.SeedanceAsset{}, ErrSeedanceAssetNotFound
		}
		return model.SeedanceAsset{}, err
	}
	return asset, nil
}

func (r *GormSeedanceAssetRepository) GetAssetByVolcanoID(volcanoAssetID string) (model.SeedanceAsset, error) {
	var asset model.SeedanceAsset
	if err := r.db.Preload("Tags").First(&asset, "volcano_asset_id = ?", volcanoAssetID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.SeedanceAsset{}, ErrSeedanceAssetNotFound
		}
		return model.SeedanceAsset{}, err
	}
	return asset, nil
}

func (r *GormSeedanceAssetRepository) UpsertAsset(asset model.SeedanceAsset) (model.SeedanceAsset, error) {
	var existing model.SeedanceAsset
	err := r.db.First(&existing, "volcano_asset_id = ?", asset.VolcanoAssetID).Error
	now := time.Now().UTC()
	if err == nil {
		asset.ID = existing.ID
		asset.CreatedAt = existing.CreatedAt
		asset.UpdatedAt = now
		if err := r.db.Omit("Tags").Save(&asset).Error; err != nil {
			return model.SeedanceAsset{}, err
		}
		return r.GetAsset(asset.ID)
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return model.SeedanceAsset{}, err
	}
	asset.CreatedAt = now
	asset.UpdatedAt = now
	if err := r.db.Omit("Tags").Create(&asset).Error; err != nil {
		return model.SeedanceAsset{}, err
	}
	return r.GetAsset(asset.ID)
}

func (r *GormSeedanceAssetRepository) UpdateAsset(asset model.SeedanceAsset) (model.SeedanceAsset, error) {
	existing, err := r.GetAsset(asset.ID)
	if err != nil {
		return model.SeedanceAsset{}, err
	}
	asset.CreatedAt = existing.CreatedAt
	asset.UpdatedAt = time.Now().UTC()
	if err := r.db.Omit("Tags").Save(&asset).Error; err != nil {
		return model.SeedanceAsset{}, err
	}
	return r.GetAsset(asset.ID)
}

func (r *GormSeedanceAssetRepository) DeleteAsset(id string) error {
	if err := r.db.Where("asset_id = ?", id).Delete(&model.SeedanceAssetTagBinding{}).Error; err != nil {
		return err
	}
	result := r.db.Delete(&model.SeedanceAsset{}, "id = ?", id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrSeedanceAssetNotFound
	}
	return nil
}

func (r *GormSeedanceAssetRepository) ListTags() ([]model.SeedanceAssetTag, error) {
	var tags []model.SeedanceAssetTag
	if err := r.db.Where("scope = ?", model.SeedanceAssetTagScope).Order("name ASC").Find(&tags).Error; err != nil {
		return nil, err
	}
	return tags, nil
}

func (r *GormSeedanceAssetRepository) GetTag(id string) (model.SeedanceAssetTag, error) {
	var tag model.SeedanceAssetTag
	if err := r.db.First(&tag, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.SeedanceAssetTag{}, ErrSeedanceAssetTagNotFound
		}
		return model.SeedanceAssetTag{}, err
	}
	return tag, nil
}

func (r *GormSeedanceAssetRepository) UpsertTag(tag model.SeedanceAssetTag) (model.SeedanceAssetTag, error) {
	var existing model.SeedanceAssetTag
	err := r.db.First(&existing, "LOWER(name) = LOWER(?) AND scope = ?", tag.Name, tag.Scope).Error
	now := time.Now().UTC()
	if err == nil {
		tag.ID = existing.ID
		tag.CreatedAt = existing.CreatedAt
		tag.UpdatedAt = now
		return tag, r.db.Save(&tag).Error
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return model.SeedanceAssetTag{}, err
	}
	tag.CreatedAt = now
	tag.UpdatedAt = now
	return tag, r.db.Create(&tag).Error
}

func (r *GormSeedanceAssetRepository) DeleteTag(id string) error {
	if err := r.db.Where("tag_id = ?", id).Delete(&model.SeedanceAssetTagBinding{}).Error; err != nil {
		return err
	}
	result := r.db.Delete(&model.SeedanceAssetTag{}, "id = ?", id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrSeedanceAssetTagNotFound
	}
	return nil
}

func (r *GormSeedanceAssetRepository) AddTag(assetID string, tagID string) error {
	if _, err := r.GetAsset(assetID); err != nil {
		return err
	}
	if _, err := r.GetTag(tagID); err != nil {
		return err
	}
	binding := model.SeedanceAssetTagBinding{
		ID:        "satb_" + randomRepositoryHex(12),
		AssetID:   assetID,
		TagID:     tagID,
		CreatedAt: time.Now().UTC(),
	}
	return r.db.Where("asset_id = ? AND tag_id = ?", assetID, tagID).FirstOrCreate(&binding).Error
}

func (r *GormSeedanceAssetRepository) RemoveTag(assetID string, tagID string) error {
	if _, err := r.GetAsset(assetID); err != nil {
		return err
	}
	return r.db.Where("asset_id = ? AND tag_id = ?", assetID, tagID).Delete(&model.SeedanceAssetTagBinding{}).Error
}

func (r *GormSeedanceAssetRepository) SetAssetTags(assetID string, tagIDs []string) error {
	if _, err := r.GetAsset(assetID); err != nil {
		return err
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("asset_id = ?", assetID).Delete(&model.SeedanceAssetTagBinding{}).Error; err != nil {
			return err
		}
		for _, tagID := range uniqueNonEmptyRepositoryStrings(tagIDs) {
			var tag model.SeedanceAssetTag
			if err := tx.First(&tag, "id = ?", tagID).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrSeedanceAssetTagNotFound
				}
				return err
			}
			binding := model.SeedanceAssetTagBinding{
				ID:        "satb_" + randomRepositoryHex(12),
				AssetID:   assetID,
				TagID:     tagID,
				CreatedAt: time.Now().UTC(),
			}
			if err := tx.Create(&binding).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func applySeedanceAssetGormFilter(query *gorm.DB, filter SeedanceAssetFilter) *gorm.DB {
	if filter.ActiveOnly {
		query = query.Where("status = ?", model.SeedanceAssetStatusActive)
	}
	if strings.TrimSpace(filter.Status) != "" {
		query = query.Where("status = ?", strings.TrimSpace(filter.Status))
	}
	if strings.TrimSpace(filter.Type) != "" {
		query = query.Where("asset_type = ?", strings.TrimSpace(filter.Type))
	}
	if strings.TrimSpace(filter.Search) != "" {
		pattern := "%" + strings.ToLower(strings.TrimSpace(filter.Search)) + "%"
		query = query.Where("LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(volcano_asset_id) LIKE ?", pattern, pattern, pattern)
	}
	if strings.TrimSpace(filter.TagID) != "" {
		query = query.Joins("JOIN seedance_asset_tag_bindings ON seedance_asset_tag_bindings.asset_id = seedance_assets.id").Where("seedance_asset_tag_bindings.tag_id = ?", strings.TrimSpace(filter.TagID))
	}
	return query
}

func seedanceAssetMatches(asset model.SeedanceAsset, filter SeedanceAssetFilter, bindings map[string]map[string]bool) bool {
	if filter.ActiveOnly && asset.Status != model.SeedanceAssetStatusActive {
		return false
	}
	if strings.TrimSpace(filter.Status) != "" && asset.Status != strings.TrimSpace(filter.Status) {
		return false
	}
	if strings.TrimSpace(filter.Type) != "" && asset.AssetType != strings.TrimSpace(filter.Type) {
		return false
	}
	if strings.TrimSpace(filter.TagID) != "" && !bindings[asset.ID][strings.TrimSpace(filter.TagID)] {
		return false
	}
	if strings.TrimSpace(filter.Search) != "" {
		needle := strings.ToLower(strings.TrimSpace(filter.Search))
		source := strings.ToLower(asset.Name + " " + asset.Description + " " + asset.VolcanoAssetID)
		if !strings.Contains(source, needle) {
			return false
		}
	}
	return true
}

func isPendingSeedanceAssetStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case model.SeedanceAssetStatusQueued, model.SeedanceAssetStatusCreating, model.SeedanceAssetStatusProcessing:
		return true
	default:
		return false
	}
}

func paginateSeedanceAssets(items []model.SeedanceAsset, limit int, offset int) []model.SeedanceAsset {
	if offset < 0 {
		offset = 0
	}
	if offset >= len(items) {
		return []model.SeedanceAsset{}
	}
	items = items[offset:]
	if limit <= 0 || limit >= len(items) {
		return append([]model.SeedanceAsset{}, items...)
	}
	return append([]model.SeedanceAsset{}, items[:limit]...)
}

func uniqueNonEmptyRepositoryStrings(values []string) []string {
	seen := make(map[string]bool)
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}
