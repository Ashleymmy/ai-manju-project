package repository

import (
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/database"
	"github.com/ai-manju/api/internal/model"
)

func testAssetExportDelete(t *testing.T, repo AssetExportRepository, prefix string) {
	t.Helper()
	workspace := "default:" + prefix
	for _, status := range []string{model.AssetExportStatusQueued, model.AssetExportStatusRunning, model.AssetExportStatusSucceeded, model.AssetExportStatusPartialFailed, model.AssetExportStatusFailed, model.AssetExportStatusCanceled, model.AssetExportStatusExpired} {
		t.Run(status, func(t *testing.T) {
			id := prefix + "_" + status
			_, err := repo.Create(model.AssetExportBatch{ID: id, WorkspaceID: workspace, UserID: prefix, Kind: model.AssetExportKindAssets, Status: status, Error: model.JSONB("{}")}, []model.AssetExportItem{
				{ID: id + "_item", ExportID: id, AssetID: id + "_asset", Status: model.AssetExportItemStatusPending, Error: model.JSONB("{}")},
			})
			if err != nil {
				t.Fatal(err)
			}
			if err := repo.Delete(id, "another-user"); !errors.Is(err, ErrAssetExportNotFound) {
				t.Fatalf("cross-workspace delete: %v", err)
			}
			if status == model.AssetExportStatusQueued || status == model.AssetExportStatusRunning {
				if err := repo.Delete(id, workspace); !errors.Is(err, ErrAssetExportActive) {
					t.Fatalf("active delete: %v", err)
				}
				if _, err := repo.Cancel(id, workspace); err != nil {
					t.Fatal(err)
				}
			}
			if err := repo.Delete(id, workspace); err != nil {
				t.Fatal(err)
			}
			if _, _, err := repo.Get(id, workspace); !errors.Is(err, ErrAssetExportNotFound) {
				t.Fatalf("record survived: %v", err)
			}
			if err := repo.Delete(id, workspace); !errors.Is(err, ErrAssetExportNotFound) {
				t.Fatalf("repeat delete: %v", err)
			}
		})
	}
}

func TestMemoryAssetExportDelete(t *testing.T) {
	repo := NewMemoryAssetExportRepository()
	testAssetExportDelete(t, repo, "delete-memory")
	if len(repo.items) != 0 || len(repo.itemLocations) != 0 || len(repo.batches) != 0 {
		t.Fatal("delete leaked repository entries")
	}
}

func TestGormAssetExportDeleteIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run PostgreSQL repository integration test")
	}
	db, err := database.OpenPostgres(dsn)
	if err != nil {
		t.Fatal(err)
	}
	prefix := fmt.Sprintf("delete_export_%d", time.Now().UnixNano())
	testAssetExportDelete(t, NewGormAssetExportRepository(db), prefix)
	var count int64
	if err := db.Model(&model.AssetExportItem{}).Where("id LIKE ?", prefix+"%").Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("orphan items: %d, %v", count, err)
	}
}
