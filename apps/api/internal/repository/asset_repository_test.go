package repository

import (
	"os"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestMemoryAssetRepositoryListByWorkspaceIDsPreservesRequestedOrder(t *testing.T) {
	repo := NewMemoryAssetRepository()
	workspaceA := "default:user_a"
	workspaceB := "default:user_b"
	for _, asset := range []model.Asset{
		{ID: "asset_a1", UserID: "user_a", WorkspaceID: workspaceA, Type: "image", URL: "/a1.png"},
		{ID: "asset_a2", UserID: "user_a", WorkspaceID: workspaceA, Type: "image", URL: "/a2.png"},
		{ID: "asset_b1", UserID: "user_b", WorkspaceID: workspaceB, Type: "image", URL: "/b1.png"},
	} {
		if _, err := repo.Create(asset); err != nil {
			t.Fatal(err)
		}
	}

	items, err := repo.ListByWorkspaceIDs([]string{"asset_a2", "missing", "asset_b1", "asset_a1", "asset_a2", ""}, workspaceA)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].ID != "asset_a2" || items[1].ID != "asset_a1" {
		t.Fatalf("ordered workspace result = %+v", items)
	}
}

func TestAssetRepositoryExpiredTrashOrderParity(t *testing.T) {
	check := func(t *testing.T, repo AssetRepository) {
		now := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
		expired := now.Add(-2 * time.Hour)
		legacy := now.Add(-model.AssetTrashRetention - time.Hour)
		for _, asset := range []model.Asset{
			{ID: "order_active", UserID: "review", WorkspaceID: "review", Type: "image", URL: "/active.png", TrashExpiresAt: &expired},
			{ID: "order_explicit", UserID: "review", WorkspaceID: "review", Type: "image", URL: "/explicit.png", TrashedAt: &expired, TrashExpiresAt: &expired},
			{ID: "order_legacy", UserID: "review", WorkspaceID: "review", Type: "image", URL: "/legacy.png", TrashedAt: &legacy},
		} {
			if _, err := repo.Create(asset); err != nil {
				t.Fatal(err)
			}
		}
		items, err := repo.ListExpiredTrash(now, 10)
		if err != nil || len(items) != 2 || items[0].ID != "order_explicit" || items[1].ID != "order_legacy" {
			t.Fatalf("effective expiry order = %+v, err=%v", items, err)
		}
		items, err = repo.ListExpiredTrash(now, 1)
		if err != nil || len(items) != 1 || items[0].ID != "order_explicit" {
			t.Fatalf("first purge batch = %+v, err=%v", items, err)
		}
	}
	t.Run("memory", func(t *testing.T) { check(t, NewMemoryAssetRepository()) })
	t.Run("postgres", func(t *testing.T) {
		dsn := os.Getenv("ASSET_TEST_DATABASE_URL")
		if dsn == "" {
			t.Skip("ASSET_TEST_DATABASE_URL is not configured")
		}
		db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		sqlDB, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		defer sqlDB.Close()
		if err := db.AutoMigrate(&model.Asset{}); err != nil {
			t.Fatal(err)
		}
		// Roll back the isolated test table so other integration tests keep their data.
		tx := db.Begin()
		if tx.Error != nil {
			t.Fatal(tx.Error)
		}
		defer tx.Rollback()
		if err := tx.Exec("CREATE TEMP TABLE assets (LIKE assets INCLUDING ALL)").Error; err != nil {
			t.Fatal(err)
		}
		check(t, NewGormAssetRepository(tx))
	})
}

func TestMemoryAssetRepositoryListExpiredTrashIncludesLegacyRows(t *testing.T) {
	repo := NewMemoryAssetRepository()
	now := time.Now().UTC()
	expired := now.Add(-time.Hour)
	legacy := now.Add(-model.AssetTrashRetention - time.Hour)
	freshTrash := now.Add(-time.Hour)
	freshExpiry := now.Add(24 * time.Hour)
	workspace := "default:user_a"
	for _, asset := range []model.Asset{
		{ID: "active", UserID: "user_a", WorkspaceID: workspace, Type: "image", URL: "/a.png"},
		{ID: "active_with_expiry", UserID: "user_a", WorkspaceID: workspace, Type: "image", URL: "/a.png", TrashExpiresAt: &expired},
		{ID: "expired", UserID: "user_a", WorkspaceID: workspace, Type: "image", URL: "/e.png", TrashedAt: &expired, TrashExpiresAt: &expired},
		{ID: "legacy", UserID: "user_a", WorkspaceID: workspace, Type: "image", URL: "/l.png", TrashedAt: &legacy},
		{ID: "fresh", UserID: "user_a", WorkspaceID: workspace, Type: "image", URL: "/f.png", TrashedAt: &freshTrash, TrashExpiresAt: &freshExpiry},
	} {
		if _, err := repo.Create(asset); err != nil {
			t.Fatal(err)
		}
	}
	items, err := repo.ListExpiredTrash(now, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("expired trash = %+v", items)
	}
	ids := map[string]bool{}
	for _, item := range items {
		ids[item.ID] = true
	}
	if !ids["expired"] || !ids["legacy"] || ids["fresh"] || ids["active"] {
		t.Fatalf("expired ids = %v", ids)
	}
}
