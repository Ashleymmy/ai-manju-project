package repository

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type GormTagRepository struct {
	db *gorm.DB
}

func NewGormTagRepository(db *gorm.DB) *GormTagRepository {
	return &GormTagRepository{db: db}
}

func (r *GormTagRepository) List(scopeKeys []string) ([]model.Tag, error) {
	var tags []model.Tag
	err := r.db.Where("scope_key IN ?", uniqueStrings(scopeKeys)).Order("sort_order ASC, name ASC, id ASC").Find(&tags).Error
	return tags, err
}

func (r *GormTagRepository) Get(id string, scopeKeys []string) (model.Tag, error) {
	var tag model.Tag
	err := r.db.First(&tag, "id = ? AND scope_key IN ?", id, uniqueStrings(scopeKeys)).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.Tag{}, ErrTagNotFound
	}
	return tag, err
}

func (r *GormTagRepository) Create(tag model.Tag, maxDepth int) (model.Tag, error) {
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if tag.ParentID != "" {
			var parent model.Tag
			if err := tx.First(&parent, "id = ? AND scope_key = ? AND scope_type = ?", tag.ParentID, tag.ScopeKey, tag.ScopeType).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrTagNotFound
				}
				return err
			}
		}
		now := time.Now().UTC()
		tag.CreatedAt, tag.UpdatedAt = now, now
		if err := tx.Create(&tag).Error; err != nil {
			return mapTagConflict(err)
		}
		return rebuildGormTagClosures(tx, tag.ScopeKey, maxDepth)
	})
	return tag, err
}

func (r *GormTagRepository) Update(tag model.Tag, scopeKey string) (model.Tag, error) {
	current, err := r.Get(tag.ID, []string{scopeKey})
	if err != nil {
		return model.Tag{}, err
	}
	tag.ScopeType, tag.ScopeKey, tag.CreatedBy = current.ScopeType, current.ScopeKey, current.CreatedBy
	tag.ParentID, tag.CreatedAt, tag.UpdatedAt = current.ParentID, current.CreatedAt, time.Now().UTC()
	if err := r.db.Save(&tag).Error; err != nil {
		return model.Tag{}, mapTagConflict(err)
	}
	return tag, nil
}

func (r *GormTagRepository) Move(id string, parentID string, sortOrder int, scopeKey string, maxDepth int) (model.Tag, error) {
	var moved model.Tag
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&moved, "id = ? AND scope_key = ?", id, scopeKey).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrTagNotFound
			}
			return err
		}
		if parentID == moved.ID {
			return ErrTagCycle
		}
		if parentID != "" {
			var parent model.Tag
			if err := tx.First(&parent, "id = ? AND scope_key = ? AND scope_type = ?", parentID, moved.ScopeKey, moved.ScopeType).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrTagNotFound
				}
				return err
			}
		}
		moved.ParentID, moved.SortOrder, moved.UpdatedAt = parentID, sortOrder, time.Now().UTC()
		if err := tx.Save(&moved).Error; err != nil {
			return mapTagConflict(err)
		}
		return rebuildGormTagClosures(tx, scopeKey, maxDepth)
	})
	return moved, err
}

func (r *GormTagRepository) BulkMove(ids []string, parentID string, sortOrder int, scopeKey string, maxDepth int) ([]model.Tag, error) {
	ids = uniqueStrings(ids)
	if len(ids) == 0 {
		return nil, ErrTagNotFound
	}
	moved := make([]model.Tag, 0, len(ids))
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var tags []model.Tag
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id IN ? AND scope_key = ?", ids, scopeKey).Find(&tags).Error; err != nil {
			return err
		}
		if len(tags) != len(ids) {
			return ErrTagNotFound
		}
		byID := make(map[string]model.Tag, len(tags))
		for _, tag := range tags {
			byID[tag.ID] = tag
		}
		var parent model.Tag
		if parentID != "" {
			if err := tx.First(&parent, "id = ? AND scope_key = ?", parentID, scopeKey).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrTagNotFound
				}
				return err
			}
		}
		now := time.Now().UTC()
		for index, id := range ids {
			tag := byID[id]
			if parentID == tag.ID {
				return ErrTagCycle
			}
			if parentID != "" && parent.ScopeType != tag.ScopeType {
				return ErrTagNotFound
			}
			tag.ParentID, tag.SortOrder, tag.UpdatedAt = parentID, sortOrder+index, now
			if err := tx.Save(&tag).Error; err != nil {
				return mapTagConflict(err)
			}
			moved = append(moved, tag)
		}
		return rebuildGormTagClosures(tx, scopeKey, maxDepth)
	})
	return moved, err
}

