package service

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/ai-manju/api/internal/model"
)

func TestProjectSummariesPreserveWorkspaceAndSnapshots(t *testing.T) {
	for _, driver := range []string{"memory", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			repo, _, _ := canvasLibraryRepositories(t, driver)
			original := model.JSONB(`{"nodes":[{"id":"keep-node"}],"edges":[],"custom":"preserve"}`)
			for _, p := range []model.Project{
				{ID: "legacy", Title: "旧画布", OwnerID: "owner", Data: original},
				{ID: "personal", Title: "个人画布", OwnerID: "owner", WorkspaceID: "default:owner", Data: original},
				{ID: "other", Title: "他人画布", OwnerID: "other", WorkspaceID: "default:other", Data: original},
				{ID: "team", Title: "团队画布", OwnerID: "owner", WorkspaceID: TeamWorkspaceID, Data: original},
			} {
				if _, err := repo.Create(p); err != nil {
					t.Fatal(err)
				}
				if _, err := repo.UpsertSnapshot(model.CanvasSnapshot{ProjectID: p.ID, Data: original}); err != nil {
					t.Fatal(err)
				}
			}
			service := NewProjectService(repo)
			for _, scope := range []string{WorkspaceScopePersonal, WorkspaceScopeTeam} {
				items, err := service.ListSummaries("owner", scope)
				if err != nil {
					t.Fatal(err)
				}
				wantCount := 2
				if scope == WorkspaceScopeTeam {
					wantCount = 1
				}
				if len(items) != wantCount {
					t.Fatalf("scope %s: %d items, want %d", scope, len(items), wantCount)
				}
				for _, p := range items {
					if len(p.Data) != 0 || p.ID == "other" || (scope == WorkspaceScopePersonal && p.ID == "team") {
						t.Fatalf("invalid summary: %+v", p)
					}
					snapshot, err := repo.GetSnapshot(p.ID)
					if err != nil {
						t.Fatal(err)
					}
					var want, got any
					if err := json.Unmarshal(original, &want); err != nil {
						t.Fatal(err)
					}
					if err := json.Unmarshal(snapshot.Data, &got); err != nil {
						t.Fatal(err)
					}
					wantJSON, _ := json.Marshal(want)
					gotJSON, _ := json.Marshal(got)
					if snapshot.Version != 1 || !bytes.Equal(wantJSON, gotJSON) {
						t.Fatalf("summary changed snapshot: %+v", snapshot)
					}
				}
				full, err := service.List("owner", scope)
				if err != nil {
					t.Fatal(err)
				}
				for _, p := range full {
					if len(p.Data) == 0 {
						t.Fatal("full list lost snapshot data")
					}
				}
			}
		})
	}
}
