package repository

import (
	"errors"
	"sort"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *MemoryComicAssetRepository) UpdateAssetIfPromptVersion(asset model.ComicAsset, workspaceID string, expectedVersion int) (model.ComicAsset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	project, ok := r.projects[asset.ProjectID]
	if !ok || project.WorkspaceID != workspaceID {
		return model.ComicAsset{}, ErrComicAssetProjectNotFound
	}
	current, ok := r.assets[asset.ID]
	if !ok || current.ProjectID != asset.ProjectID {
		return model.ComicAsset{}, ErrComicAssetNotFound
	}
	if current.PromptVersion != expectedVersion {
		return model.ComicAsset{}, ErrComicAssetConflict
	}
	asset.CreatedAt = current.CreatedAt
	asset.UpdatedAt = time.Now().UTC()
	r.assets[asset.ID] = asset
	return asset, nil
}

func (r *MemoryComicAssetRepository) CreateAnalysisSession(session model.ComicAssetAnalysisSession, revision model.ComicAssetAnalysisRevision) (model.ComicAssetAnalysisSession, model.ComicAssetAnalysisRevision, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.analysisSessions[session.ID]; exists || revision.SessionID != session.ID || revision.ID == "" {
		return model.ComicAssetAnalysisSession{}, model.ComicAssetAnalysisRevision{}, ErrComicAssetConflict
	}
	if _, exists := r.analysisRevisions[revision.ID]; exists {
		return model.ComicAssetAnalysisSession{}, model.ComicAssetAnalysisRevision{}, ErrComicAssetConflict
	}
	now := time.Now().UTC()
	session.CreatedAt, session.UpdatedAt = now, now
	revision.Version, revision.CreatedAt = 1, now
	session.ActiveRevisionID = revision.ID
	r.analysisSessions[session.ID] = session
	r.analysisRevisions[revision.ID] = revision
	return session, revision, nil
}

func (r *MemoryComicAssetRepository) GetAnalysisSession(id string, workspaceID string) (model.ComicAssetAnalysisSession, []model.ComicAssetAnalysisRevision, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.getAnalysisSessionLocked(id, workspaceID)
}

func (r *MemoryComicAssetRepository) getAnalysisSessionLocked(id string, workspaceID string) (model.ComicAssetAnalysisSession, []model.ComicAssetAnalysisRevision, error) {
	session, ok := r.analysisSessions[id]
	if !ok || session.WorkspaceID != workspaceID {
		return model.ComicAssetAnalysisSession{}, nil, ErrComicAnalysisSessionNotFound
	}
	return session, r.listAnalysisRevisionsLocked(id), nil
}

func (r *MemoryComicAssetRepository) listAnalysisRevisionsLocked(sessionID string) []model.ComicAssetAnalysisRevision {
	revisions := make([]model.ComicAssetAnalysisRevision, 0)
	for _, revision := range r.analysisRevisions {
		if revision.SessionID == sessionID {
			revisions = append(revisions, revision)
		}
	}
	sort.Slice(revisions, func(i, j int) bool { return revisions[i].Version < revisions[j].Version })
	return revisions
}

