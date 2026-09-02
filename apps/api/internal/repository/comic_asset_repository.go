package repository

import (
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrComicAssetProjectNotFound     = errors.New("comic asset project not found")
	ErrComicAssetNotFound            = errors.New("comic asset not found")
	ErrComicAssetBatchNotFound       = errors.New("comic asset generation batch not found")
	ErrComicAssetBatchItemNotFound   = errors.New("comic asset generation item not found")
	ErrComicAnalysisSessionNotFound  = errors.New("comic asset analysis session not found")
	ErrComicAnalysisRevisionNotFound = errors.New("comic asset analysis revision not found")
	ErrComicAssetConflict            = errors.New("comic asset conflict")
	ErrComicAssetInvalidState        = errors.New("comic asset state transition is not allowed")
)

type ComicAssetRepository interface {
	ListProjects(workspaceID string) ([]model.ComicAssetProject, error)
	GetProject(id string, workspaceID string) (model.ComicAssetProject, error)
	CreateProject(project model.ComicAssetProject) (model.ComicAssetProject, error)
	CreateProjectWithAssets(project model.ComicAssetProject, assets []model.ComicAsset) (model.ComicAssetProject, []model.ComicAsset, error)
	UpdateProject(project model.ComicAssetProject, workspaceID string) (model.ComicAssetProject, error)
	DeleteProject(id string, workspaceID string) error

	ListAssets(projectID string, workspaceID string) ([]model.ComicAsset, error)
	GetAsset(projectID string, assetID string, workspaceID string) (model.ComicAsset, error)
	CreateAsset(asset model.ComicAsset, workspaceID string) (model.ComicAsset, error)
	UpdateAsset(asset model.ComicAsset, workspaceID string) (model.ComicAsset, error)
	DeleteAsset(projectID string, assetID string, workspaceID string) error
	UpdateAssetIfPromptVersion(asset model.ComicAsset, workspaceID string, expectedVersion int) (model.ComicAsset, error)

	CreateAnalysisSession(session model.ComicAssetAnalysisSession, revision model.ComicAssetAnalysisRevision) (model.ComicAssetAnalysisSession, model.ComicAssetAnalysisRevision, error)
	GetAnalysisSession(id string, workspaceID string) (model.ComicAssetAnalysisSession, []model.ComicAssetAnalysisRevision, error)
	CreateAnalysisRevision(sessionID string, workspaceID string, expectedActiveRevisionID string, revision model.ComicAssetAnalysisRevision) (model.ComicAssetAnalysisSession, []model.ComicAssetAnalysisRevision, error)
	SetActiveAnalysisRevision(sessionID string, revisionID string, workspaceID string) (model.ComicAssetAnalysisSession, []model.ComicAssetAnalysisRevision, error)
	ConfirmAnalysisSession(sessionID string, revisionID string, workspaceID string, project model.ComicAssetProject, assets []model.ComicAsset) (model.ComicAssetAnalysisSession, model.ComicAssetProject, []model.ComicAsset, error)
	ListExpiredAnalysisSessions(now time.Time) ([]model.ComicAssetAnalysisSession, error)
	DeleteExpiredAnalysisSession(sessionID string, now time.Time) error

	CreateBatch(batch model.ComicAssetGenerationBatch, items []model.ComicAssetGenerationItem) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error)
	GetBatchByIdempotencyKey(key string) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error)
	ListBatches(projectID string, workspaceID string) ([]model.ComicAssetGenerationBatch, error)
	GetBatch(id string, workspaceID string) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error)
	GetBatchInternal(id string) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error)
	ListActiveBatches() ([]model.ComicAssetGenerationBatch, error)
	ClaimPendingItems(batchID string) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error)
	RecoverUnassignedItems(batchID string, staleBefore time.Time) error
	SetItemJob(itemID string, attempt int, jobID string) error
	SyncItemFromJob(itemID string, jobID string, status string, outputAssetID string, errorPayload model.JSONB) error
	ControlBatch(batchID string, workspaceID string, action string) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error)
	RetryBatchItems(batchID string, workspaceID string, itemIDs []string) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error)
	HasActiveOutputFolder(folderIDs []string, workspaceID string) (bool, error)
}

type MemoryComicAssetRepository struct {
	mu                sync.Mutex
	projects          map[string]model.ComicAssetProject
	assets            map[string]model.ComicAsset
	batches           map[string]model.ComicAssetGenerationBatch
	items             map[string]model.ComicAssetGenerationItem
	analysisSessions  map[string]model.ComicAssetAnalysisSession
	analysisRevisions map[string]model.ComicAssetAnalysisRevision
}

func NewMemoryComicAssetRepository() *MemoryComicAssetRepository {
	return &MemoryComicAssetRepository{
		projects:          make(map[string]model.ComicAssetProject),
		assets:            make(map[string]model.ComicAsset),
		batches:           make(map[string]model.ComicAssetGenerationBatch),
		items:             make(map[string]model.ComicAssetGenerationItem),
		analysisSessions:  make(map[string]model.ComicAssetAnalysisSession),
		analysisRevisions: make(map[string]model.ComicAssetAnalysisRevision),
	}
}

func (r *MemoryComicAssetRepository) ListProjects(workspaceID string) ([]model.ComicAssetProject, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	projects := make([]model.ComicAssetProject, 0)
	for _, project := range r.projects {
		if project.WorkspaceID == workspaceID {
			projects = append(projects, project)
		}
	}
	sort.Slice(projects, func(i, j int) bool { return projects[i].UpdatedAt.After(projects[j].UpdatedAt) })
	return projects, nil
}

func (r *MemoryComicAssetRepository) GetProject(id string, workspaceID string) (model.ComicAssetProject, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.getProjectLocked(id, workspaceID)
}

func (r *MemoryComicAssetRepository) getProjectLocked(id string, workspaceID string) (model.ComicAssetProject, error) {
	project, ok := r.projects[id]
	if !ok || (workspaceID != "" && project.WorkspaceID != workspaceID) {
		return model.ComicAssetProject{}, ErrComicAssetProjectNotFound
	}
	return project, nil
}

func (r *MemoryComicAssetRepository) CreateProject(project model.ComicAssetProject) (model.ComicAssetProject, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.projects[project.ID]; exists {
		return model.ComicAssetProject{}, ErrComicAssetConflict
	}
	now := time.Now().UTC()
	project.CreatedAt = now
	project.UpdatedAt = now
	r.projects[project.ID] = project
	return project, nil
}

