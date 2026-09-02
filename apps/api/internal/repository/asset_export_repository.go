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

var ErrAssetExportNotFound = errors.New("asset export not found")

const (
	// AssetExportRepositoryWriteBatchSize keeps PostgreSQL parameter counts bounded.
	AssetExportRepositoryWriteBatchSize = 250
)

type AssetExportItemUpdate struct {
	ID          string
	Status      string
	ArchivePath string
	Error       model.JSONB
}

type AssetExportRepository interface {
	Create(batch model.AssetExportBatch, items []model.AssetExportItem) (model.AssetExportBatch, error)
	Get(id string, workspaceID string) (model.AssetExportBatch, []model.AssetExportItem, error)
	GetBatch(id string, workspaceID string) (model.AssetExportBatch, error)
	List(workspaceID string) ([]model.AssetExportBatch, error)
	ClaimNext(staleBefore time.Time) (model.AssetExportBatch, []model.AssetExportItem, bool, error)
	UpdateItem(id string, status string, archivePath string, errorPayload model.JSONB) error
	UpdateItems(updates []AssetExportItemUpdate) error
	UpdateProgress(id string, succeeded int, failed int) error
	Touch(id string) error
	Finalize(id string, status string, storageKey string, fileName string, size int64, errorPayload model.JSONB, expiresAt *time.Time) error
	Cancel(id string, workspaceID string) (model.AssetExportBatch, error)
	ListExpired(now time.Time, limit int) ([]model.AssetExportBatch, error)
	MarkExpired(id string) error
}

type assetExportItemLocation struct {
	batchID string
	index   int
}

type MemoryAssetExportRepository struct {
	mu            sync.Mutex
	batches       map[string]model.AssetExportBatch
	items         map[string][]model.AssetExportItem
	itemLocations map[string]assetExportItemLocation
}

func NewMemoryAssetExportRepository() *MemoryAssetExportRepository {
	return &MemoryAssetExportRepository{
		batches:       make(map[string]model.AssetExportBatch),
		items:         make(map[string][]model.AssetExportItem),
		itemLocations: make(map[string]assetExportItemLocation),
	}
}

func (r *MemoryAssetExportRepository) Create(batch model.AssetExportBatch, items []model.AssetExportItem) (model.AssetExportBatch, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UTC()
	batch.CreatedAt, batch.UpdatedAt = now, now
	r.batches[batch.ID] = batch
	for _, existing := range r.items[batch.ID] {
		delete(r.itemLocations, existing.ID)
	}
	stored := append([]model.AssetExportItem(nil), items...)
	for index := range stored {
		stored[index].CreatedAt, stored[index].UpdatedAt = now, now
		r.itemLocations[stored[index].ID] = assetExportItemLocation{batchID: batch.ID, index: index}
	}
	r.items[batch.ID] = stored
	return batch, nil
}

func (r *MemoryAssetExportRepository) Get(id string, workspaceID string) (model.AssetExportBatch, []model.AssetExportItem, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	batch, ok := r.batches[id]
	if !ok || batch.WorkspaceID != workspaceID {
		return model.AssetExportBatch{}, nil, ErrAssetExportNotFound
	}
	return batch, append([]model.AssetExportItem(nil), r.items[id]...), nil
}

func (r *MemoryAssetExportRepository) GetBatch(id string, workspaceID string) (model.AssetExportBatch, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	batch, ok := r.batches[id]
	if !ok || batch.WorkspaceID != workspaceID {
		return model.AssetExportBatch{}, ErrAssetExportNotFound
	}
	return batch, nil
}

func (r *MemoryAssetExportRepository) List(workspaceID string) ([]model.AssetExportBatch, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]model.AssetExportBatch, 0)
	for _, batch := range r.batches {
		if batch.WorkspaceID == workspaceID {
			result = append(result, batch)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.After(result[j].CreatedAt) })
	return result, nil
}