func (r *GormTagRepository) ArchiveSubtrees(ids []string, scopeKey string) ([]model.Tag, error) {
	ids = uniqueStrings(ids)
	if len(ids) == 0 {
		return nil, ErrTagNotFound
	}
	archived := []model.Tag{}
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var roots []model.Tag
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id IN ? AND scope_key = ?", ids, scopeKey).Find(&roots).Error; err != nil {
			return err
		}
		if len(roots) != len(ids) {
			return ErrTagNotFound
		}
		var affectedIDs []string
		if err := tx.Model(&model.TagClosure{}).Distinct("descendant_id").Where("ancestor_id IN ?", ids).Pluck("descendant_id", &affectedIDs).Error; err != nil {
			return err
		}
		if len(affectedIDs) == 0 {
			affectedIDs = ids
		}
		now := time.Now().UTC()
		if err := tx.Model(&model.Tag{}).Where("id IN ? AND scope_key = ?", affectedIDs, scopeKey).Updates(map[string]any{"status": model.TagStatusArchived, "updated_at": now}).Error; err != nil {
			return err
		}
		var assetIDs []string
		if err := tx.Model(&model.AssetTagBinding{}).Distinct("asset_id").Where("tag_id IN ?", affectedIDs).Pluck("asset_id", &assetIDs).Error; err != nil {
			return err
		}
		for _, assetID := range assetIDs {
			if err := syncGormAssetTagMirror(tx, assetID, now); err != nil {
				return err
			}
		}
		return tx.Where("id IN ? AND scope_key = ?", affectedIDs, scopeKey).Order("sort_order ASC, name ASC, id ASC").Find(&archived).Error
	})
	return archived, err
}

func (r *GormTagRepository) ListAliases(tagIDs []string) ([]model.TagAlias, error) {
	if len(uniqueStrings(tagIDs)) == 0 {
		return []model.TagAlias{}, nil
	}
	var aliases []model.TagAlias
	err := r.db.Where("tag_id IN ?", uniqueStrings(tagIDs)).Order("alias ASC, id ASC").Find(&aliases).Error
	return aliases, err
}

func (r *GormTagRepository) CreateAlias(alias model.TagAlias, scopeKey string) (model.TagAlias, error) {
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var tag model.Tag
		if err := tx.First(&tag, "id = ? AND scope_key = ?", alias.TagID, scopeKey).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrTagNotFound
			}
			return err
		}
		var collisions int64
		if err := tx.Model(&model.Tag{}).Where("scope_key = ? AND normalized_name = ?", scopeKey, alias.NormalizedAlias).Count(&collisions).Error; err != nil {
			return err
		}
		if collisions == 0 {
			err := tx.Table("tag_aliases AS a").Joins("JOIN tags AS t ON t.id = a.tag_id").Where("t.scope_key = ? AND a.normalized_alias = ?", scopeKey, alias.NormalizedAlias).Count(&collisions).Error
			if err != nil {
				return err
			}
		}
		if collisions > 0 {
			return ErrTagConflict
		}
		now := time.Now().UTC()
		alias.CreatedAt, alias.UpdatedAt = now, now
		return mapTagConflict(tx.Create(&alias).Error)
	})
	return alias, err
}