func (r *MemoryComicAssetRepository) CreateProjectWithAssets(project model.ComicAssetProject, assets []model.ComicAsset) (model.ComicAssetProject, []model.ComicAsset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.projects[project.ID]; exists {
		return model.ComicAssetProject{}, nil, ErrComicAssetConflict
	}
	seenIDs := make(map[string]bool, len(assets))
	seenCodes := make(map[string]bool, len(assets))
	for _, asset := range assets {
		if asset.ID == "" || asset.ProjectID != project.ID || asset.Code == "" || seenIDs[asset.ID] || seenCodes[asset.Code] {
			return model.ComicAssetProject{}, nil, ErrComicAssetConflict
		}
		if _, exists := r.assets[asset.ID]; exists {
			return model.ComicAssetProject{}, nil, ErrComicAssetConflict
		}
		seenIDs[asset.ID] = true
		seenCodes[asset.Code] = true
	}
	now := time.Now().UTC()
	project.CreatedAt = now
	project.UpdatedAt = now
	createdAssets := make([]model.ComicAsset, len(assets))
	for index, asset := range assets {
		asset.CreatedAt = now
		asset.UpdatedAt = now
		createdAssets[index] = asset
	}
	r.projects[project.ID] = project
	for _, asset := range createdAssets {
		r.assets[asset.ID] = asset
	}
	return project, createdAssets, nil
}

func (r *MemoryComicAssetRepository) UpdateProject(project model.ComicAssetProject, workspaceID string) (model.ComicAssetProject, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, err := r.getProjectLocked(project.ID, workspaceID)
	if err != nil {
		return model.ComicAssetProject{}, err
	}
	project.OwnerID = current.OwnerID
	project.WorkspaceID = current.WorkspaceID
	project.CreatedAt = current.CreatedAt
	project.UpdatedAt = time.Now().UTC()
	r.projects[project.ID] = project
	return project, nil
}

func (r *MemoryComicAssetRepository) DeleteProject(id string, workspaceID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, err := r.getProjectLocked(id, workspaceID); err != nil {
		return err
	}
	delete(r.projects, id)
	batchIDs := make(map[string]bool)
	for assetID, asset := range r.assets {
		if asset.ProjectID == id {
			delete(r.assets, assetID)
		}
	}
	for batchID, batch := range r.batches {
		if batch.ProjectID == id {
			batchIDs[batchID] = true
			delete(r.batches, batchID)
		}
	}
	for itemID, item := range r.items {
		if batchIDs[item.BatchID] {
			delete(r.items, itemID)
		}
	}
	return nil
}

func (r *MemoryComicAssetRepository) ListAssets(projectID string, workspaceID string) ([]model.ComicAsset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, err := r.getProjectLocked(projectID, workspaceID); err != nil {
		return nil, err
	}
	assets := r.listAssetsLocked(projectID)
	return assets, nil
}

func (r *MemoryComicAssetRepository) listAssetsLocked(projectID string) []model.ComicAsset {
	assets := make([]model.ComicAsset, 0)
	for _, asset := range r.assets {
		if asset.ProjectID == projectID {
			assets = append(assets, asset)
		}
	}
	sort.Slice(assets, func(i, j int) bool {
		if assets[i].Class == assets[j].Class {
			return assets[i].Code < assets[j].Code
		}
		return assets[i].Class < assets[j].Class
	})
	return assets
}

func (r *MemoryComicAssetRepository) GetAsset(projectID string, assetID string, workspaceID string) (model.ComicAsset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, err := r.getProjectLocked(projectID, workspaceID); err != nil {
		return model.ComicAsset{}, err
	}
	return r.getAssetLocked(projectID, assetID)
}

func (r *MemoryComicAssetRepository) getAssetLocked(projectID string, assetID string) (model.ComicAsset, error) {
	asset, ok := r.assets[assetID]
	if !ok || asset.ProjectID != projectID {
		return model.ComicAsset{}, ErrComicAssetNotFound
	}
	return asset, nil
}

func (r *MemoryComicAssetRepository) CreateAsset(asset model.ComicAsset, workspaceID string) (model.ComicAsset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, err := r.getProjectLocked(asset.ProjectID, workspaceID); err != nil {
		return model.ComicAsset{}, err
	}
	if _, exists := r.assets[asset.ID]; exists || r.assetCodeExistsLocked(asset.ProjectID, asset.Code, "") {
		return model.ComicAsset{}, ErrComicAssetConflict
	}
	now := time.Now().UTC()
	asset.CreatedAt = now
	asset.UpdatedAt = now
	r.assets[asset.ID] = asset
	return asset, nil
}

func (r *MemoryComicAssetRepository) UpdateAsset(asset model.ComicAsset, workspaceID string) (model.ComicAsset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, err := r.getProjectLocked(asset.ProjectID, workspaceID); err != nil {
		return model.ComicAsset{}, err
	}
	current, err := r.getAssetLocked(asset.ProjectID, asset.ID)
	if err != nil {
		return model.ComicAsset{}, err
	}
	if r.assetCodeExistsLocked(asset.ProjectID, asset.Code, asset.ID) {
		return model.ComicAsset{}, ErrComicAssetConflict
	}
	asset.CreatedAt = current.CreatedAt
	asset.UpdatedAt = time.Now().UTC()
	r.assets[asset.ID] = asset
	return asset, nil
}

func (r *MemoryComicAssetRepository) assetCodeExistsLocked(projectID string, code string, excludeID string) bool {
	for _, asset := range r.assets {
		if asset.ProjectID == projectID && asset.Code == code && asset.ID != excludeID {
			return true
		}
	}
	return false
}

func (r *MemoryComicAssetRepository) DeleteAsset(projectID string, assetID string, workspaceID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, err := r.getProjectLocked(projectID, workspaceID); err != nil {
		return err
	}
	if _, err := r.getAssetLocked(projectID, assetID); err != nil {
		return err
	}
	delete(r.assets, assetID)
	return nil
}

func (r *MemoryComicAssetRepository) HasActiveOutputFolder(folderIDs []string, workspaceID string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	wanted := make(map[string]bool, len(folderIDs))
	for _, id := range folderIDs {
		wanted[id] = true
	}
	for _, item := range r.items {
		if !wanted[item.OutputFolderID] {
			continue
		}
		batch, ok := r.batches[item.BatchID]
		if ok && batch.WorkspaceID == workspaceID && comicBatchIsActiveForFolder(batch.Status) {
			return true, nil
		}
	}
	return false, nil
}

