package repository

import (
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/database"
	"github.com/ai-manju/api/internal/model"
)

func TestGormAssetLineageRepositoryIsIdempotentIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run PostgreSQL repository integration test")
	}
	db, err := database.OpenPostgres(dsn)
	if err != nil {
		t.Fatal(err)
	}
	prefix := fmt.Sprintf("lineage_it_%d", time.Now().UTC().UnixNano())
	repo := NewGormAssetLineageRepository(db)
	input := []model.AssetLineage{{ID: prefix, WorkspaceID: prefix, ParentAssetID: prefix + "_parent", ChildAssetID: prefix + "_child", RelationType: model.AssetLineageGeneration, InputOrdinal: 0}}
	for index := 0; index < 2; index++ {
		items, err := repo.CreateMany(input)
		if err != nil || len(items) != 1 || items[0].ID != prefix {
			t.Fatalf("iteration=%d items=%v err=%v", index, items, err)
		}
	}
	t.Cleanup(func() { _ = db.Where("workspace_id = ?", prefix).Delete(&model.AssetLineage{}).Error })
	items, err := repo.ListByChild(prefix, prefix+"_child")
	if err != nil || len(items) != 1 {
		t.Fatalf("items=%v err=%v", items, err)
	}
}

func TestMemoryAssetLineageRepositoryIsIdempotent(t *testing.T) {
	repo := NewMemoryAssetLineageRepository()
	input := []model.AssetLineage{{ID: "lineage_a", WorkspaceID: "workspace_a", ParentAssetID: "parent", ChildAssetID: "child", RelationType: model.AssetLineageGeneration, InputOrdinal: 0}}
	for index := 0; index < 2; index++ {
		items, err := repo.CreateMany(input)
		if err != nil || len(items) != 1 || items[0].ID != "lineage_a" {
			t.Fatalf("iteration=%d items=%v err=%v", index, items, err)
		}
	}
	parents, err := repo.ListByChild("workspace_a", "child")
	if err != nil || len(parents) != 1 {
		t.Fatalf("parents=%v err=%v", parents, err)
	}
	children, err := repo.ListByParent("workspace_a", "parent")
	if err != nil || len(children) != 1 {
		t.Fatalf("children=%v err=%v", children, err)
	}
}
