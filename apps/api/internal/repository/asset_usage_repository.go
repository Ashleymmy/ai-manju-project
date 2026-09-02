package repository

import (
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type AssetUsageRepository interface {
	RecordEvent(event model.AssetUsageEvent) (bool, error)
	GetAggregate(workspaceID string, assetID string) (model.AssetUsageAggregate, error)
	GetAggregates(workspaceID string, assetIDs []string) (map[string]model.AssetUsageAggregate, error)
	ListEvents(workspaceID string, assetID string, page int, pageSize int) ([]model.AssetUsageEvent, int64, error)
	SetStructuralCounts(workspaceID string, assetID string, activeReferences int64, derivedAssets int64) error
	GetUserState(workspaceID string, assetID string, userID string) (model.AssetUserState, error)
	GetUserStates(workspaceID string, assetIDs []string, userID string) (map[string]model.AssetUserState, error)
	PutUserState(state model.AssetUserState) (model.AssetUserState, error)
	ListAssetIDsByUsage(workspaceID string, userID string, reaction string, minimumUseCount int64, usedOnly bool) ([]string, error)
	Reconcile(workspaceID string, assetIDs []string) error
}

type MemoryAssetUsageRepository struct {
	mu         sync.RWMutex
	events     map[string]model.AssetUsageEvent
	aggregates map[string]model.AssetUsageAggregate
	states     map[string]model.AssetUserState
}

func NewMemoryAssetUsageRepository() *MemoryAssetUsageRepository {
	return &MemoryAssetUsageRepository{events: map[string]model.AssetUsageEvent{}, aggregates: map[string]model.AssetUsageAggregate{}, states: map[string]model.AssetUserState{}}
}

func (r *MemoryAssetUsageRepository) RecordEvent(event model.AssetUsageEvent) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.events[event.IdempotencyKey]; exists {
		return false, nil
	}
	now := time.Now().UTC()
	if event.OccurredAt.IsZero() {
		event.OccurredAt = now
	}
	event.CreatedAt, event.UpdatedAt = now, now
	r.events[event.IdempotencyKey] = event
	aggregate := r.aggregates[event.AssetID]
	aggregate.AssetID, aggregate.WorkspaceID = event.AssetID, event.WorkspaceID
	applyUsageEvent(&aggregate, event)
	if aggregate.CreatedAt.IsZero() {
		aggregate.CreatedAt = now
	}
	aggregate.UpdatedAt = now
	r.aggregates[event.AssetID] = aggregate
	return true, nil
}

func (r *MemoryAssetUsageRepository) GetAggregate(workspaceID string, assetID string) (model.AssetUsageAggregate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := r.aggregates[assetID]
	if result.AssetID == "" {
		return model.AssetUsageAggregate{AssetID: assetID, WorkspaceID: workspaceID}, nil
	}
	if result.WorkspaceID != workspaceID {
		return model.AssetUsageAggregate{}, ErrAssetNotFound
	}
	return result, nil
}

func (r *MemoryAssetUsageRepository) GetAggregates(workspaceID string, assetIDs []string) (map[string]model.AssetUsageAggregate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make(map[string]model.AssetUsageAggregate, len(assetIDs))
	for _, assetID := range uniqueAssetIDs(assetIDs) {
		aggregate := r.aggregates[assetID]
		if aggregate.AssetID != "" && aggregate.WorkspaceID != workspaceID {
			continue
		}
		if aggregate.AssetID == "" {
			aggregate = model.AssetUsageAggregate{AssetID: assetID, WorkspaceID: workspaceID}
		}
		result[assetID] = aggregate
	}
	return result, nil
}

func (r *MemoryAssetUsageRepository) ListEvents(workspaceID string, assetID string, page int, pageSize int) ([]model.AssetUsageEvent, int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]model.AssetUsageEvent, 0)
	for _, event := range r.events {
		if event.WorkspaceID == workspaceID && event.AssetID == assetID {
			items = append(items, event)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].OccurredAt.After(items[j].OccurredAt) })
	total := int64(len(items))
	start := (page - 1) * pageSize
	if start >= len(items) {
		return []model.AssetUsageEvent{}, total, nil
	}
	end := start + pageSize
	if end > len(items) {
		end = len(items)
	}
	return append([]model.AssetUsageEvent(nil), items[start:end]...), total, nil
}

