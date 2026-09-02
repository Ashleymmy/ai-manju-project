package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/storage"
)

const (
	// ComicAnalysisRetention is the reviewed lifetime for an unconfirmed session.
	ComicAnalysisRetention = 7 * 24 * time.Hour
	// ComicAnalysisMaxScriptRunes matches the browser extraction safety bound.
	ComicAnalysisMaxScriptRunes = 120_000
	// ComicAnalysisMaxInstructionRunes keeps iterative requests bounded.
	ComicAnalysisMaxInstructionRunes = 4_000
	// ComicAnalysisMaintenanceInterval bounds cleanup delay after the seven-day expiry.
	ComicAnalysisMaintenanceInterval = time.Hour
	// ComicDefaultInitialAnalysisInstruction prevents a blank first pass from
	// silently dropping production details while preserving old API clients.
	ComicDefaultInitialAnalysisInstruction = "按剧本出现顺序完整拆解人物、场景、道具和必要 UI；不同服装、造型或受损状态分别建项；保留身份关系、外观、服装、材质、随身道具、场景时间空间和光线细节；剧本未明确的信息标记为未明确，不得自行补写。"

	ComicPromptOperationOptimize = "optimize"
	ComicPromptOperationMerge    = "merge"
)

var (
	ErrComicAnalysisExpired         = errors.New("comic asset analysis session has expired")
	ErrComicAnalysisInstruction     = errors.New("comic asset analysis revision instruction is required")
	ErrComicAnalysisCandidate       = errors.New("comic asset analysis candidate is invalid")
	ErrComicAnalysisScriptRequired  = errors.New("comic asset analysis script text is required")
	ErrComicAnalysisScriptTooLarge  = errors.New("comic asset analysis script exceeds 120000 characters")
	ErrComicPromptDirectionRequired = errors.New("comic asset prompt optimization direction is required")
	ErrComicPromptOperationInvalid  = errors.New("comic asset prompt operation is invalid")
	ErrComicPromptMergeBaseRequired = errors.New("comic asset prompt merge base is required")
	ErrComicPromptMergeBaseInvalid  = errors.New("comic asset prompt merge base is not a saved revision")
	ErrComicTextModelRequired       = errors.New("text model is required")
	ErrComicTextProvider            = errors.New("text model provider is unavailable; please contact an administrator")
)

type ComicTextGenerator func(ctx context.Context, requestedModel string, request provider.TextGenerationRequest) (provider.TextResponse, error)

func (s *ComicAssetService) SetTextGenerator(generator ComicTextGenerator) {
	s.textGenerator = generator
}

// StartAnalysisMaintenance removes only unconfirmed sessions after their
// retention window. Confirmed sessions share their source with a project and
// are therefore never selected by this cleanup.
func (s *ComicAssetService) StartAnalysisMaintenance(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = ComicAnalysisMaintenanceInterval
	}
	go func() {
		if err := s.CleanupExpiredAnalysisSessions(ctx); err != nil {
			log.Printf("comic analysis cleanup failed: %v", err)
		}
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := s.CleanupExpiredAnalysisSessions(ctx); err != nil {
					log.Printf("comic analysis cleanup failed: %v", err)
				}
			}
		}
	}()
}

func (s *ComicAssetService) CleanupExpiredAnalysisSessions(ctx context.Context) error {
	now := time.Now().UTC()
	sessions, err := s.repo.ListExpiredAnalysisSessions(now)
	if err != nil {
		return err
	}
	for _, session := range sessions {
		if s.sourceStorage != nil && strings.TrimSpace(session.SourceStorageKey) != "" {
			if err := s.sourceStorage.Delete(ctx, session.SourceStorageKey); err != nil && !errors.Is(err, os.ErrNotExist) {
				log.Printf("comic analysis source cleanup failed session_id=%s error=%v", session.ID, err)
				continue
			}
		}
		if err := s.repo.DeleteExpiredAnalysisSession(session.ID, now); err != nil && !errors.Is(err, repository.ErrComicAssetInvalidState) {
			log.Printf("comic analysis record cleanup failed session_id=%s error=%v", session.ID, err)
		}
	}
	return nil
}

type ComicAnalysisCandidate struct {
	Code              string `json:"code"`
	Class             string `json:"class"`
	Name              string `json:"name"`
	State             string `json:"state"`
	Description       string `json:"description"`
	VisualDescription string `json:"visual_description"`
	ChangeRequest     string `json:"change_request"`
	SourcePrompt      string `json:"source_prompt"`
	PromptTemplate    string `json:"prompt_template"`
	ArchiveStatus     string `json:"archive_status"`
}

type ComicAnalysisCandidateSnapshot struct {
	Assets []ComicAnalysisCandidate `json:"assets"`
}

type ComicAnalysisDetail struct {
	Session   model.ComicAssetAnalysisSession    `json:"session"`
	Revisions []model.ComicAssetAnalysisRevision `json:"revisions"`
}

type CreateComicAnalysisSessionInput struct {
	CreateComicProjectInput
	SourceType         string
	SourceFileName     string
	SourceContentType  string
	SourceSize         int64
	Source             io.Reader
	SourceText         string
	InitialInstruction string
	RequestedModel     string
}

