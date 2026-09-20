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

func TestCanvasFolderDeletionRequiresDeletedProjectThroughHTTP(t *testing.T) {
	router := NewWithConfig(config.Config{
		StorageDriver: "memory", AllowPublicSignup: true,
		AppSecret: "canvas-folder-delete-test-secret", AssetStorageDir: t.TempDir(),
		FrontendURLs: []string{"http://localhost:3100"},
	})
	var cookies []*http.Cookie
	request := func(method, path, body string, status int, target any) string {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		for _, cookie := range cookies {
			req.AddCookie(cookie)
		}
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)
		if recorder.Code != status {
			t.Fatalf("%s %s: status=%d, body=%s", method, path, recorder.Code, recorder.Body.String())
		}
		var envelope struct {
			Success   bool            `json:"success"`
			Data      json.RawMessage `json:"data"`
			Error     string          `json:"error"`
			RequestID string          `json:"request_id"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil || envelope.Success != (status < http.StatusBadRequest) || (status >= http.StatusBadRequest && envelope.RequestID == "") {
			t.Fatalf("invalid envelope: %s, err=%v", recorder.Body.String(), err)
		}
		if target != nil {
			if err := json.Unmarshal(envelope.Data, target); err != nil {
				t.Fatal(err)
			}
		}
		if received := recorder.Result().Cookies(); len(received) > 0 {
			cookies = received
		}
		return envelope.Error
	}
	request(http.MethodPost, "/api/auth/register", `{"username":"folder_delete_test","password":"folder-delete-test-password"}`, http.StatusCreated, nil)
	var project model.Project
	request(http.MethodPost, "/api/projects?scope=personal", `{"title":"未命名画布"}`, http.StatusCreated, &project)
	var folders []model.AssetFolder
	request(http.MethodGet, "/api/asset-folders?scope=personal", "", http.StatusOK, &folders)
	var linked model.AssetFolder
	for _, folder := range folders {
		if folder.SystemKey == model.AssetFolderSystemKeyCanvasProject && folder.SourceRefID == project.ID {
			linked = folder
		}
	}
	if linked.ID == "" {
		t.Fatal("linked folder missing")
	}
	path := "/api/asset-folders/" + linked.ID + "?scope=personal"
	message := request(http.MethodDelete, path, "", http.StatusConflict, nil)
	if !strings.Contains(message, "请先在「全部项目」中删除该画布") {
		t.Fatalf("unhelpful live-canvas error: %s", message)
	}
	request(http.MethodDelete, "/api/projects/"+project.ID+"?scope=personal", "", http.StatusOK, nil)
	var result struct {
		Moved int64 `json:"moved_assets"`
	}
	request(http.MethodDelete, path, "", http.StatusOK, &result)
	if result.Moved != 0 {
		t.Fatalf("empty archive moved assets: %d", result.Moved)
	}
	request(http.MethodGet, "/api/asset-folders?scope=personal", "", http.StatusOK, &folders)
	if len(folders) != 6 {
		t.Fatalf("deleted archive descendants remain: %+v", folders)
	}
	request(http.MethodDelete, path, "", http.StatusNotFound, nil)
}
