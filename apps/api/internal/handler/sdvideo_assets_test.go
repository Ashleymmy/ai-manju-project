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

func TestSDVideoAssetCompatibilityUsesScopedQueries(t *testing.T) {
	_, private, _ := ed25519.GenerateKey(rand.Reader)
	paths := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.RequestURI())
		var data any = map[string]any{"id": "last", "kind": "image", "status": "active", "tags": []string{"tag-last"}, "tag_details": []any{map[string]any{"id": "tag-last", "name": "tag"}}}
		switch r.URL.Path {
		case "/v1/volcano/assets":
			if r.URL.Query().Get("offset") != "17" || r.URL.Query().Get("status") != "active" || r.URL.Query().Get("keyword") != "needle" {
				t.Error("query translation failed", r.URL)
			}
			data = map[string]any{"items": []any{data}, "total": 90, "offset": 17, "limit": 13}
		case "/v1/volcano/ensure-active":
			if r.Method != "POST" {
				t.Error("must use scoped reference validation")
			}
			data = map[string]any{"active": true}
		case "/v1/volcano/tags":
			if r.URL.Query().Get("page") == "1" {
				data = map[string]any{"items": []any{map[string]any{"id": "first"}}, "total": 2}
			} else {
				data = map[string]any{"items": []any{map[string]any{"id": "last"}}, "total": 2}
			}
		case "/v1/volcano/assets/last", "/v1/volcano/assets/last/tags/added":
		default:
			t.Error("unexpected remote path", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": data})
	}))
	defer server.Close()
	client := sdvideo.NewClient(config.Config{SDVideoBaseURL: server.URL, SDVideoMode: "active", SDVideoJWTPrivateKey: base64.RawStdEncoding.EncodeToString(private), SDVideoJWTIssuer: "ai-manju-studio", SDVideoJWTAudience: "sd-video", SDVideoRequestTimeoutMilli: 1000})
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, model.User{ID: "owner", Role: model.UserRoleSuperAdmin})
	}, SDVideoAssetCompatibility(client))
	for _, route := range []struct{ method, path string }{{"GET", "/api/admin/seedance-assets/:id"}, {"GET", "/api/ai/seedance-assets/mentions"}, {"POST", "/api/ai/seedance-assets/ensure-active"}, {"GET", "/api/admin/seedance-asset-tags"}, {"POST", "/api/admin/seedance-assets/:id/tags/:tag_id"}} {
		router.Handle(route.method, route.path, func(c *gin.Context) { t.Error("legacy fallback must not execute") })
	}
	request := func(method, path, body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
		}
		return w
	}
	request("GET", "/api/admin/seedance-assets/last", "")
	if len(paths) != 1 || paths[0] != "/v1/volcano/assets/last" {
		t.Fatal("detail still depends on listing", paths)
	}
	w := request("GET", "/api/ai/seedance-assets/mentions?status=Failed&search=needle&limit=13&offset=17", "")
	if !strings.Contains(w.Body.String(), `"total":90`) || !strings.Contains(w.Body.String(), `"name":"tag"`) {
		t.Fatal("lost page count or hydrated tag", w.Body.String())
	}
	request("POST", "/api/ai/seedance-assets/ensure-active", `{"asset_ids":["asset://beyond-first-page"]}`)
	w = request("GET", "/api/admin/seedance-asset-tags", "")
	if !strings.Contains(w.Body.String(), `"id":"last"`) {
		t.Fatal("tag selector silently truncated")
	}
	request("POST", "/api/admin/seedance-assets/last/tags/added", "")
	if paths[len(paths)-1] != "/v1/volcano/assets/last/tags/added" {
		t.Fatal("tag mutation still uses read/replace")
	}
}