type CreateComicAnalysisRevisionInput struct {
	Instruction              string
	RequestedModel           string
	ParentRevisionID         string
	ExpectedActiveRevisionID string
	Source                   string
	Candidate                *ComicAnalysisCandidateSnapshot
}

type OptimizeComicPromptInput struct {
	Direction             string
	RequestedModel        string
	Operation             string
	BaseContent           string
	ExpectedPromptVersion int
}

type OptimizeComicPromptResult struct {
	Asset          model.ComicAsset              `json:"asset"`
	RequestedModel string                        `json:"requested_model"`
	ResponseModel  string                        `json:"response_model"`
	MergeReport    *model.ComicPromptMergeReport `json:"merge_report,omitempty"`
}

type BulkComicPromptApprovalInput struct {
	AssetID               string `json:"asset_id"`
	ExpectedPromptVersion int    `json:"expected_prompt_version"`
}

type BulkComicPromptApprovalResult struct {
	AssetID string            `json:"asset_id"`
	OK      bool              `json:"ok"`
	Asset   *model.ComicAsset `json:"asset,omitempty"`
	Error   string            `json:"error,omitempty"`
}

func (s *ComicAssetService) CreateAnalysisSession(ctx context.Context, userID string, scope string, input CreateComicAnalysisSessionInput) (ComicAnalysisDetail, error) {
	if s.sourceStorage == nil {
		return ComicAnalysisDetail{}, ErrComicSourceUnavailable
	}
	if s.textGenerator == nil {
		return ComicAnalysisDetail{}, ErrComicTextProvider
	}
	projectInput := newComicProject(userID, scope, input.CreateComicProjectInput)
	if projectInput.Title == "" {
		return ComicAnalysisDetail{}, ErrComicTitleRequired
	}
	requestedModel := strings.TrimSpace(input.RequestedModel)
	if requestedModel == "" {
		return ComicAnalysisDetail{}, ErrComicTextModelRequired
	}
	initialInstruction := trimRunes(strings.TrimSpace(input.InitialInstruction), ComicAnalysisMaxInstructionRunes)
	if initialInstruction == "" {
		initialInstruction = ComicDefaultInitialAnalysisInstruction
	}
	sourceText := strings.TrimSpace(input.SourceText)
	if sourceText == "" {
		return ComicAnalysisDetail{}, ErrComicAnalysisScriptRequired
	}
	if utf8.RuneCountInString(sourceText) > ComicAnalysisMaxScriptRunes {
		return ComicAnalysisDetail{}, ErrComicAnalysisScriptTooLarge
	}
	if input.Source == nil {
		return ComicAnalysisDetail{}, ErrComicSourceRequired
	}
	if input.SourceSize > ComicProjectSourceMaxBytes {
		return ComicAnalysisDetail{}, ErrComicSourceTooLarge
	}
	sourceType, extension, contentType, err := normalizeComicProjectSource(input.SourceType, input.SourceFileName, input.SourceContentType)
	if err != nil || sourceType != "script" {
		return ComicAnalysisDetail{}, ErrComicSourceInvalid
	}

	sessionID := "comic_analysis_" + randomHex(10)
	storageKey := comicAnalysisSourceStorageKey(projectInput.WorkspaceID, sessionID, extension)
	object, err := s.sourceStorage.Put(ctx, storageKey, io.LimitReader(input.Source, ComicProjectSourceMaxBytes+1), storage.PutMeta{
		ContentType: contentType,
		Size:        ComicProjectSourceMaxBytes + 1,
	})
	if err != nil {
		return ComicAnalysisDetail{}, err
	}
	cleanupSource := true
	defer func() {
		if cleanupSource {
			_ = s.sourceStorage.Delete(context.Background(), storageKey)
		}
	}()
	if object.Size > ComicProjectSourceMaxBytes {
		return ComicAnalysisDetail{}, ErrComicSourceTooLarge
	}

	generated, err := s.textGenerator(ctx, requestedModel, comicInitialAnalysisRequest(projectInput, sourceText, initialInstruction))
	if err != nil {
		return ComicAnalysisDetail{}, err
	}
	snapshot, err := parseComicAnalysisCandidate(generated.Text)
	if err != nil {
		return ComicAnalysisDetail{}, err
	}
	candidateJSON := encodeComicJSON(snapshot, `{"assets":[]}`)
	now := time.Now().UTC()
	session := model.ComicAssetAnalysisSession{
		ID: sessionID, OwnerID: userID, WorkspaceID: projectInput.WorkspaceID,
		Title: projectInput.Title, StylePreset: projectInput.StylePreset, DefaultTemplates: projectInput.DefaultTemplates,
		SourceType: sourceType, SourceFileName: filepath.Base(strings.ReplaceAll(strings.TrimSpace(input.SourceFileName), "\\", "/")),
		SourceStorageKey: storageKey, SourceContentType: contentType, SourceSize: object.Size, SourceText: sourceText,
		Status: model.ComicAnalysisStatusActive, ExpiresAt: now.Add(ComicAnalysisRetention),
	}
	revision := model.ComicAssetAnalysisRevision{
		ID: "comic_revision_" + randomHex(10), SessionID: sessionID,
		Source: model.ComicAnalysisRevisionSourceInitial, Instruction: initialInstruction,
		RequestedModel: requestedModel, ResponseModel: strings.TrimSpace(generated.Model), Candidate: candidateJSON,
	}
	session, revision, err = s.repo.CreateAnalysisSession(session, revision)
	if err != nil {
		return ComicAnalysisDetail{}, err
	}
	cleanupSource = false
	session.Scope = WorkspaceScopeFromID(session.WorkspaceID)
	return ComicAnalysisDetail{Session: session, Revisions: []model.ComicAssetAnalysisRevision{revision}}, nil
}

