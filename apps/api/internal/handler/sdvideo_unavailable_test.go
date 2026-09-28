package handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/sdvideo"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

// A missing gateway must not turn a saved SD-video selection into a paid
// ordinary-provider job, including the multipart and legacy query routes.
func TestUnavailableSDVideoNeverFallsBackToProvider(t *testing.T) {
	for _, missingClient := range []bool{true, false} {
		t.Run(map[bool]string{true: "nil client", false: "missing credentials"}[missingClient], func(t *testing.T) {
			t.Setenv("SD_VIDEO_JWT_PRIVATE_KEY_FILE", "")
			t.Setenv("SD_VIDEO_CA_FILE", "")
			var upstreamCalls int
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				upstreamCalls++
				http.Error(w, "unexpected provider request", http.StatusInternalServerError)
			}))
			defer upstream.Close()
			providers := repository.NewMemoryModelProviderRepository()
			_, err := providers.UpsertModelProvider(model.ModelProviderConfig{
				ID: "ordinary", Enabled: true, BaseURL: upstream.URL, AuthType: "none",
				VideoModel: "ordinary-video", Capabilities: model.JSONB(`["video"]`),
			})
			if err != nil {
				t.Fatal(err)
			}
			producer := &queue.MemoryProducer{}
			jobs := service.NewJobService(repository.NewMemoryJobRepository(), producer, "celery", 1)
			ai := NewAIHandler(NewModelProviderHandler(providers, provider.NewSecretBox("test")), jobs)
			if !missingClient {
				ai.SetSDVideoClient(sdvideo.NewClient(config.Config{SDVideoBaseURL: upstream.URL, SDVideoMode: "active"}))
			}
			router := gin.New()
			router.Use(func(c *gin.Context) {
				c.Set(auth.ContextUserKey, model.User{ID: "owner", Role: model.UserRoleSuperAdmin})
				c.Set("request_id", "req-unavailable")
			})
			router.POST("/videos", ai.VideoTaskCreate)
			router.POST("/tasks", ai.SeedanceTaskCreate)
			router.GET("/videos/:id", ai.VideoTaskGet)
			router.GET("/videos/:id/content", ai.VideoTaskContent)
			router.GET("/tasks/:id", ai.SeedanceTaskGet)
			router.GET("/tasks/:id/content", ai.SeedanceTaskContent)
			for _, path := range []string{"/videos", "/tasks", "/tasks?model=sdvideo/seedance-fast"} {
				body := `{"model":" SDVIDEO/seedance-fast ","prompt":"test"}`
				if strings.Contains(path, "?") {
					body = `{"prompt":"test"}`
				}
				req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
				req.Header.Set("Content-Type", "application/json")
				assertSDVideoUnavailable(t, router, req)
			}
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			_ = writer.WriteField("model", "sdvideo/seedance-fast")
			_ = writer.WriteField("prompt", "test")
			_ = writer.Close()
			req := httptest.NewRequest(http.MethodPost, "/videos", &body)
			req.Header.Set("Content-Type", writer.FormDataContentType())
			assertSDVideoUnavailable(t, router, req)
			for _, path := range []string{
				"/videos/sdv_previous", "/videos/sdv_previous/content",
				"/tasks/sdv_previous", "/tasks/sdv_previous/content",
				"/tasks/previous?model=sdvideo/seedance-fast",
			} {
				assertSDVideoUnavailable(t, router, httptest.NewRequest(http.MethodGet, path, nil))
			}
			rows, err := jobs.ListForUser("owner")
			if err != nil || len(rows) != 0 || len(producer.Messages) != 0 || upstreamCalls != 0 {
				t.Fatalf("unavailable gateway caused side effects: jobs=%d messages=%d upstream=%d error=%v", len(rows), len(producer.Messages), upstreamCalls, err)
			}
		})
	}
}

func assertSDVideoUnavailable(t *testing.T, router http.Handler, req *http.Request) {
	t.Helper()
	out := httptest.NewRecorder()
	router.ServeHTTP(out, req)
	var envelope map[string]any
	if err := json.Unmarshal(out.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if out.Code != http.StatusServiceUnavailable || envelope["success"] != false || envelope["request_id"] != "req-unavailable" || envelope["error"] != "sd-video service is unavailable" {
		t.Fatalf("%s %s: %d %s", req.Method, req.URL.Path, out.Code, out.Body.String())
	}
}
