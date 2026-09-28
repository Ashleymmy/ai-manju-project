package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

var ErrComicAnalysisSubmissionPending = errors.New("分析请求已经接收，正在准备原任务，请稍后查看")

type ComicAnalysisSubmission struct {
	Status    string `json:"status"`
	SessionID string `json:"session_id,omitempty"`
}

func comicSubmissionScope(userID, scope, key string) GenerationReceiptScope {
	return GenerationReceiptScope{UserID: userID, WorkspaceID: WorkspaceIDForScope(scope, userID), Kind: model.GenerationReceiptKindComicAnalysis, Key: key}
}

// Derive both identities from the permanent claim, so a missing HTTP response
// or encrypted acceptance response cannot make the saved session undiscoverable.
func comicSubmissionIdentities(receipt model.GenerationReceipt) (string, string) {
	return "comic_analysis_" + receipt.ID, "comic-work:" + receipt.ExecutionToken
}

func comicSubmissionHash(input *CreateComicAnalysisSessionInput) (string, error) {
	if input.Source == nil {
		return "", ErrComicSourceRequired
	}
	if input.SourceSize > ComicProjectSourceMaxBytes {
		return "", ErrComicSourceTooLarge
	}
	hash := sha256.New()
	var size int64
	var err error
	if seekable, ok := input.Source.(io.ReadSeeker); ok {
		start, seekErr := seekable.Seek(0, io.SeekCurrent)
		if seekErr != nil {
			return "", ErrComicSourceInvalid
		}
		size, err = io.Copy(hash, io.LimitReader(seekable, ComicProjectSourceMaxBytes+1))
		if _, seekErr = seekable.Seek(start, io.SeekStart); seekErr != nil {
			return "", ErrComicSourceInvalid
		}
	} else {
		var data []byte
		data, err = io.ReadAll(io.LimitReader(input.Source, ComicProjectSourceMaxBytes+1))
		size = int64(len(data))
		_, _ = hash.Write(data)
		input.Source = bytes.NewReader(data)
	}
	if err != nil {
		return "", ErrComicSourceInvalid
	}
	if size > ComicProjectSourceMaxBytes {
		return "", ErrComicSourceTooLarge
	}
	return GenerationReceiptRequestHash(map[string]any{
		"project": input.CreateComicProjectInput, "type": input.SourceType, "file": input.SourceFileName,
		"content_type": input.SourceContentType, "source_sha256": hex.EncodeToString(hash.Sum(nil)),
		"source_text": input.SourceText, "instruction": input.InitialInstruction, "model": input.RequestedModel,
	})
}

func (s *ComicAssetService) createAnalysisSubmission(ctx context.Context, userID, scope string, input CreateComicAnalysisSessionInput) (ComicAnalysisDetail, error) {
	if s.analysisReceipts == nil {
		return ComicAnalysisDetail{}, ErrGenerationReceiptUnavailable
	}
	requestHash, err := comicSubmissionHash(&input)
	if err != nil {
		return ComicAnalysisDetail{}, err
	}
	claim, claimed, err := s.analysisReceipts.Begin(ctx, comicSubmissionScope(userID, scope, input.IdempotencyKey), requestHash)
	if err != nil {
		return ComicAnalysisDetail{}, err
	}
	if !claimed {
		status, err := s.GetAnalysisSubmission(ctx, userID, scope, input.IdempotencyKey)
		if err != nil {
			return ComicAnalysisDetail{}, err
		}
		if status.SessionID != "" {
			return s.GetAnalysisSession(status.SessionID, userID, scope)
		}
		return ComicAnalysisDetail{}, ErrComicAnalysisSubmissionPending
	}
	input.sessionID, input.analysisReceiptKey = comicSubmissionIdentities(claim)
	// The multipart file remains open until this bounded call returns. Transport
	// loss must not cancel a claimed upload and strand an otherwise valid task.
	setupCtx, stop := context.WithTimeout(context.WithoutCancel(ctx), ComicAnalysisTaskTimeout)
	defer stop()
	detail, err := s.createAnalysisSession(setupCtx, userID, scope, input)
	saveCtx, cancel := context.WithTimeout(context.Background(), comicAnalysisReceiptSaveTimeout)
	defer cancel()
	if err != nil {
		// No background generator is started by a failing creation. Keep the
		// claim even if the failure acknowledgement itself cannot be persisted.
		_ = s.analysisReceipts.Fail(saveCtx, claim, "", false)
		return ComicAnalysisDetail{}, err
	}
	body, _ := json.Marshal(map[string]string{"session_id": detail.Session.ID})
	// The database session plus deterministic binding is already sufficient for
	// recovery if only the acceptance-response store is temporarily unavailable.
	_ = s.analysisReceipts.Complete(saveCtx, claim, GenerationReceiptResult{ContentType: "application/json", Body: body})
	return detail, nil
}

func (s *ComicAssetService) GetAnalysisSubmission(ctx context.Context, userID, scope, key string) (ComicAnalysisSubmission, error) {
	receipt, _, lookupErr := s.analysisReceipts.Lookup(ctx, comicSubmissionScope(userID, scope, key))
	if receipt.ID == "" {
		return ComicAnalysisSubmission{}, lookupErr
	}
	if receipt.State == model.GenerationReceiptStateNotSubmitted {
		return ComicAnalysisSubmission{Status: model.GenerationReceiptStateNotSubmitted}, nil
	}
	sessionID, executionKey := comicSubmissionIdentities(receipt)
	session, _, err := s.repo.GetAnalysisSession(sessionID, receipt.WorkspaceID)
	if err == nil {
		if session.OwnerID != userID || session.AnalysisReceiptKey != executionKey || !comicAnalysisHasReceipt(session) {
			return ComicAnalysisSubmission{}, ErrGenerationReceiptConflict
		}
		if !session.ExpiresAt.After(time.Now().UTC()) {
			return ComicAnalysisSubmission{Status: model.GenerationReceiptStateExpired}, nil
		}
		return ComicAnalysisSubmission{Status: "ready", SessionID: session.ID}, nil
	}
	if !errors.Is(err, repository.ErrComicAnalysisSessionNotFound) {
		return ComicAnalysisSubmission{}, ErrGenerationReceiptUnavailable
	}
	if receipt.State == model.GenerationReceiptStateFailed || receipt.State == model.GenerationReceiptStateExpired {
		return ComicAnalysisSubmission{Status: receipt.State}, nil
	}
	if time.Since(receipt.CreatedAt) > ComicAnalysisTaskTimeout {
		// Seal the independently claimed model execution before reporting that
		// setup never submitted it. A delayed upload can no longer invoke a model.
		execution, err := s.analysisReceipts.Reconcile(ctx, GenerationReceiptScope{UserID: userID, WorkspaceID: receipt.WorkspaceID, Kind: model.GenerationReceiptKindText, Key: executionKey})
		if err != nil {
			return ComicAnalysisSubmission{}, err
		}
		if execution.State == model.GenerationReceiptStateNotSubmitted {
			return ComicAnalysisSubmission{Status: model.GenerationReceiptStateNotSubmitted}, nil
		}
		return ComicAnalysisSubmission{Status: model.GenerationReceiptStateUncertain}, nil
	}
	if lookupErr != nil {
		return ComicAnalysisSubmission{}, lookupErr
	}
	return ComicAnalysisSubmission{Status: "preparing"}, nil
}
