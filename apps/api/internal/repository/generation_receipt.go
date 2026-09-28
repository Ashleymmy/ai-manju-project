package repository

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrGenerationReceiptNotFound = errors.New("generation receipt not found")
	ErrGenerationReceiptConflict = errors.New("generation receipt conflicts with original execution")
)

type GenerationReceiptRepository interface {
	// Begin inserts at most once for this user/workspace/kind/key. An existing
	// receipt is never reclaimed, including failed, expired or uncertain rows.
	Begin(context.Context, model.GenerationReceipt) (model.GenerationReceipt, bool, error)
	Find(context.Context, string, string, string, string) (model.GenerationReceipt, error)
	// Transition requires the entire execution binding and a matching old state.
	// not_submitted can only be inserted by Begin, never entered or left here.
	Transition(context.Context, model.GenerationReceipt, []string, string, string, *time.Time) (model.GenerationReceipt, bool, error)
}

type MemoryGenerationReceiptRepository struct {
	mu   sync.Mutex
	rows map[string]model.GenerationReceipt
	ids  map[string]bool
}

func NewMemoryGenerationReceiptRepository() *MemoryGenerationReceiptRepository {
	return &MemoryGenerationReceiptRepository{rows: make(map[string]model.GenerationReceipt), ids: make(map[string]bool)}
}

func generationReceiptScopeKey(user, workspace, kind, key string) string {
	encoded, _ := json.Marshal([]string{user, workspace, kind, key})
	return string(encoded)
}

func sameGenerationReceiptExecution(a, b model.GenerationReceipt) bool {
	return a.ID == b.ID && a.UserID == b.UserID && a.WorkspaceID == b.WorkspaceID && a.Kind == b.Kind && a.Key == b.Key && a.RequestHash == b.RequestHash && a.ExecutionToken == b.ExecutionToken
}

func (r *MemoryGenerationReceiptRepository) Begin(ctx context.Context, candidate model.GenerationReceipt) (model.GenerationReceipt, bool, error) {
	if err := ctx.Err(); err != nil {
		return model.GenerationReceipt{}, false, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	key := generationReceiptScopeKey(candidate.UserID, candidate.WorkspaceID, candidate.Kind, candidate.Key)
	if existing, ok := r.rows[key]; ok {
		return existing, false, nil
	}
	if r.ids[candidate.ID] {
		return model.GenerationReceipt{}, false, ErrGenerationReceiptConflict
	}
	now := time.Now().UTC()
	candidate.CreatedAt, candidate.UpdatedAt = now, now
	r.rows[key] = candidate
	r.ids[candidate.ID] = true
	return candidate, true, nil
}

func (r *MemoryGenerationReceiptRepository) Find(ctx context.Context, user, workspace, kind, key string) (model.GenerationReceipt, error) {
	if err := ctx.Err(); err != nil {
		return model.GenerationReceipt{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	row, ok := r.rows[generationReceiptScopeKey(user, workspace, kind, key)]
	if !ok {
		return model.GenerationReceipt{}, ErrGenerationReceiptNotFound
	}
	return row, nil
}

func (r *MemoryGenerationReceiptRepository) Transition(ctx context.Context, binding model.GenerationReceipt, from []string, state, message string, expires *time.Time) (model.GenerationReceipt, bool, error) {
	if err := ctx.Err(); err != nil {
		return model.GenerationReceipt{}, false, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	key := generationReceiptScopeKey(binding.UserID, binding.WorkspaceID, binding.Kind, binding.Key)
	row, ok := r.rows[key]
	if !ok {
		return model.GenerationReceipt{}, false, ErrGenerationReceiptNotFound
	}
	if !sameGenerationReceiptExecution(row, binding) {
		return row, false, ErrGenerationReceiptConflict
	}
	if row.State == model.GenerationReceiptStateNotSubmitted || state == model.GenerationReceiptStateNotSubmitted || !slices.Contains(from, row.State) {
		return row, false, nil
	}
	row.State, row.Error, row.UpdatedAt = state, message, time.Now().UTC()
	if expires != nil {
		row.ExpiresAt = *expires
	}
	r.rows[key] = row
	return row, true, nil
}

type GormGenerationReceiptRepository struct{ db *gorm.DB }

func NewGormGenerationReceiptRepository(db *gorm.DB) *GormGenerationReceiptRepository {
	return &GormGenerationReceiptRepository{db: db}
}

func (r *GormGenerationReceiptRepository) Begin(ctx context.Context, candidate model.GenerationReceipt) (model.GenerationReceipt, bool, error) {
	result := r.db.WithContext(ctx).Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "workspace_id"}, {Name: "kind"}, {Name: "key"}}, DoNothing: true}).Create(&candidate)
	if result.Error != nil {
		return model.GenerationReceipt{}, false, result.Error
	}
	if result.RowsAffected == 1 {
		return candidate, true, nil
	}
	row, err := r.Find(ctx, candidate.UserID, candidate.WorkspaceID, candidate.Kind, candidate.Key)
	return row, false, err
}

func (r *GormGenerationReceiptRepository) Find(ctx context.Context, user, workspace, kind, key string) (model.GenerationReceipt, error) {
	var row model.GenerationReceipt
	err := r.db.WithContext(ctx).Where("user_id = ? AND workspace_id = ? AND kind = ? AND key = ?", user, workspace, kind, key).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = ErrGenerationReceiptNotFound
	}
	return row, err
}

func (r *GormGenerationReceiptRepository) Transition(ctx context.Context, binding model.GenerationReceipt, from []string, state, message string, expires *time.Time) (model.GenerationReceipt, bool, error) {
	updates := map[string]any{"state": state, "error": message, "updated_at": time.Now().UTC()}
	if expires != nil {
		updates["expires_at"] = *expires
	}
	result := r.db.WithContext(ctx).Model(&model.GenerationReceipt{}).
		Where("id = ? AND user_id = ? AND workspace_id = ? AND kind = ? AND key = ? AND request_hash = ? AND execution_token = ? AND state IN ?", binding.ID, binding.UserID, binding.WorkspaceID, binding.Kind, binding.Key, binding.RequestHash, binding.ExecutionToken, from).
		Where("state <> ? AND ? <> ?", model.GenerationReceiptStateNotSubmitted, state, model.GenerationReceiptStateNotSubmitted).Updates(updates)
	if result.Error != nil {
		return model.GenerationReceipt{}, false, result.Error
	}
	row, err := r.Find(ctx, binding.UserID, binding.WorkspaceID, binding.Kind, binding.Key)
	if err == nil && !sameGenerationReceiptExecution(row, binding) {
		err = ErrGenerationReceiptConflict
	}
	return row, result.RowsAffected == 1, err
}