func (r *MemoryComicAssetRepository) CreateBatch(batch model.ComicAssetGenerationBatch, items []model.ComicAssetGenerationItem) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, existing := range r.batches {
		if existing.IdempotencyKey != "" && existing.IdempotencyKey == batch.IdempotencyKey {
			if existing.RequestFingerprint != batch.RequestFingerprint {
				return model.ComicAssetGenerationBatch{}, nil, ErrComicAssetConflict
			}
			return existing, r.listBatchItemsLocked(existing.ID), nil
		}
	}
	if _, err := r.getProjectLocked(batch.ProjectID, batch.WorkspaceID); err != nil {
		return model.ComicAssetGenerationBatch{}, nil, ErrComicAssetProjectNotFound
	}
	if _, exists := r.batches[batch.ID]; exists {
		return model.ComicAssetGenerationBatch{}, nil, ErrComicAssetConflict
	}
	seenItems := make(map[string]bool, len(items))
	for _, item := range items {
		if _, exists := r.items[item.ID]; exists || seenItems[item.ID] || item.BatchID != batch.ID {
			return model.ComicAssetGenerationBatch{}, nil, ErrComicAssetConflict
		}
		seenItems[item.ID] = true
		asset, exists := r.assets[item.ComicAssetID]
		if !exists || asset.ProjectID != batch.ProjectID {
			return model.ComicAssetGenerationBatch{}, nil, ErrComicAssetNotFound
		}
	}
	now := time.Now().UTC()
	batch.CreatedAt = now
	batch.UpdatedAt = now
	batch.Total = len(items)
	batch.Pending = len(items)
	r.batches[batch.ID] = batch
	for index := range items {
		items[index].CreatedAt = now
		items[index].UpdatedAt = now
		r.items[items[index].ID] = items[index]
	}
	return batch, append([]model.ComicAssetGenerationItem(nil), items...), nil
}

func (r *MemoryComicAssetRepository) GetBatchByIdempotencyKey(key string) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, batch := range r.batches {
		if batch.IdempotencyKey == key {
			return batch, r.listBatchItemsLocked(batch.ID), nil
		}
	}
	return model.ComicAssetGenerationBatch{}, nil, ErrComicAssetBatchNotFound
}

func (r *MemoryComicAssetRepository) RecoverUnassignedItems(batchID string, staleBefore time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	batch, ok := r.batches[batchID]
	if !ok {
		return ErrComicAssetBatchNotFound
	}
	now := time.Now().UTC()
	for itemID, item := range r.items {
		if item.BatchID != batchID || item.Status != model.ComicBatchItemStatusQueued || item.JobID != "" || item.UpdatedAt.After(staleBefore) {
			continue
		}
		if batch.Status == model.ComicBatchStatusStopping {
			item.Status = model.ComicBatchItemStatusCanceled
		} else {
			item.Status = model.ComicBatchItemStatusPending
		}
		item.UpdatedAt = now
		r.items[itemID] = item
	}
	r.refreshBatchLocked(batchID)
	return nil
}

func (r *MemoryComicAssetRepository) ListBatches(projectID string, workspaceID string) ([]model.ComicAssetGenerationBatch, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, err := r.getProjectLocked(projectID, workspaceID); err != nil {
		return nil, err
	}
	batches := make([]model.ComicAssetGenerationBatch, 0)
	for _, batch := range r.batches {
		if batch.ProjectID == projectID && batch.WorkspaceID == workspaceID {
			batches = append(batches, batch)
		}
	}
	sort.Slice(batches, func(i, j int) bool { return batches[i].CreatedAt.After(batches[j].CreatedAt) })
	return batches, nil
}

func (r *MemoryComicAssetRepository) GetBatch(id string, workspaceID string) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.getBatchLocked(id, workspaceID)
}

func (r *MemoryComicAssetRepository) GetBatchInternal(id string) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.getBatchLocked(id, "")
}

func (r *MemoryComicAssetRepository) getBatchLocked(id string, workspaceID string) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error) {
	batch, ok := r.batches[id]
	if !ok || (workspaceID != "" && batch.WorkspaceID != workspaceID) {
		return model.ComicAssetGenerationBatch{}, nil, ErrComicAssetBatchNotFound
	}
	items := r.listBatchItemsLocked(id)
	return batch, items, nil
}

func (r *MemoryComicAssetRepository) listBatchItemsLocked(batchID string) []model.ComicAssetGenerationItem {
	items := make([]model.ComicAssetGenerationItem, 0)
	for _, item := range r.items {
		if item.BatchID == batchID {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Position < items[j].Position })
	return items
}

func (r *MemoryComicAssetRepository) ListActiveBatches() ([]model.ComicAssetGenerationBatch, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	batches := make([]model.ComicAssetGenerationBatch, 0)
	for _, batch := range r.batches {
		if isActiveComicBatchStatus(batch.Status) {
			batches = append(batches, batch)
		}
	}
	sort.Slice(batches, func(i, j int) bool { return batches[i].CreatedAt.Before(batches[j].CreatedAt) })
	return batches, nil
}

func (r *MemoryComicAssetRepository) ClaimPendingItems(batchID string) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	batch, ok := r.batches[batchID]
	if !ok {
		return model.ComicAssetGenerationBatch{}, nil, ErrComicAssetBatchNotFound
	}
	if batch.Status != model.ComicBatchStatusQueued && batch.Status != model.ComicBatchStatusRunning {
		return batch, nil, nil
	}
	items := r.listBatchItemsLocked(batchID)
	active := 0
	for _, item := range items {
		if isActiveComicItemStatus(item.Status) {
			active++
		}
	}
	available := batch.Concurrency - active
	claimed := make([]model.ComicAssetGenerationItem, 0, maxInt(available, 0))
	now := time.Now().UTC()
	for _, item := range items {
		if available <= 0 {
			break
		}
		if item.Status != model.ComicBatchItemStatusPending {
			continue
		}
		item.Status = model.ComicBatchItemStatusQueued
		item.UpdatedAt = now
		r.items[item.ID] = item
		claimed = append(claimed, item)
		available--
	}
	if len(claimed) > 0 {
		batch.Status = model.ComicBatchStatusRunning
		if batch.StartedAt == nil {
			started := now
			batch.StartedAt = &started
		}
		batch.UpdatedAt = now
		r.batches[batch.ID] = batch
	}
	r.refreshBatchLocked(batchID)
	batch = r.batches[batchID]
	return batch, claimed, nil
}

func (r *MemoryComicAssetRepository) SetItemJob(itemID string, attempt int, jobID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.items[itemID]
	if !ok {
		return ErrComicAssetBatchItemNotFound
	}
	if item.Attempt != attempt {
		return nil
	}
	if item.Status != model.ComicBatchItemStatusQueued || (item.JobID != "" && item.JobID != jobID) {
		return nil
	}
	item.JobID = jobID
	item.UpdatedAt = time.Now().UTC()
	r.items[item.ID] = item
	return nil
}