func (r *MemoryComicAssetRepository) CreateAnalysisRevision(sessionID string, workspaceID string, expectedActiveRevisionID string, revision model.ComicAssetAnalysisRevision) (model.ComicAssetAnalysisSession, []model.ComicAssetAnalysisRevision, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	session, revisions, err := r.getAnalysisSessionLocked(sessionID, workspaceID)
	if err != nil {
		return model.ComicAssetAnalysisSession{}, nil, err
	}
	if session.Status != model.ComicAnalysisStatusActive {
		return model.ComicAssetAnalysisSession{}, nil, ErrComicAssetInvalidState
	}
	if expectedActiveRevisionID != "" && session.ActiveRevisionID != expectedActiveRevisionID {
		return model.ComicAssetAnalysisSession{}, nil, ErrComicAssetConflict
	}
	if revision.ID == "" || revision.SessionID != sessionID {
		return model.ComicAssetAnalysisSession{}, nil, ErrComicAssetConflict
	}
	if _, exists := r.analysisRevisions[revision.ID]; exists {
		return model.ComicAssetAnalysisSession{}, nil, ErrComicAssetConflict
	}
	if revision.ParentRevisionID != "" {
		parent, ok := r.analysisRevisions[revision.ParentRevisionID]
		if !ok || parent.SessionID != sessionID {
			return model.ComicAssetAnalysisSession{}, nil, ErrComicAnalysisRevisionNotFound
		}
	}
	revision.Version = len(revisions) + 1
	revision.CreatedAt = time.Now().UTC()
	r.analysisRevisions[revision.ID] = revision
	session.ActiveRevisionID = revision.ID
	session.UpdatedAt = revision.CreatedAt
	r.analysisSessions[session.ID] = session
	return session, r.listAnalysisRevisionsLocked(sessionID), nil
}

func (r *MemoryComicAssetRepository) SetActiveAnalysisRevision(sessionID string, revisionID string, workspaceID string) (model.ComicAssetAnalysisSession, []model.ComicAssetAnalysisRevision, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	session, _, err := r.getAnalysisSessionLocked(sessionID, workspaceID)
	if err != nil {
		return model.ComicAssetAnalysisSession{}, nil, err
	}
	if session.Status != model.ComicAnalysisStatusActive {
		return model.ComicAssetAnalysisSession{}, nil, ErrComicAssetInvalidState
	}
	revision, ok := r.analysisRevisions[revisionID]
	if !ok || revision.SessionID != sessionID {
		return model.ComicAssetAnalysisSession{}, nil, ErrComicAnalysisRevisionNotFound
	}
	session.ActiveRevisionID = revisionID
	session.UpdatedAt = time.Now().UTC()
	r.analysisSessions[session.ID] = session
	return session, r.listAnalysisRevisionsLocked(sessionID), nil
}

func (r *MemoryComicAssetRepository) ConfirmAnalysisSession(sessionID string, revisionID string, workspaceID string, project model.ComicAssetProject, assets []model.ComicAsset) (model.ComicAssetAnalysisSession, model.ComicAssetProject, []model.ComicAsset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	session, _, err := r.getAnalysisSessionLocked(sessionID, workspaceID)
	if err != nil {
		return model.ComicAssetAnalysisSession{}, model.ComicAssetProject{}, nil, err
	}
	if session.Status == model.ComicAnalysisStatusConfirmed {
		existing, ok := r.projects[session.ProjectID]
		if !ok {
			return model.ComicAssetAnalysisSession{}, model.ComicAssetProject{}, nil, ErrComicAssetProjectNotFound
		}
		createdAssets := make([]model.ComicAsset, 0)
		for _, asset := range r.assets {
			if asset.ProjectID == existing.ID {
				createdAssets = append(createdAssets, asset)
			}
		}
		sort.Slice(createdAssets, func(i, j int) bool { return createdAssets[i].Code < createdAssets[j].Code })
		return session, existing, createdAssets, nil
	}
	if session.Status != model.ComicAnalysisStatusActive {
		return model.ComicAssetAnalysisSession{}, model.ComicAssetProject{}, nil, ErrComicAssetInvalidState
	}
	revision, ok := r.analysisRevisions[revisionID]
	if !ok || revision.SessionID != sessionID {
		return model.ComicAssetAnalysisSession{}, model.ComicAssetProject{}, nil, ErrComicAnalysisRevisionNotFound
	}
	if project.WorkspaceID != workspaceID || project.ID == "" {
		return model.ComicAssetAnalysisSession{}, model.ComicAssetProject{}, nil, ErrComicAssetConflict
	}
	if _, exists := r.projects[project.ID]; exists {
		return model.ComicAssetAnalysisSession{}, model.ComicAssetProject{}, nil, ErrComicAssetConflict
	}
	seenIDs, seenCodes := make(map[string]bool), make(map[string]bool)
	for _, asset := range assets {
		if asset.ID == "" || asset.ProjectID != project.ID || asset.Code == "" || seenIDs[asset.ID] || seenCodes[asset.Code] {
			return model.ComicAssetAnalysisSession{}, model.ComicAssetProject{}, nil, ErrComicAssetConflict
		}
		if _, exists := r.assets[asset.ID]; exists {
			return model.ComicAssetAnalysisSession{}, model.ComicAssetProject{}, nil, ErrComicAssetConflict
		}
		seenIDs[asset.ID], seenCodes[asset.Code] = true, true
	}
	now := time.Now().UTC()
	project.CreatedAt, project.UpdatedAt = now, now
	createdAssets := make([]model.ComicAsset, len(assets))
	for index, asset := range assets {
		asset.CreatedAt, asset.UpdatedAt = now, now
		createdAssets[index] = asset
	}
	r.projects[project.ID] = project
	for _, asset := range createdAssets {
		r.assets[asset.ID] = asset
	}
	session.Status = model.ComicAnalysisStatusConfirmed
	session.ActiveRevisionID = revisionID
	session.ConfirmedRevisionID = revisionID
	session.ProjectID = project.ID
	session.ConfirmedAt = &now
	session.UpdatedAt = now
	r.analysisSessions[session.ID] = session
	return session, project, createdAssets, nil
}