func (r *MemoryAssetExportRepository) ClaimNext(staleBefore time.Time) (model.AssetExportBatch, []model.AssetExportItem, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidates := make([]model.AssetExportBatch, 0)
	for _, batch := range r.batches {
		if batch.Status == model.AssetExportStatusQueued || (batch.Status == model.AssetExportStatusRunning && batch.UpdatedAt.Before(staleBefore)) {
			candidates = append(candidates, batch)
		}
	}
	if len(candidates) == 0 {
		return model.AssetExportBatch{}, nil, false, nil
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].CreatedAt.Before(candidates[j].CreatedAt) })
	batch := candidates[0]
	stale := batch.Status == model.AssetExportStatusRunning
	now := time.Now().UTC()
	batch.Status = model.AssetExportStatusRunning
	batch.Succeeded, batch.Failed, batch.Canceled = 0, 0, 0
	batch.UpdatedAt = now
	if batch.StartedAt == nil {
		batch.StartedAt = &now
	}
	items := r.items[batch.ID]
	if stale {
		for index := range items {
			items[index].Status = model.AssetExportItemStatusPending
			items[index].ArchivePath = ""
			items[index].Error = model.JSONB("{}")
			items[index].UpdatedAt = now
		}
		r.items[batch.ID] = items
	}
	r.batches[batch.ID] = batch
	return batch, append([]model.AssetExportItem(nil), items...), true, nil
}

func (r *MemoryAssetExportRepository) UpdateItem(id string, status string, archivePath string, errorPayload model.JSONB) error {
	return r.UpdateItems([]AssetExportItemUpdate{{ID: id, Status: status, ArchivePath: archivePath, Error: errorPayload}})
}

func (r *MemoryAssetExportRepository) UpdateItems(updates []AssetExportItemUpdate) error {
	if len(updates) == 0 {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, update := range updates {
		if _, ok := r.itemLocations[update.ID]; !ok {
			return ErrAssetExportNotFound
		}
	}
	now := time.Now().UTC()
	for _, update := range updates {
		location := r.itemLocations[update.ID]
		items := r.items[location.batchID]
		if items[location.index].Status != model.AssetExportItemStatusPending {
			continue
		}
		items[location.index].Status = update.Status
		items[location.index].ArchivePath = update.ArchivePath
		items[location.index].Error = append(model.JSONB(nil), update.Error...)
		items[location.index].UpdatedAt = now
		r.items[location.batchID] = items
	}
	return nil
}

func (r *MemoryAssetExportRepository) UpdateProgress(id string, succeeded int, failed int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	batch, ok := r.batches[id]
	if !ok {
		return ErrAssetExportNotFound
	}
	if batch.Status != model.AssetExportStatusRunning {
		return nil
	}
	batch.Succeeded, batch.Failed, batch.UpdatedAt = succeeded, failed, time.Now().UTC()
	r.batches[id] = batch
	return nil
}

func (r *MemoryAssetExportRepository) Touch(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	batch, ok := r.batches[id]
	if !ok {
		return ErrAssetExportNotFound
	}
	batch.UpdatedAt = time.Now().UTC()
	r.batches[id] = batch
	return nil
}

func (r *MemoryAssetExportRepository) Finalize(id string, status string, storageKey string, fileName string, size int64, errorPayload model.JSONB, expiresAt *time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	batch, ok := r.batches[id]
	if !ok {
		return ErrAssetExportNotFound
	}
	if batch.Status == model.AssetExportStatusCanceled {
		return nil
	}
	now := time.Now().UTC()
	batch.Status, batch.StorageKey, batch.FileName, batch.Size = status, storageKey, fileName, size
	batch.Error, batch.ExpiresAt, batch.UpdatedAt, batch.FinishedAt = append(model.JSONB(nil), errorPayload...), expiresAt, now, &now
	batch.Succeeded, batch.Failed, batch.Canceled = 0, 0, 0
	for _, item := range r.items[id] {
		switch item.Status {
		case model.AssetExportItemStatusSucceeded:
			batch.Succeeded++
		case model.AssetExportItemStatusFailed:
			batch.Failed++
		case model.AssetExportItemStatusCanceled:
			batch.Canceled++
		}
	}
	r.batches[id] = batch
	return nil
}

func (r *MemoryAssetExportRepository) Cancel(id string, workspaceID string) (model.AssetExportBatch, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	batch, ok := r.batches[id]
	if !ok || batch.WorkspaceID != workspaceID {
		return model.AssetExportBatch{}, ErrAssetExportNotFound
	}
	if batch.Status == model.AssetExportStatusQueued || batch.Status == model.AssetExportStatusRunning {
		now := time.Now().UTC()
		batch.Status, batch.UpdatedAt, batch.FinishedAt = model.AssetExportStatusCanceled, now, &now
		for index := range r.items[id] {
			if r.items[id][index].Status == model.AssetExportItemStatusPending {
				r.items[id][index].Status = model.AssetExportItemStatusCanceled
				r.items[id][index].UpdatedAt = now
			}
		}
		batch.Succeeded, batch.Failed, batch.Canceled = 0, 0, 0
		for _, item := range r.items[id] {
			switch item.Status {
			case model.AssetExportItemStatusSucceeded:
				batch.Succeeded++
			case model.AssetExportItemStatusFailed:
				batch.Failed++
			case model.AssetExportItemStatusCanceled:
				batch.Canceled++
			}
		}
		r.batches[id] = batch
	}
	return batch, nil
}

func (r *MemoryAssetExportRepository) ListExpired(now time.Time, limit int) ([]model.AssetExportBatch, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]model.AssetExportBatch, 0)
	for _, batch := range r.batches {
		if batch.ExpiresAt != nil && !batch.ExpiresAt.After(now) && (batch.Status == model.AssetExportStatusSucceeded || batch.Status == model.AssetExportStatusPartialFailed) {
			result = append(result, batch)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ExpiresAt.Before(*result[j].ExpiresAt) })
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}
	return result, nil
}