func (r *MemoryComicAssetRepository) SyncItemFromJob(itemID string, jobID string, status string, outputAssetID string, errorPayload model.JSONB) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.items[itemID]
	if !ok {
		return ErrComicAssetBatchItemNotFound
	}
	if item.JobID != jobID || isTerminalComicItemStatus(item.Status) {
		return nil
	}
	now := time.Now().UTC()
	switch status {
	case model.JobStatusQueued:
		item.Status = model.ComicBatchItemStatusQueued
	case model.JobStatusRunning:
		item.Status = model.ComicBatchItemStatusRunning
	case model.JobStatusSucceeded:
		if outputAssetID == "" {
			item.Status = model.ComicBatchItemStatusFailed
			item.Error = model.JSONB(`{"message":"generated job did not return an asset","code":"missing_output_asset"}`)
			break
		}
		asset, exists := r.assets[item.ComicAssetID]
		if !exists {
			return ErrComicAssetNotFound
		}
		outputs := decodeComicOutputs(asset.Outputs)
		if !comicOutputContainsItem(outputs, item.ID) {
			asset.OutputVersion++
			outputs = append(outputs, model.ComicAssetOutput{Version: asset.OutputVersion, AssetID: outputAssetID, BatchID: item.BatchID, BatchItemID: item.ID, CreatedAt: now})
			asset.Outputs = encodeRepositoryJSON(outputs, model.JSONB("[]"))
			asset.ArchiveStatus = model.ComicAssetArchiveArchived
			asset.UpdatedAt = now
			r.assets[asset.ID] = asset
		}
		item.Status = model.ComicBatchItemStatusSucceeded
		item.OutputAssetID = outputAssetID
		item.OutputVersion = asset.OutputVersion
		item.Error = model.JSONB("{}")
	case model.JobStatusFailed:
		item.Status = model.ComicBatchItemStatusFailed
		item.Error = normalizeRepositoryJSON(errorPayload, "{}")
		if asset, exists := r.assets[item.ComicAssetID]; exists {
			if asset.OutputVersion == 0 {
				asset.ArchiveStatus = model.ComicAssetArchiveFailed
				asset.UpdatedAt = now
				r.assets[asset.ID] = asset
			}
		}
	case model.JobStatusCanceled:
		item.Status = model.ComicBatchItemStatusCanceled
		item.Error = normalizeRepositoryJSON(errorPayload, "{}")
	default:
		return nil
	}
	item.UpdatedAt = now
	r.items[item.ID] = item
	r.refreshBatchLocked(item.BatchID)
	return nil
}

func (r *MemoryComicAssetRepository) ControlBatch(batchID string, workspaceID string, action string) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	batch, _, err := r.getBatchLocked(batchID, workspaceID)
	if err != nil {
		return model.ComicAssetGenerationBatch{}, nil, err
	}
	now := time.Now().UTC()
	switch action {
	case "pause":
		if batch.Status != model.ComicBatchStatusQueued && batch.Status != model.ComicBatchStatusRunning {
			return model.ComicAssetGenerationBatch{}, nil, ErrComicAssetInvalidState
		}
		batch.Status = model.ComicBatchStatusPaused
	case "resume":
		if batch.Status != model.ComicBatchStatusPaused {
			return model.ComicAssetGenerationBatch{}, nil, ErrComicAssetInvalidState
		}
		batch.Status = model.ComicBatchStatusQueued
		batch.FinishedAt = nil
	case "stop":
		if isTerminalComicBatchStatus(batch.Status) {
			return r.getBatchLocked(batchID, workspaceID)
		}
		batch.Status = model.ComicBatchStatusStopping
		for itemID, item := range r.items {
			if item.BatchID == batchID && item.Status == model.ComicBatchItemStatusPending {
				item.Status = model.ComicBatchItemStatusCanceled
				item.UpdatedAt = now
				r.items[itemID] = item
			}
		}
	default:
		return model.ComicAssetGenerationBatch{}, nil, ErrComicAssetInvalidState
	}
	batch.UpdatedAt = now
	r.batches[batch.ID] = batch
	r.refreshBatchLocked(batch.ID)
	return r.getBatchLocked(batchID, workspaceID)
}

func (r *MemoryComicAssetRepository) RetryBatchItems(batchID string, workspaceID string, itemIDs []string) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	batch, _, err := r.getBatchLocked(batchID, workspaceID)
	if err != nil {
		return model.ComicAssetGenerationBatch{}, nil, err
	}
	selected := make(map[string]bool, len(itemIDs))
	for _, itemID := range itemIDs {
		selected[itemID] = true
	}
	now := time.Now().UTC()
	changed := 0
	for itemID, item := range r.items {
		if item.BatchID != batchID || item.Status != model.ComicBatchItemStatusFailed || (len(selected) > 0 && !selected[itemID]) {
			continue
		}
		item.Status = model.ComicBatchItemStatusPending
		item.Attempt++
		item.JobID = ""
		item.OutputAssetID = ""
		item.OutputVersion = 0
		item.Error = model.JSONB("{}")
		item.UpdatedAt = now
		r.items[itemID] = item
		if asset, exists := r.assets[item.ComicAssetID]; exists && asset.OutputVersion == 0 {
			asset.ArchiveStatus = model.ComicAssetArchivePending
			asset.UpdatedAt = now
			r.assets[asset.ID] = asset
		}
		changed++
	}
	if changed == 0 {
		return model.ComicAssetGenerationBatch{}, nil, ErrComicAssetInvalidState
	}
	batch.Status = model.ComicBatchStatusQueued
	batch.FinishedAt = nil
	batch.UpdatedAt = now
	r.batches[batch.ID] = batch
	r.refreshBatchLocked(batch.ID)
	return r.getBatchLocked(batchID, workspaceID)
}

func (r *MemoryComicAssetRepository) refreshBatchLocked(batchID string) {
	batch, ok := r.batches[batchID]
	if !ok {
		return
	}
	items := r.listBatchItemsLocked(batchID)
	applyComicBatchCounts(&batch, items, time.Now().UTC())
	r.batches[batch.ID] = batch
}

type GormComicAssetRepository struct {
	db *gorm.DB
}

func NewGormComicAssetRepository(db *gorm.DB) *GormComicAssetRepository {
	return &GormComicAssetRepository{db: db}
}

func (r *GormComicAssetRepository) ListProjects(workspaceID string) ([]model.ComicAssetProject, error) {
	var projects []model.ComicAssetProject
	return projects, r.db.Where("workspace_id = ?", workspaceID).Order("updated_at DESC").Find(&projects).Error
}

func (r *GormComicAssetRepository) GetProject(id string, workspaceID string) (model.ComicAssetProject, error) {
	var project model.ComicAssetProject
	err := r.db.First(&project, "id = ? AND workspace_id = ?", id, workspaceID).Error
	return project, mapComicAssetGormError(err, ErrComicAssetProjectNotFound)
}

