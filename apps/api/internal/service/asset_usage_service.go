package service

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

var (
	ErrAssetReaction         = errors.New("asset reaction must be none, favorite, or dislike")
	ErrAssetPrivateNote      = errors.New("asset private note is too long")
	ErrAssetLibrarySmartView = errors.New("asset library smart view is invalid")
)

const AssetPrivateNoteMaxLength = 4000

const AssetHighFrequencyThreshold int64 = 5

type AssetUsageService struct {
	usage      repository.AssetUsageRepository
	assets     repository.AssetRepository
	references repository.AssetReferenceRepository
	lineage    repository.AssetLineageRepository
}

type AssetStatsView struct {
	model.AssetUsageAggregate
	UserState model.AssetUserState `json:"user_state"`
}

type AssetUsageEventView struct {
	ID          string    `json:"id"`
	EventType   string    `json:"event_type"`
	ContextType string    `json:"context_type"`
	OccurredAt  time.Time `json:"occurred_at"`
}

type AssetUsageEventPage struct {
	Items    []AssetUsageEventView `json:"items"`
	Total    int64                 `json:"total"`
	Page     int                   `json:"page"`
	PageSize int                   `json:"page_size"`
}

type AssetUserStateInput struct {
	Reaction    string
	PrivateNote *string
}

type AssetLibraryUsageIDs struct {
	IDs     []string
	Exclude bool
}

func NewAssetUsageService(usage repository.AssetUsageRepository, assets repository.AssetRepository, references repository.AssetReferenceRepository, lineage repository.AssetLineageRepository) *AssetUsageService {
	return &AssetUsageService{usage: usage, assets: assets, references: references, lineage: lineage}
}

func (s *AssetUsageService) RecordGenerationUse(workspaceID string, userID string, jobID string, assetIDs []string) error {
	return s.recordForAssets(workspaceID, userID, model.AssetUsageGeneration, "job", jobID, assetIDs)
}

func (s *AssetUsageService) RecordReference(workspaceID string, userID string, referenceType string, referenceID string, assetIDs []string) error {
	return s.recordForAssets(workspaceID, userID, model.AssetUsageReference, referenceType, referenceID, assetIDs)
}

func (s *AssetUsageService) RecordExport(workspaceID string, userID string, exportID string, assetIDs []string) error {
	return s.recordForAssets(workspaceID, userID, model.AssetUsageExport, "export", exportID, assetIDs)
}

func (s *AssetUsageService) RecordDownload(assetID string, userID string, scope string, idempotencyKey string) error {
	workspaceID := WorkspaceIDForScope(scope, userID)
	if _, err := s.assets.GetByWorkspace(assetID, workspaceID); err != nil {
		return err
	}
	_, err := s.usage.RecordEvent(newAssetUsageEvent(workspaceID, assetID, userID, model.AssetUsageDownload, "download", strings.TrimSpace(idempotencyKey), strings.TrimSpace(idempotencyKey)))
	return err
}

func (s *AssetUsageService) Stats(assetID string, userID string, scope string) (AssetStatsView, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	assetID = strings.TrimSpace(assetID)
	if _, err := s.assets.GetByWorkspace(assetID, workspaceID); err != nil {
		return AssetStatsView{}, err
	}
	aggregate, err := s.usage.GetAggregate(workspaceID, assetID)
	if err != nil {
		return AssetStatsView{}, err
	}
	references, err := s.references.ListByAssetIDs(workspaceID, []string{assetID})
	if err != nil {
		return AssetStatsView{}, err
	}
	children, err := s.lineage.ListByParent(workspaceID, assetID)
	if err != nil {
		return AssetStatsView{}, err
	}
	aggregate.ActiveReferenceCount = int64(len(references))
	aggregate.DerivedAssetCount = int64(len(children))
	if err := s.usage.SetStructuralCounts(workspaceID, assetID, aggregate.ActiveReferenceCount, aggregate.DerivedAssetCount); err != nil {
		return AssetStatsView{}, err
	}
	state, err := s.usage.GetUserState(workspaceID, assetID, userID)
	if err != nil {
		return AssetStatsView{}, err
	}
	return AssetStatsView{AssetUsageAggregate: aggregate, UserState: state}, nil
}