func (s *ComicAssetService) GetAnalysisSession(sessionID string, userID string, scope string) (ComicAnalysisDetail, error) {
	session, revisions, err := s.repo.GetAnalysisSession(sessionID, WorkspaceIDForScope(scope, userID))
	if err != nil {
		return ComicAnalysisDetail{}, err
	}
	if err := validateComicAnalysisSession(session); err != nil {
		return ComicAnalysisDetail{}, err
	}
	session.Scope = WorkspaceScopeFromID(session.WorkspaceID)
	return ComicAnalysisDetail{Session: session, Revisions: revisions}, nil
}

func (s *ComicAssetService) CreateAnalysisRevision(ctx context.Context, sessionID string, userID string, scope string, input CreateComicAnalysisRevisionInput) (ComicAnalysisDetail, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	session, revisions, err := s.repo.GetAnalysisSession(sessionID, workspaceID)
	if err != nil {
		return ComicAnalysisDetail{}, err
	}
	if err := validateComicAnalysisSessionEditable(session); err != nil {
		return ComicAnalysisDetail{}, err
	}
	parentID := strings.TrimSpace(input.ParentRevisionID)
	if parentID == "" {
		parentID = session.ActiveRevisionID
	}
	parent, ok := comicAnalysisRevisionByID(revisions, parentID)
	if !ok {
		return ComicAnalysisDetail{}, repository.ErrComicAnalysisRevisionNotFound
	}
	expectedActive := strings.TrimSpace(input.ExpectedActiveRevisionID)
	if expectedActive == "" {
		expectedActive = session.ActiveRevisionID
	}
	source := strings.ToLower(strings.TrimSpace(input.Source))
	var snapshot ComicAnalysisCandidateSnapshot
	requestedModel := strings.TrimSpace(input.RequestedModel)
	responseModel := ""
	instruction := trimRunes(strings.TrimSpace(input.Instruction), ComicAnalysisMaxInstructionRunes)
	if source == model.ComicAnalysisRevisionSourceManual {
		if input.Candidate == nil {
			return ComicAnalysisDetail{}, ErrComicAnalysisCandidate
		}
		snapshot, err = normalizeComicAnalysisSnapshot(*input.Candidate)
		if instruction == "" {
			instruction = "人工调整资产候选"
		}
	} else {
		source = model.ComicAnalysisRevisionSourceAI
		if instruction == "" {
			return ComicAnalysisDetail{}, ErrComicAnalysisInstruction
		}
		if requestedModel == "" {
			return ComicAnalysisDetail{}, ErrComicTextModelRequired
		}
		if s.textGenerator == nil {
			return ComicAnalysisDetail{}, ErrComicTextProvider
		}
		generated, generateErr := s.textGenerator(ctx, requestedModel, comicRevisionAnalysisRequest(session, parent, instruction))
		if generateErr != nil {
			return ComicAnalysisDetail{}, generateErr
		}
		responseModel = strings.TrimSpace(generated.Model)
		snapshot, err = parseComicAnalysisCandidate(generated.Text)
	}
	if err != nil {
		return ComicAnalysisDetail{}, err
	}
	revision := model.ComicAssetAnalysisRevision{
		ID: "comic_revision_" + randomHex(10), SessionID: sessionID, ParentRevisionID: parentID,
		Source: source, Instruction: instruction, RequestedModel: requestedModel, ResponseModel: responseModel,
		Candidate: encodeComicJSON(snapshot, `{"assets":[]}`),
	}
	session, revisions, err = s.repo.CreateAnalysisRevision(sessionID, workspaceID, expectedActive, revision)
	if err != nil {
		return ComicAnalysisDetail{}, err
	}
	session.Scope = WorkspaceScopeFromID(session.WorkspaceID)
	return ComicAnalysisDetail{Session: session, Revisions: revisions}, nil
}

func (s *ComicAssetService) SetActiveAnalysisRevision(sessionID string, revisionID string, userID string, scope string) (ComicAnalysisDetail, error) {
	detail, err := s.GetAnalysisSession(sessionID, userID, scope)
	if err != nil {
		return ComicAnalysisDetail{}, err
	}
	if err := validateComicAnalysisSessionEditable(detail.Session); err != nil {
		return ComicAnalysisDetail{}, err
	}
	session, revisions, err := s.repo.SetActiveAnalysisRevision(sessionID, strings.TrimSpace(revisionID), detail.Session.WorkspaceID)
	if err != nil {
		return ComicAnalysisDetail{}, err
	}
	session.Scope = WorkspaceScopeFromID(session.WorkspaceID)
	return ComicAnalysisDetail{Session: session, Revisions: revisions}, nil
}