func (r *GormComicAssetRepository) CreateProject(project model.ComicAssetProject) (model.ComicAssetProject, error) {
	now := time.Now().UTC()
	project.CreatedAt = now
	project.UpdatedAt = now
	if err := r.db.Create(&project).Error; err != nil {
		return model.ComicAssetProject{}, mapComicAssetConflict(err)
	}
	return project, nil
}

func (r *GormComicAssetRepository) CreateProjectWithAssets(project model.ComicAssetProject, assets []model.ComicAsset) (model.ComicAssetProject, []model.ComicAsset, error) {
	seenIDs := make(map[string]bool, len(assets))
	seenCodes := make(map[string]bool, len(assets))
	for _, asset := range assets {
		if asset.ID == "" || asset.ProjectID != project.ID || asset.Code == "" || seenIDs[asset.ID] || seenCodes[asset.Code] {
			return model.ComicAssetProject{}, nil, ErrComicAssetConflict
		}
		seenIDs[asset.ID] = true
		seenCodes[asset.Code] = true
	}
	now := time.Now().UTC()
	project.CreatedAt = now
	project.UpdatedAt = now
	createdAssets := make([]model.ComicAsset, len(assets))
	copy(createdAssets, assets)
	for index := range createdAssets {
		createdAssets[index].CreatedAt = now
		createdAssets[index].UpdatedAt = now
	}
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&project).Error; err != nil {
			return mapComicAssetConflict(err)
		}
		if len(createdAssets) > 0 {
			if err := tx.Create(&createdAssets).Error; err != nil {
				return mapComicAssetConflict(err)
			}
		}
		return nil
	})
	if err != nil {
		return model.ComicAssetProject{}, nil, err
	}
	return project, createdAssets, nil
}

func (r *GormComicAssetRepository) UpdateProject(project model.ComicAssetProject, workspaceID string) (model.ComicAssetProject, error) {
	current, err := r.GetProject(project.ID, workspaceID)
	if err != nil {
		return model.ComicAssetProject{}, err
	}
	project.OwnerID = current.OwnerID
	project.WorkspaceID = current.WorkspaceID
	project.CreatedAt = current.CreatedAt
	project.UpdatedAt = time.Now().UTC()
	if err := r.db.Save(&project).Error; err != nil {
		return model.ComicAssetProject{}, mapComicAssetConflict(err)
	}
	return project, nil
}

func (r *GormComicAssetRepository) DeleteProject(id string, workspaceID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var project model.ComicAssetProject
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&project, "id = ? AND workspace_id = ?", id, workspaceID).Error; err != nil {
			return mapComicAssetGormError(err, ErrComicAssetProjectNotFound)
		}
		var batchIDs []string
		if err := tx.Model(&model.ComicAssetGenerationBatch{}).Where("project_id = ?", id).Pluck("id", &batchIDs).Error; err != nil {
			return err
		}
		if len(batchIDs) > 0 {
			if err := tx.Where("batch_id IN ?", batchIDs).Delete(&model.ComicAssetGenerationItem{}).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.ComicAssetGenerationBatch{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.ComicAsset{}).Error; err != nil {
			return err
		}
		return tx.Delete(&model.ComicAssetProject{}, "id = ?", id).Error
	})
}

func (r *GormComicAssetRepository) ListAssets(projectID string, workspaceID string) ([]model.ComicAsset, error) {
	if _, err := r.GetProject(projectID, workspaceID); err != nil {
		return nil, err
	}
	var assets []model.ComicAsset
	return assets, r.db.Where("project_id = ?", projectID).Order("class ASC, code ASC").Find(&assets).Error
}

func (r *GormComicAssetRepository) GetAsset(projectID string, assetID string, workspaceID string) (model.ComicAsset, error) {
	if _, err := r.GetProject(projectID, workspaceID); err != nil {
		return model.ComicAsset{}, err
	}
	var asset model.ComicAsset
	err := r.db.First(&asset, "id = ? AND project_id = ?", assetID, projectID).Error
	return asset, mapComicAssetGormError(err, ErrComicAssetNotFound)
}

func (r *GormComicAssetRepository) CreateAsset(asset model.ComicAsset, workspaceID string) (model.ComicAsset, error) {
	if _, err := r.GetProject(asset.ProjectID, workspaceID); err != nil {
		return model.ComicAsset{}, err
	}
	now := time.Now().UTC()
	asset.CreatedAt = now
	asset.UpdatedAt = now
	if err := r.db.Create(&asset).Error; err != nil {
		return model.ComicAsset{}, mapComicAssetConflict(err)
	}
	return asset, nil
}

func (r *GormComicAssetRepository) UpdateAsset(asset model.ComicAsset, workspaceID string) (model.ComicAsset, error) {
	current, err := r.GetAsset(asset.ProjectID, asset.ID, workspaceID)
	if err != nil {
		return model.ComicAsset{}, err
	}
	asset.CreatedAt = current.CreatedAt
	asset.UpdatedAt = time.Now().UTC()
	if err := r.db.Save(&asset).Error; err != nil {
		return model.ComicAsset{}, mapComicAssetConflict(err)
	}
	return asset, nil
}

func (r *GormComicAssetRepository) DeleteAsset(projectID string, assetID string, workspaceID string) error {
	if _, err := r.GetAsset(projectID, assetID, workspaceID); err != nil {
		return err
	}
	result := r.db.Delete(&model.ComicAsset{}, "id = ? AND project_id = ?", assetID, projectID)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrComicAssetNotFound
	}
	return nil
}

func (r *GormComicAssetRepository) HasActiveOutputFolder(folderIDs []string, workspaceID string) (bool, error) {
	if len(folderIDs) == 0 {
		return false, nil
	}
	var count int64
	err := r.db.Table("comic_asset_generation_items AS items").
		Joins("JOIN comic_asset_generation_batches AS batches ON batches.id = items.batch_id").
		Where("items.output_folder_id IN ? AND batches.workspace_id = ? AND batches.status IN ?", folderIDs, workspaceID, []string{
			model.ComicBatchStatusQueued,
			model.ComicBatchStatusRunning,
			model.ComicBatchStatusPaused,
			model.ComicBatchStatusStopping,
		}).
		Count(&count).Error
	return count > 0, err
}