func (r *MemoryAssetUsageRepository) SetStructuralCounts(workspaceID string, assetID string, activeReferences int64, derivedAssets int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UTC()
	aggregate := r.aggregates[assetID]
	aggregate.AssetID, aggregate.WorkspaceID = assetID, workspaceID
	aggregate.ActiveReferenceCount = activeReferences
	aggregate.DerivedAssetCount = derivedAssets
	if aggregate.CreatedAt.IsZero() {
		aggregate.CreatedAt = now
	}
	aggregate.UpdatedAt = now
	r.aggregates[assetID] = aggregate
	return nil
}

func (r *MemoryAssetUsageRepository) GetUserState(workspaceID string, assetID string, userID string) (model.AssetUserState, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	state := r.states[assetUserStateKey(assetID, userID)]
	if state.ID == "" {
		return model.AssetUserState{AssetID: assetID, UserID: userID, WorkspaceID: workspaceID, Reaction: model.AssetReactionNone}, nil
	}
	if state.WorkspaceID != workspaceID {
		return model.AssetUserState{}, ErrAssetNotFound
	}
	return state, nil
}

func (r *MemoryAssetUsageRepository) GetUserStates(workspaceID string, assetIDs []string, userID string) (map[string]model.AssetUserState, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make(map[string]model.AssetUserState, len(assetIDs))
	for _, assetID := range uniqueAssetIDs(assetIDs) {
		state := r.states[assetUserStateKey(assetID, userID)]
		if state.ID != "" && state.WorkspaceID != workspaceID {
			continue
		}
		if state.ID == "" {
			state = model.AssetUserState{AssetID: assetID, UserID: userID, WorkspaceID: workspaceID, Reaction: model.AssetReactionNone}
		}
		result[assetID] = state
	}
	return result, nil
}

func (r *MemoryAssetUsageRepository) ListAssetIDsByUsage(workspaceID string, userID string, reaction string, minimumUseCount int64, usedOnly bool) ([]string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	matched := map[string]bool{}
	if reaction != "" {
		for _, state := range r.states {
			if state.WorkspaceID == workspaceID && state.UserID == userID && state.Reaction == reaction {
				matched[state.AssetID] = true
			}
		}
	} else {
		for _, aggregate := range r.aggregates {
			if aggregate.WorkspaceID != workspaceID {
				continue
			}
			uses := aggregate.GenerationUseCount + aggregate.ActiveReferenceCount + aggregate.DownloadCount + aggregate.ExportCount
			if (minimumUseCount > 0 && uses >= minimumUseCount) || (usedOnly && (uses > 0 || aggregate.LastUsedAt != nil)) {
				matched[aggregate.AssetID] = true
			}
		}
	}
	ids := make([]string, 0, len(matched))
	for assetID := range matched {
		ids = append(ids, assetID)
	}
	sort.Strings(ids)
	return ids, nil
}

func (r *MemoryAssetUsageRepository) PutUserState(state model.AssetUserState) (model.AssetUserState, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := assetUserStateKey(state.AssetID, state.UserID)
	previous := r.states[key]
	now := time.Now().UTC()
	if previous.CreatedAt.IsZero() {
		state.CreatedAt = now
	} else {
		state.CreatedAt = previous.CreatedAt
	}
	state.UpdatedAt = now
	r.states[key] = state
	aggregate := r.aggregates[state.AssetID]
	aggregate.AssetID, aggregate.WorkspaceID = state.AssetID, state.WorkspaceID
	applyReactionDelta(&aggregate, previous.Reaction, state.Reaction)
	if aggregate.CreatedAt.IsZero() {
		aggregate.CreatedAt = now
	}
	aggregate.UpdatedAt = now
	r.aggregates[state.AssetID] = aggregate
	return state, nil
}

