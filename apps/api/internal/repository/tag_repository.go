package repository

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
)

var (
	ErrTagNotFound      = errors.New("tag not found")
	ErrTagConflict      = errors.New("tag already exists")
	ErrTagProtected     = errors.New("tag is read-only")
	ErrTagAliasNotFound = errors.New("tag alias not found")
	ErrTagCycle         = errors.New("tag cannot be moved below itself")
	ErrTagDepth         = errors.New("tag maximum depth exceeded")
	ErrTagUsage         = errors.New("tag is not enabled for this usage")
)

type TagCounts struct {
	AssetCount  int64 `json:"asset_count"`
	PromptCount int64 `json:"prompt_count"`
}

type AssetTagBindingDetail struct {
	Binding model.AssetTagBinding  `json:"binding"`
	Tag     model.Tag              `json:"tag"`
	Origins []model.AssetTagOrigin `json:"origins"`
}

type TagRepository interface {
	List(scopeKeys []string) ([]model.Tag, error)
	Get(id string, scopeKeys []string) (model.Tag, error)
	Create(tag model.Tag, maxDepth int) (model.Tag, error)
	Update(tag model.Tag, scopeKey string) (model.Tag, error)
	Move(id string, parentID string, sortOrder int, scopeKey string, maxDepth int) (model.Tag, error)
	BulkMove(ids []string, parentID string, sortOrder int, scopeKey string, maxDepth int) ([]model.Tag, error)
	ArchiveSubtrees(ids []string, scopeKey string) ([]model.Tag, error)
	ListAliases(tagIDs []string) ([]model.TagAlias, error)
	CreateAlias(alias model.TagAlias, scopeKey string) (model.TagAlias, error)
	DeleteAlias(tagID string, aliasID string, scopeKey string) error
	DescendantIDs(tagID string, scopeKeys []string, includeSelf bool) ([]string, error)
	Counts(tagIDs []string) (map[string]TagCounts, error)
	BindAssets(workspaceID string, userID string, assetIDs []string, tagIDs []string, originType string) ([]model.AssetTagBinding, error)
	RemoveAssetTags(workspaceID string, assetIDs []string, tagIDs []string) error
	ReplaceAssetDirectTags(workspaceID string, userID string, assetID string, tagIDs []string, originType string) error
	ResyncInheritedAssetTags(workspaceID string, userID string, childAssetID string, parentAssetIDs []string) error
	RefreshTagMirrors(tagID string) error
	ListAssetIDs(workspaceID string, tagIDs []string, matchAll bool) ([]string, error)
	ListAssetTagDetails(workspaceID string, assetIDs []string, scopeKeys []string) ([]AssetTagBindingDetail, error)
	ListPromptIDs(tagIDs []string) ([]string, error)
}

type MemoryTagRepository struct {
	mu             sync.RWMutex
	assets         *MemoryAssetRepository
	tags           map[string]model.Tag
	closures       map[string]model.TagClosure
	aliases        map[string]model.TagAlias
	assetBindings  map[string]model.AssetTagBinding
	assetOrigins   map[string]model.AssetTagOrigin
	promptBindings map[string]model.PromptTagBinding
}

func NewMemoryTagRepository(assets *MemoryAssetRepository) *MemoryTagRepository {
	return &MemoryTagRepository{
		assets: assets, tags: map[string]model.Tag{}, closures: map[string]model.TagClosure{}, aliases: map[string]model.TagAlias{},
		assetBindings: map[string]model.AssetTagBinding{}, assetOrigins: map[string]model.AssetTagOrigin{}, promptBindings: map[string]model.PromptTagBinding{},
	}
}

func (r *MemoryTagRepository) List(scopeKeys []string) ([]model.Tag, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	allowed := stringSet(scopeKeys)
	items := make([]model.Tag, 0)
	for _, tag := range r.tags {
		if allowed[tag.ScopeKey] {
			items = append(items, tag)
		}
	}
	sortTags(items)
	return items, nil
}