func (r *MemoryAssetExportRepository) MarkExpired(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	batch, ok := r.batches[id]
	if !ok {
		return ErrAssetExportNotFound
	}
	batch.Status, batch.StorageKey, batch.UpdatedAt = model.AssetExportStatusExpired, "", time.Now().UTC()
	r.batches[id] = batch
	return nil
}

type GormAssetExportRepository struct{ db *gorm.DB }

func NewGormAssetExportRepository(db *gorm.DB) *GormAssetExportRepository {
	return &GormAssetExportRepository{db: db}
}

func (r *GormAssetExportRepository) Create(batch model.AssetExportBatch, items []model.AssetExportItem) (model.AssetExportBatch, error) {
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&batch).Error; err != nil {
			return err
		}
		if len(items) > 0 {
			return tx.CreateInBatches(&items, AssetExportRepositoryWriteBatchSize).Error
		}
		return nil
	})
	return batch, err
}

func (r *GormAssetExportRepository) Get(id string, workspaceID string) (model.AssetExportBatch, []model.AssetExportItem, error) {
	batch, err := r.GetBatch(id, workspaceID)
	if err != nil {
		return model.AssetExportBatch{}, nil, err
	}
	var items []model.AssetExportItem
	if err := r.db.Where("export_id = ?", batch.ID).Order("position ASC, id ASC").Find(&items).Error; err != nil {
		return model.AssetExportBatch{}, nil, err
	}
	return batch, items, nil
}

func (r *GormAssetExportRepository) GetBatch(id string, workspaceID string) (model.AssetExportBatch, error) {
	var batch model.AssetExportBatch
	if err := r.db.Where("id = ? AND workspace_id = ?", id, workspaceID).First(&batch).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.AssetExportBatch{}, ErrAssetExportNotFound
		}
		return model.AssetExportBatch{}, err
	}
	return batch, nil
}

func (r *GormAssetExportRepository) List(workspaceID string) ([]model.AssetExportBatch, error) {
	var result []model.AssetExportBatch
	err := r.db.Where("workspace_id = ?", workspaceID).Order("created_at DESC, id DESC").Find(&result).Error
	return result, err
}

