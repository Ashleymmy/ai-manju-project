package repository

import (
	"testing"

	"github.com/ai-manju/api/internal/model"
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
