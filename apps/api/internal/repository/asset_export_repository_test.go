package repository

import (
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/database"
	"github.com/ai-manju/api/internal/model"
)

func TestMemoryAssetExportRepositoryClaimsEachBatchOnce(t *testing.T) {
	repo := NewMemoryAssetExportRepository()
	workspaceID := "default:user_a"
	for _, id := range []string{"export_a", "export_b"} {
		_, err := repo.Create(model.AssetExportBatch{ID: id, WorkspaceID: workspaceID, Status: model.AssetExportStatusQueued}, []model.AssetExportItem{
			{ID: id + "_item", ExportID: id, AssetID: id + "_asset", Status: model.AssetExportItemStatusPending},
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	claimedIDs := make(chan string, 2)
	var wait sync.WaitGroup
	for index := 0; index < 2; index++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			batch, _, claimed, err := repo.ClaimNext(time.Now().UTC().Add(-time.Minute))
			if err != nil {
				t.Errorf("claim: %v", err)
				return
			}
			if !claimed {
				t.Error("expected claim")
				return
			}
			claimedIDs <- batch.ID
		}()
	}
	wait.Wait()
	close(claimedIDs)
	seen := map[string]bool{}
	for id := range claimedIDs {
		if seen[id] {
			t.Fatalf("batch %q claimed twice", id)
		}
		seen[id] = true
	}
	if len(seen) != 2 {
		t.Fatalf("claims = %v", seen)
	}
}

func TestMemoryAssetExportRepositoryRecoversStaleAndPreservesCancel(t *testing.T) {
	repo := NewMemoryAssetExportRepository()
	workspaceID := "default:user_a"
	batch, err := repo.Create(model.AssetExportBatch{ID: "export_stale", WorkspaceID: workspaceID, Status: model.AssetExportStatusQueued}, []model.AssetExportItem{
		{ID: "item_stale", ExportID: "export_stale", AssetID: "asset_stale", Status: model.AssetExportItemStatusPending},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, claimed, err := repo.ClaimNext(time.Now().UTC().Add(-time.Minute)); err != nil || !claimed {
		t.Fatalf("initial claim claimed=%v err=%v", claimed, err)
	}
	if err := repo.UpdateItem("item_stale", model.AssetExportItemStatusSucceeded, "old/path.png", model.JSONB("{}")); err != nil {
		t.Fatal(err)
	}
	_, items, claimed, err := repo.ClaimNext(time.Now().UTC().Add(time.Minute))
	if err != nil || !claimed {
		t.Fatalf("stale claim claimed=%v err=%v", claimed, err)
	}
	if len(items) != 1 || items[0].Status != model.AssetExportItemStatusPending || items[0].ArchivePath != "" {
		t.Fatalf("stale items = %+v", items)
	}
	if _, err := repo.Cancel(batch.ID, workspaceID); err != nil {
		t.Fatal(err)
	}
	future := time.Now().UTC().Add(time.Hour)
	if err := repo.Finalize(batch.ID, model.AssetExportStatusSucceeded, "exports/test.zip", "test.zip", 123, model.JSONB("{}"), &future); err != nil {
		t.Fatal(err)
	}
	current, currentItems, err := repo.Get(batch.ID, workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if current.Status != model.AssetExportStatusCanceled || current.StorageKey != "" || current.Canceled != 1 {
		t.Fatalf("finalize overwrote cancel: %+v", current)
	}
	if currentItems[0].Status != model.AssetExportItemStatusCanceled {
		t.Fatalf("canceled items = %+v", currentItems)
	}
}

func TestMemoryAssetExportRepositoryBulkProgressAndCancelAreConsistent(t *testing.T) {
	repo := NewMemoryAssetExportRepository()
	workspaceID := "default:user_bulk"
	_, err := repo.Create(model.AssetExportBatch{ID: "export_bulk", WorkspaceID: workspaceID, Status: model.AssetExportStatusQueued, Total: 3}, []model.AssetExportItem{
		{ID: "item_bulk_1", ExportID: "export_bulk", AssetID: "asset_1", Status: model.AssetExportItemStatusPending},
		{ID: "item_bulk_2", ExportID: "export_bulk", AssetID: "asset_2", Status: model.AssetExportItemStatusPending},
		{ID: "item_bulk_3", ExportID: "export_bulk", AssetID: "asset_3", Status: model.AssetExportItemStatusPending},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, claimed, err := repo.ClaimNext(time.Now().UTC().Add(-time.Minute)); err != nil || !claimed {
		t.Fatalf("claim claimed=%v err=%v", claimed, err)
	}
	if err := repo.UpdateItems([]AssetExportItemUpdate{
		{ID: "item_bulk_1", Status: model.AssetExportItemStatusSucceeded, ArchivePath: "one.png", Error: model.JSONB("{}")},
		{ID: "item_bulk_2", Status: model.AssetExportItemStatusFailed, Error: model.JSONB(`{"message":"failed"}`)},
	}); err != nil {
		t.Fatal(err)
	}
	if err := repo.UpdateProgress("export_bulk", 1, 1); err != nil {
		t.Fatal(err)
	}
	running, err := repo.GetBatch("export_bulk", workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if running.Status != model.AssetExportStatusRunning || running.Succeeded != 1 || running.Failed != 1 {
		t.Fatalf("running progress = %+v", running)
	}
	if _, err := repo.Cancel("export_bulk", workspaceID); err != nil {
		t.Fatal(err)
	}
	if err := repo.UpdateItems([]AssetExportItemUpdate{{ID: "item_bulk_3", Status: model.AssetExportItemStatusSucceeded, ArchivePath: "late.png", Error: model.JSONB("{}")}}); err != nil {
		t.Fatal(err)
	}
	finished, items, err := repo.Get("export_bulk", workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if finished.Status != model.AssetExportStatusCanceled || finished.Succeeded != 1 || finished.Failed != 1 || finished.Canceled != 1 {
		t.Fatalf("canceled progress = %+v", finished)
	}
	if items[2].Status != model.AssetExportItemStatusCanceled || items[2].ArchivePath != "" {
		t.Fatalf("late bulk update overwrote cancel: %+v", items[2])
	}
}

func TestGormAssetExportRepositoryBulkUpdatesIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run PostgreSQL repository integration test")
	}
	db, err := database.OpenPostgres(dsn)
	if err != nil {
		t.Fatal(err)
	}
	repo := NewGormAssetExportRepository(db)
	prefix := fmt.Sprintf("asset_export_bulk_%d", time.Now().UTC().UnixNano())
	workspaceID := "default:" + prefix
	batch := model.AssetExportBatch{ID: prefix, UserID: prefix, WorkspaceID: workspaceID, Status: model.AssetExportStatusRunning, Total: 300, Error: model.JSONB("{}")}
	items := make([]model.AssetExportItem, 0, batch.Total)
	for index := 0; index < batch.Total; index++ {
		items = append(items, model.AssetExportItem{
			ID: fmt.Sprintf("%s_item_%03d", prefix, index), ExportID: prefix, AssetID: fmt.Sprintf("%s_asset_%03d", prefix, index),
			Position: index + 1, Status: model.AssetExportItemStatusPending, Error: model.JSONB("{}"),
		})
	}
	if _, err := repo.Create(batch, items); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = db.Where("export_id = ?", prefix).Delete(&model.AssetExportItem{}).Error
		_ = db.Where("id = ?", prefix).Delete(&model.AssetExportBatch{}).Error
	})
	updates := make([]AssetExportItemUpdate, 0, len(items)-1)
	for index, item := range items[:len(items)-1] {
		status := model.AssetExportItemStatusSucceeded
		archivePath := fmt.Sprintf("folder/%03d.png", index)
		errorPayload := model.JSONB("{}")
		if index%2 == 1 {
			status = model.AssetExportItemStatusFailed
			archivePath = ""
			errorPayload = model.JSONB(`{"message":"failed"}`)
		}
		updates = append(updates, AssetExportItemUpdate{ID: item.ID, Status: status, ArchivePath: archivePath, Error: errorPayload})
	}
	if err := repo.UpdateItems(updates); err != nil {
		t.Fatal(err)
	}
	if err := repo.UpdateProgress(prefix, 150, 149); err != nil {
		t.Fatal(err)
	}
	running, err := repo.GetBatch(prefix, workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if running.Succeeded != 150 || running.Failed != 149 {
		t.Fatalf("running progress = %+v", running)
	}
	if _, err := repo.Cancel(prefix, workspaceID); err != nil {
		t.Fatal(err)
	}
	last := items[len(items)-1]
	if err := repo.UpdateItems([]AssetExportItemUpdate{{ID: last.ID, Status: model.AssetExportItemStatusSucceeded, ArchivePath: "late.png", Error: model.JSONB("{}")}}); err != nil {
		t.Fatal(err)
	}
	finished, stored, err := repo.Get(prefix, workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if finished.Status != model.AssetExportStatusCanceled || finished.Succeeded != 150 || finished.Failed != 149 || finished.Canceled != 1 {
		t.Fatalf("finished batch = %+v", finished)
	}
	if stored[len(stored)-1].Status != model.AssetExportItemStatusCanceled || stored[len(stored)-1].ArchivePath != "" {
		t.Fatalf("late update overwrote canceled item: %+v", stored[len(stored)-1])
	}
}