func (r *MemoryComicAssetRepository) ListExpiredAnalysisSessions(now time.Time) ([]model.ComicAssetAnalysisSession, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]model.ComicAssetAnalysisSession, 0)
	for _, session := range r.analysisSessions {
		if session.Status == model.ComicAnalysisStatusActive && !session.ExpiresAt.After(now) {
			result = append(result, session)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ExpiresAt.Before(result[j].ExpiresAt) })
	return result, nil
}

func (r *MemoryComicAssetRepository) DeleteExpiredAnalysisSession(sessionID string, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	session, ok := r.analysisSessions[sessionID]
	if !ok {
		return nil
	}
	if session.Status != model.ComicAnalysisStatusActive || session.ExpiresAt.After(now) {
		return ErrComicAssetInvalidState
	}
	delete(r.analysisSessions, sessionID)
	for revisionID, revision := range r.analysisRevisions {
		if revision.SessionID == sessionID {
			delete(r.analysisRevisions, revisionID)
		}
	}
	return nil
}

func (r *GormComicAssetRepository) UpdateAssetIfPromptVersion(asset model.ComicAsset, workspaceID string, expectedVersion int) (model.ComicAsset, error) {
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var project model.ComicAssetProject
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&project, "id = ? AND workspace_id = ?", asset.ProjectID, workspaceID).Error; err != nil {
			return mapComicAssetGormError(err, ErrComicAssetProjectNotFound)
		}
		var current model.ComicAsset
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&current, "id = ? AND project_id = ?", asset.ID, asset.ProjectID).Error; err != nil {
			return mapComicAssetGormError(err, ErrComicAssetNotFound)
		}
		if current.PromptVersion != expectedVersion {
			return ErrComicAssetConflict
		}
		asset.CreatedAt = current.CreatedAt
		asset.UpdatedAt = time.Now().UTC()
		return tx.Save(&asset).Error
	})
	return asset, mapComicAssetConflict(err)
}

func (r *GormComicAssetRepository) CreateAnalysisSession(session model.ComicAssetAnalysisSession, revision model.ComicAssetAnalysisRevision) (model.ComicAssetAnalysisSession, model.ComicAssetAnalysisRevision, error) {
	now := time.Now().UTC()
	session.CreatedAt, session.UpdatedAt = now, now
	revision.Version, revision.CreatedAt = 1, now
	session.ActiveRevisionID = revision.ID
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&session).Error; err != nil {
			return mapComicAssetConflict(err)
		}
		if err := tx.Create(&revision).Error; err != nil {
			return mapComicAssetConflict(err)
		}
		return nil
	})
	return session, revision, err
}