func (r *GormComicAssetRepository) CreateBatch(batch model.ComicAssetGenerationBatch, items []model.ComicAssetGenerationItem) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error) {
	seenItems := make(map[string]bool, len(items))
	assetIDs := make([]string, 0, len(items))
	seenAssets := make(map[string]bool, len(items))
	for _, item := range items {
		if item.BatchID != batch.ID || seenItems[item.ID] {
			return model.ComicAssetGenerationBatch{}, nil, ErrComicAssetConflict
		}
		seenItems[item.ID] = true
		if !seenAssets[item.ComicAssetID] {
			seenAssets[item.ComicAssetID] = true
			assetIDs = append(assetIDs, item.ComicAssetID)
		}
	}
	now := time.Now().UTC()
	batch.CreatedAt = now
	batch.UpdatedAt = now
	batch.Total = len(items)
	batch.Pending = len(items)
	for index := range items {
		items[index].CreatedAt = now
		items[index].UpdatedAt = now
	}
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var project model.ComicAssetProject
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&project, "id = ? AND workspace_id = ?", batch.ProjectID, batch.WorkspaceID).Error; err != nil {
			return mapComicAssetGormError(err, ErrComicAssetProjectNotFound)
		}
		if len(assetIDs) > 0 {
			var assetCount int64
			if err := tx.Model(&model.ComicAsset{}).Where("project_id = ? AND id IN ?", batch.ProjectID, assetIDs).Count(&assetCount).Error; err != nil {
				return err
			}
			if assetCount != int64(len(assetIDs)) {
				return ErrComicAssetNotFound
			}
		}
		if err := tx.Create(&batch).Error; err != nil {
			return mapComicAssetConflict(err)
		}
		if len(items) > 0 {
			if err := tx.Create(&items).Error; err != nil {
				return mapComicAssetConflict(err)
			}
		}
		return nil
	})
	if err != nil && batch.IdempotencyKey != "" {
		existing, existingItems, lookupErr := r.GetBatchByIdempotencyKey(batch.IdempotencyKey)
		if lookupErr == nil {
			if existing.RequestFingerprint != batch.RequestFingerprint {
				return model.ComicAssetGenerationBatch{}, nil, ErrComicAssetConflict
			}
			return existing, existingItems, nil
		}
	}
	return batch, items, err
}

func (r *GormComicAssetRepository) GetBatchByIdempotencyKey(key string) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error) {
	var batch model.ComicAssetGenerationBatch
	if err := r.db.First(&batch, "idempotency_key = ?", key).Error; err != nil {
		return model.ComicAssetGenerationBatch{}, nil, mapComicAssetGormError(err, ErrComicAssetBatchNotFound)
	}
	items, err := r.listBatchItems(batch.ID)
	return batch, items, err
}

func (r *GormComicAssetRepository) RecoverUnassignedItems(batchID string, staleBefore time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var batch model.ComicAssetGenerationBatch
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&batch, "id = ?", batchID).Error; err != nil {
			return mapComicAssetGormError(err, ErrComicAssetBatchNotFound)
		}
		status := model.ComicBatchItemStatusPending
		if batch.Status == model.ComicBatchStatusStopping {
			status = model.ComicBatchItemStatusCanceled
		}
		now := time.Now().UTC()
		if err := tx.Model(&model.ComicAssetGenerationItem{}).
			Where("batch_id = ? AND status = ? AND job_id = ? AND updated_at <= ?", batchID, model.ComicBatchItemStatusQueued, "", staleBefore).
			Updates(map[string]any{"status": status, "updated_at": now}).Error; err != nil {
			return err
		}
		return refreshComicBatchTx(tx, &batch)
	})
}

func (r *GormComicAssetRepository) ListBatches(projectID string, workspaceID string) ([]model.ComicAssetGenerationBatch, error) {
	if _, err := r.GetProject(projectID, workspaceID); err != nil {
		return nil, err
	}
	var batches []model.ComicAssetGenerationBatch
	return batches, r.db.Where("project_id = ? AND workspace_id = ?", projectID, workspaceID).Order("created_at DESC").Find(&batches).Error
}

func (r *GormComicAssetRepository) GetBatch(id string, workspaceID string) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error) {
	var batch model.ComicAssetGenerationBatch
	err := r.db.First(&batch, "id = ? AND workspace_id = ?", id, workspaceID).Error
	if err != nil {
		return model.ComicAssetGenerationBatch{}, nil, mapComicAssetGormError(err, ErrComicAssetBatchNotFound)
	}
	items, err := r.listBatchItems(id)
	return batch, items, err
}

func (r *GormComicAssetRepository) GetBatchInternal(id string) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error) {
	var batch model.ComicAssetGenerationBatch
	err := r.db.First(&batch, "id = ?", id).Error
	if err != nil {
		return model.ComicAssetGenerationBatch{}, nil, mapComicAssetGormError(err, ErrComicAssetBatchNotFound)
	}
	items, err := r.listBatchItems(id)
	return batch, items, err
}

func (r *GormComicAssetRepository) listBatchItems(batchID string) ([]model.ComicAssetGenerationItem, error) {
	var items []model.ComicAssetGenerationItem
	return items, r.db.Where("batch_id = ?", batchID).Order("position ASC").Find(&items).Error
}

func (r *GormComicAssetRepository) ListActiveBatches() ([]model.ComicAssetGenerationBatch, error) {
	var batches []model.ComicAssetGenerationBatch
	statuses := []string{model.ComicBatchStatusQueued, model.ComicBatchStatusRunning, model.ComicBatchStatusPaused, model.ComicBatchStatusStopping}
	return batches, r.db.Where("status IN ?", statuses).Order("created_at ASC").Find(&batches).Error
}

func (r *GormComicAssetRepository) ClaimPendingItems(batchID string) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error) {
	var batch model.ComicAssetGenerationBatch
	claimed := make([]model.ComicAssetGenerationItem, 0)
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&batch, "id = ?", batchID).Error; err != nil {
			return mapComicAssetGormError(err, ErrComicAssetBatchNotFound)
		}
		if batch.Status != model.ComicBatchStatusQueued && batch.Status != model.ComicBatchStatusRunning {
			return nil
		}
		var active int64
		if err := tx.Model(&model.ComicAssetGenerationItem{}).Where("batch_id = ? AND status IN ?", batchID, []string{model.ComicBatchItemStatusQueued, model.ComicBatchItemStatusRunning}).Count(&active).Error; err != nil {
			return err
		}
		available := batch.Concurrency - int(active)
		if available <= 0 {
			return refreshComicBatchTx(tx, &batch)
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).Where("batch_id = ? AND status = ?", batchID, model.ComicBatchItemStatusPending).Order("position ASC").Limit(available).Find(&claimed).Error; err != nil {
			return err
		}
		now := time.Now().UTC()
		for index := range claimed {
			claimed[index].Status = model.ComicBatchItemStatusQueued
			claimed[index].UpdatedAt = now
			if err := tx.Model(&model.ComicAssetGenerationItem{}).Where("id = ? AND status = ?", claimed[index].ID, model.ComicBatchItemStatusPending).Updates(map[string]any{"status": model.ComicBatchItemStatusQueued, "updated_at": now}).Error; err != nil {
				return err
			}
		}
		if len(claimed) > 0 {
			updates := map[string]any{"status": model.ComicBatchStatusRunning, "updated_at": now}
			if batch.StartedAt == nil {
				updates["started_at"] = now
				started := now
				batch.StartedAt = &started
			}
			batch.Status = model.ComicBatchStatusRunning
			if err := tx.Model(&model.ComicAssetGenerationBatch{}).Where("id = ?", batch.ID).Updates(updates).Error; err != nil {
				return err
			}
		}
		return refreshComicBatchTx(tx, &batch)
	})
	return batch, claimed, err
}