func (r *GormAssetExportRepository) ClaimNext(staleBefore time.Time) (batch model.AssetExportBatch, items []model.AssetExportItem, claimed bool, err error) {
	err = r.db.Transaction(func(tx *gorm.DB) error {
		query := tx.Where("status = ? OR (status = ? AND updated_at < ?)", model.AssetExportStatusQueued, model.AssetExportStatusRunning, staleBefore).
			Order("created_at ASC, id ASC").Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"})
		if getErr := query.First(&batch).Error; getErr != nil {
			if errors.Is(getErr, gorm.ErrRecordNotFound) {
				return nil
			}
			return getErr
		}
		stale := batch.Status == model.AssetExportStatusRunning
		now := time.Now().UTC()
		updates := map[string]any{
			"status": model.AssetExportStatusRunning, "succeeded": 0, "failed": 0, "canceled": 0, "updated_at": now,
		}
		if batch.StartedAt == nil {
			updates["started_at"] = now
		}
		if updateErr := tx.Model(&model.AssetExportBatch{}).Where("id = ?", batch.ID).Updates(updates).Error; updateErr != nil {
			return updateErr
		}
		if stale {
			if resetErr := tx.Model(&model.AssetExportItem{}).Where("export_id = ?", batch.ID).Updates(map[string]any{
				"status": model.AssetExportItemStatusPending, "archive_path": "", "error": model.JSONB("{}"), "updated_at": now,
			}).Error; resetErr != nil {
				return resetErr
			}
		}
		if itemsErr := tx.Where("export_id = ?", batch.ID).Order("position ASC, id ASC").Find(&items).Error; itemsErr != nil {
			return itemsErr
		}
		batch.Status, batch.UpdatedAt, claimed = model.AssetExportStatusRunning, now, true
		if batch.StartedAt == nil {
			batch.StartedAt = &now
		}
		return nil
	})
	return
}

func (r *GormAssetExportRepository) UpdateItem(id string, status string, archivePath string, errorPayload model.JSONB) error {
	result := r.db.Model(&model.AssetExportItem{}).Where("id = ? AND status = ?", id, model.AssetExportItemStatusPending).Updates(map[string]any{
		"status": status, "archive_path": archivePath, "error": errorPayload, "updated_at": time.Now().UTC(),
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrAssetExportNotFound
	}
	return nil
}

func (r *GormAssetExportRepository) UpdateItems(updates []AssetExportItemUpdate) error {
	if len(updates) == 0 {
		return nil
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		for start := 0; start < len(updates); start += AssetExportRepositoryWriteBatchSize {
			end := start + AssetExportRepositoryWriteBatchSize
			if end > len(updates) {
				end = len(updates)
			}
			if err := updateAssetExportItemsChunk(tx, updates[start:end]); err != nil {
				return err
			}
		}
		return nil
	})
}

func updateAssetExportItemsChunk(tx *gorm.DB, updates []AssetExportItemUpdate) error {
	statusCase := strings.Builder{}
	archivePathCase := strings.Builder{}
	errorCase := strings.Builder{}
	statusCase.WriteString("CASE id")
	archivePathCase.WriteString("CASE id")
	errorCase.WriteString("CASE id")
	statusArgs := make([]any, 0, len(updates)*2)
	archivePathArgs := make([]any, 0, len(updates)*2)
	errorArgs := make([]any, 0, len(updates)*2)
	ids := make([]string, 0, len(updates))
	for _, update := range updates {
		statusCase.WriteString(" WHEN ? THEN ?")
		archivePathCase.WriteString(" WHEN ? THEN ?")
		errorCase.WriteString(" WHEN ? THEN ?")
		statusArgs = append(statusArgs, update.ID, update.Status)
		archivePathArgs = append(archivePathArgs, update.ID, update.ArchivePath)
		errorArgs = append(errorArgs, update.ID, update.Error)
		ids = append(ids, update.ID)
	}
	statusCase.WriteString(" ELSE status END")
	archivePathCase.WriteString(" ELSE archive_path END")
	errorCase.WriteString(" ELSE error END")
	query := "UPDATE asset_export_items SET status = " + statusCase.String() +
		", archive_path = " + archivePathCase.String() + ", error = " + errorCase.String() +
		", updated_at = ? WHERE id IN ? AND status = ?"
	args := append(statusArgs, archivePathArgs...)
	args = append(args, errorArgs...)
	args = append(args, time.Now().UTC(), ids, model.AssetExportItemStatusPending)
	return tx.Exec(query, args...).Error
}

func (r *GormAssetExportRepository) UpdateProgress(id string, succeeded int, failed int) error {
	result := r.db.Model(&model.AssetExportBatch{}).Where("id = ? AND status = ?", id, model.AssetExportStatusRunning).Updates(map[string]any{
		"succeeded": succeeded, "failed": failed, "updated_at": time.Now().UTC(),
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		var count int64
		if err := r.db.Model(&model.AssetExportBatch{}).Where("id = ?", id).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			return ErrAssetExportNotFound
		}
	}
	return nil
}