func (r *GormComicAssetRepository) GetAnalysisSession(id string, workspaceID string) (model.ComicAssetAnalysisSession, []model.ComicAssetAnalysisRevision, error) {
	var session model.ComicAssetAnalysisSession
	if err := r.db.First(&session, "id = ? AND workspace_id = ?", id, workspaceID).Error; err != nil {
		return model.ComicAssetAnalysisSession{}, nil, mapComicAssetGormError(err, ErrComicAnalysisSessionNotFound)
	}
	revisions, err := r.listAnalysisRevisions(r.db, id)
	return session, revisions, err
}

func (r *GormComicAssetRepository) listAnalysisRevisions(db *gorm.DB, sessionID string) ([]model.ComicAssetAnalysisRevision, error) {
	var revisions []model.ComicAssetAnalysisRevision
	err := db.Where("session_id = ?", sessionID).Order("version ASC").Find(&revisions).Error
	return revisions, err
}

func (r *GormComicAssetRepository) CreateAnalysisRevision(sessionID string, workspaceID string, expectedActiveRevisionID string, revision model.ComicAssetAnalysisRevision) (model.ComicAssetAnalysisSession, []model.ComicAssetAnalysisRevision, error) {
	var session model.ComicAssetAnalysisSession
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&session, "id = ? AND workspace_id = ?", sessionID, workspaceID).Error; err != nil {
			return mapComicAssetGormError(err, ErrComicAnalysisSessionNotFound)
		}
		if session.Status != model.ComicAnalysisStatusActive {
			return ErrComicAssetInvalidState
		}
		if expectedActiveRevisionID != "" && session.ActiveRevisionID != expectedActiveRevisionID {
			return ErrComicAssetConflict
		}
		if revision.ParentRevisionID != "" {
			var count int64
			if err := tx.Model(&model.ComicAssetAnalysisRevision{}).Where("id = ? AND session_id = ?", revision.ParentRevisionID, sessionID).Count(&count).Error; err != nil {
				return err
			}
			if count != 1 {
				return ErrComicAnalysisRevisionNotFound
			}
		}
		var maxVersion int
		if err := tx.Model(&model.ComicAssetAnalysisRevision{}).Select("COALESCE(MAX(version), 0)").Where("session_id = ?", sessionID).Scan(&maxVersion).Error; err != nil {
			return err
		}
		revision.SessionID = sessionID
		revision.Version = maxVersion + 1
		revision.CreatedAt = time.Now().UTC()
		if err := tx.Create(&revision).Error; err != nil {
			return mapComicAssetConflict(err)
		}
		session.ActiveRevisionID = revision.ID
		session.UpdatedAt = revision.CreatedAt
		return tx.Model(&model.ComicAssetAnalysisSession{}).Where("id = ?", session.ID).Updates(map[string]any{"active_revision_id": session.ActiveRevisionID, "updated_at": session.UpdatedAt}).Error
	})
	if err != nil {
		return model.ComicAssetAnalysisSession{}, nil, err
	}
	revisions, err := r.listAnalysisRevisions(r.db, sessionID)
	return session, revisions, err
}

func (r *GormComicAssetRepository) SetActiveAnalysisRevision(sessionID string, revisionID string, workspaceID string) (model.ComicAssetAnalysisSession, []model.ComicAssetAnalysisRevision, error) {
	var session model.ComicAssetAnalysisSession
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&session, "id = ? AND workspace_id = ?", sessionID, workspaceID).Error; err != nil {
			return mapComicAssetGormError(err, ErrComicAnalysisSessionNotFound)
		}
		if session.Status != model.ComicAnalysisStatusActive {
			return ErrComicAssetInvalidState
		}
		var count int64
		if err := tx.Model(&model.ComicAssetAnalysisRevision{}).Where("id = ? AND session_id = ?", revisionID, sessionID).Count(&count).Error; err != nil {
			return err
		}
		if count != 1 {
			return ErrComicAnalysisRevisionNotFound
		}
		session.ActiveRevisionID = revisionID
		session.UpdatedAt = time.Now().UTC()
		return tx.Model(&model.ComicAssetAnalysisSession{}).Where("id = ?", session.ID).Updates(map[string]any{"active_revision_id": revisionID, "updated_at": session.UpdatedAt}).Error
	})
	if err != nil {
		return model.ComicAssetAnalysisSession{}, nil, err
	}
	revisions, err := r.listAnalysisRevisions(r.db, sessionID)
	return session, revisions, err
}