func (r *MemoryAssetUsageRepository) Reconcile(workspaceID string, assetIDs []string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UTC()
	for _, assetID := range uniqueAssetIDs(assetIDs) {
		aggregate := model.AssetUsageAggregate{AssetID: assetID, WorkspaceID: workspaceID, CreatedAt: now, UpdatedAt: now}
		for _, event := range r.events {
			if event.WorkspaceID == workspaceID && event.AssetID == assetID {
				applyUsageEvent(&aggregate, event)
			}
		}
		for _, state := range r.states {
			if state.WorkspaceID == workspaceID && state.AssetID == assetID {
				applyReactionDelta(&aggregate, model.AssetReactionNone, state.Reaction)
			}
		}
		r.aggregates[assetID] = aggregate
	}
	return nil
}

type GormAssetUsageRepository struct{ db *gorm.DB }

func NewGormAssetUsageRepository(db *gorm.DB) *GormAssetUsageRepository {
	return &GormAssetUsageRepository{db: db}
}

func (r *GormAssetUsageRepository) RecordEvent(event model.AssetUsageEvent) (bool, error) {
	created := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now().UTC()
		if event.OccurredAt.IsZero() {
			event.OccurredAt = now
		}
		event.CreatedAt, event.UpdatedAt = now, now
		result := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "idempotency_key"}}, DoNothing: true}).Create(&event)
		if result.Error != nil || result.RowsAffected == 0 {
			return result.Error
		}
		created = true
		aggregate := model.AssetUsageAggregate{AssetID: event.AssetID, WorkspaceID: event.WorkspaceID, CreatedAt: now, UpdatedAt: now, LastUsedAt: &event.OccurredAt}
		applyUsageEvent(&aggregate, event)
		assignments := map[string]any{
			"workspace_id": event.WorkspaceID,
			"updated_at":   now,
			"last_used_at": gorm.Expr("GREATEST(COALESCE(asset_usage_aggregates.last_used_at, ?), ?)", event.OccurredAt, event.OccurredAt),
		}
		switch event.EventType {
		case model.AssetUsageGeneration:
			assignments["generation_use_count"] = gorm.Expr("asset_usage_aggregates.generation_use_count + 1")
		case model.AssetUsageDownload:
			assignments["download_count"] = gorm.Expr("asset_usage_aggregates.download_count + 1")
		case model.AssetUsageExport:
			assignments["export_count"] = gorm.Expr("asset_usage_aggregates.export_count + 1")
		}
		return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "asset_id"}}, DoUpdates: clause.Assignments(assignments)}).Create(&aggregate).Error
	})
	return created, err
}

func (r *GormAssetUsageRepository) GetAggregate(workspaceID string, assetID string) (model.AssetUsageAggregate, error) {
	var result model.AssetUsageAggregate
	err := r.db.Where("workspace_id = ? AND asset_id = ?", workspaceID, assetID).First(&result).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.AssetUsageAggregate{AssetID: assetID, WorkspaceID: workspaceID}, nil
	}
	return result, err
}

func (r *GormAssetUsageRepository) GetAggregates(workspaceID string, assetIDs []string) (map[string]model.AssetUsageAggregate, error) {
	ids := uniqueAssetIDs(assetIDs)
	result := make(map[string]model.AssetUsageAggregate, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var rows []model.AssetUsageAggregate
	if err := r.db.Where("workspace_id = ? AND asset_id IN ?", workspaceID, ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.AssetID] = row
	}
	for _, assetID := range ids {
		if _, ok := result[assetID]; !ok {
			result[assetID] = model.AssetUsageAggregate{AssetID: assetID, WorkspaceID: workspaceID}
		}
	}
	return result, nil
}

