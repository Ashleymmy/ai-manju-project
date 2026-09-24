package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

func TestProjectListSummaryOptInPreservesFullAPI(t *testing.T) {
	repo := repository.NewMemoryProjectRepository()
	for _, project := range []model.Project{
		{ID: "legacy", Title: "旧画布", OwnerID: "owner", Data: model.JSONB(`{"nodes":[{"id":"kept"}]}`)},
		{ID: "other", Title: "别人的画布", OwnerID: "other"},
		{ID: "team", Title: "团队画布", OwnerID: "owner", WorkspaceID: TeamWorkspaceID},
	} {
		if _, err := repo.Create(project); err != nil {
			t.Fatal(err)
		}
	}
	router := newProjectTestRouterWithRepoAndUser(repo, "owner")
	for _, summary := range []bool{true, false} {
		url := "/projects?scope=personal"
		if summary {
			url += "&include_data=false"
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Success   bool             `json:"success"`
			Data      []map[string]any `json:"data"`
			RequestID string           `json:"request_id"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if !body.Success || rec.Header().Get("X-Request-Id") == "" || len(body.Data) != 1 {
			t.Fatalf("invalid envelope: %s", rec.Body.String())
		}
		item := body.Data[0]
		if item["id"] != "legacy" || item["scope"] != "personal" || item["workspace_id"] != "default:owner" {
			t.Fatalf("wrong scope: %v", item)
		}
		data, present := item["data"]
		if summary && present {
			t.Fatal("summary must omit snapshot data")
		}
		if !summary && (!present || len(data.(map[string]any)["nodes"].([]any)) != 1) {
			t.Fatalf("default list lost data: %v", item)
		}
	}
}
