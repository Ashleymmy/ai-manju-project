package handler

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/middleware"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/ai-manju/api/internal/storage"
	"github.com/gin-gonic/gin"
)

func TestAssetExportDeleteEnvelopeAndOwnerIsolation(t *testing.T) {
	repo := repository.NewMemoryAssetExportRepository()
	workspace := service.WorkspaceIDForScope("personal", "alice")
	for _, status := range []string{model.AssetExportStatusSucceeded, model.AssetExportStatusRunning} {
		if _, err := repo.Create(model.AssetExportBatch{ID: status, WorkspaceID: workspace, Status: status}, nil); err != nil {
			t.Fatal(err)
		}
	}
	h := NewAssetExportHandler(service.NewAssetExportService(repo, nil, nil, storage.NewLocalFSStorage(t.TempDir())))
	r := gin.New()
	r.Use(middleware.RequestID())
	r.DELETE("/api/asset-exports/:exportId", func(c *gin.Context) {
		c.Set(auth.ContextUserKey, model.User{ID: c.GetHeader("Test-User")})
		h.Delete(c)
	})
	for _, item := range []struct {
		user, id string
		code     int
	}{
		{"bob", "succeeded", 404}, {"alice", "running", 409}, {"alice", "succeeded", 200}, {"alice", "succeeded", 404},
	} {
		req := httptest.NewRequest("DELETE", "/api/asset-exports/"+item.id+"?scope=personal", nil)
		req.Header.Set("Test-User", item.user)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var body struct {
			Success bool `json:"success"`
			Data    struct {
				Deleted bool `json:"deleted"`
			} `json:"data"`
			RequestID string `json:"request_id"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if w.Code != item.code || w.Header().Get("X-Request-ID") == "" || body.Success != (item.code == 200) {
			t.Fatalf("unexpected envelope: %d %s", w.Code, w.Body.String())
		}
		if item.code == 200 && !body.Data.Deleted {
			t.Fatal("missing deleted flag")
		}
	}
}