func (r *MemoryTagRepository) Get(id string, scopeKeys []string) (model.Tag, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	tag, ok := r.tags[id]
	if !ok || !stringSet(scopeKeys)[tag.ScopeKey] {
		return model.Tag{}, ErrTagNotFound
	}
	return tag, nil
}

func (r *MemoryTagRepository) Create(tag model.Tag, maxDepth int) (model.Tag, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.tags[tag.ID]; exists || r.tagNameExistsLocked(tag.ScopeKey, tag.ParentID, tag.NormalizedName, "") {
		return model.Tag{}, ErrTagConflict
	}
	if tag.ParentID != "" {
		parent, ok := r.tags[tag.ParentID]
		if !ok || parent.ScopeKey != tag.ScopeKey || parent.ScopeType != tag.ScopeType {
			return model.Tag{}, ErrTagNotFound
		}
	}
	now := time.Now().UTC()
	tag.CreatedAt, tag.UpdatedAt = now, now
	r.tags[tag.ID] = tag
	if err := r.rebuildScopeClosuresLocked(tag.ScopeKey, maxDepth); err != nil {
		delete(r.tags, tag.ID)
		return model.Tag{}, err
	}
	return tag, nil
}

func (r *MemoryTagRepository) Update(tag model.Tag, scopeKey string) (model.Tag, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, ok := r.tags[tag.ID]
	if !ok || current.ScopeKey != scopeKey {
		return model.Tag{}, ErrTagNotFound
	}
	if r.tagNameExistsLocked(scopeKey, current.ParentID, tag.NormalizedName, tag.ID) {
		return model.Tag{}, ErrTagConflict
	}
	tag.ScopeType, tag.ScopeKey, tag.CreatedBy = current.ScopeType, current.ScopeKey, current.CreatedBy
	tag.ParentID, tag.CreatedAt = current.ParentID, current.CreatedAt
	tag.UpdatedAt = time.Now().UTC()
	r.tags[tag.ID] = tag
	return tag, nil
}

func (r *MemoryTagRepository) Move(id string, parentID string, sortOrder int, scopeKey string, maxDepth int) (model.Tag, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	tag, ok := r.tags[id]
	if !ok || tag.ScopeKey != scopeKey {
		return model.Tag{}, ErrTagNotFound
	}
	if parentID == id {
		return model.Tag{}, ErrTagCycle
	}
	if parentID != "" {
		parent, found := r.tags[parentID]
		if !found || parent.ScopeKey != tag.ScopeKey || parent.ScopeType != tag.ScopeType {
			return model.Tag{}, ErrTagNotFound
		}
	}
	if r.tagNameExistsLocked(scopeKey, parentID, tag.NormalizedName, tag.ID) {
		return model.Tag{}, ErrTagConflict
	}
	previous := tag
	tag.ParentID, tag.SortOrder, tag.UpdatedAt = parentID, sortOrder, time.Now().UTC()
	r.tags[id] = tag
	if err := r.rebuildScopeClosuresLocked(scopeKey, maxDepth); err != nil {
		r.tags[id] = previous
		_ = r.rebuildScopeClosuresLocked(scopeKey, maxDepth)
		return model.Tag{}, err
	}
	return tag, nil
}