func (s *ComicAssetService) ConfirmAnalysisSession(sessionID string, revisionID string, userID string, scope string) (ComicProjectDetail, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	session, revisions, err := s.repo.GetAnalysisSession(sessionID, workspaceID)
	if err != nil {
		return ComicProjectDetail{}, err
	}
	if session.Status == model.ComicAnalysisStatusConfirmed {
		return s.GetProject(session.ProjectID, userID, scope)
	}
	if err := validateComicAnalysisSessionEditable(session); err != nil {
		return ComicProjectDetail{}, err
	}
	if strings.TrimSpace(revisionID) == "" {
		revisionID = session.ActiveRevisionID
	}
	revision, ok := comicAnalysisRevisionByID(revisions, revisionID)
	if !ok {
		return ComicProjectDetail{}, repository.ErrComicAnalysisRevisionNotFound
	}
	snapshot, err := decodeComicAnalysisSnapshot(revision.Candidate)
	if err != nil {
		return ComicProjectDetail{}, err
	}
	project := newComicProject(userID, scope, CreateComicProjectInput{
		Title: session.Title, StylePreset: session.StylePreset, DefaultTemplates: decodeComicTemplates(session.DefaultTemplates),
	})
	project.SourceType = session.SourceType
	project.SourceFileName = session.SourceFileName
	project.SourceStorageKey = session.SourceStorageKey
	project.SourceContentType = session.SourceContentType
	project.SourceSize = session.SourceSize
	assets, err := buildComicAssetsFromAnalysis(project.ID, snapshot)
	if err != nil {
		return ComicProjectDetail{}, err
	}
	_, project, assets, err = s.repo.ConfirmAnalysisSession(sessionID, revisionID, workspaceID, project, assets)
	if err != nil {
		return ComicProjectDetail{}, err
	}
	project.Scope = WorkspaceScopeFromID(project.WorkspaceID)
	return ComicProjectDetail{Project: project, Assets: assets}, nil
}

func (s *ComicAssetService) OptimizePrompt(ctx context.Context, projectID string, assetID string, userID string, scope string, input OptimizeComicPromptInput) (OptimizeComicPromptResult, error) {
	direction := trimRunes(strings.TrimSpace(input.Direction), ComicAnalysisMaxInstructionRunes)
	if direction == "" {
		return OptimizeComicPromptResult{}, ErrComicPromptDirectionRequired
	}
	operation := strings.ToLower(strings.TrimSpace(input.Operation))
	if operation == "" {
		operation = ComicPromptOperationOptimize
	}
	if operation != ComicPromptOperationOptimize && operation != ComicPromptOperationMerge {
		return OptimizeComicPromptResult{}, ErrComicPromptOperationInvalid
	}
	requestedModel := strings.TrimSpace(input.RequestedModel)
	if requestedModel == "" {
		return OptimizeComicPromptResult{}, ErrComicTextModelRequired
	}
	if s.textGenerator == nil {
		return OptimizeComicPromptResult{}, ErrComicTextProvider
	}
	workspaceID := WorkspaceIDForScope(scope, userID)
	project, err := s.repo.GetProject(projectID, workspaceID)
	if err != nil {
		return OptimizeComicPromptResult{}, err
	}
	asset, err := s.repo.GetAsset(projectID, assetID, workspaceID)
	if err != nil {
		return OptimizeComicPromptResult{}, err
	}
	if input.ExpectedPromptVersion > 0 && asset.PromptVersion != input.ExpectedPromptVersion {
		return OptimizeComicPromptResult{}, repository.ErrComicAssetConflict
	}
	template, _ := resolveComicTemplate(project, asset)
	draft := strings.TrimSpace(asset.DraftPrompt)
	if draft == "" {
		draft = renderComicPrompt(template, project, asset)
	}
	revisions := decodeComicPromptRevisions(asset.PromptRevisions)
	request := comicPromptOptimizationRequest(project, asset, draft, direction)
	baseVersion := 0
	mergeBaseContent := ""
	if operation == ComicPromptOperationMerge {
		baseContent := normalizeComicPrompt(input.BaseContent)
		if baseContent == "" {
			return OptimizeComicPromptResult{}, ErrComicPromptMergeBaseRequired
		}
		var validBase bool
		baseVersion, validBase = comicPromptMergeBaseVersion(asset, revisions, baseContent)
		if !validBase {
			return OptimizeComicPromptResult{}, ErrComicPromptMergeBaseInvalid
		}
		mergeBaseContent = baseContent
		request = comicPromptMergeRequest(project, asset, baseContent, direction)
	}
	generated, err := s.textGenerator(ctx, requestedModel, request)
	if err != nil {
		return OptimizeComicPromptResult{}, err
	}
	content := ""
	var mergeReport *model.ComicPromptMergeReport
	if operation == ComicPromptOperationMerge {
		content, mergeReport = parseComicPromptMergeResponse(generated.Text, asset, mergeBaseContent)
	} else {
		content = cleanComicTextCandidate(generated.Text)
	}
	if content == "" {
		return OptimizeComicPromptResult{}, ErrComicPromptRequired
	}
	warnings, _ := comicPromptIssues(content)
	expectedVersion := asset.PromptVersion
	asset.DraftPrompt = content
	asset.PromptWarnings = encodeComicJSON(warnings, "[]")
	asset.PromptVersion++
	asset.PromptStatus = model.ComicPromptStatusNeedsReview
	revisionSource := "ai"
	basedOn := []string(nil)
	if operation == ComicPromptOperationMerge {
		revisionSource = "merge"
		basedOn = []string{"source_prompt", fmt.Sprintf("prompt_revision:v%d", baseVersion)}
	}
	revisions = append(revisions, model.ComicPromptRevision{
		Version: asset.PromptVersion, Source: revisionSource, Content: content, Operation: operation, BasedOn: basedOn, Direction: direction,
		RequestedModel: requestedModel, ResponseModel: strings.TrimSpace(generated.Model), CreatedAt: time.Now().UTC(),
		MergeReport: mergeReport,
	})
	asset.PromptRevisions = encodeComicJSON(revisions, "[]")
	asset, err = s.repo.UpdateAssetIfPromptVersion(asset, workspaceID, expectedVersion)
	if err != nil {
		return OptimizeComicPromptResult{}, err
	}
	return OptimizeComicPromptResult{Asset: asset, RequestedModel: requestedModel, ResponseModel: strings.TrimSpace(generated.Model), MergeReport: mergeReport}, nil
}

