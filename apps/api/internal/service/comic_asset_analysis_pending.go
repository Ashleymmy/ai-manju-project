package service

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
)

const (
	// Bound the entire background analysis, including supplier retries. GET also
	// uses this deadline to resolve abandoned tasks after a process restart.
	ComicAnalysisTaskTimeout         = 20 * time.Minute
	comicAnalysisTimeoutMessage      = "剧本分析超时或服务中断，结果尚未确认，上传文件已保留；请勿重复提交，请联系管理员核查"
	comicAnalysisProviderMessage     = "模型服务未能完成剧本分析，上传文件已保留，请稍后重试或更换模型"
	comicAnalysisCandidateMessage    = "模型返回的资产清单格式不完整，上传文件已保留，请重新分析"
	comicAnalysisNotSubmittedMessage = "剧本分析尚未提交到模型服务，上传文件已保留，可重新发起分析"
)

func (s *ComicAssetService) runPendingAnalysis(parent context.Context, session model.ComicAssetAnalysisSession, requestedModel, instruction string, request provider.TextGenerationRequest) {
	ctx, cancel := context.WithDeadline(parent, session.CreatedAt.Add(ComicAnalysisTaskTimeout))
	defer cancel()
	if comicAnalysisHasReceipt(session) && ctx.Err() != nil {
		_ = s.restorePendingAnalysisReceipt(session)
		return
	}
	var binding *model.GenerationReceipt
	if comicAnalysisHasReceipt(session) {
		hash, err := GenerationReceiptRequestHash(map[string]any{"session_id": session.ID, "model": requestedModel, "instruction": instruction, "request": request})
		if err != nil {
			return
		}
		receipt, claimed, err := s.analysisReceipts.Begin(ctx, comicAnalysisReceiptScope(session), hash)
		if err != nil {
			// A lost claim response is ambiguous. Never call the Provider without
			// ownership, and never retry it just because a receipt is unavailable.
			_ = s.repo.FinishPendingAnalysisSession(session.ID, session.WorkspaceID, nil, comicAnalysisTimeoutMessage)
			return
		}
		if !claimed {
			_ = s.restorePendingAnalysisReceipt(session)
			return
		}
		binding = &receipt
	}
	var revision *model.ComicAssetAnalysisRevision
	failure := comicAnalysisProviderMessage
	uncertain := false
	defer func() {
		if recovered := recover(); recovered != nil {
			// Do not log provider payloads or the uploaded script.
			log.Printf("comic analysis panic session_id=%s", session.ID)
			revision = nil
			failure, uncertain = comicAnalysisTimeoutMessage, true
		}
		if binding != nil {
			if revision != nil {
				s.savePendingAnalysisReceipt(session, *binding, *revision)
				return
			}
			saveCtx, stop := context.WithTimeout(context.Background(), comicAnalysisReceiptSaveTimeout)
			defer stop()
			_ = s.analysisReceipts.Fail(saveCtx, *binding, failure, uncertain)
		}
		if err := s.repo.FinishPendingAnalysisSession(session.ID, session.WorkspaceID, revision, failure); err != nil {
			log.Printf("comic analysis completion failed session_id=%s error=%v", session.ID, err)
		}
	}()
	generated, err := s.textGenerator(ctx, session.OwnerID, requestedModel, request)
	if err != nil {
		if ctx.Err() != nil || errors.Is(err, context.DeadlineExceeded) {
			failure, uncertain = comicAnalysisTimeoutMessage, true
		}
		if errors.Is(err, ErrComicTextSubmissionUncertain) {
			failure, uncertain = ErrComicTextSubmissionUncertain.Error(), true
		}
		log.Printf("comic analysis generation failed session_id=%s", session.ID)
		return
	}
	// A complete successful response belongs to this execution even when the
	// deadline fired concurrently. Validate and persist it with a fresh context.
	snapshot, err := parseComicAnalysisCandidate(generated.Text)
	if err != nil {
		failure = comicAnalysisCandidateMessage
		return
	}
	revision = &model.ComicAssetAnalysisRevision{
		ID: "comic_revision_" + randomHex(10), SessionID: session.ID,
		Source: model.ComicAnalysisRevisionSourceInitial, Instruction: instruction,
		RequestedModel: requestedModel, ResponseModel: strings.TrimSpace(generated.Model),
		Candidate: encodeComicJSON(snapshot, `{"assets":[]}`),
	}
	failure = ""
}
