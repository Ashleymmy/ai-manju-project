package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
)

func TestCanvasCreationAndRenameLinkLibraryThroughHTTP(t *testing.T) {
	// Entirely in-memory HTTP fixture, with its own synthetic ordinary member.
	router := NewWithConfig(config.Config{
		StorageDriver: "memory", AllowPublicSignup: true,
		AppSecret: "canvas-library-http-test-secret", AssetStorageDir: t.TempDir(),
		FrontendURLs: []string{"http://localhost:3100"},
	})
	var cookies []*http.Cookie
	request := func(method, path, body string, expectedStatus int, target any) {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		for _, cookie := range cookies {
			req.AddCookie(cookie)
		}
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)
		if recorder.Code != expectedStatus {
			t.Fatalf("%s %s status=%d, body=%s", method, path, recorder.Code, recorder.Body.String())
		}
		var envelope struct {
			Success bool            `json:"success"`
			Data    json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil || !envelope.Success {
			t.Fatalf("invalid response envelope: %s, err=%v", recorder.Body.String(), err)
		}
		if target != nil {
			if err := json.Unmarshal(envelope.Data, target); err != nil {
				t.Fatal(err)
			}
		}
		if received := recorder.Result().Cookies(); len(received) > 0 {
			cookies = received
		}
	}
	request(http.MethodPost, "/api/auth/register", `{"username":"canvas_library_test","password":"canvas-library-test-password"}`, http.StatusCreated, nil)
	var first, second model.Project
	request(http.MethodPost, "/api/projects?scope=personal", `{"title":"未命名画布","data":{"nodes":[]}}`, http.StatusCreated, &first)
	request(http.MethodPost, "/api/projects?scope=personal", `{"title":"未命名画布"}`, http.StatusCreated, &second)
	if first.Title != "未命名画布1" || second.Title != "未命名画布2" {
		t.Fatalf("HTTP titles = %q / %q", first.Title, second.Title)
	}
	var folders []model.AssetFolder
	request(http.MethodGet, "/api/asset-folders?scope=personal", "", http.StatusOK, &folders)
	var linked model.AssetFolder
	for _, folder := range folders {
		if folder.SystemKey == model.AssetFolderSystemKeyCanvasProject && folder.SourceRefID == first.ID {
			linked = folder
		}
	}
	if linked.ID == "" || linked.Name != first.Title {
		t.Fatalf("HTTP linked folder = %+v", linked)
	}
	children := map[string]bool{}
	for _, folder := range folders {
		if folder.ParentID == linked.ID {
			children[folder.Name] = true
		}
	}
	if len(children) != 4 || !children["角色"] || !children["场景"] || !children["道具"] || !children["其他"] {
		t.Fatalf("HTTP children = %+v", children)
	}
	request(http.MethodPut, "/api/projects/"+first.ID+"?scope=personal", `{"title":"第一集分镜"}`, http.StatusOK, &first)
	request(http.MethodGet, "/api/asset-folders?scope=personal", "", http.StatusOK, &folders)
	for _, folder := range folders {
		if folder.ID == linked.ID {
			if folder.Name != "第一集分镜" || folder.SourceRefID != first.ID {
				t.Fatalf("HTTP renamed folder = %+v", folder)
			}
			return
		}
	}
	t.Fatal("rename lost linked folder")
}
