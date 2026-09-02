package repository

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/database"
	"github.com/ai-manju/api/internal/model"
)

func TestMemoryComicBatchRecoveryAndAtomicCreate(t *testing.T) {
	repo := NewMemoryComicAssetRepository()
	project, asset := seedMemoryComicProject(t, repo, "recover")
	batch := model.ComicAssetGenerationBatch{
		ID: "batch_recover", ProjectID: project.ID, UserID: project.OwnerID, WorkspaceID: project.WorkspaceID,
		Status: model.ComicBatchStatusQueued, Model: "image-v1", Concurrency: 1,
	}
	duplicate := model.ComicAssetGenerationItem{
		ID: "item_duplicate", BatchID: batch.ID, ComicAssetID: asset.ID, Status: model.ComicBatchItemStatusPending, PromptSnapshot: "prompt", Attempt: 1,
	}
	if _, _, err := repo.CreateBatch(batch, []model.ComicAssetGenerationItem{duplicate, duplicate}); !errors.Is(err, ErrComicAssetConflict) {
		t.Fatalf("duplicate create error = %v", err)
	}
	if len(repo.batches) != 0 || len(repo.items) != 0 {
		t.Fatalf("failed create partially persisted batches=%d items=%d", len(repo.batches), len(repo.items))
	}

	item := duplicate
	item.ID = "item_recover"
	if _, _, err := repo.CreateBatch(batch, []model.ComicAssetGenerationItem{item}); err != nil {
		t.Fatal(err)
	}
	_, claimed, err := repo.ClaimPendingItems(batch.ID)
	if err != nil || len(claimed) != 1 {
		t.Fatalf("claim = %v, %v", claimed, err)
	}
	if err := repo.RecoverUnassignedItems(batch.ID, time.Now().UTC().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	recovered, items, err := repo.GetBatchInternal(batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if items[0].Status != model.ComicBatchItemStatusPending || recovered.Active != 0 || recovered.Pending != 1 {
		t.Fatalf("recovered batch=%+v item=%+v", recovered, items[0])
	}
}

func TestMemoryComicProjectWithAssetsIsAtomic(t *testing.T) {
	repo := NewMemoryComicAssetRepository()
	project := model.ComicAssetProject{ID: "project_import", OwnerID: "user_a", WorkspaceID: "default:user_a", Title: "导入项目", DefaultTemplates: model.JSONB("{}")}
	assets := []model.ComicAsset{
		{ID: "asset_import_1", ProjectID: project.ID, Code: "C001", Class: model.ComicAssetClassCharacter, Name: "甲"},
		{ID: "asset_import_2", ProjectID: project.ID, Code: "C001", Class: model.ComicAssetClassCharacter, Name: "乙"},
	}
	if _, _, err := repo.CreateProjectWithAssets(project, assets); !errors.Is(err, ErrComicAssetConflict) {
		t.Fatalf("duplicate import error=%v", err)
	}
	if len(repo.projects) != 0 || len(repo.assets) != 0 {
		t.Fatalf("failed import partially persisted projects=%d assets=%d", len(repo.projects), len(repo.assets))
	}
	assets[1].Code = "C002"
	created, createdAssets, err := repo.CreateProjectWithAssets(project, assets)
	if err != nil {
		t.Fatal(err)
	}
	if created.ID != project.ID || len(createdAssets) != 2 || len(repo.projects) != 1 || len(repo.assets) != 2 {
		t.Fatalf("created=%+v assets=%+v", created, createdAssets)
	}
}

func TestMemoryComicBatchStopRecoversUnassignedClaimAsCanceled(t *testing.T) {
	repo := NewMemoryComicAssetRepository()
	project, asset := seedMemoryComicProject(t, repo, "stop")
	batch := model.ComicAssetGenerationBatch{ID: "batch_stop", ProjectID: project.ID, UserID: project.OwnerID, WorkspaceID: project.WorkspaceID, Status: model.ComicBatchStatusQueued, Model: "image-v1", Concurrency: 1}
	item := model.ComicAssetGenerationItem{ID: "item_stop", BatchID: batch.ID, ComicAssetID: asset.ID, Status: model.ComicBatchItemStatusPending, PromptSnapshot: "prompt", Attempt: 1}
	if _, _, err := repo.CreateBatch(batch, []model.ComicAssetGenerationItem{item}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.ClaimPendingItems(batch.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.ControlBatch(batch.ID, project.WorkspaceID, "stop"); err != nil {
		t.Fatal(err)
	}
	if err := repo.RecoverUnassignedItems(batch.ID, time.Now().UTC().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	stopped, items, err := repo.GetBatchInternal(batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stopped.Status != model.ComicBatchStatusCanceled || items[0].Status != model.ComicBatchItemStatusCanceled {
		t.Fatalf("stopped batch=%+v item=%+v", stopped, items[0])
	}
}

func TestMemoryComicOutputVersionsAreContinuousAndIdempotent(t *testing.T) {
	repo := NewMemoryComicAssetRepository()
	project, asset := seedMemoryComicProject(t, repo, "versions")
	for version := 1; version <= 2; version++ {
		batchID := fmt.Sprintf("batch_version_%d", version)
		itemID := fmt.Sprintf("item_version_%d", version)
		batch := model.ComicAssetGenerationBatch{ID: batchID, ProjectID: project.ID, UserID: project.OwnerID, WorkspaceID: project.WorkspaceID, Status: model.ComicBatchStatusQueued, Model: "image-v1", Concurrency: 1}
		item := model.ComicAssetGenerationItem{ID: itemID, BatchID: batchID, ComicAssetID: asset.ID, Status: model.ComicBatchItemStatusPending, PromptSnapshot: "prompt", Attempt: 1}
		if _, _, err := repo.CreateBatch(batch, []model.ComicAssetGenerationItem{item}); err != nil {
			t.Fatal(err)
		}
		_, claimed, err := repo.ClaimPendingItems(batchID)
		if err != nil {
			t.Fatal(err)
		}
		jobID := fmt.Sprintf("job_%d", version)
		if err := repo.SetItemJob(claimed[0].ID, 1, jobID); err != nil {
			t.Fatal(err)
		}
		if err := repo.SyncItemFromJob(itemID, jobID, model.JobStatusSucceeded, fmt.Sprintf("asset_output_%d", version), model.JSONB("{}")); err != nil {
			t.Fatal(err)
		}
		if err := repo.SyncItemFromJob(itemID, jobID, model.JobStatusSucceeded, fmt.Sprintf("asset_output_%d", version), model.JSONB("{}")); err != nil {
			t.Fatal(err)
		}
	}
	archived, err := repo.GetAsset(project.ID, asset.ID, project.WorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	outputs := decodeComicOutputs(archived.Outputs)
	if archived.OutputVersion != 2 || len(outputs) != 2 || outputs[0].Version != 1 || outputs[1].Version != 2 {
		t.Fatalf("asset=%+v outputs=%+v", archived, outputs)
	}
}

func TestMemoryComicVariantFailureDoesNotHideSuccessfulOutput(t *testing.T) {
	repo := NewMemoryComicAssetRepository()
	project, asset := seedMemoryComicProject(t, repo, "partial_variants")
	batch := model.ComicAssetGenerationBatch{ID: "batch_partial_variants", ProjectID: project.ID, UserID: project.OwnerID, WorkspaceID: project.WorkspaceID, Status: model.ComicBatchStatusQueued, Model: "image-v1", Concurrency: 2}
	items := []model.ComicAssetGenerationItem{
		{ID: "item_variant_success", BatchID: batch.ID, ComicAssetID: asset.ID, VariantIndex: 1, Status: model.ComicBatchItemStatusPending, PromptSnapshot: "prompt", Attempt: 1},
		{ID: "item_variant_failed", BatchID: batch.ID, ComicAssetID: asset.ID, VariantIndex: 2, Status: model.ComicBatchItemStatusPending, PromptSnapshot: "prompt", Attempt: 1},
	}
	if _, _, err := repo.CreateBatch(batch, items); err != nil {
		t.Fatal(err)
	}
	_, claimed, err := repo.ClaimPendingItems(batch.ID)
	if err != nil || len(claimed) != 2 {
		t.Fatalf("claimed=%+v err=%v", claimed, err)
	}
	for _, item := range claimed {
		if err := repo.SetItemJob(item.ID, 1, "job_"+item.ID); err != nil {
			t.Fatal(err)
		}
	}
	if err := repo.SyncItemFromJob(items[0].ID, "job_"+items[0].ID, model.JobStatusSucceeded, "asset_output", model.JSONB("{}")); err != nil {
		t.Fatal(err)
	}
	if err := repo.SyncItemFromJob(items[1].ID, "job_"+items[1].ID, model.JobStatusFailed, "", model.JSONB(`{"message":"failed"}`)); err != nil {
		t.Fatal(err)
	}
	archived, err := repo.GetAsset(project.ID, asset.ID, project.WorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if archived.ArchiveStatus != model.ComicAssetArchiveArchived || archived.OutputVersion != 1 {
		t.Fatalf("asset=%+v", archived)
	}
	if _, _, err := repo.RetryBatchItems(batch.ID, project.WorkspaceID, []string{items[1].ID}); err != nil {
		t.Fatal(err)
	}
	archived, err = repo.GetAsset(project.ID, asset.ID, project.WorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if archived.ArchiveStatus != model.ComicAssetArchiveArchived || archived.OutputVersion != 1 {
		t.Fatalf("retry hid an existing successful variant: %+v", archived)
	}
}

func TestGormComicRepositoryBatchLifecycleIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run PostgreSQL repository integration test")
	}
	db, err := database.OpenPostgres(dsn)
	if err != nil {
		t.Fatal(err)
	}
	repo := NewGormComicAssetRepository(db)
	prefix := "comic_repo_" + randomRepositoryHex(6)
	project := model.ComicAssetProject{ID: prefix + "_project", OwnerID: prefix + "_user", WorkspaceID: "default:" + prefix + "_user", Title: "integration", DefaultTemplates: model.JSONB("{}")}
	assetInput := model.ComicAsset{
		ID: prefix + "_asset", ProjectID: project.ID, Code: "C001", Class: model.ComicAssetClassCharacter, Name: "角色",
		PromptStatus: model.ComicPromptStatusApproved, ApprovedPrompt: "prompt", PromptWarnings: model.JSONB("[]"), PromptRevisions: model.JSONB("[]"), ArchiveStatus: model.ComicAssetArchivePending, Outputs: model.JSONB("[]"),
	}
	project, importedAssets, err := repo.CreateProjectWithAssets(project, []model.ComicAsset{assetInput})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = repo.DeleteProject(project.ID, project.WorkspaceID) })
	asset := importedAssets[0]
	batch := model.ComicAssetGenerationBatch{ID: prefix + "_batch", ProjectID: project.ID, UserID: project.OwnerID, WorkspaceID: project.WorkspaceID, IdempotencyKey: prefix + "_request", RequestFingerprint: "fingerprint", Status: model.ComicBatchStatusQueued, Model: "image-v1", Concurrency: 1}
	item := model.ComicAssetGenerationItem{ID: prefix + "_item", BatchID: batch.ID, ComicAssetID: asset.ID, VariantIndex: 2, Status: model.ComicBatchItemStatusPending, PromptSnapshot: "prompt", ConfigSnapshot: model.JSONB(`{"model_selector":"provider::image-v1","model":"image-v1","size":"1024x1536","quality":"medium","output_format":"png","reference_asset_ids":[]}`), Attempt: 1, Error: model.JSONB("{}")}
	createdBatch, createdItems, err := repo.CreateBatch(batch, []model.ComicAssetGenerationItem{item})
	if err != nil {
		t.Fatal(err)
	}
	replayInput := batch
	replayInput.ID = prefix + "_batch_replay"
	replayItem := item
	replayItem.ID = prefix + "_item_replay"
	replayItem.BatchID = replayInput.ID
	replayedBatch, replayedItems, err := repo.CreateBatch(replayInput, []model.ComicAssetGenerationItem{replayItem})
	if err != nil {
		t.Fatal(err)
	}
	if replayedBatch.ID != createdBatch.ID || replayedItems[0].ID != createdItems[0].ID {
		t.Fatalf("idempotent replay created different records: batch=%+v items=%+v", replayedBatch, replayedItems)
	}
	conflicting := replayInput
	conflicting.ID = prefix + "_batch_conflict"
	conflicting.RequestFingerprint = "changed"
	conflictingItem := replayItem
	conflictingItem.ID = prefix + "_item_conflict"
	conflictingItem.BatchID = conflicting.ID
	if _, _, err := repo.CreateBatch(conflicting, []model.ComicAssetGenerationItem{conflictingItem}); !errors.Is(err, ErrComicAssetConflict) {
		t.Fatalf("changed idempotent request error=%v", err)
	}
	_, claimed, err := repo.ClaimPendingItems(batch.ID)
	if err != nil || len(claimed) != 1 {
		t.Fatalf("claim=%v err=%v", claimed, err)
	}
	if err := repo.SetItemJob(item.ID, 1, prefix+"_job"); err != nil {
		t.Fatal(err)
	}
	if err := repo.SyncItemFromJob(item.ID, prefix+"_job", model.JobStatusSucceeded, prefix+"_output", model.JSONB("{}")); err != nil {
		t.Fatal(err)
	}
	done, items, err := repo.GetBatch(batch.ID, project.WorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if done.Status != model.ComicBatchStatusSucceeded || items[0].OutputVersion != 1 || items[0].VariantIndex != 2 || !repositoryJSONEqual(items[0].ConfigSnapshot, item.ConfigSnapshot) {
		t.Fatalf("done=%+v items=%+v", done, items)
	}
	if _, _, err := repo.GetBatch(batch.ID, "default:another-user"); !errors.Is(err, ErrComicAssetBatchNotFound) {
		t.Fatalf("cross-workspace get error=%v", err)
	}

	retryBatch := model.ComicAssetGenerationBatch{ID: prefix + "_retry_batch", ProjectID: project.ID, UserID: project.OwnerID, WorkspaceID: project.WorkspaceID, IdempotencyKey: prefix + "_retry_request", RequestFingerprint: "retry-fingerprint", Status: model.ComicBatchStatusQueued, Model: "image-v1", Concurrency: 1}
	retryItem := model.ComicAssetGenerationItem{ID: prefix + "_retry_item", BatchID: retryBatch.ID, ComicAssetID: asset.ID, Status: model.ComicBatchItemStatusPending, PromptSnapshot: "prompt", Attempt: 1, Error: model.JSONB("{}")}
	if _, _, err := repo.CreateBatch(retryBatch, []model.ComicAssetGenerationItem{retryItem}); err != nil {
		t.Fatal(err)
	}
	_, claimed, err = repo.ClaimPendingItems(retryBatch.ID)
	if err != nil || len(claimed) != 1 {
		t.Fatalf("retry claim=%+v err=%v", claimed, err)
	}
	if err := repo.SetItemJob(retryItem.ID, 1, prefix+"_retry_job"); err != nil {
		t.Fatal(err)
	}
	if err := repo.SyncItemFromJob(retryItem.ID, prefix+"_retry_job", model.JobStatusFailed, "", model.JSONB(`{"message":"failed"}`)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.RetryBatchItems(retryBatch.ID, project.WorkspaceID, []string{retryItem.ID}); err != nil {
		t.Fatal(err)
	}
	archived, err := repo.GetAsset(project.ID, asset.ID, project.WorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if archived.ArchiveStatus != model.ComicAssetArchiveArchived || archived.OutputVersion != 1 {
		t.Fatalf("gorm retry hid an existing successful variant: %+v", archived)
	}
}

func repositoryJSONEqual(left model.JSONB, right model.JSONB) bool {
	var leftValue any
	var rightValue any
	if json.Unmarshal(left, &leftValue) != nil || json.Unmarshal(right, &rightValue) != nil {
		return false
	}
	return reflect.DeepEqual(leftValue, rightValue)
}

func seedMemoryComicProject(t *testing.T, repo *MemoryComicAssetRepository, suffix string) (model.ComicAssetProject, model.ComicAsset) {
	t.Helper()
	project := model.ComicAssetProject{ID: "project_" + suffix, OwnerID: "user_a", WorkspaceID: "default:user_a", Title: suffix, DefaultTemplates: model.JSONB("{}")}
	project, err := repo.CreateProject(project)
	if err != nil {
		t.Fatal(err)
	}
	asset := model.ComicAsset{
		ID: "asset_" + suffix, ProjectID: project.ID, Code: "C001", Class: model.ComicAssetClassCharacter, Name: suffix,
		PromptStatus: model.ComicPromptStatusApproved, ApprovedPrompt: "prompt", PromptWarnings: model.JSONB("[]"), PromptRevisions: model.JSONB("[]"), ArchiveStatus: model.ComicAssetArchivePending, Outputs: model.JSONB("[]"),
	}
	asset, err = repo.CreateAsset(asset, project.WorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	return project, asset
}