func (r *MemoryTagRepository) BulkMove(ids []string, parentID string, sortOrder int, scopeKey string, maxDepth int) ([]model.Tag, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	ids = uniqueStrings(ids)
	if len(ids) == 0 {
		return nil, ErrTagNotFound
	}
	backup := make(map[string]model.Tag, len(r.tags))
	for id, tag := range r.tags {
		backup[id] = tag
	}
	var parent model.Tag
	if parentID != "" {
		var ok bool
		parent, ok = r.tags[parentID]
		if !ok || parent.ScopeKey != scopeKey {
			return nil, ErrTagNotFound
		}
	}
	now := time.Now().UTC()
	moved := make([]model.Tag, 0, len(ids))
	for index, id := range ids {
		tag, ok := r.tags[id]
		if !ok || tag.ScopeKey != scopeKey {
			r.tags = backup
			return nil, ErrTagNotFound
		}
		if parentID == tag.ID {
			r.tags = backup
			return nil, ErrTagCycle
		}
		if parentID != "" && parent.ScopeType != tag.ScopeType {
			r.tags = backup
			return nil, ErrTagNotFound
		}
		if r.tagNameExistsLocked(scopeKey, parentID, tag.NormalizedName, tag.ID) {
			r.tags = backup
			return nil, ErrTagConflict
		}
		tag.ParentID, tag.SortOrder, tag.UpdatedAt = parentID, sortOrder+index, now
		r.tags[id] = tag
		moved = append(moved, tag)
	}
	if err := r.rebuildScopeClosuresLocked(scopeKey, maxDepth); err != nil {
		r.tags = backup
		_ = r.rebuildScopeClosuresLocked(scopeKey, maxDepth)
		return nil, err
	}
	return moved, nil
}

func (r *MemoryTagRepository) ArchiveSubtrees(ids []string, scopeKey string) ([]model.Tag, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	ids = uniqueStrings(ids)
	if len(ids) == 0 {
		return nil, ErrTagNotFound
	}
	selected := stringSet(ids)
	for _, id := range ids {
		tag, ok := r.tags[id]
		if !ok || tag.ScopeKey != scopeKey {
			return nil, ErrTagNotFound
		}
	}
	for _, closure := range r.closures {
		if selected[closure.AncestorID] {
			selected[closure.DescendantID] = true
		}
	}
	now := time.Now().UTC()
	archived := make([]model.Tag, 0, len(selected))
	for id := range selected {
		tag, ok := r.tags[id]
		if !ok || tag.ScopeKey != scopeKey {
			continue
		}
		tag.Status, tag.UpdatedAt = model.TagStatusArchived, now
		r.tags[id] = tag
		archived = append(archived, tag)
	}
	if r.assets != nil {
		r.assets.mu.Lock()
		assetIDs := map[string]bool{}
		for _, binding := range r.assetBindings {
			if selected[binding.TagID] {
				assetIDs[binding.AssetID] = true
			}
		}
		for assetID := range assetIDs {
			r.syncAssetMirrorLocked(assetID, now)
		}
		r.assets.mu.Unlock()
	}
	sortTags(archived)
	return archived, nil
}

func (r *MemoryTagRepository) ListAliases(tagIDs []string) ([]model.TagAlias, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	wanted := stringSet(tagIDs)
	items := make([]model.TagAlias, 0)
	for _, alias := range r.aliases {
		if wanted[alias.TagID] {
			items = append(items, alias)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Alias < items[j].Alias })
	return items, nil
}

func (r *MemoryTagRepository) CreateAlias(alias model.TagAlias, scopeKey string) (model.TagAlias, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	tag, ok := r.tags[alias.TagID]
	if !ok || tag.ScopeKey != scopeKey {
		return model.TagAlias{}, ErrTagNotFound
	}
	for _, existingTag := range r.tags {
		if existingTag.ScopeKey == scopeKey && existingTag.NormalizedName == alias.NormalizedAlias {
			return model.TagAlias{}, ErrTagConflict
		}
	}
	for _, existing := range r.aliases {
		existingTag := r.tags[existing.TagID]
		if existingTag.ScopeKey == scopeKey && existing.NormalizedAlias == alias.NormalizedAlias {
			return model.TagAlias{}, ErrTagConflict
		}
	}
	now := time.Now().UTC()
	alias.CreatedAt, alias.UpdatedAt = now, now
	r.aliases[alias.ID] = alias
	return alias, nil
}

func (r *MemoryTagRepository) DeleteAlias(tagID string, aliasID string, scopeKey string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	tag, ok := r.tags[tagID]
	if !ok || tag.ScopeKey != scopeKey {
		return ErrTagNotFound
	}
	alias, ok := r.aliases[aliasID]
	if !ok || alias.TagID != tagID {
		return ErrTagAliasNotFound
	}
	delete(r.aliases, aliasID)
	return nil
}