func (r *GormTagRepository) DeleteAlias(tagID string, aliasID string, scopeKey string) error {
	var count int64
	if err := r.db.Model(&model.Tag{}).Where("id = ? AND scope_key = ?", tagID, scopeKey).Count(&count).Error; err != nil {
		return err
	}
	if count != 1 {
		return ErrTagNotFound
	}
	result := r.db.Where("id = ? AND tag_id = ?", aliasID, tagID).Delete(&model.TagAlias{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrTagAliasNotFound
	}
	return nil
}

func (r *GormTagRepository) DescendantIDs(tagID string, scopeKeys []string, includeSelf bool) ([]string, error) {
	if _, err := r.Get(tagID, scopeKeys); err != nil {
		return nil, err
	}
	query := r.db.Model(&model.TagClosure{}).Where("ancestor_id = ?", tagID)
	if !includeSelf {
		query = query.Where("depth > 0")
	}
	var ids []string
	err := query.Order("depth ASC, descendant_id ASC").Pluck("descendant_id", &ids).Error
	return ids, err
}

func (r *GormTagRepository) Counts(tagIDs []string) (map[string]TagCounts, error) {
	ids := uniqueStrings(tagIDs)
	counts := make(map[string]TagCounts, len(ids))
	for _, id := range ids {
		counts[id] = TagCounts{}
	}
	if len(ids) == 0 {
		return counts, nil
	}
	type row struct {
		TagID string
		Count int64
	}
	var assetRows []row
	if err := r.db.Model(&model.AssetTagBinding{}).Select("tag_id, COUNT(*) AS count").Where("tag_id IN ? AND state = ?", ids, model.AssetTagBindingActive).Group("tag_id").Scan(&assetRows).Error; err != nil {
		return nil, err
	}
	for _, item := range assetRows {
		count := counts[item.TagID]
		count.AssetCount = item.Count
		counts[item.TagID] = count
	}
	var promptRows []row
	if err := r.db.Model(&model.PromptTagBinding{}).Select("tag_id, COUNT(*) AS count").Where("tag_id IN ?", ids).Group("tag_id").Scan(&promptRows).Error; err != nil {
		return nil, err
	}
	for _, item := range promptRows {
		count := counts[item.TagID]
		count.PromptCount = item.Count
		counts[item.TagID] = count
	}
	return counts, nil
}

func (r *GormTagRepository) BindAssets(workspaceID string, userID string, assetIDs []string, tagIDs []string, originType string) ([]model.AssetTagBinding, error) {
	result := make([]model.AssetTagBinding, 0)
	err := r.db.Transaction(func(tx *gorm.DB) error {
		assets, tags, err := validateGormAssetBindings(tx, workspaceID, assetIDs, tagIDs)
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		for _, asset := range assets {
			for _, tag := range tags {
				binding, bindErr := upsertGormAssetBinding(tx, workspaceID, userID, asset.ID, tag.ID, originType, now)
				if bindErr != nil {
					return bindErr
				}
				result = append(result, binding)
			}
			if err := syncGormAssetTagMirror(tx, asset.ID, now); err != nil {
				return err
			}
		}
		return nil
	})
	return result, err
}

func (r *GormTagRepository) RemoveAssetTags(workspaceID string, assetIDs []string, tagIDs []string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		assets, err := validateGormAssets(tx, workspaceID, assetIDs)
		if err != nil {
			return err
		}
		var tags []model.Tag
		if err := tx.Where("id IN ?", uniqueStrings(tagIDs)).Find(&tags).Error; err != nil {
			return err
		}
		if len(tags) != len(uniqueStrings(tagIDs)) {
			return ErrTagNotFound
		}
		for _, tag := range tags {
			if !tagAvailableToAsset(tag, workspaceID) {
				return ErrTagNotFound
			}
		}
		now := time.Now().UTC()
		if err := tx.Model(&model.AssetTagBinding{}).Where("workspace_id = ? AND asset_id IN ? AND tag_id IN ?", workspaceID, uniqueStrings(assetIDs), uniqueStrings(tagIDs)).Updates(map[string]any{"state": model.AssetTagBindingSuppressed, "updated_at": now}).Error; err != nil {
			return err
		}
		for _, asset := range assets {
			if err := syncGormAssetTagMirror(tx, asset.ID, now); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *GormTagRepository) ReplaceAssetDirectTags(workspaceID string, userID string, assetID string, tagIDs []string, originType string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		assets, err := validateGormAssets(tx, workspaceID, []string{assetID})
		if err != nil {
			return err
		}
		tags := []model.Tag{}
		if len(uniqueStrings(tagIDs)) > 0 {
			_, tags, err = validateGormAssetBindings(tx, workspaceID, []string{assetID}, tagIDs)
			if err != nil {
				return err
			}
		}
		wanted := uniqueStrings(tagIDs)
		var directBindingIDs []string
		if err := tx.Model(&model.AssetTagOrigin{}).Distinct("binding_id").Where("origin_type IN ?", []string{model.AssetTagOriginDirect, model.AssetTagOriginMigrated}).Pluck("binding_id", &directBindingIDs).Error; err != nil {
			return err
		}
		now := time.Now().UTC()
		if len(directBindingIDs) > 0 {
			query := tx.Model(&model.AssetTagBinding{}).Where("id IN ? AND workspace_id = ? AND asset_id = ?", directBindingIDs, workspaceID, assetID)
			if len(wanted) > 0 {
				query = query.Where("tag_id NOT IN ?", wanted)
			}
			if err := query.Updates(map[string]any{"state": model.AssetTagBindingSuppressed, "updated_at": now}).Error; err != nil {
				return err
			}
		}
		for _, tag := range tags {
			if _, err := upsertGormAssetBinding(tx, workspaceID, userID, assetID, tag.ID, originType, now); err != nil {
				return err
			}
		}
		return syncGormAssetTagMirror(tx, assets[0].ID, now)
	})
}

