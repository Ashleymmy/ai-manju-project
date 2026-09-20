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
	ComicAnalysisTaskTimeout      = 20 * time.Minute
	comicAnalysisTimeoutMessage   = "剧本分析超时或服务中断，上传文件已保留，请重新发起分析"
	comicAnalysisProviderMessage  = "模型服务未能完成剧本分析，上传文件已保留，请稍后重试或更换模型"
	comicAnalysisCandidateMessage = "模型返回的资产清单格式不完整，上传文件已保留，请重新分析"
)

func (s *ComicAssetService) runPendingAnalysis(parent context.Context, session model.ComicAssetAnalysisSession, requestedModel, instruction string, request provider.TextGenerationRequest) {
	ctx, cancel := context.WithDeadline(parent, session.CreatedAt.Add(ComicAnalysisTaskTimeout))
	defer cancel()
	var revision *model.ComicAssetAnalysisRevision
	failure := comicAnalysisProviderMessage
	defer func() {
		if recovered := recover(); recovered != nil {
			// Do not log provider payloads or the uploaded script.
			log.Printf("comic analysis panic session_id=%s", session.ID)
			revision = nil
		}
		if err := s.repo.FinishPendingAnalysisSession(session.ID, session.WorkspaceID, revision, failure); err != nil {
			log.Printf("comic analysis completion failed session_id=%s error=%v", session.ID, err)
		}
	}()
	generated, err := s.textGenerator(ctx, requestedModel, request)
	if ctx.Err() != nil || errors.Is(err, context.DeadlineExceeded) {
		failure = comicAnalysisTimeoutMessage
		return
	}
	if err != nil {
		log.Printf("comic analysis generation failed session_id=%s", session.ID)
		return
	}
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