func (r *MemoryTagRepository) DescendantIDs(tagID string, scopeKeys []string, includeSelf bool) ([]string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	tag, ok := r.tags[tagID]
	if !ok || !stringSet(scopeKeys)[tag.ScopeKey] {
		return nil, ErrTagNotFound
	}
	result := make([]string, 0)
	for _, closure := range r.closures {
		if closure.AncestorID == tagID && (includeSelf || closure.Depth > 0) {
			result = append(result, closure.DescendantID)
		}
	}
	sort.Strings(result)
	return result, nil
}

func (r *MemoryTagRepository) Counts(tagIDs []string) (map[string]TagCounts, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	wanted := stringSet(tagIDs)
	counts := make(map[string]TagCounts, len(tagIDs))
	for id := range wanted {
		counts[id] = TagCounts{}
	}
	for _, binding := range r.assetBindings {
		if wanted[binding.TagID] && binding.State == model.AssetTagBindingActive {
			count := counts[binding.TagID]
			count.AssetCount++
			counts[binding.TagID] = count
		}
	}
	for _, binding := range r.promptBindings {
		if wanted[binding.TagID] {
			count := counts[binding.TagID]
			count.PromptCount++
			counts[binding.TagID] = count
		}
	}
	return counts, nil
}

func (r *MemoryTagRepository) BindAssets(workspaceID string, userID string, assetIDs []string, tagIDs []string, originType string) ([]model.AssetTagBinding, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.assets == nil {
		return nil, errors.New("asset repository is unavailable")
	}
	r.assets.mu.Lock()
	defer r.assets.mu.Unlock()
	assets, tags, err := r.validateAssetBindingLocked(workspaceID, assetIDs, tagIDs)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	result := make([]model.AssetTagBinding, 0, len(assets)*len(tags))
	for _, asset := range assets {
		for _, tag := range tags {
			binding := r.upsertAssetBindingLocked(workspaceID, userID, asset.ID, tag.ID, originType, now)
			result = append(result, binding)
		}
		r.syncAssetMirrorLocked(asset.ID, now)
	}
	return result, nil
}

func (r *MemoryTagRepository) RemoveAssetTags(workspaceID string, assetIDs []string, tagIDs []string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.assets == nil {
		return errors.New("asset repository is unavailable")
	}
	r.assets.mu.Lock()
	defer r.assets.mu.Unlock()
	assets, err := r.validateAssetTagRemovalLocked(workspaceID, assetIDs, tagIDs)
	if err != nil {
		return err
	}
	wantedAssets, wantedTags := stringSet(assetIDs), stringSet(tagIDs)
	now := time.Now().UTC()
	for id, binding := range r.assetBindings {
		if wantedAssets[binding.AssetID] && wantedTags[binding.TagID] && binding.WorkspaceID == workspaceID {
			binding.State, binding.UpdatedAt = model.AssetTagBindingSuppressed, now
			r.assetBindings[id] = binding
		}
	}
	for _, asset := range assets {
		r.syncAssetMirrorLocked(asset.ID, now)
	}
	return nil
}

func (r *MemoryTagRepository) validateAssetTagRemovalLocked(workspaceID string, assetIDs []string, tagIDs []string) ([]model.Asset, error) {
	assetIDs, tagIDs = uniqueStrings(assetIDs), uniqueStrings(tagIDs)
	if len(assetIDs) == 0 || len(tagIDs) == 0 {
		return nil, ErrTagNotFound
	}
	assets := make([]model.Asset, 0, len(assetIDs))
	for _, id := range assetIDs {
		asset, ok := r.assets.assets[id]
		if !ok || !assetBelongsToWorkspace(asset, workspaceID) || asset.TrashedAt != nil {
			return nil, ErrAssetNotFound
		}
		assets = append(assets, asset)
	}
	for _, id := range tagIDs {
		tag, ok := r.tags[id]
		if !ok || !tagAvailableToAsset(tag, workspaceID) {
			return nil, ErrTagNotFound
		}
	}
	return assets, nil
}