func (r *GormComicAssetRepository) SetItemJob(itemID string, attempt int, jobID string) error {
	return r.db.Model(&model.ComicAssetGenerationItem{}).
		Where("id = ? AND attempt = ? AND status = ? AND (job_id = ? OR job_id = ?)", itemID, attempt, model.ComicBatchItemStatusQueued, "", jobID).
		Updates(map[string]any{"job_id": jobID, "updated_at": time.Now().UTC()}).Error
}

func (r *GormComicAssetRepository) SyncItemFromJob(itemID string, jobID string, status string, outputAssetID string, errorPayload model.JSONB) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var item model.ComicAssetGenerationItem
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&item, "id = ?", itemID).Error; err != nil {
			return mapComicAssetGormError(err, ErrComicAssetBatchItemNotFound)
		}
		if item.JobID != jobID || isTerminalComicItemStatus(item.Status) {
			return nil
		}
		now := time.Now().UTC()
		updates := map[string]any{"updated_at": now}
		switch status {
		case model.JobStatusQueued:
			updates["status"] = model.ComicBatchItemStatusQueued
		case model.JobStatusRunning:
			updates["status"] = model.ComicBatchItemStatusRunning
		case model.JobStatusSucceeded:
			if outputAssetID == "" {
				updates["status"] = model.ComicBatchItemStatusFailed
				updates["error"] = model.JSONB(`{"message":"generated job did not return an asset","code":"missing_output_asset"}`)
				break
			}
			var asset model.ComicAsset
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&asset, "id = ?", item.ComicAssetID).Error; err != nil {
				return mapComicAssetGormError(err, ErrComicAssetNotFound)
			}
			outputs := decodeComicOutputs(asset.Outputs)
			if !comicOutputContainsItem(outputs, item.ID) {
				asset.OutputVersion++
				outputs = append(outputs, model.ComicAssetOutput{Version: asset.OutputVersion, AssetID: outputAssetID, BatchID: item.BatchID, BatchItemID: item.ID, CreatedAt: now})
				if err := tx.Model(&model.ComicAsset{}).Where("id = ?", asset.ID).Updates(map[string]any{"output_version": asset.OutputVersion, "outputs": encodeRepositoryJSON(outputs, model.JSONB("[]")), "archive_status": model.ComicAssetArchiveArchived, "updated_at": now}).Error; err != nil {
					return err
				}
			}
			updates["status"] = model.ComicBatchItemStatusSucceeded
			updates["output_asset_id"] = outputAssetID
			updates["output_version"] = asset.OutputVersion
			updates["error"] = model.JSONB("{}")
		case model.JobStatusFailed:
			updates["status"] = model.ComicBatchItemStatusFailed
			updates["error"] = normalizeRepositoryJSON(errorPayload, "{}")
			if err := tx.Model(&model.ComicAsset{}).Where("id = ? AND output_version = ?", item.ComicAssetID, 0).Updates(map[string]any{"archive_status": model.ComicAssetArchiveFailed, "updated_at": now}).Error; err != nil {
				return err
			}
		case model.JobStatusCanceled:
			updates["status"] = model.ComicBatchItemStatusCanceled
			updates["error"] = normalizeRepositoryJSON(errorPayload, "{}")
		default:
			return nil
		}
		if err := tx.Model(&model.ComicAssetGenerationItem{}).Where("id = ?", item.ID).Updates(updates).Error; err != nil {
			return err
		}
		var batch model.ComicAssetGenerationBatch
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&batch, "id = ?", item.BatchID).Error; err != nil {
			return err
		}
		return refreshComicBatchTx(tx, &batch)
	})
}

func (r *GormComicAssetRepository) ControlBatch(batchID string, workspaceID string, action string) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error) {
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var batch model.ComicAssetGenerationBatch
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&batch, "id = ? AND workspace_id = ?", batchID, workspaceID).Error; err != nil {
			return mapComicAssetGormError(err, ErrComicAssetBatchNotFound)
		}
		now := time.Now().UTC()
		switch action {
		case "pause":
			if batch.Status != model.ComicBatchStatusQueued && batch.Status != model.ComicBatchStatusRunning {
				return ErrComicAssetInvalidState
			}
			batch.Status = model.ComicBatchStatusPaused
		case "resume":
			if batch.Status != model.ComicBatchStatusPaused {
				return ErrComicAssetInvalidState
			}
			batch.Status = model.ComicBatchStatusQueued
			batch.FinishedAt = nil
		case "stop":
			if isTerminalComicBatchStatus(batch.Status) {
				return nil
			}
			batch.Status = model.ComicBatchStatusStopping
			if err := tx.Model(&model.ComicAssetGenerationItem{}).Where("batch_id = ? AND status = ?", batch.ID, model.ComicBatchItemStatusPending).Updates(map[string]any{"status": model.ComicBatchItemStatusCanceled, "updated_at": now}).Error; err != nil {
				return err
			}
		default:
			return ErrComicAssetInvalidState
		}
		if err := tx.Model(&model.ComicAssetGenerationBatch{}).Where("id = ?", batch.ID).Updates(map[string]any{"status": batch.Status, "finished_at": batch.FinishedAt, "updated_at": now}).Error; err != nil {
			return err
		}
		return refreshComicBatchTx(tx, &batch)
	})
	if err != nil {
		return model.ComicAssetGenerationBatch{}, nil, err
	}
	return r.GetBatch(batchID, workspaceID)
}

