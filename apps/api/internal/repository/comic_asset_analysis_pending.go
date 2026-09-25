package repository

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Recovery is deliberately narrower than ordinary completion: it may only
// attach an initial result to its unchanged, unconfirmed and unexpired session.
func validateAnalysisReceiptRecovery(session model.ComicAssetAnalysisSession, ownerID, receiptKey string, revision model.ComicAssetAnalysisRevision, now time.Time) error {
	if session.OwnerID != ownerID || receiptKey == "" || session.AnalysisReceiptKey != receiptKey || session.AnalysisReceiptVersion != model.ComicAnalysisReceiptVersion {
		return ErrComicAssetConflict
	}
	if (session.Status != model.ComicAnalysisStatusProcessing && session.Status != model.ComicAnalysisStatusFailed) ||
		!session.ExpiresAt.After(now) || session.ActiveRevisionID != "" || session.ConfirmedRevisionID != "" || session.ProjectID != "" || session.ConfirmedAt != nil {
		return ErrComicAssetInvalidState
	}
	var candidate struct {
		Assets []json.RawMessage `json:"assets"`
	}
	if revision.ID == "" || revision.SessionID != session.ID || revision.ParentRevisionID != "" || revision.Source != model.ComicAnalysisRevisionSourceInitial ||
		json.Unmarshal(revision.Candidate, &candidate) != nil || len(candidate.Assets) == 0 {
		return ErrComicAssetConflict
	}
	for _, raw := range candidate.Assets {
		var asset struct {
			Class string `json:"class"`
			Name  string `json:"name"`
		}
		if json.Unmarshal(raw, &asset) != nil || strings.TrimSpace(asset.Name) == "" {
			return ErrComicAssetConflict
		}
		switch asset.Class {
		case model.ComicAssetClassCharacter, model.ComicAssetClassEnvironment, model.ComicAssetClassProp, model.ComicAssetClassUI:
		default:
			return ErrComicAssetConflict
		}
	}
	return nil
}

func (r *MemoryComicAssetRepository) RecoverAnalysisSessionFromReceipt(sessionID, workspaceID, ownerID, receiptKey string, revision model.ComicAssetAnalysisRevision, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	session, revisions, err := r.getAnalysisSessionLocked(sessionID, workspaceID)
	if err != nil {
		return err
	}
	if err := validateAnalysisReceiptRecovery(session, ownerID, receiptKey, revision, now); err != nil {
		return err
	}
	if len(revisions) != 0 {
		return ErrComicAssetInvalidState
	}
	if _, exists := r.analysisRevisions[revision.ID]; exists {
		return ErrComicAssetConflict
	}
	session.Status = model.ComicAnalysisStatusProcessing
	if err := finishPendingAnalysis(&session, &revision, ""); err != nil {
		return err
	}
	r.analysisRevisions[revision.ID] = revision
	r.analysisSessions[sessionID] = session
	return nil
}

func (r *GormComicAssetRepository) RecoverAnalysisSessionFromReceipt(sessionID, workspaceID, ownerID, receiptKey string, revision model.ComicAssetAnalysisRevision, now time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var session model.ComicAssetAnalysisSession
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&session, "id = ? AND workspace_id = ?", sessionID, workspaceID).Error; err != nil {
			return mapComicAssetGormError(err, ErrComicAnalysisSessionNotFound)
		}
		if err := validateAnalysisReceiptRecovery(session, ownerID, receiptKey, revision, now); err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&model.ComicAssetAnalysisRevision{}).Where("session_id = ?", sessionID).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return ErrComicAssetInvalidState
		}
		session.Status = model.ComicAnalysisStatusProcessing
		if err := finishPendingAnalysis(&session, &revision, ""); err != nil {
			return err
		}
		if err := tx.Create(&revision).Error; err != nil {
			return mapComicAssetConflict(err)
		}
		return tx.Model(&session).Updates(map[string]any{
			"status": session.Status, "active_revision_id": session.ActiveRevisionID,
			"analysis_error": "", "updated_at": session.UpdatedAt,
		}).Error
	})
}

