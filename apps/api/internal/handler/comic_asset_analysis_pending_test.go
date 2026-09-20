package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/ai-manju/api/internal/storage"
	"github.com/gin-gonic/gin"
)

func TestAnalysisUploadReturnsBeforeSlowModelAndSurvivesClosedRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := service.NewComicAssetService(repository.NewMemoryComicAssetRepository(), nil)
	svc.SetSourceStorage(storage.NewLocalFSStorage(t.TempDir()))
	release := make(chan struct{})
	defer close(release)
	svc.SetTextGenerator(func(ctx context.Context, _ string, _ provider.TextGenerationRequest) (provider.TextResponse, error) {
		select {
		case <-release:
			return provider.TextResponse{Text: `{"assets":[{"class":"character","name":"actor"}]}`}, nil
		case <-ctx.Done():
			return provider.TextResponse{}, ctx.Err()
		}
	})
	h := NewComicAssetHandler(svc)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(auth.ContextUserKey, model.User{ID: "user"}); c.Next() })
	r.POST("/api/comic-asset-analysis-sessions", h.CreateAnalysisSession)
	r.GET("/api/comic-asset-analysis-sessions/:sessionId", h.GetAnalysisSession)
	server := httptest.NewServer(r)
	defer server.Close()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	_ = w.WriteField("payload", `{"title":"test","source_type":"script","source_text":"actor enters","model":"test"}`)
	f, _ := w.CreateFormFile("source_file", "test.txt")
	_, _ = f.Write([]byte("actor enters"))
	_ = w.Close()
	client := &http.Client{Timeout: time.Second}
	res, err := client.Post(server.URL+"/api/comic-asset-analysis-sessions?async=true&scope=personal", w.FormDataContentType(), &body)
	if err != nil {
		t.Fatal(err)
	}
	var envelope struct {
		Success bool                        `json:"success"`
		Data    service.ComicAnalysisDetail `json:"data"`
	}
	if err := json.NewDecoder(res.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusAccepted || !envelope.Success || envelope.Data.Session.Status != model.ComicAnalysisStatusProcessing {
		t.Fatalf("status=%d envelope=%+v", res.StatusCode, envelope)
	}
	res, err = client.Get(server.URL + "/api/comic-asset-analysis-sessions/" + envelope.Data.Session.ID + "?scope=personal")
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK || !bytes.Contains(payload, []byte(`"processing"`)) {
		t.Fatalf("poll=%d %s", res.StatusCode, payload)
	}
}