func (s *AssetUsageService) BatchStats(assetIDs []string, userID string, scope string) (map[string]AssetStatsView, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	ids := uniqueAssetStrings(assetIDs)
	result := make(map[string]AssetStatsView, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	aggregates, err := s.usage.GetAggregates(workspaceID, ids)
	if err != nil {
		return nil, err
	}
	states, err := s.usage.GetUserStates(workspaceID, ids, userID)
	if err != nil {
		return nil, err
	}
	references, err := s.references.ListByAssetIDs(workspaceID, ids)
	if err != nil {
		return nil, err
	}
	children, err := s.lineage.ListByParents(workspaceID, ids)
	if err != nil {
		return nil, err
	}
	referenceCounts := map[string]int64{}
	for _, reference := range references {
		referenceCounts[reference.AssetID]++
	}
	childCounts := map[string]int64{}
	for _, child := range children {
		childCounts[child.ParentAssetID]++
	}
	for _, assetID := range ids {
		aggregate := aggregates[assetID]
		aggregate.AssetID, aggregate.WorkspaceID = assetID, workspaceID
		aggregate.ActiveReferenceCount = referenceCounts[assetID]
		aggregate.DerivedAssetCount = childCounts[assetID]
		state := states[assetID]
		if state.Reaction == "" {
			state.Reaction = model.AssetReactionNone
		}
		result[assetID] = AssetStatsView{AssetUsageAggregate: aggregate, UserState: state}
	}
	return result, nil
}

func (s *AssetUsageService) LibraryAssetIDs(userID string, scope string, view string) (AssetLibraryUsageIDs, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	switch strings.TrimSpace(strings.ToLower(view)) {
	case "favorite":
		ids, err := s.usage.ListAssetIDsByUsage(workspaceID, userID, model.AssetReactionFavorite, 0, false)
		return AssetLibraryUsageIDs{IDs: ids}, err
	case "dislike":
		ids, err := s.usage.ListAssetIDsByUsage(workspaceID, userID, model.AssetReactionDislike, 0, false)
		return AssetLibraryUsageIDs{IDs: ids}, err
	case "frequent":
		ids, err := s.usage.ListAssetIDsByUsage(workspaceID, userID, "", AssetHighFrequencyThreshold, false)
		return AssetLibraryUsageIDs{IDs: ids}, err
	case "unused":
		ids, err := s.usage.ListAssetIDsByUsage(workspaceID, userID, "", 0, true)
		return AssetLibraryUsageIDs{IDs: ids, Exclude: true}, err
	case "":
		return AssetLibraryUsageIDs{}, nil
	default:
		return AssetLibraryUsageIDs{}, ErrAssetLibrarySmartView
	}
}

func (s *AssetUsageService) UserState(assetID string, userID string, scope string) (model.AssetUserState, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	if _, err := s.assets.GetByWorkspace(assetID, workspaceID); err != nil {
		return model.AssetUserState{}, err
	}
	return s.usage.GetUserState(workspaceID, assetID, userID)
}

func (s *AssetUsageService) PutUserState(assetID string, userID string, scope string, input AssetUserStateInput) (model.AssetUserState, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	assetID = strings.TrimSpace(assetID)
	if _, err := s.assets.GetByWorkspace(assetID, workspaceID); err != nil {
		return model.AssetUserState{}, err
	}
	previous, err := s.usage.GetUserState(workspaceID, assetID, userID)
	if err != nil {
		return model.AssetUserState{}, err
	}
	reaction := strings.TrimSpace(strings.ToLower(input.Reaction))
	if reaction == "" {
		reaction = previous.Reaction
	}
	if reaction != model.AssetReactionNone && reaction != model.AssetReactionFavorite && reaction != model.AssetReactionDislike {
		return model.AssetUserState{}, ErrAssetReaction
	}
	privateNote := previous.PrivateNote
	if input.PrivateNote != nil {
		privateNote = strings.TrimSpace(*input.PrivateNote)
	}
	if len([]rune(privateNote)) > AssetPrivateNoteMaxLength {
		return model.AssetUserState{}, ErrAssetPrivateNote
	}
	return s.usage.PutUserState(model.AssetUserState{
		ID: assetUserStateID(assetID, userID), AssetID: assetID, UserID: userID, WorkspaceID: workspaceID,
		Reaction: reaction, PrivateNote: privateNote,
	})
}

func (s *AssetUsageService) Events(assetID string, userID string, scope string, page int, pageSize int) (AssetUsageEventPage, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	if _, err := s.assets.GetByWorkspace(assetID, workspaceID); err != nil {
		return AssetUsageEventPage{}, err
	}
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}
	events, total, err := s.usage.ListEvents(workspaceID, assetID, page, pageSize)
	if err != nil {
		return AssetUsageEventPage{}, err
	}
	views := make([]AssetUsageEventView, 0, len(events))
	for _, event := range events {
		views = append(views, AssetUsageEventView{ID: event.ID, EventType: event.EventType, ContextType: event.ContextType, OccurredAt: event.OccurredAt})
	}
	return AssetUsageEventPage{Items: views, Total: total, Page: page, PageSize: pageSize}, nil
}