func (s *ComicAssetService) BulkApprovePrompts(projectID string, userID string, scope string, approvals []BulkComicPromptApprovalInput) ([]BulkComicPromptApprovalResult, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	if _, err := s.repo.GetProject(projectID, workspaceID); err != nil {
		return nil, err
	}
	results := make([]BulkComicPromptApprovalResult, 0, len(approvals))
	seen := make(map[string]bool)
	for _, approval := range approvals {
		assetID := strings.TrimSpace(approval.AssetID)
		result := BulkComicPromptApprovalResult{AssetID: assetID}
		if assetID == "" || seen[assetID] {
			result.Error = "资产 ID 为空或重复"
			results = append(results, result)
			continue
		}
		seen[assetID] = true
		asset, err := s.repo.GetAsset(projectID, assetID, workspaceID)
		if err != nil {
			result.Error = "资产不存在或不可访问"
			results = append(results, result)
			continue
		}
		if asset.PromptVersion != approval.ExpectedPromptVersion {
			result.Error = "提示词版本已变化，请刷新后重试"
			results = append(results, result)
			continue
		}
		content := normalizeComicPrompt(asset.DraftPrompt)
		_, blockers := comicPromptIssues(content)
		if content == "" {
			result.Error = "候选草稿为空"
			results = append(results, result)
			continue
		}
		if len(blockers) > 0 {
			result.Error = strings.Join(blockers, "；")
			results = append(results, result)
			continue
		}
		expectedVersion := asset.PromptVersion
		asset.PromptVersion++
		asset.DraftPrompt = content
		asset.ApprovedPrompt = content
		asset.PromptStatus = model.ComicPromptStatusApproved
		asset.ChangeRequest = ""
		revisions := decodeComicPromptRevisions(asset.PromptRevisions)
		revisions = append(revisions, model.ComicPromptRevision{
			Version: asset.PromptVersion, Source: "bulk_approve", Content: content, Approved: true, CreatedAt: time.Now().UTC(),
		})
		asset.PromptRevisions = encodeComicJSON(revisions, "[]")
		asset, err = s.repo.UpdateAssetIfPromptVersion(asset, workspaceID, expectedVersion)
		if err != nil {
			if errors.Is(err, repository.ErrComicAssetConflict) {
				result.Error = "提示词版本已变化，请刷新后重试"
			} else {
				result.Error = "批准保存失败"
			}
			results = append(results, result)
			continue
		}
		result.OK, result.Asset = true, &asset
		results = append(results, result)
	}
	return results, nil
}

func comicInitialAnalysisRequest(project model.ComicAssetProject, sourceText string, instruction string) provider.TextGenerationRequest {
	parallel := false
	return provider.TextGenerationRequest{Messages: []map[string]any{
		{"role": "system", "content": comicAnalysisSystemPrompt()},
		{"role": "user", "content": fmt.Sprintf("项目：%s\n全局美术风格：%s\n用户首轮分析要求（必须优先遵循）：\n%s\n\n请从以下剧本提取人物、场景、道具和必要 UI 资产；不得因压缩表达而遗漏用户要求关注的细节。\n\n%s", project.Title, project.StylePreset, instruction, sourceText)},
	}, ParallelToolCalls: &parallel, Stream: false}
}

func comicRevisionAnalysisRequest(session model.ComicAssetAnalysisSession, parent model.ComicAssetAnalysisRevision, instruction string) provider.TextGenerationRequest {
	parallel := false
	return provider.TextGenerationRequest{Messages: []map[string]any{
		{"role": "system", "content": comicAnalysisSystemPrompt() + "\n你正在修订既有候选。必须返回完整 assets 数组，而不是差量。"},
		{"role": "user", "content": fmt.Sprintf("项目：%s\n全局美术风格：%s\n剧本原文：\n%s\n\n当前候选版本：\n%s\n\n本轮改稿方向：\n%s", session.Title, session.StylePreset, session.SourceText, string(parent.Candidate), instruction)},
	}, ParallelToolCalls: &parallel, Stream: false}
}

