package handler

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/sdvideo"
	"github.com/ai-manju/api/internal/service"
	"github.com/ai-manju/api/internal/storage"
	"github.com/gin-gonic/gin"
)

func TestVideoRoutesKeepSDVideoAndNativeJobsSeparate(t *testing.T) {
	assets := service.NewAssetService(repository.NewMemoryAssetRepository(), storage.NewLocalFSStorage(t.TempDir()))
	asset, err := assets.Upload(context.Background(), service.AssetUploadInput{ID: "asset_native_route", UserID: "owner", Scope: "personal", Type: "video", Name: "native", Extension: ".mp4", ContentType: "video/mp4", Reader: bytes.NewBufferString("native-video")})
	if err != nil {
		t.Fatal(err)
	}
	repo := repository.NewMemoryJobRepository()
	workspaceID := service.WorkspaceIDForScope("personal", "owner")
	for _, job := range []model.Job{
		{ID: "job_native_route", UserID: "owner", WorkspaceID: workspaceID, Type: model.JobTypeVideoGenerate, Status: model.JobStatusSucceeded, Result: mustProviderJSONB(map[string]any{"outputs": []any{map[string]any{"asset_id": asset.ID}}})},
		{ID: "job_sdvideo_route", UserID: "owner", WorkspaceID: workspaceID, Type: model.JobTypeVideoGenerate, Status: model.JobStatusSucceeded, ExternalProvider: "sd-video", ExternalTaskID: "sdv_remote", Result: mustProviderJSONB(map[string]any{"asset_id": "asset_bridge"})},
	} {
		job.IdempotencyKey = job.ID
		if _, err := repo.Create(job); err != nil {
			t.Fatal(err)
		}
	}
	h := NewAIHandler(nil, service.NewJobService(repo, &queue.MemoryProducer{}, "celery", 3))
	h.SetGenerationAssetService(assets)
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	h.SetSDVideoClient(sdvideo.NewClient(config.Config{SDVideoBaseURL: "http://127.0.0.1:1", SDVideoJWTPrivateKey: base64.RawStdEncoding.EncodeToString(private), SDVideoMode: "active"}))
	for name, route := range map[string]gin.HandlerFunc{
		"video-status": h.VideoTaskGet, "seedance-status": h.SeedanceTaskGet,
		"video-content": h.VideoTaskContent, "seedance-content": h.SeedanceTaskContent,
	} {
		for _, id := range []string{"job_native_route", "job_sdvideo_route"} {
			t.Run(name+"/"+id, func(t *testing.T) {
				response := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(response)
				c.Request = httptest.NewRequest(http.MethodGet, "/?scope=personal", nil)
				c.Params = gin.Params{{Key: "id", Value: id}}
				c.Set(auth.ContextUserKey, model.User{ID: "owner"})
				route(c)
				if strings.HasSuffix(name, "content") && id == "job_sdvideo_route" {
					if response.Code != http.StatusTemporaryRedirect || response.Header().Get("Location") != "/api/assets/asset_bridge/content?scope=personal" {
						t.Fatalf("bridge content used native path: %d %s", response.Code, response.Body.String())
					}
					return
				}
				if response.Code != http.StatusOK {
					t.Fatalf("route failed: %d %s", response.Code, response.Body.String())
				}
				if strings.HasSuffix(name, "content") && response.Body.String() != "native-video" {
					t.Fatal("native content was lost")
				}
				if id == "job_sdvideo_route" && !strings.Contains(response.Body.String(), `"external_task_id":"sdv_remote"`) {
					t.Fatal("bridge status used native path")
				}
			})
		}
	}
}