func (r *GormTagRepository) RefreshTagMirrors(tagID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&model.Tag{}).Where("id = ?", tagID).Count(&count).Error; err != nil {
			return err
		}
		if count != 1 {
			return ErrTagNotFound
		}
		var assetIDs []string
		if err := tx.Model(&model.AssetTagBinding{}).Distinct("asset_id").Where("tag_id = ?", tagID).Pluck("asset_id", &assetIDs).Error; err != nil {
			return err
		}
		now := time.Now().UTC()
		for _, assetID := range assetIDs {
			if err := syncGormAssetTagMirror(tx, assetID, now); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *GormTagRepository) ResyncInheritedAssetTags(workspaceID string, userID string, childAssetID string, parentAssetIDs []string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		parents := uniqueStrings(parentAssetIDs)
		allAssetIDs := append([]string{childAssetID}, parents...)
		if _, err := validateGormAssets(tx, workspaceID, allAssetIDs); err != nil {
			return err
		}
		for _, parentID := range parents {
			if parentID == childAssetID {
				return ErrAssetNotFound
			}
		}
		type inheritedSource struct {
			TagID         string
			SourceAssetID string
		}
		var sources []inheritedSource
		if len(parents) > 0 {
			err := tx.Table("asset_tag_bindings AS b").Select("b.tag_id, b.asset_id AS source_asset_id").Joins("JOIN tags AS t ON t.id = b.tag_id").Where("b.workspace_id = ? AND b.asset_id IN ? AND b.state = ? AND t.asset_enabled = ? AND t.status = ? AND t.inherit_mode = ?", workspaceID, parents, model.AssetTagBindingActive, true, model.TagStatusActive, model.TagInheritAuto).Scan(&sources).Error
			if err != nil {
				return err
			}
		}
		var childBindings []model.AssetTagBinding
		if err := tx.Where("workspace_id = ? AND asset_id = ?", workspaceID, childAssetID).Find(&childBindings).Error; err != nil {
			return err
		}
		bindingIDs := make([]string, 0, len(childBindings))
		bindingByTag := map[string]model.AssetTagBinding{}
		for _, binding := range childBindings {
			bindingIDs = append(bindingIDs, binding.ID)
			bindingByTag[binding.TagID] = binding
		}
		bindingsWithInherited := map[string]bool{}
		if len(bindingIDs) > 0 {
			var inheritedOrigins []model.AssetTagOrigin
			if err := tx.Where("binding_id IN ? AND origin_type = ?", bindingIDs, model.AssetTagOriginInherited).Find(&inheritedOrigins).Error; err != nil {
				return err
			}
			for _, origin := range inheritedOrigins {
				bindingsWithInherited[origin.BindingID] = true
			}
			if err := tx.Where("binding_id IN ? AND origin_type = ?", bindingIDs, model.AssetTagOriginInherited).Delete(&model.AssetTagOrigin{}).Error; err != nil {
				return err
			}
		}
		for _, binding := range childBindings {
			if !bindingsWithInherited[binding.ID] || binding.State == model.AssetTagBindingSuppressed {
				continue
			}
			var remaining int64
			if err := tx.Model(&model.AssetTagOrigin{}).Where("binding_id = ?", binding.ID).Count(&remaining).Error; err != nil {
				return err
			}
			if remaining == 0 {
				if err := tx.Delete(&model.AssetTagBinding{}, "id = ?", binding.ID).Error; err != nil {
					return err
				}
				delete(bindingByTag, binding.TagID)
			}
		}
		now := time.Now().UTC()
		for _, source := range sources {
			binding, exists := bindingByTag[source.TagID]
			if !exists {
				binding = model.AssetTagBinding{ID: "asset_tag_" + randomRepositoryHex(12), WorkspaceID: workspaceID, AssetID: childAssetID, TagID: source.TagID, State: model.AssetTagBindingActive, CreatedBy: userID, CreatedAt: now, UpdatedAt: now}
				if err := tx.Create(&binding).Error; err != nil {
					return err
				}
				bindingByTag[source.TagID] = binding
			}
			origin := model.AssetTagOrigin{ID: "asset_tag_origin_" + randomRepositoryHex(12), BindingID: binding.ID, OriginType: model.AssetTagOriginInherited, SourceAssetID: source.SourceAssetID, CreatedAt: now, UpdatedAt: now}
			if err := tx.Create(&origin).Error; err != nil {
				return err
			}
		}
		return syncGormAssetTagMirror(tx, childAssetID, now)
	})
}