func comicAnalysisSystemPrompt() string {
	return `你是 AI 漫剧资产拆解员。只输出合法 JSON，不要 Markdown。格式：{"assets":[{"class":"character|environment|prop|ui","code":"可留空","name":"资产名称","state":"默认或明确状态","description":"剧本事实与制作备注","visual_description":"仅可见、可绘制的外观、材质、空间、色彩与光线事实","source_prompt":"可直接生图的初始中文提示词"}]}。同一角色的明显造型状态可以拆为独立资产；不要虚构剧本没有提供的事实；不要输出真人认证或真人素材任务。`
}

func comicPromptOptimizationRequest(project model.ComicAssetProject, asset model.ComicAsset, draft string, direction string) provider.TextGenerationRequest {
	parallel := false
	return provider.TextGenerationRequest{Messages: []map[string]any{
		{"role": "system", "content": "你是 AI 漫剧美术资产提示词编辑器。只输出一段可直接用于文生图的中文提示词，不解释，不使用 Markdown。保留可见、可绘制的主体、外观、材质、空间、光线和风格事实；删除集数、审核、复用、后期和工作流等制作管理语；不要添加剧本中未提供的事实；不要输出模板占位符。"},
		{"role": "user", "content": fmt.Sprintf("项目风格：%s\n资产类别：%s\n资产名称：%s\n状态：%s\n资产设定：%s\n原始提示词：%s\n当前草稿：%s\n资产修改需求：%s\n用户本轮优化方向（必须优先遵循）：%s\n\n请输出一段独立完整的生图提示词。", project.StylePreset, asset.Class, asset.Name, asset.State, defaultStringValue(asset.VisualDescription, asset.Description), asset.SourcePrompt, draft, defaultStringValue(asset.ChangeRequest, "无"), direction)},
	}, ParallelToolCalls: &parallel, Stream: false}
}

func comicPromptMergeRequest(project model.ComicAssetProject, asset model.ComicAsset, latest string, direction string) provider.TextGenerationRequest {
	parallel := false
	return provider.TextGenerationRequest{Messages: []map[string]any{
		{"role": "system", "content": `你是 AI 漫剧美术资产提示词融合编辑器。必须把原始稿与已保存候选稿（模板稿或 AI 优化稿）融合成一份独立完整、可直接用于文生图的中文提示词，而不是机械拼接。原始稿负责事实、身份、服装、道具和不可丢失的核心设定；候选稿负责更好的画面表达、材质、光线、构图和风格。保留两版中所有不冲突的有效细节；冲突按“用户本轮融合方向 > 资产结构化设定 > 原始稿事实 > 候选稿表达”处理；不得补写剧本外事实。只输出合法 JSON，不要 Markdown，格式：{"prompt":"融合后的完整提示词","retained_from_source":["从原始稿保留的关键细节"],"retained_from_latest":["从候选稿保留的关键细节"],"conflicts":["发现并处理的冲突"],"missing_details":["仍无法兼容或可能遗漏的细节"]}。`},
		{"role": "user", "content": fmt.Sprintf("项目风格：%s\n资产类别：%s\n资产名称：%s\n状态：%s\n资产设定：%s\n资产修改需求：%s\n\n原始稿 A：\n%s\n\n已保存候选稿 B：\n%s\n\n用户本轮融合方向（必须优先遵循）：\n%s\n\n请生成融合稿 C，并逐项报告 A、B 的保留内容、冲突和可能遗漏。", project.StylePreset, asset.Class, asset.Name, asset.State, defaultStringValue(asset.VisualDescription, asset.Description), defaultStringValue(asset.ChangeRequest, "无"), asset.SourcePrompt, latest, direction)},
	}, ParallelToolCalls: &parallel, Stream: false}
}

func comicPromptMergeBaseVersion(asset model.ComicAsset, revisions []model.ComicPromptRevision, content string) (int, bool) {
	content = normalizeComicPrompt(content)
	for index := len(revisions) - 1; index >= 0; index-- {
		if normalizeComicPrompt(revisions[index].Content) == content {
			return revisions[index].Version, true
		}
	}
	if normalizeComicPrompt(asset.DraftPrompt) == content {
		return asset.PromptVersion, true
	}
	return 0, false
}

func parseComicPromptMergeResponse(raw string, asset model.ComicAsset, latest string) (string, *model.ComicPromptMergeReport) {
	text := strings.TrimSpace(raw)
	text = strings.TrimPrefix(text, "```json")
	text = strings.TrimPrefix(text, "```")
	text = strings.TrimSuffix(text, "```")
	text = strings.TrimSpace(text)
	attempts := []string{text}
	if start, end := strings.Index(text, "{"), strings.LastIndex(text, "}"); start >= 0 && end > start {
		attempts = append(attempts, text[start:end+1])
	}
	type mergePayload struct {
		Prompt             string   `json:"prompt"`
		RetainedFromSource []string `json:"retained_from_source"`
		RetainedFromLatest []string `json:"retained_from_latest"`
		Conflicts          []string `json:"conflicts"`
		MissingDetails     []string `json:"missing_details"`
	}
	for _, attempt := range attempts {
		var payload mergePayload
		if json.Unmarshal([]byte(attempt), &payload) != nil {
			continue
		}
		content := cleanComicTextCandidate(payload.Prompt)
		if content == "" {
			continue
		}
		report := &model.ComicPromptMergeReport{
			RetainedFromSource: normalizeComicMergeReportItems(payload.RetainedFromSource),
			RetainedFromLatest: normalizeComicMergeReportItems(payload.RetainedFromLatest),
			Conflicts:          normalizeComicMergeReportItems(payload.Conflicts),
			MissingDetails:     normalizeComicMergeReportItems(payload.MissingDetails),
		}
		appendComicPromptProtectedDetailWarnings(report, asset, latest, content)
		return content, report
	}
	if strings.HasPrefix(text, "{") {
		return "", &model.ComicPromptMergeReport{Warnings: []string{"模型返回的融合 JSON 无法解析，请重试。"}}
	}
	content := cleanComicTextCandidate(text)
	report := &model.ComicPromptMergeReport{Warnings: []string{"模型未返回结构化融合报告，请人工对照原始稿与最新稿检查细节覆盖。"}}
	appendComicPromptProtectedDetailWarnings(report, asset, latest, content)
	return content, report
}