func (s *AssetUsageService) ReconcileWorkspace(workspaceID string) (int, error) {
	assets, err := s.assets.ListByWorkspace(workspaceID)
	if err != nil {
		return 0, err
	}
	assetIDs := make([]string, 0, len(assets))
	for _, asset := range assets {
		assetIDs = append(assetIDs, asset.ID)
	}
	if err := s.usage.Reconcile(workspaceID, assetIDs); err != nil {
		return 0, err
	}
	for _, assetID := range assetIDs {
		references, err := s.references.ListByAssetIDs(workspaceID, []string{assetID})
		if err != nil {
			return 0, err
		}
		children, err := s.lineage.ListByParent(workspaceID, assetID)
		if err != nil {
			return 0, err
		}
		if err := s.usage.SetStructuralCounts(workspaceID, assetID, int64(len(references)), int64(len(children))); err != nil {
			return 0, err
		}
	}
	return len(assetIDs), nil
}

func (s *AssetUsageService) recordForAssets(workspaceID string, userID string, eventType string, contextType string, contextID string, assetIDs []string) error {
	assetIDs = uniqueAssetStrings(assetIDs)
	if len(assetIDs) == 0 {
		return nil
	}
	assets, err := s.assets.ListByWorkspaceIDs(assetIDs, workspaceID)
	if err != nil {
		return err
	}
	if len(assets) != len(assetIDs) {
		return repository.ErrAssetNotFound
	}
	for _, assetID := range assetIDs {
		key := strings.Join([]string{eventType, contextType, contextID, assetID}, ":")
		if _, err := s.usage.RecordEvent(newAssetUsageEvent(workspaceID, assetID, userID, eventType, contextType, contextID, key)); err != nil {
			return err
		}
	}
	return nil
}

func newAssetUsageEvent(workspaceID string, assetID string, userID string, eventType string, contextType string, contextID string, idempotencyKey string) model.AssetUsageEvent {
	now := time.Now().UTC()
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if idempotencyKey == "" {
		idempotencyKey = strings.Join([]string{eventType, contextType, contextID, assetID, now.Format(time.RFC3339Nano)}, ":")
	}
	digest := sha256.Sum256([]byte(idempotencyKey))
	return model.AssetUsageEvent{
		ID: "asset_usage_" + hex.EncodeToString(digest[:12]), WorkspaceID: workspaceID, AssetID: assetID, UserID: userID,
		EventType: eventType, ContextType: contextType, ContextID: contextID, IdempotencyKey: idempotencyKey, OccurredAt: now,
	}
}

func assetUserStateID(assetID string, userID string) string {
	digest := sha256.Sum256([]byte(assetID + "\x00" + userID))
	return "asset_user_state_" + hex.EncodeToString(digest[:12])
}
