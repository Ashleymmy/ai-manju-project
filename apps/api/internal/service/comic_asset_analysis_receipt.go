package service

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

const (
	// Result persistence gets its own bounded context after Provider execution.
	comicAnalysisReceiptSaveTimeout  = 15 * time.Second
	comicAnalysisReceiptSaveAttempts = 3
	comicAnalysisReceiptRetryDelay   = 100 * time.Millisecond
)

type comicAnalysisReceiptResult struct {
	Version     int                              `json:"version"`
	SessionID   string                           `json:"session_id"`
	OwnerID     string                           `json:"owner_id"`
	WorkspaceID string                           `json:"workspace_id"`
	Revision    model.ComicAssetAnalysisRevision `json:"revision"`
}

func (s *ComicAssetService) SetAnalysisReceiptService(receipts *GenerationReceiptService) {
	s.analysisReceipts = receipts
}

func comicAnalysisHasReceipt(session model.ComicAssetAnalysisSession) bool {
	return session.AnalysisReceiptVersion == model.ComicAnalysisReceiptVersion && session.AnalysisReceiptKey != ""
}

func comicAnalysisReceiptScope(session model.ComicAssetAnalysisSession) GenerationReceiptScope {
	return GenerationReceiptScope{UserID: session.OwnerID, WorkspaceID: session.WorkspaceID, Kind: model.GenerationReceiptKindText, Key: session.AnalysisReceiptKey}
}

func (s *ComicAssetService) savePendingAnalysisReceipt(session model.ComicAssetAnalysisSession, binding model.GenerationReceipt, revision model.ComicAssetAnalysisRevision) {
	ctx, cancel := context.WithTimeout(context.Background(), comicAnalysisReceiptSaveTimeout)
	defer cancel()
	body, err := json.Marshal(comicAnalysisReceiptResult{model.ComicAnalysisReceiptVersion, session.ID, session.OwnerID, session.WorkspaceID, revision})
	if err != nil {
		return
	}
	for attempt := 0; attempt < comicAnalysisReceiptSaveAttempts; attempt++ {
		err = s.analysisReceipts.Complete(ctx, binding, GenerationReceiptResult{ContentType: "application/json", Body: body})
		if err == nil || !errors.Is(err, ErrGenerationReceiptUnavailable) || ctx.Err() != nil {
			break
		}
		if attempt+1 < comicAnalysisReceiptSaveAttempts {
			select {
			case <-ctx.Done():
			case <-time.After(comicAnalysisReceiptRetryDelay):
			}
		}
	}
	if err == nil {
		// The encrypted candidate is durable before the session transition. GET
		// can safely complete it after a DB outage or a concurrent timeout.
		err = s.repo.RecoverAnalysisSessionFromReceipt(session.ID, session.WorkspaceID, session.OwnerID, session.AnalysisReceiptKey, revision, time.Now().UTC())
	} else {
		// Preserve valid output in the session if only receipt storage failed.
		// This fallback cannot revive a failed, edited or confirmed session.
		err = s.repo.FinishPendingAnalysisSession(session.ID, session.WorkspaceID, &revision, "")
	}
	if err != nil && !errors.Is(err, repository.ErrComicAssetInvalidState) {
		log.Printf("comic analysis result persistence pending session_id=%s", session.ID)
	}
}

// No generation is ever initiated by retrieval. The only mutation restores a
// validated initial candidate or closes an abandoned, never-claimed operation.
func (s *ComicAssetService) restorePendingAnalysisReceipt(session model.ComicAssetAnalysisSession) error {
	if !comicAnalysisHasReceipt(session) ||
		(session.Status != model.ComicAnalysisStatusProcessing && session.Status != model.ComicAnalysisStatusFailed) ||
		session.ActiveRevisionID != "" || session.ConfirmedRevisionID != "" || session.ProjectID != "" || session.ConfirmedAt != nil || !session.ExpiresAt.After(time.Now().UTC()) {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), comicAnalysisReceiptSaveTimeout)
	defer cancel()
	receipt, output, err := s.analysisReceipts.Lookup(ctx, comicAnalysisReceiptScope(session))
	stale := time.Since(session.CreatedAt) > ComicAnalysisTaskTimeout
	if errors.Is(err, ErrGenerationReceiptNotFound) {
		if !stale {
			return nil
		}
		// The same unique-key claim as Begin makes the missing-submission proof
		// atomic: either execution already owns it or this tombstone wins.
		receipt, err = s.analysisReceipts.Reconcile(ctx, comicAnalysisReceiptScope(session))
	}
	if err != nil {
		return err
	}
	if output != nil {
		var result comicAnalysisReceiptResult
		if output.ContentType != "application/json" || json.Unmarshal(output.Body, &result) != nil ||
			result.Version != model.ComicAnalysisReceiptVersion || result.SessionID != session.ID || result.OwnerID != session.OwnerID || result.WorkspaceID != session.WorkspaceID ||
			result.Revision.SessionID != session.ID || result.Revision.Source != model.ComicAnalysisRevisionSourceInitial {
			return ErrGenerationReceiptConflict
		}
		if _, err := decodeComicAnalysisSnapshot(result.Revision.Candidate); err != nil {
			return ErrGenerationReceiptConflict
		}
		err := s.repo.RecoverAnalysisSessionFromReceipt(session.ID, session.WorkspaceID, session.OwnerID, session.AnalysisReceiptKey, result.Revision, time.Now().UTC())
		if errors.Is(err, repository.ErrComicAssetInvalidState) {
			return nil
		}
		return err
	}
	if stale || receipt.State == model.GenerationReceiptStateNotSubmitted || receipt.State == model.GenerationReceiptStateFailed || receipt.State == model.GenerationReceiptStateUncertain {
		failure := comicAnalysisTimeoutMessage
		if receipt.State == model.GenerationReceiptStateNotSubmitted {
			failure = comicAnalysisNotSubmittedMessage
		} else if receipt.State == model.GenerationReceiptStateFailed {
			failure = comicAnalysisProviderMessage
		}
		err := s.repo.FinishPendingAnalysisSession(session.ID, session.WorkspaceID, nil, failure)
		if errors.Is(err, repository.ErrComicAssetInvalidState) {
			return nil
		}
		return err
	}
	return nil
}