func (r *MemoryTagRepository) ReplaceAssetDirectTags(workspaceID string, userID string, assetID string, tagIDs []string, originType string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.assets == nil {
		return errors.New("asset repository is unavailable")
	}
	r.assets.mu.Lock()
	defer r.assets.mu.Unlock()
	asset, ok := r.assets.assets[assetID]
	if !ok || !assetBelongsToWorkspace(asset, workspaceID) || asset.TrashedAt != nil {
		return ErrAssetNotFound
	}
	assets := []model.Asset{asset}
	tags := make([]model.Tag, 0, len(tagIDs))
	if len(uniqueStrings(tagIDs)) > 0 {
		var err error
		assets, tags, err = r.validateAssetBindingLocked(workspaceID, []string{assetID}, tagIDs)
		if err != nil {
			return err
		}
	}
	wanted := stringSet(tagIDs)
	now := time.Now().UTC()
	for id, binding := range r.assetBindings {
		if binding.AssetID != assetID || binding.WorkspaceID != workspaceID || wanted[binding.TagID] {
			continue
		}
		if r.bindingHasOriginLocked(binding.ID, model.AssetTagOriginDirect) || r.bindingHasOriginLocked(binding.ID, model.AssetTagOriginMigrated) {
			binding.State, binding.UpdatedAt = model.AssetTagBindingSuppressed, now
			r.assetBindings[id] = binding
		}
	}
	for _, tag := range tags {
		r.upsertAssetBindingLocked(workspaceID, userID, assetID, tag.ID, originType, now)
	}
	r.syncAssetMirrorLocked(assets[0].ID, now)
	return nil
}

func (r *MemoryTagRepository) RefreshTagMirrors(tagID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.assets == nil {
		return errors.New("asset repository is unavailable")
	}
	if _, ok := r.tags[tagID]; !ok {
		return ErrTagNotFound
	}
	r.assets.mu.Lock()
	defer r.assets.mu.Unlock()
	now, assetIDs := time.Now().UTC(), map[string]bool{}
	for _, binding := range r.assetBindings {
		if binding.TagID == tagID {
			assetIDs[binding.AssetID] = true
		}
	}
	for assetID := range assetIDs {
		r.syncAssetMirrorLocked(assetID, now)
	}
	return nil
}