func comicAnalysisCanExpire(status string) bool {
	return status == model.ComicAnalysisStatusActive || status == model.ComicAnalysisStatusProcessing || status == model.ComicAnalysisStatusFailed
}

// Pending creation and completion are separate atomic operations. No empty
// candidate revision is exposed as a successful analysis.
func (r *MemoryComicAssetRepository) CreatePendingAnalysisSession(session model.ComicAssetAnalysisSession) (model.ComicAssetAnalysisSession, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if session.ID == "" || session.Status != model.ComicAnalysisStatusProcessing || session.ActiveRevisionID != "" {
		return model.ComicAssetAnalysisSession{}, ErrComicAssetInvalidState
	}
	if _, exists := r.analysisSessions[session.ID]; exists {
		return model.ComicAssetAnalysisSession{}, ErrComicAssetConflict
	}
	session.CreatedAt = time.Now().UTC()
	session.UpdatedAt = session.CreatedAt
	r.analysisSessions[session.ID] = session
	return session, nil
}

func (r *GormComicAssetRepository) CreatePendingAnalysisSession(session model.ComicAssetAnalysisSession) (model.ComicAssetAnalysisSession, error) {
	if session.ID == "" || session.Status != model.ComicAnalysisStatusProcessing || session.ActiveRevisionID != "" {
		return model.ComicAssetAnalysisSession{}, ErrComicAssetInvalidState
	}
	session.CreatedAt = time.Now().UTC()
	session.UpdatedAt = session.CreatedAt
	err := r.db.Create(&session).Error
	return session, mapComicAssetConflict(err)
}

func finishPendingAnalysis(session *model.ComicAssetAnalysisSession, revision *model.ComicAssetAnalysisRevision, failure string) error {
	if session.Status != model.ComicAnalysisStatusProcessing {
		return ErrComicAssetInvalidState
	}
	if revision == nil {
		if failure == "" {
			return ErrComicAssetInvalidState
		}
		session.Status = model.ComicAnalysisStatusFailed
		session.AnalysisError = failure
	} else {
		if revision.ID == "" || revision.SessionID != session.ID || failure != "" {
			return ErrComicAssetConflict
		}
		revision.Version = 1
		revision.CreatedAt = time.Now().UTC()
		session.ActiveRevisionID = revision.ID
		session.Status = model.ComicAnalysisStatusActive
		session.AnalysisError = ""
	}
	session.UpdatedAt = time.Now().UTC()
	return nil
}

func (r *MemoryComicAssetRepository) FinishPendingAnalysisSession(sessionID, workspaceID string, revision *model.ComicAssetAnalysisRevision, failure string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	session, _, err := r.getAnalysisSessionLocked(sessionID, workspaceID)
	if err != nil {
		return err
	}
	if revision != nil {
		if _, exists := r.analysisRevisions[revision.ID]; exists {
			return ErrComicAssetConflict
		}
	}
	if err := finishPendingAnalysis(&session, revision, failure); err != nil {
		return err
	}
	if revision != nil {
		r.analysisRevisions[revision.ID] = *revision
	}
	r.analysisSessions[sessionID] = session
	return nil
}

func (r *GormComicAssetRepository) FinishPendingAnalysisSession(sessionID, workspaceID string, revision *model.ComicAssetAnalysisRevision, failure string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var session model.ComicAssetAnalysisSession
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&session, "id = ? AND workspace_id = ?", sessionID, workspaceID).Error; err != nil {
			return mapComicAssetGormError(err, ErrComicAnalysisSessionNotFound)
		}
		if err := finishPendingAnalysis(&session, revision, failure); err != nil {
			return err
		}
		if revision != nil {
			if err := tx.Create(revision).Error; err != nil {
				return mapComicAssetConflict(err)
			}
		}
		return tx.Model(&session).Updates(map[string]any{
			"status": session.Status, "active_revision_id": session.ActiveRevisionID,
			"analysis_error": session.AnalysisError, "updated_at": session.UpdatedAt,
		}).Error
	})
}