func normalizeComicMergeReportItems(items []string) []string {
	result := make([]string, 0, len(items))
	seen := make(map[string]bool)
	for _, item := range items {
		item = trimRunes(strings.TrimSpace(item), 160)
		if item == "" || seen[item] {
			continue
		}
		seen[item] = true
		result = append(result, item)
		if len(result) == 12 {
			break
		}
	}
	return result
}

func appendComicPromptProtectedDetailWarnings(report *model.ComicPromptMergeReport, asset model.ComicAsset, latest string, merged string) {
	protected := []struct {
		label string
		value string
	}{
		{label: "资产名称", value: strings.TrimSpace(asset.Name)},
		{label: "资产状态", value: strings.TrimSpace(asset.State)},
	}
	for _, detail := range protected {
		if detail.value == "" || (!strings.Contains(asset.SourcePrompt, detail.value) && !strings.Contains(latest, detail.value)) || strings.Contains(merged, detail.value) {
			continue
		}
		report.MissingDetails = append(report.MissingDetails, fmt.Sprintf("%s“%s”未原样出现在融合稿中，请确认是否被同义改写或遗漏。", detail.label, detail.value))
	}
	appendComicPromptLexicalCoverageWarnings(report, "原始稿", asset.SourcePrompt, latest, merged)
	appendComicPromptLexicalCoverageWarnings(report, "最新稿", latest, asset.SourcePrompt, merged)
	report.MissingDetails = normalizeComicMergeReportItems(report.MissingDetails)
	report.Warnings = normalizeComicMergeReportItems(report.Warnings)
}

func appendComicPromptLexicalCoverageWarnings(report *model.ComicPromptMergeReport, label string, primary string, other string, merged string) {
	missing := 0
	for _, term := range comicPromptCoverageTerms(primary) {
		if strings.Contains(other, term) || strings.Contains(merged, term) {
			continue
		}
		report.MissingDetails = append(report.MissingDetails, fmt.Sprintf("%s独有片段“%s”未原样出现在融合稿中，请确认是否被同义改写或遗漏。", label, term))
		missing++
		if missing == 4 {
			return
		}
	}
}

func comicPromptCoverageTerms(value string) []string {
	segments := strings.FieldsFunc(value, func(char rune) bool {
		return unicode.IsSpace(char) || strings.ContainsRune("，。；、,.!?！？：:()（）[]【】<>《》", char)
	})
	terms := make([]string, 0, len(segments))
	for _, segment := range segments {
		segment = strings.TrimSpace(segment)
		runes := []rune(segment)
		if len(runes) < 3 {
			continue
		}
		if len(runes) <= 16 {
			terms = append(terms, segment)
			continue
		}
		for start := 0; start < len(runes); start += 6 {
			end := start + 6
			if end > len(runes) {
				end = len(runes)
			}
			if end-start >= 3 {
				terms = append(terms, string(runes[start:end]))
			}
		}
	}
	return normalizeComicMergeReportItems(terms)
}

func parseComicAnalysisCandidate(raw string) (ComicAnalysisCandidateSnapshot, error) {
	text := strings.TrimSpace(raw)
	text = strings.TrimPrefix(text, "```json")
	text = strings.TrimPrefix(text, "```")
	text = strings.TrimSuffix(text, "```")
	text = strings.TrimSpace(text)
	attempts := []string{text}
	if start, end := strings.Index(text, "{"), strings.LastIndex(text, "}"); start >= 0 && end > start {
		attempts = append(attempts, text[start:end+1])
	}
	if start, end := strings.Index(text, "["), strings.LastIndex(text, "]"); start >= 0 && end > start {
		attempts = append(attempts, fmt.Sprintf(`{"assets":%s}`, text[start:end+1]))
	}
	for _, attempt := range attempts {
		var snapshot ComicAnalysisCandidateSnapshot
		if json.Unmarshal([]byte(attempt), &snapshot) == nil {
			return normalizeComicAnalysisSnapshot(snapshot)
		}
	}
	return ComicAnalysisCandidateSnapshot{}, ErrComicAnalysisCandidate
}

