package repository

import (
	"sort"
	"time"

	"github.com/ai-manju/api/internal/model"
)

// Discovery is owner scoped even for a shared workspace. Stable creation-time
// cursors keep status updates from moving an unfinished task between pages.
type ComicAnalysisListFilter struct {
	OwnerID, WorkspaceID string
	BeforeCreatedAt      time.Time
	BeforeID             string
	Now                  time.Time
	Limit                int
}

func comicAnalysisDiscoverable(session model.ComicAssetAnalysisSession, filter ComicAnalysisListFilter) bool {
	return session.OwnerID == filter.OwnerID && session.WorkspaceID == filter.WorkspaceID &&
		session.ExpiresAt.After(filter.Now) && comicAnalysisCanExpire(session.Status) &&
		(filter.BeforeCreatedAt.IsZero() || session.CreatedAt.Before(filter.BeforeCreatedAt) ||
			(session.CreatedAt.Equal(filter.BeforeCreatedAt) && session.ID < filter.BeforeID))
}

func (r *MemoryComicAssetRepository) ListAnalysisSessions(filter ComicAnalysisListFilter) ([]model.ComicAssetAnalysisSession, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]model.ComicAssetAnalysisSession, 0)
	for _, session := range r.analysisSessions {
		if comicAnalysisDiscoverable(session, filter) {
			// Listing never needs scripts, source storage keys or internal claims.
			session.SourceText, session.SourceStorageKey, session.AnalysisReceiptKey = "", "", ""
			result = append(result, session)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].CreatedAt.Equal(result[j].CreatedAt) {
			return result[i].ID > result[j].ID
		}
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
	if filter.Limit > 0 && len(result) > filter.Limit {
		result = result[:filter.Limit]
	}
	return result, nil
}

func (r *GormComicAssetRepository) ListAnalysisSessions(filter ComicAnalysisListFilter) ([]model.ComicAssetAnalysisSession, error) {
	result := make([]model.ComicAssetAnalysisSession, 0)
	query := r.db.Select("id", "owner_id", "workspace_id", "title", "source_file_name", "status", "created_at", "expires_at").
		Where("owner_id = ? AND workspace_id = ? AND expires_at > ? AND status IN ?", filter.OwnerID, filter.WorkspaceID, filter.Now,
			[]string{model.ComicAnalysisStatusActive, model.ComicAnalysisStatusProcessing, model.ComicAnalysisStatusFailed})
	if !filter.BeforeCreatedAt.IsZero() {
		query = query.Where("created_at < ? OR (created_at = ? AND id < ?)", filter.BeforeCreatedAt, filter.BeforeCreatedAt, filter.BeforeID)
	}
	err := query.Order("created_at DESC, id DESC").Limit(filter.Limit).Find(&result).Error
	return result, err
}
