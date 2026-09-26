package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

const (
	// The checkpoint holds a candidate and its original compare-and-swap
	// preconditions, never a permission to issue another provider request.
	comicOperationCheckpointVersion = 1
	ComicOperationRecoveryApplied   = "applied"
	ComicOperationRecoveryConflict  = "conflict"
	ComicOperationConflictMessage   = "生成结果已保留，但原内容已修改或确认，未覆盖当前内容；请查看保留的候选结果"
)

type comicOperationReceiptContextKey struct{}

// WithComicOperationReceipt carries the wrapper's authenticated, immutable
// execution claim into a service operation. The client cannot provide it.
func WithComicOperationReceipt(ctx context.Context, receipt model.GenerationReceipt) context.Context {
	return context.WithValue(ctx, comicOperationReceiptContextKey{}, receipt)
}

type ComicOperationCandidate struct {
	Revision *model.ComicAssetAnalysisRevision `json:"revision,omitempty"`
	Prompt   *OptimizeComicPromptResult        `json:"prompt,omitempty"`
}

// Result retains the ordinary operation response shape only when applied.
// Conflict candidates are separate so clients cannot mistake them for saved
// state or discard the original request and pay for a replacement generation.
type ComicOperationRecovery struct {
	Status    string                   `json:"status"`
	Kind      string                   `json:"kind"`
	Result    any                      `json:"result,omitempty"`
	Candidate *ComicOperationCandidate `json:"candidate,omitempty"`
	Message   string                   `json:"message,omitempty"`
}

type comicOperationCheckpoint struct {
	Version                  int                               `json:"version"`
	ReceiptID                string                            `json:"receipt_id"`
	UserID                   string                            `json:"user_id"`
	WorkspaceID              string                            `json:"workspace_id"`
	Kind                     string                            `json:"kind"`
	SessionID                string                            `json:"session_id,omitempty"`
	ExpectedActiveRevisionID string                            `json:"expected_active_revision_id,omitempty"`
	ExpectedUpdatedAt        time.Time                         `json:"expected_updated_at"`
	Revision                 *model.ComicAssetAnalysisRevision `json:"revision,omitempty"`
	ExpectedPromptVersion    int                               `json:"expected_prompt_version,omitempty"`
	Prompt                   *OptimizeComicPromptResult        `json:"prompt,omitempty"`
}

func comicOperationReceipt(ctx context.Context, userID, workspaceID, kind string) (model.GenerationReceipt, bool, error) {
	receipt, ok := ctx.Value(comicOperationReceiptContextKey{}).(model.GenerationReceipt)
	if !ok {
		return model.GenerationReceipt{}, false, nil
	}
	if receipt.UserID != userID || receipt.WorkspaceID != workspaceID || receipt.Kind != kind || receipt.ID == "" || receipt.ExecutionToken == "" {
		return model.GenerationReceipt{}, false, ErrGenerationReceiptConflict
	}
	return receipt, true, nil
}

func comicOperationCheckpointScope(receipt model.GenerationReceipt) GenerationReceiptScope {
	return GenerationReceiptScope{UserID: receipt.UserID, WorkspaceID: receipt.WorkspaceID, Kind: model.GenerationReceiptKindText, Key: "comic-output:" + receipt.ExecutionToken}
}

// Claim the independent result slot before provider execution. The external
// receipt remains responsible for the final HTTP envelope; this internal slot
// survives a later DB mutation failure or loss of its acknowledgement.
func (s *ComicAssetService) beginComicOperationCheckpoint(ctx context.Context, receipt model.GenerationReceipt) (model.GenerationReceipt, error) {
	if s.analysisReceipts == nil {
		return model.GenerationReceipt{}, ErrGenerationReceiptUnavailable
	}
	claim, fresh, err := s.analysisReceipts.Begin(ctx, comicOperationCheckpointScope(receipt), receipt.RequestHash)
	if err != nil {
		return model.GenerationReceipt{}, err
	}
	if !fresh {
		return model.GenerationReceipt{}, ErrComicTextSubmissionUncertain
	}
	return claim, nil
}

func (s *ComicAssetService) saveComicOperationCheckpoint(claim model.GenerationReceipt, checkpoint comicOperationCheckpoint) error {
	ctx, cancel := context.WithTimeout(context.Background(), comicAnalysisReceiptSaveTimeout)
	defer cancel()
	body, err := json.Marshal(checkpoint)
	if err != nil {
		return err
	}
	for attempt := 0; attempt < comicAnalysisReceiptSaveAttempts; attempt++ {
		err = s.analysisReceipts.Complete(ctx, claim, GenerationReceiptResult{ContentType: "application/json", Body: body})
		if err == nil || !errors.Is(err, ErrGenerationReceiptUnavailable) || ctx.Err() != nil {
			return err
		}
		if attempt+1 < comicAnalysisReceiptSaveAttempts {
			select {
			case <-ctx.Done():
				return err
			case <-time.After(comicAnalysisReceiptRetryDelay):
			}
		}
	}
	return err
}

