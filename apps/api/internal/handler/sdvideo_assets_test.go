package handler

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/sdvideo"
	"github.com/gin-gonic/gin"
)

func TestUserSDVideoAssetUploadUsesAuthenticatedOwnerAndWorkspace(t *testing.T) {
	_, private, _ := ed25519.GenerateKey(rand.Reader)
	paths := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		parts := strings.Split(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "), ".")
		claimsJSON, _ := base64.RawURLEncoding.DecodeString(parts[1])
		var claims map[string]any
		_ = json.Unmarshal(claimsJSON, &claims)
		if claims["sub"] != "owner" || claims["workspace_id"] != "default:owner" {
			t.Fatal("lost authenticated owner/workspace")
		}
		var data any = map[string]any{}
		switch r.URL.Path {
		case "/v1/inputs/presign":
			data = map[string]any{"upload_token": "inputs/default:owner/owner/reference"}
		case "/v1/inputs/inputs/default:owner/owner/reference":
			body, _ := io.ReadAll(r.Body)
			if string(body) != "reference-image" {
				t.Error("uploaded body changed")
			}
		case "/v1/inputs/complete":
		case "/v1/volcano/assets":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["kind"] != "image" || body["storage_token"] != "inputs/default:owner/owner/reference" {
				t.Error("registration did not use completed input")
			}
			data = map[string]any{"id": "asset-new", "kind": "image", "status": "queued", "upstream_provider": "tokenspace"}
		default:
			t.Error("unexpected route", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": data})
	}))
	defer server.Close()
	client := sdvideo.NewClient(config.Config{SDVideoBaseURL: server.URL, SDVideoMode: "active", SDVideoJWTPrivateKey: base64.RawStdEncoding.EncodeToString(private)})
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set(auth.ContextUserKey, model.User{ID: "owner", Role: model.UserRoleMember}) }, SDVideoAssetCompatibility(client))
	router.POST("/api/ai/seedance-assets/upload", func(c *gin.Context) { t.Error("must not use legacy registration") })
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", `form-data; name="file"; filename="reference.png"`)
	header.Set("Content-Type", "image/png")
	file, _ := form.CreatePart(header)
	_, _ = file.Write([]byte("reference-image"))
	// 浏览器提供的用户/空间字段不能取代经过鉴权的身份。
	_ = form.WriteField("user_id", "other")
	_ = form.WriteField("workspace_id", "other")
	_ = form.Close()
	req := httptest.NewRequest("POST", "/api/ai/seedance-assets/upload?scope=personal", &body)
	req.Header.Set("Content-Type", form.FormDataContentType())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != 200 || len(paths) != 4 || !strings.Contains(w.Body.String(), `"status":"Processing"`) || !strings.Contains(w.Body.String(), `"provider_protocol":"tokenspace_material"`) {
		t.Fatalf("upload not queued correctly: status=%d paths=%v body=%s", w.Code, paths, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "inputs/") {
		t.Error("storage token leaked")
	}
}

func TestSDVideoAssetViewRedactsProviderError(t *testing.T) {
	view := sdVideoAssetView(map[string]any{"id": "one", "kind": "image", "status": "failed", "error": map[string]any{"code": "provider_asset_failed", "message": "https://private.test/?token=hidden"}}, nil, "team")
	if view["error_message"] == "" || strings.Contains(view["error_message"].(string), "hidden") {
		t.Fatal("unsafe error mapping")
	}
	if !strings.HasSuffix(view["source_url"].(string), "?scope=team") {
		t.Fatal("preview scope lost")
	}
}

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