func (r *GormComicAssetRepository) ConfirmAnalysisSession(sessionID string, revisionID string, workspaceID string, project model.ComicAssetProject, assets []model.ComicAsset) (model.ComicAssetAnalysisSession, model.ComicAssetProject, []model.ComicAsset, error) {
	var session model.ComicAssetAnalysisSession
	createdProject := project
	createdAssets := append([]model.ComicAsset(nil), assets...)
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&session, "id = ? AND workspace_id = ?", sessionID, workspaceID).Error; err != nil {
			return mapComicAssetGormError(err, ErrComicAnalysisSessionNotFound)
		}
		if session.Status == model.ComicAnalysisStatusConfirmed {
			if err := tx.First(&createdProject, "id = ? AND workspace_id = ?", session.ProjectID, workspaceID).Error; err != nil {
				return mapComicAssetGormError(err, ErrComicAssetProjectNotFound)
			}
			return tx.Where("project_id = ?", createdProject.ID).Order("class ASC, code ASC").Find(&createdAssets).Error
		}
		if session.Status != model.ComicAnalysisStatusActive {
			return ErrComicAssetInvalidState
		}
		var revisionCount int64
		if err := tx.Model(&model.ComicAssetAnalysisRevision{}).Where("id = ? AND session_id = ?", revisionID, sessionID).Count(&revisionCount).Error; err != nil {
			return err
		}
		if revisionCount != 1 {
			return ErrComicAnalysisRevisionNotFound
		}
		now := time.Now().UTC()
		createdProject.CreatedAt, createdProject.UpdatedAt = now, now
		for index := range createdAssets {
			createdAssets[index].CreatedAt, createdAssets[index].UpdatedAt = now, now
		}
		if err := tx.Create(&createdProject).Error; err != nil {
			return mapComicAssetConflict(err)
		}
		if len(createdAssets) > 0 {
			if err := tx.Create(&createdAssets).Error; err != nil {
				return mapComicAssetConflict(err)
			}
		}
		session.Status = model.ComicAnalysisStatusConfirmed
		session.ActiveRevisionID = revisionID
		session.ConfirmedRevisionID = revisionID
		session.ProjectID = createdProject.ID
		session.ConfirmedAt = &now
		session.UpdatedAt = now
		return tx.Model(&model.ComicAssetAnalysisSession{}).Where("id = ?", session.ID).Updates(map[string]any{
			"status": session.Status, "active_revision_id": revisionID, "confirmed_revision_id": revisionID,
			"project_id": createdProject.ID, "confirmed_at": now, "updated_at": now,
		}).Error
	})
	return session, createdProject, createdAssets, err
}

func (r *GormComicAssetRepository) ListExpiredAnalysisSessions(now time.Time) ([]model.ComicAssetAnalysisSession, error) {
	var sessions []model.ComicAssetAnalysisSession
	err := r.db.Where("status = ? AND expires_at <= ?", model.ComicAnalysisStatusActive, now).Order("expires_at ASC").Find(&sessions).Error
	return sessions, err
}

func (r *GormComicAssetRepository) DeleteExpiredAnalysisSession(sessionID string, now time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var session model.ComicAssetAnalysisSession
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&session, "id = ?", sessionID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if session.Status != model.ComicAnalysisStatusActive || session.ExpiresAt.After(now) {
			return ErrComicAssetInvalidState
		}
		if err := tx.Where("session_id = ?", sessionID).Delete(&model.ComicAssetAnalysisRevision{}).Error; err != nil {
			return err
		}
		return tx.Delete(&model.ComicAssetAnalysisSession{}, "id = ?", sessionID).Error
	})
}