func (r *GormTagRepository) ListAssetIDs(workspaceID string, tagIDs []string, matchAll bool) ([]string, error) {
	ids := uniqueStrings(tagIDs)
	if len(ids) == 0 {
		return []string{}, nil
	}
	query := r.db.Model(&model.AssetTagBinding{}).Select("asset_id").Where("workspace_id = ? AND state = ? AND tag_id IN ?", workspaceID, model.AssetTagBindingActive, ids).Group("asset_id")
	if matchAll {
		query = query.Having("COUNT(DISTINCT tag_id) = ?", len(ids))
	}
	var assetIDs []string
	err := query.Order("asset_id ASC").Pluck("asset_id", &assetIDs).Error
	return assetIDs, err
}

func (r *GormTagRepository) ListAssetTagDetails(workspaceID string, assetIDs []string, scopeKeys []string) ([]AssetTagBindingDetail, error) {
	ids := uniqueStrings(assetIDs)
	if len(ids) == 0 {
		return []AssetTagBindingDetail{}, nil
	}
	var bindings []model.AssetTagBinding
	if err := r.db.Where("workspace_id = ? AND asset_id IN ?", workspaceID, ids).Find(&bindings).Error; err != nil {
		return nil, err
	}
	tagIDs := make([]string, 0, len(bindings))
	bindingIDs := make([]string, 0, len(bindings))
	for _, binding := range bindings {
		tagIDs = append(tagIDs, binding.TagID)
		bindingIDs = append(bindingIDs, binding.ID)
	}
	var tags []model.Tag
	if len(tagIDs) > 0 {
		if err := r.db.Where("id IN ? AND scope_key IN ?", uniqueStrings(tagIDs), uniqueStrings(scopeKeys)).Find(&tags).Error; err != nil {
			return nil, err
		}
	}
	var origins []model.AssetTagOrigin
	if len(bindingIDs) > 0 {
		if err := r.db.Where("binding_id IN ?", uniqueStrings(bindingIDs)).Find(&origins).Error; err != nil {
			return nil, err
		}
	}
	tagsByID := map[string]model.Tag{}
	for _, tag := range tags {
		tagsByID[tag.ID] = tag
	}
	originsByBinding := map[string][]model.AssetTagOrigin{}
	for _, origin := range origins {
		originsByBinding[origin.BindingID] = append(originsByBinding[origin.BindingID], origin)
	}
	details := make([]AssetTagBindingDetail, 0, len(bindings))
	for _, binding := range bindings {
		tag, visible := tagsByID[binding.TagID]
		if !visible {
			continue
		}
		details = append(details, AssetTagBindingDetail{Binding: binding, Tag: tag, Origins: originsByBinding[binding.ID]})
	}
	sort.Slice(details, func(i, j int) bool {
		if details[i].Binding.AssetID != details[j].Binding.AssetID {
			return details[i].Binding.AssetID < details[j].Binding.AssetID
		}
		if details[i].Tag.Name != details[j].Tag.Name {
			return details[i].Tag.Name < details[j].Tag.Name
		}
		return details[i].Binding.ID < details[j].Binding.ID
	})
	return details, nil
}