func (r *MemoryTagRepository) ResyncInheritedAssetTags(workspaceID string, userID string, childAssetID string, parentAssetIDs []string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.assets == nil {
		return errors.New("asset repository is unavailable")
	}
	r.assets.mu.Lock()
	defer r.assets.mu.Unlock()
	child, ok := r.assets.assets[childAssetID]
	if !ok || !assetBelongsToWorkspace(child, workspaceID) || child.TrashedAt != nil {
		return ErrAssetNotFound
	}
	parents := uniqueStrings(parentAssetIDs)
	for _, parentID := range parents {
		parent, exists := r.assets.assets[parentID]
		if !exists || !assetBelongsToWorkspace(parent, workspaceID) || parent.TrashedAt != nil || parentID == childAssetID {
			return ErrAssetNotFound
		}
	}
	desired := map[string]map[string]bool{}
	parentSet := stringSet(parents)
	for _, binding := range r.assetBindings {
		tag, exists := r.tags[binding.TagID]
		if parentSet[binding.AssetID] && binding.WorkspaceID == workspaceID && binding.State == model.AssetTagBindingActive && exists && tag.AssetEnabled && tag.Status == model.TagStatusActive && tag.InheritMode == model.TagInheritAuto {
			if desired[binding.TagID] == nil {
				desired[binding.TagID] = map[string]bool{}
			}
			desired[binding.TagID][binding.AssetID] = true
		}
	}
	childBindings := map[string]model.AssetTagBinding{}
	for id, binding := range r.assetBindings {
		if binding.AssetID == childAssetID && binding.WorkspaceID == workspaceID {
			childBindings[binding.TagID] = binding
			_ = id
		}
	}
	bindingsWithInherited := map[string]bool{}
	for id, origin := range r.assetOrigins {
		if origin.OriginType != model.AssetTagOriginInherited {
			continue
		}
		for _, binding := range childBindings {
			if binding.ID == origin.BindingID {
				bindingsWithInherited[binding.ID] = true
				delete(r.assetOrigins, id)
				break
			}
		}
	}
	for id, binding := range r.assetBindings {
		if binding.AssetID == childAssetID && bindingsWithInherited[binding.ID] && binding.State != model.AssetTagBindingSuppressed && !r.bindingHasAnyOriginLocked(binding.ID) {
			delete(r.assetBindings, id)
			delete(childBindings, binding.TagID)
		}
	}
	now := time.Now().UTC()
	for tagID, sources := range desired {
		binding, exists := childBindings[tagID]
		if !exists {
			binding = model.AssetTagBinding{ID: "asset_tag_" + randomRepositoryHex(12), WorkspaceID: workspaceID, AssetID: childAssetID, TagID: tagID, State: model.AssetTagBindingActive, CreatedBy: userID, CreatedAt: now, UpdatedAt: now}
			r.assetBindings[binding.ID] = binding
			childBindings[tagID] = binding
		}
		for sourceAssetID := range sources {
			origin := model.AssetTagOrigin{ID: "asset_tag_origin_" + randomRepositoryHex(12), BindingID: binding.ID, OriginType: model.AssetTagOriginInherited, SourceAssetID: sourceAssetID, CreatedAt: now, UpdatedAt: now}
			r.assetOrigins[origin.ID] = origin
		}
	}
	r.syncAssetMirrorLocked(childAssetID, now)
	return nil
}

func (r *MemoryTagRepository) bindingHasAnyOriginLocked(bindingID string) bool {
	for _, origin := range r.assetOrigins {
		if origin.BindingID == bindingID {
			return true
		}
	}
	return false
}

func (r *MemoryTagRepository) ListAssetIDs(workspaceID string, tagIDs []string, matchAll bool) ([]string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	wanted := stringSet(tagIDs)
	matches := map[string]map[string]bool{}
	for _, binding := range r.assetBindings {
		if binding.WorkspaceID == workspaceID && binding.State == model.AssetTagBindingActive && wanted[binding.TagID] {
			if matches[binding.AssetID] == nil {
				matches[binding.AssetID] = map[string]bool{}
			}
			matches[binding.AssetID][binding.TagID] = true
		}
	}
	return matchingIDs(matches, len(wanted), matchAll), nil
}