func (r *GormComicAssetRepository) RetryBatchItems(batchID string, workspaceID string, itemIDs []string) (model.ComicAssetGenerationBatch, []model.ComicAssetGenerationItem, error) {
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var batch model.ComicAssetGenerationBatch
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&batch, "id = ? AND workspace_id = ?", batchID, workspaceID).Error; err != nil {
			return mapComicAssetGormError(err, ErrComicAssetBatchNotFound)
		}
		query := tx.Model(&model.ComicAssetGenerationItem{}).Where("batch_id = ? AND status = ?", batchID, model.ComicBatchItemStatusFailed)
		if len(itemIDs) > 0 {
			query = query.Where("id IN ?", itemIDs)
		}
		now := time.Now().UTC()
		result := query.Updates(map[string]any{"status": model.ComicBatchItemStatusPending, "attempt": gorm.Expr("attempt + 1"), "job_id": "", "output_asset_id": "", "output_version": 0, "error": model.JSONB("{}"), "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrComicAssetInvalidState
		}
		assetQuery := tx.Model(&model.ComicAsset{}).
			Where("output_version = ?", 0).
			Where("id IN (?)", tx.Model(&model.ComicAssetGenerationItem{}).Select("comic_asset_id").Where("batch_id = ? AND status = ?", batchID, model.ComicBatchItemStatusPending))
		if len(itemIDs) > 0 {
			assetQuery = assetQuery.Where("id IN (?)", tx.Model(&model.ComicAssetGenerationItem{}).Select("comic_asset_id").Where("id IN ?", itemIDs))
		}
		if err := assetQuery.Updates(map[string]any{"archive_status": model.ComicAssetArchivePending, "updated_at": now}).Error; err != nil {
			return err
		}
		batch.Status = model.ComicBatchStatusQueued
		batch.FinishedAt = nil
		if err := tx.Model(&model.ComicAssetGenerationBatch{}).Where("id = ?", batch.ID).Updates(map[string]any{"status": batch.Status, "finished_at": nil, "updated_at": now}).Error; err != nil {
			return err
		}
		return refreshComicBatchTx(tx, &batch)
	})
	if err != nil {
		return model.ComicAssetGenerationBatch{}, nil, err
	}
	return r.GetBatch(batchID, workspaceID)
}

func refreshComicBatchTx(tx *gorm.DB, batch *model.ComicAssetGenerationBatch) error {
	var items []model.ComicAssetGenerationItem
	if err := tx.Where("batch_id = ?", batch.ID).Find(&items).Error; err != nil {
		return err
	}
	applyComicBatchCounts(batch, items, time.Now().UTC())
	return tx.Model(&model.ComicAssetGenerationBatch{}).Where("id = ?", batch.ID).Updates(map[string]any{
		"status": batch.Status, "total": batch.Total, "pending": batch.Pending, "active": batch.Active,
		"succeeded": batch.Succeeded, "failed": batch.Failed, "canceled": batch.Canceled,
		"started_at": batch.StartedAt, "finished_at": batch.FinishedAt, "updated_at": batch.UpdatedAt,
	}).Error
}

func applyComicBatchCounts(batch *model.ComicAssetGenerationBatch, items []model.ComicAssetGenerationItem, now time.Time) {
	batch.Total = len(items)
	batch.Pending, batch.Active, batch.Succeeded, batch.Failed, batch.Canceled = 0, 0, 0, 0, 0
	for _, item := range items {
		switch item.Status {
		case model.ComicBatchItemStatusPending:
			batch.Pending++
		case model.ComicBatchItemStatusQueued, model.ComicBatchItemStatusRunning:
			batch.Active++
		case model.ComicBatchItemStatusSucceeded:
			batch.Succeeded++
		case model.ComicBatchItemStatusFailed:
			batch.Failed++
		case model.ComicBatchItemStatusCanceled:
			batch.Canceled++
		}
	}
	terminal := batch.Succeeded + batch.Failed + batch.Canceled
	if terminal == batch.Total && batch.Total > 0 {
		finished := now
		batch.FinishedAt = &finished
		switch {
		case batch.Status == model.ComicBatchStatusStopping || batch.Canceled > 0:
			batch.Status = model.ComicBatchStatusCanceled
		case batch.Failed > 0:
			batch.Status = model.ComicBatchStatusPartialFailed
		default:
			batch.Status = model.ComicBatchStatusSucceeded
		}
	} else {
		switch batch.Status {
		case model.ComicBatchStatusPaused:
			// Paused remains explicit while pending work exists.
		case model.ComicBatchStatusStopping:
			if batch.Active == 0 {
				batch.Status = model.ComicBatchStatusCanceled
				finished := now
				batch.FinishedAt = &finished
			}
		default:
			if batch.Active > 0 || batch.Succeeded > 0 || batch.Failed > 0 {
				batch.Status = model.ComicBatchStatusRunning
			}
		}
	}
	batch.UpdatedAt = now
}

func decodeComicOutputs(value model.JSONB) []model.ComicAssetOutput {
	outputs := make([]model.ComicAssetOutput, 0)
	_ = json.Unmarshal(value, &outputs)
	return outputs
}

func comicOutputContainsItem(outputs []model.ComicAssetOutput, itemID string) bool {
	for _, output := range outputs {
		if output.BatchItemID == itemID {
			return true
		}
	}
	return false
}

func comicBatchIsActiveForFolder(status string) bool {
	switch status {
	case model.ComicBatchStatusQueued, model.ComicBatchStatusRunning, model.ComicBatchStatusPaused, model.ComicBatchStatusStopping:
		return true
	default:
		return false
	}
}

func encodeRepositoryJSON(value any, fallback model.JSONB) model.JSONB {
	data, err := json.Marshal(value)
	if err != nil {
		return fallback
	}
	return model.JSONB(data)
}

func normalizeRepositoryJSON(value model.JSONB, fallback string) model.JSONB {
	if len(value) == 0 || !json.Valid(value) {
		return model.JSONB(fallback)
	}
	return value
}

func mapComicAssetGormError(err error, notFound error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return notFound
	}
	return err
}

func mapComicAssetConflict(err error) error {
	if err == nil {
		return nil
	}
	var postgresError *pgconn.PgError
	if errors.Is(err, gorm.ErrDuplicatedKey) || (errors.As(err, &postgresError) && postgresError.Code == "23505") {
		return errors.Join(ErrComicAssetConflict, err)
	}
	return err
}

func isActiveComicBatchStatus(status string) bool {
	return status == model.ComicBatchStatusQueued || status == model.ComicBatchStatusRunning || status == model.ComicBatchStatusPaused || status == model.ComicBatchStatusStopping
}

func isTerminalComicBatchStatus(status string) bool {
	return status == model.ComicBatchStatusSucceeded || status == model.ComicBatchStatusPartialFailed || status == model.ComicBatchStatusCanceled
}

func isActiveComicItemStatus(status string) bool {
	return status == model.ComicBatchItemStatusQueued || status == model.ComicBatchItemStatusRunning
}

func isTerminalComicItemStatus(status string) bool {
	return status == model.ComicBatchItemStatusSucceeded || status == model.ComicBatchItemStatusFailed || status == model.ComicBatchItemStatusCanceled
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
}