func (r *GormAssetUsageRepository) ListEvents(workspaceID string, assetID string, page int, pageSize int) ([]model.AssetUsageEvent, int64, error) {
	query := r.db.Model(&model.AssetUsageEvent{}).Where("workspace_id = ? AND asset_id = ?", workspaceID, assetID)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []model.AssetUsageEvent
	err := query.Order("occurred_at DESC, id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&items).Error
	return items, total, err
}

func (r *GormAssetUsageRepository) SetStructuralCounts(workspaceID string, assetID string, activeReferences int64, derivedAssets int64) error {
	now := time.Now().UTC()
	aggregate := model.AssetUsageAggregate{AssetID: assetID, WorkspaceID: workspaceID, ActiveReferenceCount: activeReferences, DerivedAssetCount: derivedAssets, CreatedAt: now, UpdatedAt: now}
	return r.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "asset_id"}}, DoUpdates: clause.Assignments(map[string]any{"workspace_id": workspaceID, "active_reference_count": activeReferences, "derived_asset_count": derivedAssets, "updated_at": now})}).Create(&aggregate).Error
}

func (r *GormAssetUsageRepository) GetUserState(workspaceID string, assetID string, userID string) (model.AssetUserState, error) {
	var state model.AssetUserState
	err := r.db.Where("workspace_id = ? AND asset_id = ? AND user_id = ?", workspaceID, assetID, userID).First(&state).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.AssetUserState{AssetID: assetID, UserID: userID, WorkspaceID: workspaceID, Reaction: model.AssetReactionNone}, nil
	}
	return state, err
}

func (r *GormAssetUsageRepository) GetUserStates(workspaceID string, assetIDs []string, userID string) (map[string]model.AssetUserState, error) {
	ids := uniqueAssetIDs(assetIDs)
	result := make(map[string]model.AssetUserState, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var rows []model.AssetUserState
	if err := r.db.Where("workspace_id = ? AND user_id = ? AND asset_id IN ?", workspaceID, userID, ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.AssetID] = row
	}
	for _, assetID := range ids {
		if _, ok := result[assetID]; !ok {
			result[assetID] = model.AssetUserState{AssetID: assetID, UserID: userID, WorkspaceID: workspaceID, Reaction: model.AssetReactionNone}
		}
	}
	return result, nil
}

func (r *GormAssetUsageRepository) ListAssetIDsByUsage(workspaceID string, userID string, reaction string, minimumUseCount int64, usedOnly bool) ([]string, error) {
	var ids []string
	if reaction != "" {
		err := r.db.Model(&model.AssetUserState{}).Where("workspace_id = ? AND user_id = ? AND reaction = ?", workspaceID, userID, reaction).Order("asset_id ASC").Pluck("asset_id", &ids).Error
		return ids, err
	}
	query := r.db.Model(&model.AssetUsageAggregate{}).Where("workspace_id = ?", workspaceID)
	usageExpression := "generation_use_count + active_reference_count + download_count + export_count"
	if minimumUseCount > 0 {
		query = query.Where(usageExpression+" >= ?", minimumUseCount)
	} else if usedOnly {
		query = query.Where("(" + usageExpression + " > 0 OR last_used_at IS NOT NULL)")
	}
	err := query.Order("asset_id ASC").Pluck("asset_id", &ids).Error
	return ids, err
}

func (r *GormAssetUsageRepository) PutUserState(state model.AssetUserState) (model.AssetUserState, error) {
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var previous model.AssetUserState
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("asset_id = ? AND user_id = ?", state.AssetID, state.UserID).First(&previous).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		now := time.Now().UTC()
		if previous.CreatedAt.IsZero() {
			state.CreatedAt = now
		} else {
			state.CreatedAt = previous.CreatedAt
		}
		state.UpdatedAt = now
		if err := tx.Save(&state).Error; err != nil {
			return err
		}
		favoriteDelta := reactionValue(state.Reaction, model.AssetReactionFavorite) - reactionValue(previous.Reaction, model.AssetReactionFavorite)
		dislikeDelta := reactionValue(state.Reaction, model.AssetReactionDislike) - reactionValue(previous.Reaction, model.AssetReactionDislike)
		aggregate := model.AssetUsageAggregate{AssetID: state.AssetID, WorkspaceID: state.WorkspaceID, FavoriteCount: favoriteDelta, DislikeCount: dislikeDelta, CreatedAt: now, UpdatedAt: now}
		return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "asset_id"}}, DoUpdates: clause.Assignments(map[string]any{
			"workspace_id":   state.WorkspaceID,
			"favorite_count": gorm.Expr("GREATEST(0, asset_usage_aggregates.favorite_count + ?)", favoriteDelta),
			"dislike_count":  gorm.Expr("GREATEST(0, asset_usage_aggregates.dislike_count + ?)", dislikeDelta),
			"updated_at":     now,
		})}).Create(&aggregate).Error
	})
	return state, err
}

