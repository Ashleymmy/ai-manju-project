package handler

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/sdvideo"
	"github.com/gin-gonic/gin"
)

func TestSDVideoGroupKeepsModelsAndReadinessDistinct(t *testing.T) {
	group := sdVideoProviderGroup([]map[string]any{
		{"key": "seedance-2.0", "id": "same-id", "name": "Seedance 2.0", "enabled": false, "available": false, "version": 3, "concurrency_limit": 2},
		{"key": "seedance-2.0-ark", "id": "same-id", "name": "Official", "enabled": true, "available": false, "version": 7, "concurrency_limit": 1, "upstream_provider": "ark_official", "disabled_reason": "provider_credentials_missing"},
	})
	if group["id"] != "sdvideo::all" || group["name"] != "sdvideo" || group["enabled"] != true || group["enabled_model_count"] != 1 || group["api_key_set"] != false {
		t.Fatalf("invalid group: %+v", group)
	}
	models := group["sdvideo_models"].([]gin.H)
	if len(models) != 2 || models[0]["key"] == models[1]["key"] || models[1]["credentials_configured"] != false {
		t.Fatal("group must retain logical slots and credential readiness")
	}
}

func TestSDVideoGroupUpdateUsesOneAtomicRequestAndPreservesLegacyRoute(t *testing.T) {
	t.Setenv("SD_VIDEO_ALLOWED_MODELS", "seedance-2.0")
	_, private, _ := ed25519.GenerateKey(rand.Reader)
	writes := 0
	items := []map[string]any{
		{"key": "seedance-2.0", "id": "same-id", "name": "Seedance", "enabled": false, "version": 3, "concurrency_limit": 2},
		{"key": "seedance-2.0-ark", "id": "same-id", "name": "Official", "enabled": true, "version": 7, "concurrency_limit": 1},
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/admin/models" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Method == http.MethodPut {
			writes++
			var payload struct {
				Items []map[string]any `json:"items"`
			}
			if json.NewDecoder(r.Body).Decode(&payload) != nil || len(payload.Items) != 2 {
				t.Fatal("invalid batch")
			}
			for _, item := range payload.Items {
				if item["enabled"] != false || item["version"] == nil {
					t.Error("lost enablement or concurrency version")
				}
			}
		}
		_ = json.NewEncoder(w).Encode(gin.H{"success": true, "data": gin.H{"items": items}})
	}))
	defer server.Close()
	h := &ModelProviderHandler{sdVideo: sdvideo.NewClient(config.Config{SDVideoBaseURL: server.URL, SDVideoMode: "active", SDVideoJWTPrivateKey: base64.RawStdEncoding.EncodeToString(private)})}
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, model.User{ID: "admin", Role: model.UserRoleSuperAdmin})
	})
	router.GET("/providers/:id", func(c *gin.Context) { h.handleSDVideoModel(c, "get") })
	router.PUT("/providers/:id", func(c *gin.Context) { h.handleSDVideoModel(c, "update") })
	body := `{"base_url":"sd-video://managed","sdvideo_models":[{"key":"seedance-2.0","name":"Seedance","model_id":"same-id","enabled":false,"version":3,"concurrency_limit":2},{"key":"seedance-2.0-ark","name":"Official","model_id":"same-id","enabled":false,"version":7,"concurrency_limit":1}]}`
	invoke := func(method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		return out
	}
	if out := invoke("GET", "/providers/sdvideo::seedance-2.0", ""); out.Code != 200 || !strings.Contains(out.Body.String(), `"id":"sdvideo::seedance-2.0"`) {
		t.Fatal("legacy model route changed")
	}
	if out := invoke("PUT", "/providers/sdvideo::all", body); out.Code != 200 || writes != 1 || !strings.Contains(out.Body.String(), `"name":"sdvideo"`) {
		t.Fatalf("atomic group update failed: %d %s", out.Code, out.Body.String())
	} else if strings.Contains(out.Body.String(), "SD_VIDEO_ALLOWED_MODELS") {
		t.Fatal("legacy model allowlist must not restrict managed model settings")
	}
	invalid := strings.Replace(body, `"key":"seedance-2.0-ark"`, `"key":"seedance-2.0"`, 1)
	if out := invoke("PUT", "/providers/sdvideo::all", invalid); out.Code != 400 || writes != 1 {
		t.Fatal("duplicate model caused remote mutation")
	}
	documentBody := `{"base_url":"sd-video://managed","config_document":{"schema_version":1,"adapter":"sdvideo","config":` + strings.Replace(body, `"base_url":"sd-video://managed",`, "", 1) + `}}`
	if out := invoke("PUT", "/providers/sdvideo::all", documentBody); out.Code != 200 || writes != 2 {
		t.Fatalf("document did not use atomic model update: %d %s", out.Code, out.Body.String())
	}
	wrongChannel := strings.Replace(documentBody, `"name":"Seedance"`, `"name":"Seedance","upstream_provider":"tokenspace"`, 1)
	if out := invoke("PUT", "/providers/sdvideo::all", wrongChannel); out.Code != 400 || writes != 2 {
		t.Fatal("document changed a model's asset-registration channel")
	}
}