func (r *GormTagRepository) ListPromptIDs(tagIDs []string) ([]string, error) {
	ids := uniqueStrings(tagIDs)
	if len(ids) == 0 {
		return []string{}, nil
	}
	var promptIDs []string
	err := r.db.Model(&model.PromptTagBinding{}).Distinct("prompt_id").Where("tag_id IN ?", ids).Order("prompt_id ASC").Pluck("prompt_id", &promptIDs).Error
	return promptIDs, err
}

func rebuildGormTagClosures(tx *gorm.DB, scopeKey string, maxDepth int) error {
	var tags []model.Tag
	if err := tx.Where("scope_key = ?", scopeKey).Find(&tags).Error; err != nil {
		return err
	}
	closures, err := buildTagClosures(tags, maxDepth)
	if err != nil {
		return err
	}
	ids := make([]string, 0, len(tags))
	for _, tag := range tags {
		ids = append(ids, tag.ID)
	}
	if len(ids) > 0 {
		if err := tx.Where("descendant_id IN ?", ids).Delete(&model.TagClosure{}).Error; err != nil {
			return err
		}
	}
	if len(closures) > 0 {
		return tx.CreateInBatches(closures, 500).Error
	}
	return nil
}

func validateGormAssetBindings(tx *gorm.DB, workspaceID string, assetIDs []string, tagIDs []string) ([]model.Asset, []model.Tag, error) {
	assetIDs, tagIDs = uniqueStrings(assetIDs), uniqueStrings(tagIDs)
	if len(assetIDs) == 0 || len(tagIDs) == 0 {
		return nil, nil, ErrTagNotFound
	}
	assets, err := validateGormAssets(tx, workspaceID, assetIDs)
	if err != nil {
		return nil, nil, err
	}
	var tags []model.Tag
	if err := tx.Where("id IN ? AND asset_enabled = ? AND status = ?", tagIDs, true, model.TagStatusActive).Find(&tags).Error; err != nil {
		return nil, nil, err
	}
	if len(tags) != len(tagIDs) {
		return nil, nil, ErrTagUsage
	}
	for _, tag := range tags {
		if !tagAvailableToAsset(tag, workspaceID) {
			return nil, nil, ErrTagUsage
		}
	}
	return assets, tags, nil
}