func (r *MemoryTagRepository) ListAssetTagDetails(workspaceID string, assetIDs []string, scopeKeys []string) ([]AssetTagBindingDetail, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	wantedAssets := stringSet(assetIDs)
	visibleScopes := stringSet(scopeKeys)
	details := make([]AssetTagBindingDetail, 0)
	for _, binding := range r.assetBindings {
		tag, exists := r.tags[binding.TagID]
		if binding.WorkspaceID != workspaceID || !wantedAssets[binding.AssetID] || !exists || !visibleScopes[tag.ScopeKey] {
			continue
		}
		detail := AssetTagBindingDetail{Binding: binding, Tag: tag, Origins: []model.AssetTagOrigin{}}
		for _, origin := range r.assetOrigins {
			if origin.BindingID == binding.ID {
				detail.Origins = append(detail.Origins, origin)
			}
		}
		sort.Slice(detail.Origins, func(i, j int) bool { return detail.Origins[i].ID < detail.Origins[j].ID })
		details = append(details, detail)
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

func (r *MemoryTagRepository) ListPromptIDs(tagIDs []string) ([]string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	wanted, seen := stringSet(tagIDs), map[string]bool{}
	for _, binding := range r.promptBindings {
		if wanted[binding.TagID] {
			seen[binding.PromptID] = true
		}
	}
	result := make([]string, 0, len(seen))
	for id := range seen {
		result = append(result, id)
	}
	sort.Strings(result)
	return result, nil
}

func (r *MemoryTagRepository) validateAssetBindingLocked(workspaceID string, assetIDs []string, tagIDs []string) ([]model.Asset, []model.Tag, error) {
	assetIDs, tagIDs = uniqueStrings(assetIDs), uniqueStrings(tagIDs)
	if len(assetIDs) == 0 || len(tagIDs) == 0 {
		return nil, nil, ErrTagNotFound
	}
	assets := make([]model.Asset, 0, len(assetIDs))
	for _, id := range assetIDs {
		asset, ok := r.assets.assets[id]
		if !ok || !assetBelongsToWorkspace(asset, workspaceID) || asset.TrashedAt != nil {
			return nil, nil, ErrAssetNotFound
		}
		assets = append(assets, asset)
	}
	tags := make([]model.Tag, 0, len(tagIDs))
	for _, id := range tagIDs {
		tag, ok := r.tags[id]
		if !ok || !tag.AssetEnabled || tag.Status != model.TagStatusActive || !tagAvailableToAsset(tag, workspaceID) {
			return nil, nil, ErrTagUsage
		}
		tags = append(tags, tag)
	}
	return assets, tags, nil
}

func (r *MemoryTagRepository) upsertAssetBindingLocked(workspaceID string, userID string, assetID string, tagID string, originType string, now time.Time) model.AssetTagBinding {
	var binding model.AssetTagBinding
	for id, existing := range r.assetBindings {
		if existing.AssetID == assetID && existing.TagID == tagID {
			binding = existing
			binding.State, binding.UpdatedAt = model.AssetTagBindingActive, now
			r.assetBindings[id] = binding
			break
		}
	}
	if binding.ID == "" {
		binding = model.AssetTagBinding{ID: "asset_tag_" + randomRepositoryHex(12), WorkspaceID: workspaceID, AssetID: assetID, TagID: tagID, State: model.AssetTagBindingActive, CreatedBy: userID, CreatedAt: now, UpdatedAt: now}
		r.assetBindings[binding.ID] = binding
	}
	for _, origin := range r.assetOrigins {
		if origin.BindingID == binding.ID && origin.OriginType == originType && origin.SourceAssetID == "" && origin.SourceJobID == "" && origin.SourceNodeID == "" {
			return binding
		}
	}
	origin := model.AssetTagOrigin{ID: "asset_tag_origin_" + randomRepositoryHex(12), BindingID: binding.ID, OriginType: originType, CreatedAt: now, UpdatedAt: now}
	r.assetOrigins[origin.ID] = origin
	return binding
}

func (r *MemoryTagRepository) bindingHasOriginLocked(bindingID string, originType string) bool {
	for _, origin := range r.assetOrigins {
		if origin.BindingID == bindingID && origin.OriginType == originType {
			return true
		}
	}
	return false
}

func (r *MemoryTagRepository) syncAssetMirrorLocked(assetID string, now time.Time) {
	asset, ok := r.assets.assets[assetID]
	if !ok {
		return
	}
	names := make([]string, 0)
	for _, binding := range r.assetBindings {
		if binding.AssetID == assetID && binding.State == model.AssetTagBindingActive {
			if tag, exists := r.tags[binding.TagID]; exists && tag.Status == model.TagStatusActive {
				names = append(names, tag.Name)
			}
		}
	}
	sort.Slice(names, func(i, j int) bool { return strings.ToLower(names[i]) < strings.ToLower(names[j]) })
	payload, _ := json.Marshal(uniqueStringsFold(names))
	asset.Tags, asset.UpdatedAt = model.JSONB(payload), now
	r.assets.assets[assetID] = asset
}

func (r *MemoryTagRepository) tagNameExistsLocked(scopeKey string, parentID string, normalized string, exceptID string) bool {
	for _, existing := range r.tags {
		if existing.ID != exceptID && existing.ScopeKey == scopeKey && existing.ParentID == parentID && existing.NormalizedName == normalized {
			return true
		}
	}
	return false
}

func (r *MemoryTagRepository) rebuildScopeClosuresLocked(scopeKey string, maxDepth int) error {
	tags := make([]model.Tag, 0)
	for _, tag := range r.tags {
		if tag.ScopeKey == scopeKey {
			tags = append(tags, tag)
		}
	}
	closures, err := buildTagClosures(tags, maxDepth)
	if err != nil {
		return err
	}
	for key, closure := range r.closures {
		if tag, ok := r.tags[closure.DescendantID]; ok && tag.ScopeKey == scopeKey {
			delete(r.closures, key)
		}
	}
	for _, closure := range closures {
		r.closures[closureKey(closure.AncestorID, closure.DescendantID)] = closure
	}
	return nil
}

func buildTagClosures(tags []model.Tag, maxDepth int) ([]model.TagClosure, error) {
	byID := make(map[string]model.Tag, len(tags))
	for _, tag := range tags {
		byID[tag.ID] = tag
	}
	now := time.Now().UTC()
	closures := make([]model.TagClosure, 0, len(tags)*2)
	for _, tag := range tags {
		closures = append(closures, model.TagClosure{AncestorID: tag.ID, DescendantID: tag.ID, Depth: 0, CreatedAt: now, UpdatedAt: now})
		seen := map[string]bool{tag.ID: true}
		parentID, depth := tag.ParentID, 1
		for parentID != "" {
			if seen[parentID] {
				return nil, ErrTagCycle
			}
			parent, ok := byID[parentID]
			if !ok || parent.ScopeKey != tag.ScopeKey || parent.ScopeType != tag.ScopeType {
				return nil, ErrTagNotFound
			}
			if depth > maxDepth {
				return nil, ErrTagDepth
			}
			seen[parentID] = true
			closures = append(closures, model.TagClosure{AncestorID: parentID, DescendantID: tag.ID, Depth: depth, CreatedAt: now, UpdatedAt: now})
			parentID, depth = parent.ParentID, depth+1
		}
	}
	return closures, nil
}

func tagAvailableToAsset(tag model.Tag, workspaceID string) bool {
	return (tag.ScopeKey == model.TagGlobalScopeKey && (tag.ScopeType == model.TagScopeSystem || tag.ScopeType == model.TagScopePublic)) ||
		(tag.ScopeType == model.TagScopeWorkspace && tag.ScopeKey == workspaceID)
}

func sortTags(tags []model.Tag) {
	sort.Slice(tags, func(i, j int) bool {
		if tags[i].SortOrder != tags[j].SortOrder {
			return tags[i].SortOrder < tags[j].SortOrder
		}
		if tags[i].Name != tags[j].Name {
			return tags[i].Name < tags[j].Name
		}
		return tags[i].ID < tags[j].ID
	})
}

func stringSet(values []string) map[string]bool {
	result := make(map[string]bool, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			result[value] = true
		}
	}
	return result
}

func uniqueStrings(values []string) []string {
	seen, result := map[string]bool{}, make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	return result
}

func uniqueStringsFold(values []string) []string {
	seen, result := map[string]bool{}, make([]string, 0, len(values))
	for _, value := range values {
		key := strings.ToLower(strings.TrimSpace(value))
		if key != "" && !seen[key] {
			seen[key] = true
			result = append(result, strings.TrimSpace(value))
		}
	}
	return result
}

func matchingIDs(matches map[string]map[string]bool, wantedCount int, matchAll bool) []string {
	result := make([]string, 0, len(matches))
	for id, tags := range matches {
		if !matchAll || len(tags) == wantedCount {
			result = append(result, id)
		}
	}
	sort.Strings(result)
	return result
}

func closureKey(ancestorID string, descendantID string) string {
	return ancestorID + "\x00" + descendantID
}
