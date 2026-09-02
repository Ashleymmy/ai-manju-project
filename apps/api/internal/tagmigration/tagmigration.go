package tagmigration

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const legacyRootName = "历史标签"

type Result struct {
	ScannedAssets    int
	TaggedAssets     int
	Workspaces       int
	TagsToCreate     int
	BindingsToCreate int
	OriginsToCreate  int
	CreatedTags      int
	CreatedBindings  int
	CreatedOrigins   int
}

type legacyAsset struct {
	ID          string
	UserID      string
	WorkspaceID string
	Tags        model.JSONB
}

// Run backfills the relation tables from the legacy assets.tags JSONB array.
// The old column is intentionally retained as a compatibility mirror.
func Run(db *gorm.DB, dryRun bool) (Result, error) {
	var assets []legacyAsset
	if err := db.Model(&model.Asset{}).Select("id", "user_id", "workspace_id", "tags").Order("id ASC").Scan(&assets).Error; err != nil {
		return Result{}, err
	}
	result := Result{ScannedAssets: len(assets)}
	workspaceSeen := map[string]bool{}
	err := db.Transaction(func(tx *gorm.DB) error {
		rootCache := map[string]model.Tag{}
		tagCache := map[string]model.Tag{}
		for _, asset := range assets {
			names := decodeLegacyTags(asset.Tags)
			if len(names) == 0 {
				continue
			}
			result.TaggedAssets++
			workspaceID := strings.TrimSpace(asset.WorkspaceID)
			if workspaceID == "" {
				workspaceID = "default:" + asset.UserID
			}
			workspaceSeen[workspaceID] = true
			root, err := ensureLegacyTag(tx, rootCache, workspaceID, asset.UserID, "", legacyRootName, dryRun, &result)
			if err != nil {
				return err
			}
			for _, name := range names {
				cacheKey := workspaceID + "\x00" + normalize(name)
				tag, ok := tagCache[cacheKey]
				if !ok {
					tag, err = ensureLegacyTag(tx, tagCache, workspaceID, asset.UserID, root.ID, name, dryRun, &result)
					if err != nil {
						return err
					}
					tagCache[cacheKey] = tag
				}
				bindingID := deterministicID("asset_tag_", asset.ID, tag.ID)
				var existing model.AssetTagBinding
				findErr := tx.First(&existing, "asset_id = ? AND tag_id = ?", asset.ID, tag.ID).Error
				if findErr == nil {
					bindingID = existing.ID
				} else if findErr == gorm.ErrRecordNotFound {
					result.BindingsToCreate++
					if !dryRun {
						now := time.Now().UTC()
						binding := model.AssetTagBinding{ID: bindingID, WorkspaceID: workspaceID, AssetID: asset.ID, TagID: tag.ID, State: model.AssetTagBindingActive, CreatedBy: asset.UserID, CreatedAt: now, UpdatedAt: now}
						created := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&binding)
						if created.Error != nil {
							return created.Error
						}
						result.CreatedBindings += int(created.RowsAffected)
					}
				} else {
					return findErr
				}
				var origins int64
				if err := tx.Model(&model.AssetTagOrigin{}).Where("binding_id = ? AND origin_type = ? AND source_asset_id = '' AND source_job_id = '' AND source_node_id = ''", bindingID, model.AssetTagOriginMigrated).Count(&origins).Error; err != nil {
					return err
				}
				if origins == 0 {
					result.OriginsToCreate++
					if !dryRun {
						now := time.Now().UTC()
						origin := model.AssetTagOrigin{ID: deterministicID("asset_tag_origin_", bindingID, model.AssetTagOriginMigrated), BindingID: bindingID, OriginType: model.AssetTagOriginMigrated, CreatedAt: now, UpdatedAt: now}
						if err := tx.Create(&origin).Error; err != nil {
							return err
						}
						result.CreatedOrigins++
					}
				}
			}
		}
		if dryRun {
			return nil
		}
		return nil
	})
	result.Workspaces = len(workspaceSeen)
	return result, err
}

func ensureLegacyTag(tx *gorm.DB, cache map[string]model.Tag, workspaceID string, userID string, parentID string, name string, dryRun bool, result *Result) (model.Tag, error) {
	key := workspaceID + "\x00" + parentID + "\x00" + normalize(name)
	if cached, ok := cache[key]; ok {
		return cached, nil
	}
	var tag model.Tag
	err := tx.First(&tag, "scope_key = ? AND parent_id = ? AND normalized_name = ?", workspaceID, parentID, normalize(name)).Error
	if err == nil {
		cache[key] = tag
		return tag, nil
	}
	if err != gorm.ErrRecordNotFound {
		return model.Tag{}, err
	}
	result.TagsToCreate++
	now := time.Now().UTC()
	tag = model.Tag{
		ID: deterministicID("tag_", workspaceID, parentID, normalize(name)), ScopeType: model.TagScopeWorkspace, ScopeKey: workspaceID,
		CreatedBy: userID, ParentID: parentID, Name: strings.TrimSpace(name), NormalizedName: normalize(name), AssetEnabled: true,
		PromptEnabled: false, InheritMode: model.TagInheritAuto, Status: model.TagStatusActive, CreatedAt: now, UpdatedAt: now,
	}
	if parentID == "" {
		tag.SortOrder = 9000
	}
	if !dryRun {
		created := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&tag)
		if created.Error != nil {
			return model.Tag{}, created.Error
		}
		result.CreatedTags += int(created.RowsAffected)
		self := model.TagClosure{AncestorID: tag.ID, DescendantID: tag.ID, Depth: 0, CreatedAt: now, UpdatedAt: now}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&self).Error; err != nil {
			return model.Tag{}, err
		}
		if parentID != "" {
			var parentClosures []model.TagClosure
			if err := tx.Where("descendant_id = ?", parentID).Find(&parentClosures).Error; err != nil {
				return model.Tag{}, err
			}
			rows := make([]model.TagClosure, 0, len(parentClosures))
			for _, parentClosure := range parentClosures {
				rows = append(rows, model.TagClosure{AncestorID: parentClosure.AncestorID, DescendantID: tag.ID, Depth: parentClosure.Depth + 1, CreatedAt: now, UpdatedAt: now})
			}
			if len(rows) > 0 {
				if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&rows).Error; err != nil {
					return model.Tag{}, err
				}
			}
		}
	}
	cache[key] = tag
	return tag, nil
}

func decodeLegacyTags(payload model.JSONB) []string {
	var values []string
	if len(payload) == 0 || json.Unmarshal(payload, &values) != nil {
		return nil
	}
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		key := normalize(value)
		if key != "" && !seen[key] {
			seen[key] = true
			result = append(result, value)
		}
	}
	sort.Slice(result, func(i, j int) bool { return normalize(result[i]) < normalize(result[j]) })
	return result
}

func normalize(value string) string {
	return strings.ToLower(strings.TrimSpace(strings.Join(strings.Fields(value), " ")))
}

func deterministicID(prefix string, values ...string) string {
	hash := sha256.Sum256([]byte(strings.Join(values, "\x00")))
	return prefix + hex.EncodeToString(hash[:12])
}
