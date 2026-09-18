package handler

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/sdvideo"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

func TestSDVideoCatalogAndSubmissionShareCreationPolicy(t *testing.T) {
	for _, tc := range []struct {
		name, mode, scope              string
		models, workspaces, wantModels []string
		want25Error                    error
	}{
		{name: "unrestricted", mode: "active", wantModels: []string{"sdvideo/seedance-2.5", "sdvideo/seedance-2.0"}},
		{name: "legacy 2.0 allowlist does not restrict catalog", mode: "active", models: []string{"seedance-2.0"}, wantModels: []string{"sdvideo/seedance-2.5", "sdvideo/seedance-2.0"}},
		{name: "legacy prefixed allowlist does not restrict catalog", mode: "active", models: []string{"sdvideo/seedance-2.5"}, wantModels: []string{"sdvideo/seedance-2.5", "sdvideo/seedance-2.0"}},
		{name: "workspace blocked", mode: "active", workspaces: []string{"team:default"}, wantModels: []string{}, want25Error: sdvideo.ErrWorkspaceNotAllowed},
		{name: "team allowed", mode: "active", scope: "team", workspaces: []string{"team:default"}, wantModels: []string{"sdvideo/seedance-2.5", "sdvideo/seedance-2.0"}},
		{name: "shadow", mode: "shadow", wantModels: []string{}, want25Error: sdvideo.ErrCreationDisabled},
		{name: "disabled", mode: "disabled", wantModels: []string{}, want25Error: sdvideo.ErrCreationDisabled},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("SD_VIDEO_ALLOWED_MODELS", strings.Join(tc.models, ","))
			t.Setenv("SD_VIDEO_JWT_PRIVATE_KEY_FILE", "")
			t.Setenv("SD_VIDEO_CA_FILE", "")
			_, private, err := ed25519.GenerateKey(rand.Reader)
			if err != nil {
				t.Fatal(err)
			}
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet || (r.URL.Path != "/v1/models" && r.URL.Path != "/v1/admin/models") {
					t.Errorf("unexpected upstream request: %s %s", r.Method, r.URL.Path)
					http.Error(w, "unexpected request", 500)
					return
				}
				_ = json.NewEncoder(w).Encode(gin.H{"success": true, "data": gin.H{"items": []gin.H{
					{"key": "seedance-2.5", "id": "ep-upstream", "name": "Seedance 2.5", "available": true, "enabled": true},
					{"key": "seedance-2.0", "id": "ep-20", "name": "Seedance 2.0", "available": true, "enabled": true},
					{"key": "seedance-2.0-ark", "id": "ep-official", "available": false, "enabled": true, "disabled_reason": "provider_credentials_missing"},
				}}})
			}))
			defer upstream.Close()
			client := sdvideo.NewClient(config.Config{SDVideoBaseURL: upstream.URL, SDVideoJWTPrivateKey: base64.RawStdEncoding.EncodeToString(private), SDVideoMode: tc.mode, SDVideoAllowedWorkspaces: tc.workspaces})
			providers := repository.NewMemoryModelProviderRepository()
			_, err = providers.UpsertModelProvider(model.ModelProviderConfig{ID: "text", Name: "Text", Enabled: true, TextModel: "text-model", Capabilities: model.JSONB(`["text"]`)})
			if err != nil {
				t.Fatal(err)
			}
			catalog := &ModelProviderHandler{repo: providers, sdVideo: client}
			jobRepo := repository.NewMemoryJobRepository()
			jobs := service.NewJobService(jobRepo, &queue.MemoryProducer{}, "celery", 1)
			_, err = jobRepo.Create(model.Job{ID: "job_previous", IdempotencyKey: "previous", UserID: "owner", WorkspaceID: service.WorkspaceIDForScope(tc.scope, "owner"), Type: model.JobTypeVideoGenerate, Status: model.JobStatusFailed, ExternalProvider: "sd-video", Payload: model.JSONB(`{"model":"seedance-2.5","prompt":"pixel art"}`)})
			if err != nil {
				t.Fatal(err)
			}
			ai := NewAIHandler(catalog, jobs)
			ai.SetSDVideoClient(client)
			jobHandler := NewJobHandler(jobs)
			jobHandler.SetSDVideoClient(client)
			router := gin.New()
			router.Use(func(c *gin.Context) {
				c.Set(auth.ContextUserKey, model.User{ID: "owner", Role: model.UserRoleSuperAdmin})
				c.Set("request_id", "req-policy")
			})
			router.GET("/models", func(c *gin.Context) { catalog.AggregatedModelsWithSDVideo(c, client) })
			router.GET("/providers/:id", func(c *gin.Context) { catalog.handleSDVideoModel(c, "get") })
			router.POST("/tasks", ai.SeedanceTaskCreate)
			router.POST("/jobs/:id/retry", jobHandler.Retry)
			RegisterSDVideoGateway(router.Group("/sdvideo"), client, jobs)
			invoke := func(method, path, body string) (int, map[string]any) {
				req := httptest.NewRequest(method, path+"?scope="+tc.scope, strings.NewReader(body))
				req.Header.Set("Content-Type", "application/json")
				out := httptest.NewRecorder()
				router.ServeHTTP(out, req)
				var result map[string]any
				if err := json.Unmarshal(out.Body.Bytes(), &result); err != nil {
					t.Fatal(err)
				}
				return out.Code, result
			}
			code, result := invoke("GET", "/models", "")
			if code != 200 {
				t.Fatalf("catalog: %d %v", code, result)
			}
			data := result["data"].(map[string]any)
			var videoModels []string
			raw, _ := json.Marshal(data["video_models"])
			_ = json.Unmarshal(raw, &videoModels)
			if !reflect.DeepEqual(videoModels, tc.wantModels) {
				t.Fatalf("video models = %v, want %v", videoModels, tc.wantModels)
			}
			defaultModel := ""
			if len(tc.wantModels) > 0 {
				defaultModel = tc.wantModels[0]
			}
			if data["default_video_model"] != defaultModel {
				t.Fatalf("default = %v, want %s", data["default_video_model"], defaultModel)
			}
			if len(data["text_models"].([]any)) != 1 {
				t.Fatal("text models were affected by video policy")
			}
			if tc.want25Error != nil {
				for _, field := range []string{"models", "model_labels", "model_provider_names"} {
					raw, _ := json.Marshal(data[field])
					if strings.Contains(string(raw), "sdvideo/seedance-2.5") {
						t.Fatalf("blocked model leaked into %s", field)
					}
				}
			}
			for _, path := range []string{"/sdvideo/models", "/sdvideo/admin/models", "/providers/sdvideo::all"} {
				code, result := invoke("GET", path, "")
				if code != 200 {
					t.Fatalf("%s: %d %v", path, code, result)
				}
				data := result["data"].(map[string]any)
				field := "items"
				if path == "/providers/sdvideo::all" {
					field = "sdvideo_models"
				}
				items := data[field].([]any)
				first := items[0].(map[string]any)
				if first["enabled"] != true || first["available"] != (tc.want25Error == nil) {
					t.Fatalf("incorrect enablement/availability: %v", first)
				}
				if tc.want25Error != nil && first["creation_disabled_reason"] != tc.want25Error.Error() {
					t.Fatalf("missing diagnostic: %v", first)
				}
				if field == "sdvideo_models" && first["credentials_configured"] != true {
					t.Fatal("gateway block was reported as missing credentials")
				}
				if items[2].(map[string]any)["available"] != false {
					t.Fatal("allowlist re-enabled an upstream unavailable model")
				}
			}
			for _, request := range []struct {
				path, body  string
				successCode int
			}{
				{path: "/tasks", body: `{"model":"sdvideo/seedance-2.5","prompt":"pixel art"}`, successCode: 200},
				{path: "/jobs/job_previous/retry", body: `{}`, successCode: 202},
			} {
				code, result := invoke("POST", request.path, request.body)
				wantCode := request.successCode
				if tc.want25Error != nil {
					wantCode = 403
				}
				if tc.want25Error == sdvideo.ErrCreationDisabled {
					wantCode = 503
				}
				if code != wantCode {
					t.Fatalf("%s: %d %v, want %d", request.path, code, result, wantCode)
				}
				if code == 403 && (result["error"] != tc.want25Error.Error() || result["request_id"] != "req-policy" || result["success"] != false) {
					t.Fatalf("missing rejection envelope: %v", result)
				}
			}
			rows, err := jobs.ListForUser("owner")
			if err != nil {
				t.Fatal(err)
			}
			wantJobs := 1
			if tc.want25Error == nil {
				wantJobs = 3
			}
			if len(rows) != wantJobs {
				t.Fatalf("persisted jobs = %d, want %d", len(rows), wantJobs)
			}
		})
	}
}