func normalizeComicAnalysisSnapshot(snapshot ComicAnalysisCandidateSnapshot) (ComicAnalysisCandidateSnapshot, error) {
	if len(snapshot.Assets) == 0 {
		return ComicAnalysisCandidateSnapshot{}, ErrComicImportEmpty
	}
	if len(snapshot.Assets) > ComicProjectImportMaxAssets {
		return ComicAnalysisCandidateSnapshot{}, ErrComicImportTooMany
	}
	sequences := make(map[string]int)
	usedCodes := make(map[string]bool)
	result := ComicAnalysisCandidateSnapshot{Assets: make([]ComicAnalysisCandidate, 0, len(snapshot.Assets))}
	for _, value := range snapshot.Assets {
		value.Class = strings.ToLower(strings.TrimSpace(value.Class))
		if !isComicAssetClass(value.Class) {
			return ComicAnalysisCandidateSnapshot{}, ErrComicAssetClassInvalid
		}
		value.Name = trimRunes(strings.TrimSpace(value.Name), 200)
		if value.Name == "" {
			return ComicAnalysisCandidateSnapshot{}, ErrComicAssetNameRequired
		}
		sequences[value.Class]++
		value.Code = strings.ToUpper(trimRunes(strings.TrimSpace(value.Code), 64))
		if value.Code == "" {
			value.Code = comicImportedAssetCode(value.Class, sequences[value.Class])
		}
		baseCode := value.Code
		for suffix := 2; usedCodes[value.Code]; suffix++ {
			value.Code = fmt.Sprintf("%s-%d", baseCode, suffix)
		}
		usedCodes[value.Code] = true
		value.State = trimRunes(defaultStringValue(value.State, "默认"), 200)
		value.Description = trimRunes(strings.TrimSpace(value.Description), 4_000)
		value.VisualDescription = trimRunes(strings.TrimSpace(value.VisualDescription), 4_000)
		if value.VisualDescription == "" {
			value.VisualDescription = value.Description
		}
		value.ChangeRequest = trimRunes(strings.TrimSpace(value.ChangeRequest), 2_000)
		value.SourcePrompt = trimRunes(strings.TrimSpace(value.SourcePrompt), 8_000)
		value.PromptTemplate = trimRunes(strings.TrimSpace(value.PromptTemplate), 8_000)
		value.ArchiveStatus = model.ComicAssetArchivePending
		result.Assets = append(result.Assets, value)
	}
	return result, nil
}

func decodeComicAnalysisSnapshot(value model.JSONB) (ComicAnalysisCandidateSnapshot, error) {
	var snapshot ComicAnalysisCandidateSnapshot
	if json.Unmarshal(value, &snapshot) != nil {
		return ComicAnalysisCandidateSnapshot{}, ErrComicAnalysisCandidate
	}
	return normalizeComicAnalysisSnapshot(snapshot)
}

func buildComicAssetsFromAnalysis(projectID string, snapshot ComicAnalysisCandidateSnapshot) ([]model.ComicAsset, error) {
	assets := make([]model.ComicAsset, 0, len(snapshot.Assets))
	for _, candidate := range snapshot.Assets {
		input := ComicAssetInput{
			Code: &candidate.Code, Class: &candidate.Class, Name: &candidate.Name, State: &candidate.State,
			Description: &candidate.Description, VisualDescription: &candidate.VisualDescription,
			ChangeRequest: &candidate.ChangeRequest, SourcePrompt: &candidate.SourcePrompt,
			PromptTemplate: &candidate.PromptTemplate, ArchiveStatus: &candidate.ArchiveStatus,
		}
		asset, err := newComicAsset(projectID, input, "")
		if err != nil {
			return nil, err
		}
		assets = append(assets, asset)
	}
	return assets, nil
}

func validateComicAnalysisSession(session model.ComicAssetAnalysisSession) error {
	if session.Status == model.ComicAnalysisStatusActive && !session.ExpiresAt.After(time.Now().UTC()) {
		return ErrComicAnalysisExpired
	}
	return nil
}

func validateComicAnalysisSessionEditable(session model.ComicAssetAnalysisSession) error {
	if err := validateComicAnalysisSession(session); err != nil {
		return err
	}
	if session.Status != model.ComicAnalysisStatusActive {
		return repository.ErrComicAssetInvalidState
	}
	return nil
}

func comicAnalysisRevisionByID(revisions []model.ComicAssetAnalysisRevision, id string) (model.ComicAssetAnalysisRevision, bool) {
	for _, revision := range revisions {
		if revision.ID == id {
			return revision, true
		}
	}
	return model.ComicAssetAnalysisRevision{}, false
}

func comicAnalysisSourceStorageKey(workspaceID string, sessionID string, extension string) string {
	return filepath.ToSlash(filepath.Join(assetWorkspacePath(workspaceID), "comic-analysis", sessionID, "source"+extension))
}

func decodeComicTemplates(value model.JSONB) map[string]string {
	result := make(map[string]string)
	_ = json.Unmarshal(value, &result)
	return normalizeComicTemplates(result)
}

func cleanComicTextCandidate(value string) string {
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "```text")
	value = strings.TrimPrefix(value, "```markdown")
	value = strings.TrimPrefix(value, "```")
	value = strings.TrimSuffix(value, "```")
	value = strings.TrimSpace(value)
	value = strings.Trim(value, "\"“”")
	return normalizeComicPrompt(value)
}

func trimRunes(value string, limit int) string {
	if limit <= 0 || utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit])
}