func newComicOperationCheckpoint(receipt model.GenerationReceipt) comicOperationCheckpoint {
	return comicOperationCheckpoint{Version: comicOperationCheckpointVersion, ReceiptID: receipt.ID, UserID: receipt.UserID, WorkspaceID: receipt.WorkspaceID, Kind: receipt.Kind}
}

// RecoverComicOperation only reads a previously generated encrypted candidate
// and retries its original guarded DB mutation. It never calls textGenerator.
// nil means no candidate is available yet. The caller must keep the receipt's
// existing running/uncertain state, not grant another execution.
func (s *ComicAssetService) RecoverComicOperation(ctx context.Context, receipt model.GenerationReceipt) (*ComicOperationRecovery, error) {
	if receipt.Kind != model.GenerationReceiptKindComicRevision && receipt.Kind != model.GenerationReceiptKindComicPrompt {
		return nil, nil
	}
	if receipt.ID == "" || receipt.ExecutionToken == "" {
		return nil, nil
	}
	_, output, err := s.analysisReceipts.Lookup(ctx, comicOperationCheckpointScope(receipt))
	if errors.Is(err, ErrGenerationReceiptNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if output == nil {
		return nil, nil
	}
	var checkpoint comicOperationCheckpoint
	if output.ContentType != "application/json" || json.Unmarshal(output.Body, &checkpoint) != nil ||
		checkpoint.Version != comicOperationCheckpointVersion || checkpoint.ReceiptID != receipt.ID ||
		checkpoint.UserID != receipt.UserID || checkpoint.WorkspaceID != receipt.WorkspaceID || checkpoint.Kind != receipt.Kind || checkpoint.ExpectedUpdatedAt.IsZero() {
		return nil, ErrGenerationReceiptConflict
	}
	if checkpoint.Kind == model.GenerationReceiptKindComicRevision {
		return s.applyComicRevisionCheckpoint(checkpoint)
	}
	return s.applyComicPromptCheckpoint(checkpoint)
}

func comicOperationConflict(checkpoint comicOperationCheckpoint) *ComicOperationRecovery {
	return &ComicOperationRecovery{Status: ComicOperationRecoveryConflict, Kind: checkpoint.Kind,
		Candidate: &ComicOperationCandidate{Revision: checkpoint.Revision, Prompt: checkpoint.Prompt}, Message: ComicOperationConflictMessage}
}

func comicOperationMutationConflict(err error) bool {
	return errors.Is(err, repository.ErrComicAssetConflict) || errors.Is(err, repository.ErrComicAssetInvalidState) ||
		errors.Is(err, repository.ErrComicAssetNotFound) || errors.Is(err, repository.ErrComicAssetProjectNotFound) ||
		errors.Is(err, repository.ErrComicAnalysisSessionNotFound) || errors.Is(err, repository.ErrComicAnalysisRevisionNotFound) || errors.Is(err, ErrComicAnalysisExpired)
}

func (s *ComicAssetService) applyComicRevisionCheckpoint(checkpoint comicOperationCheckpoint) (*ComicOperationRecovery, error) {
	if checkpoint.Revision == nil || checkpoint.Prompt != nil || checkpoint.SessionID == "" ||
		checkpoint.Revision.SessionID != checkpoint.SessionID || checkpoint.Revision.ID != "comic_revision_"+checkpoint.ReceiptID || checkpoint.ExpectedActiveRevisionID == "" {
		return nil, ErrGenerationReceiptConflict
	}
	if _, err := decodeComicAnalysisSnapshot(checkpoint.Revision.Candidate); err != nil {
		return nil, ErrGenerationReceiptConflict
	}
	session, revisions, err := s.repo.GetAnalysisSession(checkpoint.SessionID, checkpoint.WorkspaceID)
	if err == nil {
		// A commit may have succeeded even though its response failed. Revision
		// IDs are immutable; finding ours proves application without reactivation.
		if _, applied := comicAnalysisRevisionByID(revisions, checkpoint.Revision.ID); applied {
			session.Scope = WorkspaceScopeFromID(session.WorkspaceID)
			return &ComicOperationRecovery{Status: ComicOperationRecoveryApplied, Kind: checkpoint.Kind, Result: ComicAnalysisDetail{Session: session, Revisions: revisions}}, nil
		}
		err = validateComicAnalysisSessionEditable(session)
	}
	if err == nil {
		session, revisions, err = s.repo.CreateAnalysisRevisionIfUnchanged(checkpoint.SessionID, checkpoint.WorkspaceID, checkpoint.ExpectedActiveRevisionID, checkpoint.ExpectedUpdatedAt, *checkpoint.Revision)
	}
	if comicOperationMutationConflict(err) {
		// Another recovery/finishing request may have won the same CAS after our
		// initial read. Recognize its immutable revision before reporting conflict.
		current, saved, readErr := s.repo.GetAnalysisSession(checkpoint.SessionID, checkpoint.WorkspaceID)
		if readErr == nil {
			if _, applied := comicAnalysisRevisionByID(saved, checkpoint.Revision.ID); applied {
				current.Scope = WorkspaceScopeFromID(current.WorkspaceID)
				return &ComicOperationRecovery{Status: ComicOperationRecoveryApplied, Kind: checkpoint.Kind, Result: ComicAnalysisDetail{Session: current, Revisions: saved}}, nil
			}
		}
		if readErr != nil && !comicOperationMutationConflict(readErr) {
			return nil, ErrGenerationReceiptUnavailable
		}
		return comicOperationConflict(checkpoint), nil
	}
	if err != nil {
		return nil, ErrGenerationReceiptUnavailable
	}
	session.Scope = WorkspaceScopeFromID(session.WorkspaceID)
	return &ComicOperationRecovery{Status: ComicOperationRecoveryApplied, Kind: checkpoint.Kind, Result: ComicAnalysisDetail{Session: session, Revisions: revisions}}, nil
}

func (s *ComicAssetService) applyComicPromptCheckpoint(checkpoint comicOperationCheckpoint) (*ComicOperationRecovery, error) {
	if checkpoint.Prompt == nil || checkpoint.Revision != nil || checkpoint.Prompt.Asset.ID == "" || checkpoint.Prompt.Asset.ProjectID == "" ||
		checkpoint.Prompt.Asset.PromptVersion != checkpoint.ExpectedPromptVersion+1 || !checkpoint.Prompt.Asset.UpdatedAt.Equal(checkpoint.ExpectedUpdatedAt) {
		return nil, ErrGenerationReceiptConflict
	}
	candidate := checkpoint.Prompt.Asset
	revisions := decodeComicPromptRevisions(candidate.PromptRevisions)
	if len(revisions) == 0 || revisions[len(revisions)-1].OperationID != checkpoint.ReceiptID || revisions[len(revisions)-1].Content != candidate.DraftPrompt {
		return nil, ErrGenerationReceiptConflict
	}
	asset, err := s.repo.GetAsset(candidate.ProjectID, candidate.ID, checkpoint.WorkspaceID)
	if err == nil {
		for _, revision := range decodeComicPromptRevisions(asset.PromptRevisions) {
			if revision.OperationID == checkpoint.ReceiptID {
				result := *checkpoint.Prompt
				result.Asset = asset
				return &ComicOperationRecovery{Status: ComicOperationRecoveryApplied, Kind: checkpoint.Kind, Result: result}, nil
			}
		}
		asset, err = s.repo.UpdateAssetPromptCandidate(candidate, checkpoint.WorkspaceID, checkpoint.ExpectedPromptVersion)
	}
	if comicOperationMutationConflict(err) {
		current, readErr := s.repo.GetAsset(candidate.ProjectID, candidate.ID, checkpoint.WorkspaceID)
		if readErr == nil {
			for _, revision := range decodeComicPromptRevisions(current.PromptRevisions) {
				if revision.OperationID == checkpoint.ReceiptID {
					result := *checkpoint.Prompt
					result.Asset = current
					return &ComicOperationRecovery{Status: ComicOperationRecoveryApplied, Kind: checkpoint.Kind, Result: result}, nil
				}
			}
		}
		if readErr != nil && !comicOperationMutationConflict(readErr) {
			return nil, ErrGenerationReceiptUnavailable
		}
		return comicOperationConflict(checkpoint), nil
	}
	if err != nil {
		return nil, ErrGenerationReceiptUnavailable
	}
	result := *checkpoint.Prompt
	result.Asset = asset
	return &ComicOperationRecovery{Status: ComicOperationRecoveryApplied, Kind: checkpoint.Kind, Result: result}, nil
}