func (r *GormAssetUsageRepository) Reconcile(workspaceID string, assetIDs []string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		for _, assetID := range uniqueAssetIDs(assetIDs) {
			var counts struct {
				Generation int64
				Downloads  int64
				Exports    int64
				LastUsedAt *time.Time
			}
			if err := tx.Model(&model.AssetUsageEvent{}).Where("workspace_id = ? AND asset_id = ?", workspaceID, assetID).Select(
				"COUNT(*) FILTER (WHERE event_type = ?) AS generation, COUNT(*) FILTER (WHERE event_type = ?) AS downloads, COUNT(*) FILTER (WHERE event_type = ?) AS exports, MAX(occurred_at) AS last_used_at",
				model.AssetUsageGeneration, model.AssetUsageDownload, model.AssetUsageExport,
			).Scan(&counts).Error; err != nil {
				return err
			}
			var reactions struct{ Favorites, Dislikes int64 }
			if err := tx.Model(&model.AssetUserState{}).Where("workspace_id = ? AND asset_id = ?", workspaceID, assetID).Select(
				"COUNT(*) FILTER (WHERE reaction = ?) AS favorites, COUNT(*) FILTER (WHERE reaction = ?) AS dislikes",
				model.AssetReactionFavorite, model.AssetReactionDislike,
			).Scan(&reactions).Error; err != nil {
				return err
			}
			now := time.Now().UTC()
			aggregate := model.AssetUsageAggregate{AssetID: assetID, WorkspaceID: workspaceID, GenerationUseCount: counts.Generation, DownloadCount: counts.Downloads, ExportCount: counts.Exports, FavoriteCount: reactions.Favorites, DislikeCount: reactions.Dislikes, LastUsedAt: counts.LastUsedAt, CreatedAt: now, UpdatedAt: now}
			if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "asset_id"}}, DoUpdates: clause.Assignments(map[string]any{
				"workspace_id": workspaceID, "generation_use_count": counts.Generation, "download_count": counts.Downloads, "export_count": counts.Exports,
				"favorite_count": reactions.Favorites, "dislike_count": reactions.Dislikes, "last_used_at": counts.LastUsedAt, "updated_at": now,
			})}).Create(&aggregate).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func applyUsageEvent(aggregate *model.AssetUsageAggregate, event model.AssetUsageEvent) {
	switch event.EventType {
	case model.AssetUsageGeneration:
		aggregate.GenerationUseCount++
	case model.AssetUsageDownload:
		aggregate.DownloadCount++
	case model.AssetUsageExport:
		aggregate.ExportCount++
	}
	if aggregate.LastUsedAt == nil || event.OccurredAt.After(*aggregate.LastUsedAt) {
		occurredAt := event.OccurredAt
		aggregate.LastUsedAt = &occurredAt
	}
}

func applyReactionDelta(aggregate *model.AssetUsageAggregate, previous string, next string) {
	aggregate.FavoriteCount += reactionValue(next, model.AssetReactionFavorite) - reactionValue(previous, model.AssetReactionFavorite)
	aggregate.DislikeCount += reactionValue(next, model.AssetReactionDislike) - reactionValue(previous, model.AssetReactionDislike)
	if aggregate.FavoriteCount < 0 {
		aggregate.FavoriteCount = 0
	}
	if aggregate.DislikeCount < 0 {
		aggregate.DislikeCount = 0
	}
}

func reactionValue(value string, expected string) int64 {
	if value == expected {
		return 1
	}
	return 0
}

func assetUserStateKey(assetID string, userID string) string {
	return assetID + "\x00" + userID
}
