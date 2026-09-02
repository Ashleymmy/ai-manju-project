package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/storage"
)

type comicServiceFixture struct {
	service  *ComicAssetService
	comic    *repository.MemoryComicAssetRepository
	jobs     *repository.MemoryJobRepository
	producer *queue.MemoryProducer
	userID   string
}

func TestComicAnalysisSessionRevisionRollbackBranchAndConfirm(t *testing.T) {
	fx := newComicServiceFixture()
	store := storage.NewLocalFSStorage(t.TempDir())
	fx.service.SetSourceStorage(store)
	responses := []provider.TextResponse{
		{Text: `{"assets":[{"class":"character","name":"阿青","visual_description":"青衣","source_prompt":"青衣少年"}]}`, Model: "mock-text-v1"},
		{Text: `{"assets":[{"class":"character","code":"C001","name":"阿青","visual_description":"青衣执伞","source_prompt":"青衣少年执伞"},{"class":"environment","name":"雨巷","visual_description":"青石板夜雨"}]}`, Model: "mock-text-v2"},
	}
	requests := make([]provider.TextGenerationRequest, 0, len(responses))
	fx.service.SetTextGenerator(func(_ context.Context, requested string, request provider.TextGenerationRequest) (provider.TextResponse, error) {
		if requested == "" || len(responses) == 0 {
			return provider.TextResponse{}, errors.New("unexpected text request")
		}
		requests = append(requests, request)
		result := responses[0]
		responses = responses[1:]
		return result, nil
	})
	detail, err := fx.service.CreateAnalysisSession(context.Background(), fx.userID, WorkspaceScopePersonal, CreateComicAnalysisSessionInput{
		CreateComicProjectInput: CreateComicProjectInput{Title: "雨巷", StylePreset: "国风动画"},
		SourceType:              "script", SourceFileName: "雨巷.txt", SourceSize: 18,
		Source: bytes.NewBufferString("雨夜，阿青执伞走入巷子。"), SourceText: "雨夜，阿青执伞走入巷子。", InitialInstruction: "keep wardrobe and prop details", RequestedModel: "provider::mock-v1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if detail.Session.Status != model.ComicAnalysisStatusActive || len(detail.Revisions) != 1 || detail.Revisions[0].Version != 1 {
		t.Fatalf("initial detail=%+v", detail)
	}
	if detail.Revisions[0].Instruction != "keep wardrobe and prop details" || len(requests) != 1 || !strings.Contains(fmt.Sprint(requests[0].Messages[1]["content"]), "keep wardrobe and prop details") {
		t.Fatalf("initial analysis instruction was not frozen into the request and revision: revision=%+v requests=%+v", detail.Revisions[0], requests)
	}
	if _, err := fx.service.GetAnalysisSession(detail.Session.ID, "other_user", WorkspaceScopePersonal); !errors.Is(err, repository.ErrComicAnalysisSessionNotFound) {
		t.Fatalf("cross-workspace analysis error=%v", err)
	}

	manualSnapshot := ComicAnalysisCandidateSnapshot{Assets: []ComicAnalysisCandidate{
		{Code: "C001", Class: model.ComicAssetClassCharacter, Name: "阿青（人工版）", State: "默认", VisualDescription: "青衣", SourcePrompt: "人工提示词"},
	}}
	manual, err := fx.service.CreateAnalysisRevision(context.Background(), detail.Session.ID, fx.userID, WorkspaceScopePersonal, CreateComicAnalysisRevisionInput{
		Source: model.ComicAnalysisRevisionSourceManual, Instruction: "人工修正名称", Candidate: &manualSnapshot,
		ParentRevisionID: detail.Session.ActiveRevisionID, ExpectedActiveRevisionID: detail.Session.ActiveRevisionID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(manual.Revisions) != 2 || manual.Revisions[1].ParentRevisionID != detail.Revisions[0].ID {
		t.Fatalf("manual revisions=%+v", manual.Revisions)
	}
	rolledBack, err := fx.service.SetActiveAnalysisRevision(detail.Session.ID, detail.Revisions[0].ID, fx.userID, WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	branched, err := fx.service.CreateAnalysisRevision(context.Background(), detail.Session.ID, fx.userID, WorkspaceScopePersonal, CreateComicAnalysisRevisionInput{
		Source: model.ComicAnalysisRevisionSourceAI, Instruction: "补充场景并保留角色", RequestedModel: "provider::mock-v2",
		ParentRevisionID: rolledBack.Session.ActiveRevisionID, ExpectedActiveRevisionID: rolledBack.Session.ActiveRevisionID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(branched.Revisions) != 3 || branched.Revisions[2].ParentRevisionID != detail.Revisions[0].ID || branched.Revisions[2].ResponseModel != "mock-text-v2" {
		t.Fatalf("branched revisions=%+v", branched.Revisions)
	}

	confirmed, err := fx.service.ConfirmAnalysisSession(detail.Session.ID, branched.Session.ActiveRevisionID, fx.userID, WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if confirmed.Project.Title != "雨巷" || len(confirmed.Assets) != 2 || confirmed.Project.SourceFileName != "雨巷.txt" {
		t.Fatalf("confirmed=%+v", confirmed)
	}
	again, err := fx.service.ConfirmAnalysisSession(detail.Session.ID, branched.Session.ActiveRevisionID, fx.userID, WorkspaceScopePersonal)
	if err != nil || again.Project.ID != confirmed.Project.ID || len(again.Assets) != 2 {
		t.Fatalf("idempotent confirm=%+v err=%v", again, err)
	}
	loaded, err := fx.service.GetAnalysisSession(detail.Session.ID, fx.userID, WorkspaceScopePersonal)
	if err != nil || loaded.Session.Status != model.ComicAnalysisStatusConfirmed || loaded.Session.ConfirmedRevisionID != branched.Session.ActiveRevisionID {
		t.Fatalf("confirmed session=%+v err=%v", loaded, err)
	}
}

func TestComicPromptDirectedOptimizeAndBulkApproveOptimisticLock(t *testing.T) {
	fx := newComicServiceFixture()
	project, first := createComicProjectAsset(t, fx, "定向优化", "角色一")
	second, err := fx.service.CreateAsset(project.ID, fx.userID, WorkspaceScopePersonal, ComicAssetInput{
		Class: strPointer(model.ComicAssetClassEnvironment), Name: strPointer("场景一"), SourcePrompt: strPointer("原始场景"),
	})
	if err != nil {
		t.Fatal(err)
	}
	first, err = fx.service.SavePrompt(project.ID, first.ID, fx.userID, WorkspaceScopePersonal, SaveComicPromptInput{Content: "已批准旧稿", Source: "manual", Action: "approve"})
	if err != nil {
		t.Fatal(err)
	}
	fx.service.SetTextGenerator(func(_ context.Context, requested string, _ provider.TextGenerationRequest) (provider.TextResponse, error) {
		return provider.TextResponse{Text: "优化后的冷色全身设定", Model: "mock-response-model"}, nil
	})
	optimized, err := fx.service.OptimizePrompt(context.Background(), project.ID, first.ID, fx.userID, WorkspaceScopePersonal, OptimizeComicPromptInput{
		Direction: "强化冷色调并保持全身构图", RequestedModel: "provider::mock-text",
	})
	if err != nil {
		t.Fatal(err)
	}
	if optimized.Asset.ApprovedPrompt != "已批准旧稿" || optimized.Asset.DraftPrompt != "优化后的冷色全身设定" || optimized.Asset.PromptStatus != model.ComicPromptStatusNeedsReview {
		t.Fatalf("optimized asset=%+v", optimized.Asset)
	}
	revisions := decodeComicPromptRevisions(optimized.Asset.PromptRevisions)
	latest := revisions[len(revisions)-1]
	if latest.Direction != "强化冷色调并保持全身构图" || latest.RequestedModel != "provider::mock-text" || latest.ResponseModel != "mock-response-model" {
		t.Fatalf("optimize revision=%+v", latest)
	}
	approvedBeforeMerge := optimized.Asset.ApprovedPrompt
	sourceBeforeMerge := optimized.Asset.SourcePrompt
	fx.service.SetTextGenerator(func(_ context.Context, requested string, request provider.TextGenerationRequest) (provider.TextResponse, error) {
		if requested != "provider::mock-text" || !strings.Contains(fmt.Sprint(request.Messages[0]["content"]), "retained_from_source") {
			return provider.TextResponse{}, errors.New("unexpected merge request")
		}
		return provider.TextResponse{Text: `{"prompt":"merged source and latest details","retained_from_source":["identity"],"retained_from_latest":["lighting"],"conflicts":[],"missing_details":[]}`, Model: "mock-merge-model"}, nil
	})
	merged, err := fx.service.OptimizePrompt(context.Background(), project.ID, first.ID, fx.userID, WorkspaceScopePersonal, OptimizeComicPromptInput{
		Direction: "keep every non-conflicting detail", RequestedModel: "provider::mock-text", Operation: ComicPromptOperationMerge,
		BaseContent: optimized.Asset.DraftPrompt, ExpectedPromptVersion: optimized.Asset.PromptVersion,
	})
	if err != nil {
		t.Fatal(err)
	}
	if merged.Asset.SourcePrompt != sourceBeforeMerge || merged.Asset.ApprovedPrompt != approvedBeforeMerge || merged.Asset.DraftPrompt != "merged source and latest details" {
		t.Fatalf("merged asset=%+v", merged.Asset)
	}
	if merged.MergeReport == nil || len(merged.MergeReport.RetainedFromSource) != 1 || len(merged.MergeReport.RetainedFromLatest) != 1 {
		t.Fatalf("merge report=%+v", merged.MergeReport)
	}
	mergedRevisions := decodeComicPromptRevisions(merged.Asset.PromptRevisions)
	mergedLatest := mergedRevisions[len(mergedRevisions)-1]
	if mergedLatest.Source != "merge" || mergedLatest.Operation != ComicPromptOperationMerge || len(mergedLatest.BasedOn) != 2 || mergedLatest.MergeReport == nil {
		t.Fatalf("merge revision=%+v", mergedLatest)
	}
	providerCalledForStaleMerge := false
	fx.service.SetTextGenerator(func(_ context.Context, _ string, _ provider.TextGenerationRequest) (provider.TextResponse, error) {
		providerCalledForStaleMerge = true
		return provider.TextResponse{}, nil
	})
	if _, err := fx.service.OptimizePrompt(context.Background(), project.ID, first.ID, fx.userID, WorkspaceScopePersonal, OptimizeComicPromptInput{
		Direction: "stale merge", RequestedModel: "provider::mock-text", Operation: ComicPromptOperationMerge,
		BaseContent: optimized.Asset.DraftPrompt, ExpectedPromptVersion: optimized.Asset.PromptVersion,
	}); !errors.Is(err, repository.ErrComicAssetConflict) || providerCalledForStaleMerge {
		t.Fatalf("stale merge error=%v provider_called=%v", err, providerCalledForStaleMerge)
	}
	second, err = fx.service.SavePrompt(project.ID, second.ID, fx.userID, WorkspaceScopePersonal, SaveComicPromptInput{Content: "可批准场景稿", Source: "template", Action: "draft"})
	if err != nil {
		t.Fatal(err)
	}
	results, err := fx.service.BulkApprovePrompts(project.ID, fx.userID, WorkspaceScopePersonal, []BulkComicPromptApprovalInput{
		{AssetID: first.ID, ExpectedPromptVersion: optimized.Asset.PromptVersion - 1},
		{AssetID: second.ID, ExpectedPromptVersion: second.PromptVersion},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 2 || results[0].OK || results[0].Error == "" || !results[1].OK || results[1].Asset == nil || results[1].Asset.ApprovedPrompt != "可批准场景稿" {
		t.Fatalf("bulk results=%+v", results)
	}
}

func TestComicPromptMergeCoverageReportsUniqueMissingDetails(t *testing.T) {
	report := &model.ComicPromptMergeReport{}
	appendComicPromptProtectedDetailWarnings(report, model.ComicAsset{
		SourcePrompt: "青色长衫，银色发簪",
	}, "冷色雨夜，全身构图", "青色长衫，冷色雨夜")
	joined := strings.Join(report.MissingDetails, "\n")
	if !strings.Contains(joined, "银色发簪") || !strings.Contains(joined, "全身构图") {
		t.Fatalf("merge coverage did not report unique missing details: %+v", report)
	}
}

func TestComicAnalysisCleanupRemovesOnlyExpiredUnconfirmedSessions(t *testing.T) {
	fx := newComicServiceFixture()
	store := storage.NewLocalFSStorage(t.TempDir())
	fx.service.SetSourceStorage(store)
	workspaceID := WorkspaceIDForScope(WorkspaceScopePersonal, fx.userID)
	storageKey := comicAnalysisSourceStorageKey(workspaceID, "expired", ".txt")
	if _, err := store.Put(context.Background(), storageKey, bytes.NewBufferString("expired source"), storage.PutMeta{ContentType: "text/plain"}); err != nil {
		t.Fatal(err)
	}
	session := model.ComicAssetAnalysisSession{
		ID: "expired", OwnerID: fx.userID, WorkspaceID: workspaceID, Title: "expired", Status: model.ComicAnalysisStatusActive,
		SourceStorageKey: storageKey, ExpiresAt: time.Now().UTC().Add(-time.Minute), DefaultTemplates: model.JSONB("{}"),
	}
	revision := model.ComicAssetAnalysisRevision{
		ID: "expired_revision", SessionID: session.ID, Source: model.ComicAnalysisRevisionSourceInitial, Candidate: model.JSONB(`{"assets":[{"class":"character","code":"C001","name":"甲"}]}`),
	}
	if _, _, err := fx.comic.CreateAnalysisSession(session, revision); err != nil {
		t.Fatal(err)
	}
	if err := fx.service.CleanupExpiredAnalysisSessions(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, _, err := fx.comic.GetAnalysisSession(session.ID, workspaceID); !errors.Is(err, repository.ErrComicAnalysisSessionNotFound) {
		t.Fatalf("expired session lookup error=%v", err)
	}
	if _, err := store.Stat(context.Background(), storageKey); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expired source stat error=%v", err)
	}
}

func newComicServiceFixture() comicServiceFixture {
	comicRepo := repository.NewMemoryComicAssetRepository()
	jobRepo := repository.NewMemoryJobRepository()
	producer := &queue.MemoryProducer{}
	jobs := NewJobService(jobRepo, producer, "celery", 3)
	svc := NewComicAssetService(comicRepo, jobs)
	svc.SetImageJobResolver(func(requested string, _ string) (ComicImageJobResolution, error) {
		selector := strings.TrimSpace(requested)
		if selector == "" {
			selector = "provider_a::image-v1"
		}
		return ComicImageJobResolution{
			Selector: selector,
			Model:    "image-v1",
			TaskKwargs: map[string]any{
				"provider": map[string]any{"model": "image-v1", "api_key": "transient-test-key"},
			},
		}, nil
	})
	return comicServiceFixture{service: svc, comic: comicRepo, jobs: jobRepo, producer: producer, userID: "user_a"}
}

func TestComicPromptTemplatePriorityIssuesAndSourcePreservation(t *testing.T) {
	fx := newComicServiceFixture()
	detail, err := fx.service.CreateProject(fx.userID, WorkspaceScopePersonal, CreateComicProjectInput{
		Title:       "提示词测试",
		StylePreset: "水墨动画",
		DefaultTemplates: map[string]string{
			model.ComicAssetClassCharacter: "项目模板 {{ 角色名称 }} {{ 视觉设定 }} {{未知字段}} 第1集",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	asset, err := fx.service.CreateAsset(detail.Project.ID, fx.userID, WorkspaceScopePersonal, ComicAssetInput{
		Class: strPointer(model.ComicAssetClassCharacter), Name: strPointer("阿青"),
		VisualDescription: strPointer("青色长衫"), SourcePrompt: strPointer("不可覆盖的原始提示词"),
	})
	if err != nil {
		t.Fatal(err)
	}

	preview, err := fx.service.PreviewPrompt(detail.Project.ID, asset.ID, fx.userID, WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if preview.TemplateSource != "project" || !strings.Contains(preview.DraftPrompt, "项目模板 阿青 青色长衫") {
		t.Fatalf("project preview = %+v", preview)
	}
	if len(preview.Blockers) != 1 || !strings.Contains(preview.Blockers[0], "未知字段") || len(preview.Warnings) == 0 {
		t.Fatalf("issues blockers=%v warnings=%v", preview.Blockers, preview.Warnings)
	}
	if _, err := fx.service.SavePrompt(detail.Project.ID, asset.ID, fx.userID, WorkspaceScopePersonal, SaveComicPromptInput{Content: preview.DraftPrompt, Source: "template", Action: "draft"}); err != nil {
		t.Fatal(err)
	}
	persisted, err := fx.comic.GetAsset(detail.Project.ID, asset.ID, WorkspaceIDForScope(WorkspaceScopePersonal, fx.userID))
	if err != nil {
		t.Fatal(err)
	}
	if persisted.SourcePrompt != "不可覆盖的原始提示词" || persisted.DraftPrompt != preview.DraftPrompt || persisted.PromptVersion != 1 {
		t.Fatalf("persisted prompt fields = %+v", persisted)
	}

	assetTemplate := "单资产模板 {{ asset_name }} {{ project_style }}"
	if _, err := fx.service.UpdateAsset(detail.Project.ID, asset.ID, fx.userID, WorkspaceScopePersonal, ComicAssetInput{PromptTemplate: &assetTemplate}); err != nil {
		t.Fatal(err)
	}
	preview, err = fx.service.PreviewPrompt(detail.Project.ID, asset.ID, fx.userID, WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if preview.TemplateSource != "asset" || preview.DraftPrompt != "单资产模板 阿青 水墨动画" || len(preview.Blockers) != 0 {
		t.Fatalf("asset preview = %+v", preview)
	}
}

func TestComicProjectImportPersistsSourceAndCreatesAssetsAtomically(t *testing.T) {
	fx := newComicServiceFixture()
	store := storage.NewLocalFSStorage(t.TempDir())
	fx.service.SetSourceStorage(store)
	detail, err := fx.service.ImportProject(context.Background(), fx.userID, WorkspaceScopePersonal, ImportComicProjectInput{
		CreateComicProjectInput: CreateComicProjectInput{Title: "剧本导入", StylePreset: "国风动画"},
		SourceType:              "script", SourceFileName: "第一集.md", SourceContentType: "text/markdown", SourceSize: 12,
		Source: bytes.NewBufferString("第一集\n雨巷夜景"),
		Assets: []ComicAssetInput{
			{Class: strPointer(model.ComicAssetClassCharacter), Name: strPointer("赵瑾"), VisualDescription: strPointer("灰色风衣"), SourcePrompt: strPointer("人物初稿")},
			{Class: strPointer(model.ComicAssetClassEnvironment), Name: strPointer("雨巷"), VisualDescription: strPointer("青石路，夜雨")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if detail.Project.SourceType != "script" || detail.Project.SourceFileName != "第一集.md" || detail.Project.SourceSize == 0 || len(detail.Assets) != 2 {
		t.Fatalf("detail=%+v", detail)
	}
	if detail.Assets[0].Code == "" || detail.Assets[1].Code == "" || detail.Assets[0].PromptStatus != model.ComicPromptStatusNeedsReview {
		t.Fatalf("assets=%+v", detail.Assets)
	}
	content, err := fx.service.OpenProjectSource(context.Background(), detail.Project.ID, fx.userID, WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(content.Reader)
	_ = content.Reader.Close()
	if err != nil || string(raw) != "第一集\n雨巷夜景" {
		t.Fatalf("source=%q err=%v", raw, err)
	}
	if _, err := fx.service.OpenProjectSource(context.Background(), detail.Project.ID, "other_user", WorkspaceScopePersonal); !errors.Is(err, repository.ErrComicAssetProjectNotFound) {
		t.Fatalf("cross-workspace source error=%v", err)
	}
	storageKey := detail.Project.SourceStorageKey
	if err := fx.service.DeleteProject(detail.Project.ID, fx.userID, WorkspaceScopePersonal); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Stat(context.Background(), storageKey); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("deleted source stat error=%v", err)
	}

	_, err = fx.service.ImportProject(context.Background(), fx.userID, WorkspaceScopePersonal, ImportComicProjectInput{
		CreateComicProjectInput: CreateComicProjectInput{Title: "冲突导入"},
		SourceType:              "workbook", SourceFileName: "资产.xlsx", SourceSize: 4, Source: bytes.NewBufferString("xlsx"),
		Assets: []ComicAssetInput{
			{Code: strPointer("C001"), Class: strPointer(model.ComicAssetClassCharacter), Name: strPointer("甲")},
			{Code: strPointer("C001"), Class: strPointer(model.ComicAssetClassCharacter), Name: strPointer("乙")},
		},
	})
	if !errors.Is(err, repository.ErrComicAssetConflict) {
		t.Fatalf("duplicate import error=%v", err)
	}
	projects, listErr := fx.service.ListProjects(fx.userID, WorkspaceScopePersonal)
	if listErr != nil || len(projects) != 0 {
		t.Fatalf("failed import left projects=%+v err=%v", projects, listErr)
	}
}

func TestComicPromptApprovalCandidateAndAssetChangeLifecycle(t *testing.T) {
	fx := newComicServiceFixture()
	project, asset := createComicProjectAsset(t, fx, "审批测试", "角色一")
	approved, err := fx.service.SavePrompt(project.ID, asset.ID, fx.userID, WorkspaceScopePersonal, SaveComicPromptInput{
		Content: "批准提示词", Source: "manual", Action: "approve",
	})
	if err != nil {
		t.Fatal(err)
	}
	if approved.PromptStatus != model.ComicPromptStatusApproved || approved.ApprovedPrompt != "批准提示词" {
		t.Fatalf("approved = %+v", approved)
	}
	candidate, err := fx.service.SavePrompt(project.ID, asset.ID, fx.userID, WorkspaceScopePersonal, SaveComicPromptInput{
		Content: "AI 候选提示词", Source: "ai", Action: "draft",
	})
	if err != nil {
		t.Fatal(err)
	}
	if candidate.PromptStatus != model.ComicPromptStatusApproved || candidate.ApprovedPrompt != "批准提示词" || candidate.DraftPrompt != "AI 候选提示词" {
		t.Fatalf("candidate = %+v", candidate)
	}
	updated, err := fx.service.UpdateAsset(project.ID, asset.ID, fx.userID, WorkspaceScopePersonal, ComicAssetInput{ChangeRequest: strPointer("改成夜景")})
	if err != nil {
		t.Fatal(err)
	}
	if updated.PromptStatus != model.ComicPromptStatusNeedsReview || updated.ApprovedPrompt != "批准提示词" {
		t.Fatalf("updated = %+v", updated)
	}
}

func TestComicBatchFreezesPromptHonorsConcurrencyAndArchivesOnce(t *testing.T) {
	fx := newComicServiceFixture()
	project, _ := createApprovedComicAssets(t, fx, 3)
	batch, err := fx.service.CreateBatch(project.ID, fx.userID, WorkspaceScopePersonal, CreateComicBatchInput{
		ModelSelector: "provider_a::image-v1", Concurrency: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	firstSnapshot := batch.Items[0].PromptSnapshot
	if _, err := fx.service.SavePrompt(project.ID, batch.Items[0].ComicAssetID, fx.userID, WorkspaceScopePersonal, SaveComicPromptInput{Content: "后来修改", Source: "manual", Action: "approve"}); err != nil {
		t.Fatal(err)
	}
	if err := fx.service.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(fx.producer.Messages) != 2 {
		t.Fatalf("published = %d, want 2", len(fx.producer.Messages))
	}
	batch, err = fx.service.GetBatch(batch.Batch.ID, fx.userID, WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if batch.Batch.Active > 2 || batch.Items[0].PromptSnapshot != firstSnapshot {
		t.Fatalf("batch after dispatch = %+v items=%+v", batch.Batch, batch.Items)
	}
	assertNoProviderSecretInBatch(t, batch)

	jobOne := batch.Items[0].JobID
	jobTwo := batch.Items[1].JobID
	if _, err := fx.jobs.SetResult(jobOne, model.JSONB(`{"assets":[{"id":"output_asset_1"}]}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.jobs.SetError(jobTwo, model.JSONB(`{"code":"rate_limit","message":"Bearer secret-value failed"}`)); err != nil {
		t.Fatal(err)
	}
	if err := fx.service.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(fx.producer.Messages) != 3 {
		t.Fatalf("published after one slot freed = %d, want 3", len(fx.producer.Messages))
	}
	batch, _ = fx.service.GetBatch(batch.Batch.ID, fx.userID, WorkspaceScopePersonal)
	if batch.Batch.Active > 2 || batch.Batch.Succeeded != 1 || batch.Batch.Failed != 1 {
		t.Fatalf("batch counts = %+v", batch.Batch)
	}
	var failedError map[string]string
	if err := json.Unmarshal(batch.Items[1].Error, &failedError); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(failedError["message"], "secret-value") || failedError["suggestion"] == "" {
		t.Fatalf("error was not sanitized: %v", failedError)
	}

	thirdJob := batch.Items[2].JobID
	if _, err := fx.jobs.SetResult(thirdJob, model.JSONB(`{"assets":[{"id":"output_asset_3"}]}`)); err != nil {
		t.Fatal(err)
	}
	if err := fx.service.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	batch, _ = fx.service.GetBatch(batch.Batch.ID, fx.userID, WorkspaceScopePersonal)
	if batch.Batch.Status != model.ComicBatchStatusPartialFailed {
		t.Fatalf("terminal status = %s", batch.Batch.Status)
	}
	archived, err := fx.comic.GetAsset(project.ID, batch.Items[0].ComicAssetID, WorkspaceIDForScope(WorkspaceScopePersonal, fx.userID))
	if err != nil {
		t.Fatal(err)
	}
	if archived.OutputVersion != 1 || archived.ArchiveStatus != model.ComicAssetArchiveArchived {
		t.Fatalf("archived = %+v", archived)
	}
	if err := fx.comic.SyncItemFromJob(batch.Items[0].ID, jobOne, model.JobStatusSucceeded, "output_asset_1", model.JSONB("{}")); err != nil {
		t.Fatal(err)
	}
	again, _ := fx.comic.GetAsset(project.ID, batch.Items[0].ComicAssetID, WorkspaceIDForScope(WorkspaceScopePersonal, fx.userID))
	if again.OutputVersion != 1 {
		t.Fatalf("duplicate reconciliation created version %d", again.OutputVersion)
	}

	retried, err := fx.service.RetryBatchItems(batch.Batch.ID, []string{batch.Items[1].ID}, fx.userID, WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if retried.Items[1].Attempt != 2 || retried.Items[1].PromptSnapshot != batch.Items[1].PromptSnapshot {
		t.Fatalf("retry item = %+v", retried.Items[1])
	}
	if err := fx.service.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := fx.producer.Messages[len(fx.producer.Messages)-1]; got.JobID == jobTwo {
		t.Fatalf("retry reused old job id %q", got.JobID)
	}
}

func TestComicBatchPauseResumeStopAndTerminalRules(t *testing.T) {
	fx := newComicServiceFixture()
	project, _ := createApprovedComicAssets(t, fx, 3)
	detail, err := fx.service.CreateBatch(project.ID, fx.userID, WorkspaceScopePersonal, CreateComicBatchInput{Concurrency: 2})
	if err != nil {
		t.Fatal(err)
	}
	if err := fx.service.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	detail, _ = fx.service.GetBatch(detail.Batch.ID, fx.userID, WorkspaceScopePersonal)
	if _, err := fx.service.ControlBatch(detail.Batch.ID, fx.userID, WorkspaceScopePersonal, "pause"); err != nil {
		t.Fatal(err)
	}
	for _, item := range detail.Items[:2] {
		if _, err := fx.jobs.SetResult(item.JobID, model.JSONB(`{"assets":[{"id":"`+item.ID+`"}]}`)); err != nil {
			t.Fatal(err)
		}
	}
	if err := fx.service.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	paused, _ := fx.service.GetBatch(detail.Batch.ID, fx.userID, WorkspaceScopePersonal)
	if paused.Batch.Status != model.ComicBatchStatusPaused || paused.Batch.Pending != 1 || len(fx.producer.Messages) != 2 {
		t.Fatalf("paused batch = %+v messages=%d", paused.Batch, len(fx.producer.Messages))
	}
	if _, err := fx.service.ControlBatch(detail.Batch.ID, fx.userID, WorkspaceScopePersonal, "resume"); err != nil {
		t.Fatal(err)
	}
	if err := fx.service.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	resumed, _ := fx.service.GetBatch(detail.Batch.ID, fx.userID, WorkspaceScopePersonal)
	if resumed.Batch.Active != 1 || len(fx.producer.Messages) != 3 {
		t.Fatalf("resumed batch = %+v messages=%d", resumed.Batch, len(fx.producer.Messages))
	}

	stopProject, _ := createApprovedComicAssets(t, fx, 3)
	stopping, err := fx.service.CreateBatch(stopProject.ID, fx.userID, WorkspaceScopePersonal, CreateComicBatchInput{Concurrency: 2})
	if err != nil {
		t.Fatal(err)
	}
	if err := fx.service.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	stopping, _ = fx.service.GetBatch(stopping.Batch.ID, fx.userID, WorkspaceScopePersonal)
	stopping, err = fx.service.ControlBatch(stopping.Batch.ID, fx.userID, WorkspaceScopePersonal, "stop")
	if err != nil {
		t.Fatal(err)
	}
	if stopping.Batch.Status != model.ComicBatchStatusStopping || stopping.Batch.Canceled != 1 {
		t.Fatalf("stopping = %+v", stopping.Batch)
	}
	for _, item := range stopping.Items {
		if item.JobID == "" {
			continue
		}
		if _, err := fx.jobs.SetResult(item.JobID, model.JSONB(`{"assets":[{"id":"`+item.ID+`"}]}`)); err != nil {
			t.Fatal(err)
		}
	}
	if err := fx.service.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	stopped, _ := fx.service.GetBatch(stopping.Batch.ID, fx.userID, WorkspaceScopePersonal)
	if stopped.Batch.Status != model.ComicBatchStatusCanceled || stopped.Batch.Succeeded != 2 || stopped.Batch.Canceled != 1 {
		t.Fatalf("stopped = %+v", stopped.Batch)
	}
}

func TestComicDispatcherRepublishesExistingQueuedJobAfterPublishWindowCrash(t *testing.T) {
	fx := newComicServiceFixture()
	project, _ := createApprovedComicAssets(t, fx, 1)
	detail, err := fx.service.CreateBatch(project.ID, fx.userID, WorkspaceScopePersonal, CreateComicBatchInput{Concurrency: 1})
	if err != nil {
		t.Fatal(err)
	}
	item := detail.Items[0]
	preexisting, err := fx.jobs.Create(model.Job{
		ID: "job_preexisting", IdempotencyKey: fmt.Sprintf("comic-batch:%s:%s:%d", detail.Batch.ID, item.ID, item.Attempt),
		UserID: fx.userID, WorkspaceID: WorkspaceIDForScope(WorkspaceScopePersonal, fx.userID), Type: model.JobTypeImageGenerate,
		Status: model.JobStatusQueued, Payload: model.JSONB(`{"prompt":"snapshot"}`), Result: model.JSONB("{}"), Error: model.JSONB("{}"), MaxAttempts: 3,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := fx.service.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(fx.producer.Messages) != 1 || fx.producer.Messages[0].JobID != preexisting.ID {
		t.Fatalf("messages=%+v preexisting=%+v", fx.producer.Messages, preexisting)
	}
	loaded, err := fx.service.GetBatch(detail.Batch.ID, fx.userID, WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Items[0].JobID != preexisting.ID {
		t.Fatalf("item job=%q want=%q", loaded.Items[0].JobID, preexisting.ID)
	}
}

func TestComicBatchCreationIsIdempotentForClientRetries(t *testing.T) {
	fx := newComicServiceFixture()
	project, _ := createApprovedComicAssets(t, fx, 1)
	input := CreateComicBatchInput{Concurrency: 2, IdempotencyKey: "client-request-1"}
	first, err := fx.service.CreateBatch(project.ID, fx.userID, WorkspaceScopePersonal, input)
	if err != nil {
		t.Fatal(err)
	}
	second, err := fx.service.CreateBatch(project.ID, fx.userID, WorkspaceScopePersonal, input)
	if err != nil {
		t.Fatal(err)
	}
	if first.Batch.ID != second.Batch.ID || first.Items[0].ID != second.Items[0].ID {
		t.Fatalf("duplicate request created another batch: first=%+v second=%+v", first.Batch, second.Batch)
	}
	input.Quality = "hd"
	if _, err := fx.service.CreateBatch(project.ID, fx.userID, WorkspaceScopePersonal, input); !errors.Is(err, repository.ErrComicAssetConflict) {
		t.Fatalf("same key with changed request error=%v", err)
	}
	if err := fx.service.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(fx.producer.Messages) != 1 {
		t.Fatalf("idempotent batch published %d jobs, want 1", len(fx.producer.Messages))
	}
}

func TestComicBatchExpandsVariantsAndFreezesPerAssetConfig(t *testing.T) {
	fx := newComicServiceFixture()
	project, assets := createApprovedComicAssets(t, fx, 1)
	detail, err := fx.service.CreateBatch(project.ID, fx.userID, WorkspaceScopePersonal, CreateComicBatchInput{
		AssetIDs:         []string{assets[0].ID},
		ModelSelector:    "provider_a::image-default",
		Size:             "1:1",
		Quality:          "low",
		VariantsPerAsset: 1,
		SystemPrompt:     "统一美术总则",
		Concurrency:      2,
		AssetConfigs: []ComicAssetGenerationConfigInput{{
			AssetID: assets[0].ID, ModelSelector: "provider_b::image-v2", Size: "1024x1536",
			Quality: "medium", Variants: 3, OutputFormat: "png", ReferenceAssetIDs: []string{},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if detail.Batch.Total != 3 || len(detail.Items) != 3 {
		t.Fatalf("batch total=%d items=%d, want 3", detail.Batch.Total, len(detail.Items))
	}
	for index, item := range detail.Items {
		if item.VariantIndex != index+1 || item.Position != index {
			t.Fatalf("item[%d] variant=%d position=%d", index, item.VariantIndex, item.Position)
		}
		var snapshot ComicGenerationConfigSnapshot
		if err := json.Unmarshal(item.ConfigSnapshot, &snapshot); err != nil {
			t.Fatal(err)
		}
		if snapshot.ModelSelector != "provider_b::image-v2" || snapshot.Model != "image-v1" || snapshot.Size != "1024x1536" || snapshot.Quality != "medium" || snapshot.OutputFormat != "png" || snapshot.SystemPrompt != "统一美术总则" {
			t.Fatalf("snapshot = %+v", snapshot)
		}
	}
	if err := fx.service.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(fx.producer.Messages) != 2 {
		t.Fatalf("published=%d, want concurrency-limited 2", len(fx.producer.Messages))
	}
	var payload map[string]any
	if err := json.Unmarshal(fx.producer.Messages[0].Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["model"] != "image-v1" || payload["size"] != "1024x1536" || payload["quality"] != "medium" || payload["output_format"] != "png" || payload["n"] != float64(1) {
		t.Fatalf("payload = %+v", payload)
	}
	if payload["prompt"] != "统一美术总则\n\n"+assets[0].ApprovedPrompt {
		t.Fatalf("prompt = %q", payload["prompt"])
	}
}

func TestComicGenerationConfigFallsBackForLegacyItems(t *testing.T) {
	batch := model.ComicAssetGenerationBatch{
		ModelSelector: "provider_a::legacy-image",
		Model:         "legacy-image",
		Size:          "1024x1024",
		Quality:       "high",
	}
	config := comicGenerationConfigForItem(batch, model.ComicAssetGenerationItem{})
	if config.ModelSelector != batch.ModelSelector || config.Model != batch.Model || config.Size != batch.Size || config.Quality != batch.Quality || config.OutputFormat != "png" {
		t.Fatalf("legacy config fallback = %+v", config)
	}
	if got := comicPromptWithReferences("  已批准提示词  ", 2); got != "参考图片编号：图片1、图片2。请按这些编号理解提示词中的图片引用。\n\n已批准提示词" {
		t.Fatalf("reference prompt = %q", got)
	}
}

func TestComicBatchReferenceAssetUsesImageEditAndWorkspaceValidation(t *testing.T) {
	fx := newComicServiceFixture()
	fx.service.SetImageJobResolver(func(requested string, jobType string) (ComicImageJobResolution, error) {
		if jobType != model.JobTypeImageEdit {
			t.Fatalf("reference job type = %q", jobType)
		}
		return ComicImageJobResolution{
			Selector: requested,
			Model:    "gpt-image-2",
			TaskKwargs: map[string]any{
				"provider": map[string]any{"model": "gpt-image-2", "api_key": "transient-test-key"},
			},
		}, nil
	})
	root := t.TempDir()
	assetRepo := repository.NewMemoryAssetRepository()
	assetStore := storage.NewLocalFSStorage(root)
	assetService := NewAssetService(assetRepo, assetStore)
	jobInputs := NewJobInputService(assetStore, 1024*1024)
	fx.service.SetReferenceServices(assetService, jobInputs)
	reference, err := assetService.Upload(context.Background(), AssetUploadInput{
		ID: "asset_reference", UserID: fx.userID, Scope: WorkspaceScopePersonal, Type: "image", Name: "角色参考.png",
		Extension: ".png", ContentType: "image/png", Reader: bytes.NewReader([]byte("reference-image")),
	})
	if err != nil {
		t.Fatal(err)
	}
	project, assets := createApprovedComicAssets(t, fx, 1)
	detail, err := fx.service.CreateBatch(project.ID, fx.userID, WorkspaceScopePersonal, CreateComicBatchInput{
		AssetIDs: []string{assets[0].ID}, ModelSelector: "provider_a::image-v1", Size: "1024x1024",
		ReferenceAssetIDs: []string{reference.ID}, Concurrency: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := fx.service.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(fx.producer.Messages) != 1 || fx.producer.Messages[0].TaskName != "worker.image_edit" {
		t.Fatalf("messages = %+v", fx.producer.Messages)
	}
	loaded, err := fx.service.GetBatch(detail.Batch.ID, fx.userID, WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	job, err := fx.jobs.GetByID(loaded.Items[0].JobID)
	if err != nil {
		t.Fatal(err)
	}
	if job.Type != model.JobTypeImageEdit {
		t.Fatalf("job type = %q", job.Type)
	}
	var payload map[string]any
	if err := json.Unmarshal(job.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	files, ok := payload["files"].([]any)
	if !ok || len(files) != 1 {
		t.Fatalf("files = %#v", payload["files"])
	}
	file, _ := files[0].(map[string]any)
	storageKey := fmt.Sprint(file["storage_key"])
	if !strings.HasPrefix(storageKey, "jobs/inputs/personal/") {
		t.Fatalf("storage key = %q", storageKey)
	}
	if _, err := assetStore.Stat(context.Background(), storageKey); err != nil {
		t.Fatalf("staged reference missing: %v", err)
	}
	if payload["prompt"] != "参考图片编号：图片1。请按这些编号理解提示词中的图片引用。\n\n"+assets[0].ApprovedPrompt {
		t.Fatalf("reference prompt = %q", payload["prompt"])
	}
	for _, unsupported := range []string{"n", "response_format", "output_format"} {
		if _, exists := payload[unsupported]; exists {
			t.Fatalf("gpt-image-2 edit payload contains unsupported %q: %+v", unsupported, payload)
		}
	}

	otherUserReference, err := assetService.Upload(context.Background(), AssetUploadInput{
		ID: "asset_other", UserID: "other_user", Scope: WorkspaceScopePersonal, Type: "image", Name: "other.png",
		Extension: ".png", ContentType: "image/png", Reader: bytes.NewReader([]byte("other")),
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = fx.service.CreateBatch(project.ID, fx.userID, WorkspaceScopePersonal, CreateComicBatchInput{
		AssetIDs: []string{assets[0].ID}, ReferenceAssetIDs: []string{otherUserReference.ID},
	})
	if !errors.Is(err, ErrComicReferenceAsset) {
		t.Fatalf("cross-workspace reference error = %v", err)
	}
}

func TestComicReferenceRecoveryCleansDuplicateStagingAndCancel(t *testing.T) {
	fx := newComicServiceFixture()
	root := t.TempDir()
	assetRepo := repository.NewMemoryAssetRepository()
	assetStore := storage.NewLocalFSStorage(root)
	assetService := NewAssetService(assetRepo, assetStore)
	jobInputs := NewJobInputService(assetStore, 1024*1024)
	fx.service.SetReferenceServices(assetService, jobInputs)
	fx.service.jobs.SetJobInputService(jobInputs)
	reference, err := assetService.Upload(context.Background(), AssetUploadInput{
		ID: "asset_recovery_reference", UserID: fx.userID, Scope: WorkspaceScopePersonal, Type: "image", Name: "reference.png",
		Extension: ".png", ContentType: "image/png", Reader: bytes.NewReader([]byte("persistent-reference")),
	})
	if err != nil {
		t.Fatal(err)
	}
	project, assets := createApprovedComicAssets(t, fx, 1)
	detail, err := fx.service.CreateBatch(project.ID, fx.userID, WorkspaceScopePersonal, CreateComicBatchInput{
		AssetIDs: []string{assets[0].ID}, ReferenceAssetIDs: []string{reference.ID}, Concurrency: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	oldInputs, err := jobInputs.Stage(context.Background(), detail.Batch.WorkspaceID, []JobInputUpload{{
		FieldName: "image", FileName: "old.png", ContentType: "image/png", Reader: bytes.NewReader([]byte("old-staged-reference")),
	}})
	if err != nil {
		t.Fatal(err)
	}
	oldPayload, err := json.Marshal(map[string]any{
		"prompt":                    "recovery",
		"files":                     []map[string]any{oldInputs[0].Payload()},
		StagedInputKeysPayloadField: StagedInputKeys(oldInputs),
	})
	if err != nil {
		t.Fatal(err)
	}
	item := detail.Items[0]
	preexisting, err := fx.jobs.Create(model.Job{
		ID: "job_reference_recovery", IdempotencyKey: fmt.Sprintf("comic-batch:%s:%s:%d", detail.Batch.ID, item.ID, item.Attempt),
		UserID: fx.userID, WorkspaceID: detail.Batch.WorkspaceID, Type: model.JobTypeImageEdit, Status: model.JobStatusQueued,
		Payload: model.JSONB(oldPayload), Result: model.JSONB("{}"), Error: model.JSONB("{}"), MaxAttempts: 3,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := fx.service.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	loaded, err := fx.service.GetBatch(detail.Batch.ID, fx.userID, WorkspaceScopePersonal)
	if err != nil || loaded.Items[0].JobID != preexisting.ID {
		t.Fatalf("recovered item=%+v err=%v", loaded.Items, err)
	}
	jobInputFiles := make([]string, 0)
	jobInputRoot := filepath.Join(root, "jobs", "inputs")
	if err := filepath.Walk(jobInputRoot, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !info.IsDir() {
			jobInputFiles = append(jobInputFiles, path)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if len(jobInputFiles) != 1 || filepath.Clean(jobInputFiles[0]) != filepath.Clean(filepath.Join(root, filepath.FromSlash(oldInputs[0].StorageKey))) {
		t.Fatalf("duplicate dispatch leaked staging: %v", jobInputFiles)
	}
	if _, err := fx.service.jobs.CancelForUser(preexisting.ID, fx.userID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(oldInputs[0].StorageKey))); !os.IsNotExist(err) {
		t.Fatalf("cancel retained recovered staged reference: %v", err)
	}
}

func TestComicWorkspaceIsolationAndDefaultSelection(t *testing.T) {
	fx := newComicServiceFixture()
	personal, assets := createApprovedComicAssets(t, fx, 2)
	if _, err := fx.service.GetProject(personal.ID, "user_b", WorkspaceScopePersonal); !errors.Is(err, repository.ErrComicAssetProjectNotFound) {
		t.Fatalf("cross-user get error = %v", err)
	}
	if _, err := fx.service.UpdateAsset(personal.ID, assets[1].ID, fx.userID, WorkspaceScopePersonal, ComicAssetInput{ArchiveStatus: strPointer(model.ComicAssetArchiveArchived)}); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.service.CreateBatch(personal.ID, fx.userID, WorkspaceScopePersonal, CreateComicBatchInput{AssetIDs: []string{assets[0].ID, "missing_asset"}}); !errors.Is(err, repository.ErrComicAssetNotFound) {
		t.Fatalf("unknown selected asset error = %v", err)
	}
	batch, err := fx.service.CreateBatch(personal.ID, fx.userID, WorkspaceScopePersonal, CreateComicBatchInput{})
	if err != nil {
		t.Fatal(err)
	}
	if batch.Batch.Total != 1 || batch.Items[0].ComicAssetID != assets[0].ID {
		t.Fatalf("default-selected items = %+v", batch.Items)
	}
}

func TestComicBatchFreezesAutomaticAndCustomOutputFolders(t *testing.T) {
	fx := newComicServiceFixture()
	assetRepo := repository.NewMemoryAssetRepository()
	folderRepo := repository.NewMemoryAssetFolderRepository()
	folders := NewAssetFolderService(folderRepo, assetRepo)
	folders.SetActiveReferenceChecker(fx.comic)
	fx.service.SetAssetFolderService(folders)

	autoProject, autoAssets := createApprovedComicAssets(t, fx, 1)
	autoBatch, err := fx.service.CreateBatch(autoProject.ID, fx.userID, WorkspaceScopePersonal, CreateComicBatchInput{AssetIDs: []string{autoAssets[0].ID}})
	if err != nil {
		t.Fatal(err)
	}
	if autoBatch.Batch.DestinationMode != model.AssetDestinationModeAuto || autoBatch.Items[0].OutputFolderID == "" {
		t.Fatalf("automatic destination = batch:%+v item:%+v", autoBatch.Batch, autoBatch.Items[0])
	}
	autoFolder, err := folders.Get(autoBatch.Items[0].OutputFolderID, fx.userID, WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if autoFolder.SystemKey != model.AssetFolderSystemKeyComicCategory || autoFolder.SourceRefID != autoProject.ID+":"+model.AssetCategoryCharacter {
		t.Fatalf("automatic folder = %+v", autoFolder)
	}

	customRoot, err := folders.Create(fx.userID, WorkspaceScopePersonal, AssetFolderCreateInput{Name: "客户交付"})
	if err != nil {
		t.Fatal(err)
	}
	customProject, customAssets := createApprovedComicAssets(t, fx, 1)
	customBatch, err := fx.service.CreateBatch(customProject.ID, fx.userID, WorkspaceScopePersonal, CreateComicBatchInput{
		AssetIDs: []string{customAssets[0].ID}, DestinationMode: model.AssetDestinationModeCustom,
		DestinationFolderID: customRoot.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	frozenFolderID := customBatch.Items[0].OutputFolderID
	customChild, err := folders.Get(frozenFolderID, fx.userID, WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if customChild.ParentID != customRoot.ID || customChild.Name != "人物" || customChild.Kind != model.AssetFolderKindUser {
		t.Fatalf("custom category folder = %+v", customChild)
	}
	if _, err := folders.Update(customChild.ID, fx.userID, WorkspaceScopePersonal, AssetFolderUpdateInput{Name: "角色成片", ParentID: customRoot.ID}); err != nil {
		t.Fatal(err)
	}
	reloaded, err := fx.service.GetBatch(customBatch.Batch.ID, fx.userID, WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Items[0].OutputFolderID != frozenFolderID {
		t.Fatalf("renamed folder changed frozen target: before=%s after=%s", frozenFolderID, reloaded.Items[0].OutputFolderID)
	}
	if _, err := folders.Delete(customRoot.ID, fx.userID, WorkspaceScopePersonal); !errors.Is(err, repository.ErrAssetFolderInUse) {
		t.Fatalf("active batch folder delete error = %v", err)
	}
	if _, err := fx.service.ControlBatch(customBatch.Batch.ID, fx.userID, WorkspaceScopePersonal, "stop"); err != nil {
		t.Fatal(err)
	}
	if _, err := folders.Delete(customRoot.ID, fx.userID, WorkspaceScopePersonal); err != nil {
		t.Fatalf("delete after stop: %v", err)
	}

	otherFolder, err := folders.Create("other_user", WorkspaceScopePersonal, AssetFolderCreateInput{Name: "他人目录"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = fx.service.CreateBatch(customProject.ID, fx.userID, WorkspaceScopePersonal, CreateComicBatchInput{
		AssetIDs: []string{customAssets[0].ID}, DestinationMode: model.AssetDestinationModeCustom,
		DestinationFolderID: otherFolder.ID,
	})
	if !errors.Is(err, repository.ErrAssetFolderNotFound) {
		t.Fatalf("cross-workspace destination error = %v", err)
	}
}

func TestComicMockProviderFiveItemArchiveClosureForAutomaticAndCustomFolders(t *testing.T) {
	for _, mode := range []string{model.AssetDestinationModeAuto, model.AssetDestinationModeCustom} {
		t.Run(mode, func(t *testing.T) {
			fx := newComicServiceFixture()
			assetRepo := repository.NewMemoryAssetRepository()
			folderRepo := repository.NewMemoryAssetFolderRepository()
			folders := NewAssetFolderService(folderRepo, assetRepo)
			folders.SetActiveReferenceChecker(fx.comic)
			assetService := NewAssetService(assetRepo, nil)
			assetService.SetFolderService(folders)
			fx.service.SetAssetFolderService(folders)
			fx.service.SetReferenceServices(assetService, nil)

			project, comicAssets := createApprovedComicAssets(t, fx, 5)
			input := CreateComicBatchInput{Concurrency: 2, DestinationMode: mode, AssetIDs: make([]string, 0, len(comicAssets))}
			for _, asset := range comicAssets {
				input.AssetIDs = append(input.AssetIDs, asset.ID)
			}
			if mode == model.AssetDestinationModeCustom {
				custom, err := folders.Create(fx.userID, WorkspaceScopePersonal, AssetFolderCreateInput{Name: "五任务交付"})
				if err != nil {
					t.Fatal(err)
				}
				input.DestinationFolderID = custom.ID
			}
			detail, err := fx.service.CreateBatch(project.ID, fx.userID, WorkspaceScopePersonal, input)
			if err != nil {
				t.Fatal(err)
			}
			archived := make(map[string]bool)
			for cycle := 0; cycle < 10 && detail.Batch.Status != model.ComicBatchStatusSucceeded; cycle++ {
				if err := fx.service.DispatchOnce(context.Background()); err != nil {
					t.Fatal(err)
				}
				detail, err = fx.service.GetBatch(detail.Batch.ID, fx.userID, WorkspaceScopePersonal)
				if err != nil {
					t.Fatal(err)
				}
				for _, item := range detail.Items {
					if item.JobID == "" || archived[item.ID] {
						continue
					}
					assetID := "asset_mock_" + item.ID
					if _, err := assetRepo.Create(model.Asset{
						ID: assetID, UserID: fx.userID, WorkspaceID: detail.Batch.WorkspaceID, Type: "image",
						Name: item.AssetName + ".png", URL: "/api/assets/" + assetID + "/content", FolderID: item.OutputFolderID,
						Category: model.AssetCategoryCharacter, SourceType: model.AssetSourceComicBatch, SourceJobID: item.JobID,
					}); err != nil {
						t.Fatal(err)
					}
					result := model.JSONB(fmt.Sprintf(`{"assets":[{"id":%q}]}`, assetID))
					if _, err := fx.jobs.SetResult(item.JobID, result); err != nil {
						t.Fatal(err)
					}
					archived[item.ID] = true
				}
				if err := fx.service.DispatchOnce(context.Background()); err != nil {
					t.Fatal(err)
				}
				detail, err = fx.service.GetBatch(detail.Batch.ID, fx.userID, WorkspaceScopePersonal)
				if err != nil {
					t.Fatal(err)
				}
			}
			if detail.Batch.Status != model.ComicBatchStatusSucceeded || detail.Batch.Succeeded != 5 {
				t.Fatalf("five-item batch did not close: %+v", detail.Batch)
			}
			library, err := assetService.ListLibrary(fx.userID, WorkspaceScopePersonal, AssetLibraryInput{
				SourceType: model.AssetSourceComicBatch, SourceProjectID: project.ID, Page: 1, PageSize: 20,
			})
			if err != nil {
				t.Fatal(err)
			}
			if library.Total != 5 || len(library.Items) != 5 {
				t.Fatalf("archived library total=%d items=%d", library.Total, len(library.Items))
			}
			for _, asset := range library.Items {
				if asset.FolderID == "" || asset.SourceBatchID != detail.Batch.ID || asset.SourceItemID == "" || asset.SourceJobID == "" {
					t.Fatalf("archived lineage incomplete: %+v", asset)
				}
			}
		})
	}
}

func createComicProjectAsset(t *testing.T, fx comicServiceFixture, title string, name string) (model.ComicAssetProject, model.ComicAsset) {
	t.Helper()
	detail, err := fx.service.CreateProject(fx.userID, WorkspaceScopePersonal, CreateComicProjectInput{Title: title, StylePreset: "3D动漫PBR"})
	if err != nil {
		t.Fatal(err)
	}
	asset, err := fx.service.CreateAsset(detail.Project.ID, fx.userID, WorkspaceScopePersonal, ComicAssetInput{
		Class: strPointer(model.ComicAssetClassCharacter), Name: &name, VisualDescription: strPointer(name + "设定"), SourcePrompt: strPointer(name + "原文"),
	})
	if err != nil {
		t.Fatal(err)
	}
	return detail.Project, asset
}

func createApprovedComicAssets(t *testing.T, fx comicServiceFixture, count int) (model.ComicAssetProject, []model.ComicAsset) {
	t.Helper()
	detail, err := fx.service.CreateProject(fx.userID, WorkspaceScopePersonal, CreateComicProjectInput{Title: "批次项目 " + randomHex(3), StylePreset: "3D动漫PBR"})
	if err != nil {
		t.Fatal(err)
	}
	assets := make([]model.ComicAsset, 0, count)
	for index := 0; index < count; index++ {
		name := "资产" + string(rune('A'+index))
		asset, err := fx.service.CreateAsset(detail.Project.ID, fx.userID, WorkspaceScopePersonal, ComicAssetInput{
			Class: strPointer(model.ComicAssetClassCharacter), Name: &name, VisualDescription: strPointer(name + "设定"), SourcePrompt: strPointer(name + "原始提示词"),
		})
		if err != nil {
			t.Fatal(err)
		}
		asset, err = fx.service.SavePrompt(detail.Project.ID, asset.ID, fx.userID, WorkspaceScopePersonal, SaveComicPromptInput{Content: name + "批准提示词", Source: "manual", Action: "approve"})
		if err != nil {
			t.Fatal(err)
		}
		assets = append(assets, asset)
	}
	return detail.Project, assets
}

func assertNoProviderSecretInBatch(t *testing.T, detail ComicBatchDetail) {
	t.Helper()
	data, err := json.Marshal(detail)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "transient-test-key") || strings.Contains(string(data), "api_key") {
		t.Fatalf("batch persisted provider secret: %s", data)
	}
}

func strPointer(value string) *string { return &value }