func validateGormAssets(tx *gorm.DB, workspaceID string, assetIDs []string) ([]model.Asset, error) {
	assetIDs = uniqueStrings(assetIDs)
	if len(assetIDs) == 0 {
		return nil, ErrAssetNotFound
	}
	var assets []model.Asset
	assetQuery := tx.Where("id IN ? AND trashed_at IS NULL", assetIDs)
	if strings.HasPrefix(workspaceID, "default:") {
		assetQuery = assetQuery.Where("workspace_id = ? OR (workspace_id = '' AND user_id = ?)", workspaceID, strings.TrimPrefix(workspaceID, "default:"))
	} else {
		assetQuery = assetQuery.Where("workspace_id = ?", workspaceID)
	}
	if err := assetQuery.Find(&assets).Error; err != nil {
		return nil, err
	}
	if len(assets) != len(assetIDs) {
		return nil, ErrAssetNotFound
	}
	return assets, nil
}

func upsertGormAssetBinding(tx *gorm.DB, workspaceID string, userID string, assetID string, tagID string, originType string, now time.Time) (model.AssetTagBinding, error) {
	seed := model.AssetTagBinding{ID: "asset_tag_" + randomRepositoryHex(12), WorkspaceID: workspaceID, AssetID: assetID, TagID: tagID, State: model.AssetTagBindingActive, CreatedBy: userID, CreatedAt: now, UpdatedAt: now}
	if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "asset_id"}, {Name: "tag_id"}}, DoUpdates: clause.Assignments(map[string]any{"state": model.AssetTagBindingActive, "updated_at": now})}).Create(&seed).Error; err != nil {
		return model.AssetTagBinding{}, err
	}
	var binding model.AssetTagBinding
	if err := tx.First(&binding, "asset_id = ? AND tag_id = ?", assetID, tagID).Error; err != nil {
		return model.AssetTagBinding{}, err
	}
	var count int64
	if err := tx.Model(&model.AssetTagOrigin{}).Where("binding_id = ? AND origin_type = ? AND source_asset_id = '' AND source_job_id = '' AND source_node_id = ''", binding.ID, originType).Count(&count).Error; err != nil {
		return model.AssetTagBinding{}, err
	}
	if count == 0 {
		origin := model.AssetTagOrigin{ID: "asset_tag_origin_" + randomRepositoryHex(12), BindingID: binding.ID, OriginType: originType, CreatedAt: now, UpdatedAt: now}
		if err := tx.Create(&origin).Error; err != nil {
			return model.AssetTagBinding{}, err
		}
	}
	return binding, nil
}

func syncGormAssetTagMirror(tx *gorm.DB, assetID string, now time.Time) error {
	var names []string
	err := tx.Table("tags AS t").Distinct("t.name").Joins("JOIN asset_tag_bindings AS b ON b.tag_id = t.id").Where("b.asset_id = ? AND b.state = ? AND t.status = ?", assetID, model.AssetTagBindingActive, model.TagStatusActive).Order("t.name ASC").Pluck("t.name", &names).Error
	if err != nil {
		return err
	}
	payload, err := json.Marshal(uniqueStringsFold(names))
	if err != nil {
		return err
	}
	return tx.Model(&model.Asset{}).Where("id = ?", assetID).Updates(map[string]any{"tags": model.JSONB(payload), "updated_at": now}).Error
}

func mapTagConflict(err error) error {
	if err == nil {
		return nil
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "duplicate key") || strings.Contains(message, "unique constraint") || strings.Contains(message, "unique failed") {
		return ErrTagConflict
	}
	return err
}

func sortedTagIDs(tags []model.Tag) []string {
	ids := make([]string, 0, len(tags))
	for _, tag := range tags {
		ids = append(ids, tag.ID)
	}
	sort.Strings(ids)
	return ids
}