func (r *GormAssetExportRepository) Touch(id string) error {
	result := r.db.Model(&model.AssetExportBatch{}).Where("id = ? AND status = ?", id, model.AssetExportStatusRunning).Update("updated_at", time.Now().UTC())
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrAssetExportNotFound
	}
	return nil
}

func (r *GormAssetExportRepository) Finalize(id string, status string, storageKey string, fileName string, size int64, errorPayload model.JSONB, expiresAt *time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		counts := map[string]int64{}
		for _, itemStatus := range []string{model.AssetExportItemStatusSucceeded, model.AssetExportItemStatusFailed, model.AssetExportItemStatusCanceled} {
			var count int64
			if err := tx.Model(&model.AssetExportItem{}).Where("export_id = ? AND status = ?", id, itemStatus).Count(&count).Error; err != nil {
				return err
			}
			counts[itemStatus] = count
		}
		now := time.Now().UTC()
		result := tx.Model(&model.AssetExportBatch{}).Where("id = ? AND status <> ?", id, model.AssetExportStatusCanceled).Updates(map[string]any{
			"status": status, "storage_key": storageKey, "file_name": fileName, "size": size, "error": errorPayload,
			"expires_at": expiresAt, "succeeded": counts[model.AssetExportItemStatusSucceeded], "failed": counts[model.AssetExportItemStatusFailed], "canceled": counts[model.AssetExportItemStatusCanceled],
			"updated_at": now, "finished_at": now,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			var count int64
			if err := tx.Model(&model.AssetExportBatch{}).Where("id = ?", id).Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				return ErrAssetExportNotFound
			}
		}
		return nil
	})
}

func (r *GormAssetExportRepository) Cancel(id string, workspaceID string) (model.AssetExportBatch, error) {
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var batch model.AssetExportBatch
		if err := tx.Where("id = ? AND workspace_id = ?", id, workspaceID).Clauses(clause.Locking{Strength: "UPDATE"}).First(&batch).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrAssetExportNotFound
			}
			return err
		}
		if batch.Status != model.AssetExportStatusQueued && batch.Status != model.AssetExportStatusRunning {
			return nil
		}
		now := time.Now().UTC()
		if err := tx.Model(&model.AssetExportItem{}).Where("export_id = ? AND status = ?", id, model.AssetExportItemStatusPending).Updates(map[string]any{"status": model.AssetExportItemStatusCanceled, "updated_at": now}).Error; err != nil {
			return err
		}
		counts := map[string]int64{}
		for _, itemStatus := range []string{model.AssetExportItemStatusSucceeded, model.AssetExportItemStatusFailed, model.AssetExportItemStatusCanceled} {
			var count int64
			if err := tx.Model(&model.AssetExportItem{}).Where("export_id = ? AND status = ?", id, itemStatus).Count(&count).Error; err != nil {
				return err
			}
			counts[itemStatus] = count
		}
		return tx.Model(&model.AssetExportBatch{}).Where("id = ?", id).Updates(map[string]any{
			"status": model.AssetExportStatusCanceled, "updated_at": now, "finished_at": now,
			"succeeded": counts[model.AssetExportItemStatusSucceeded], "failed": counts[model.AssetExportItemStatusFailed], "canceled": counts[model.AssetExportItemStatusCanceled],
		}).Error
	})
	if err != nil {
		return model.AssetExportBatch{}, err
	}
	batch, err := r.GetBatch(id, workspaceID)
	return batch, err
}

func (r *GormAssetExportRepository) ListExpired(now time.Time, limit int) ([]model.AssetExportBatch, error) {
	if limit <= 0 {
		limit = 100
	}
	var result []model.AssetExportBatch
	err := r.db.Where("expires_at IS NOT NULL AND expires_at <= ? AND status IN ?", now, []string{model.AssetExportStatusSucceeded, model.AssetExportStatusPartialFailed}).Order("expires_at ASC").Limit(limit).Find(&result).Error
	return result, err
}

func (r *GormAssetExportRepository) MarkExpired(id string) error {
	result := r.db.Model(&model.AssetExportBatch{}).Where("id = ?", id).Updates(map[string]any{"status": model.AssetExportStatusExpired, "storage_key": "", "updated_at": time.Now().UTC()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrAssetExportNotFound
	}
	return nil
}
