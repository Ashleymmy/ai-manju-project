package handler

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/middleware"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

// Use the public collection path with real session authentication in these HTTP tests.
const analysisDiscoveryTestPath = "/api/comic-asset-analysis-sessions"

type unavailableDiscoveryRepository struct {
	repository.ComicAssetRepository
}

func (r unavailableDiscoveryRepository) ListAnalysisSessions(repository.ComicAnalysisListFilter) ([]model.ComicAssetAnalysisSession, error) {
	return nil, errors.New("database private-connection-marker password=private-password-marker source=private-script-marker")
}

func TestComicAnalysisDiscoveryHTTPDatabaseFailureIsPrivate(t *testing.T) {
	r, _ := receiptTestRouter(t, func(c *gin.Context) {})
	repo := unavailableDiscoveryRepository{repository.NewMemoryComicAssetRepository()}
	h := NewComicAssetHandler(service.NewComicAssetService(repo, nil))
	r.GET(analysisDiscoveryTestPath, h.ListAnalysisSessions)
	rec := receiptRequest(r, http.MethodGet, analysisDiscoveryTestPath, "", "", "owner")
	if rec.Code != http.StatusServiceUnavailable || rec.Header().Get("Cache-Control") != "no-store" || strings.Contains(rec.Body.String(), "private-") {
		t.Fatalf("unsafe discovery failure: status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func newAnalysisDiscoveryTestRouter(t *testing.T) (*gin.Engine, *repository.MemoryComicAssetRepository) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	users := repository.NewMemoryUserRepository()
	authService := auth.NewService(users, config.Config{})
	for _, id := range []string{"owner", "other", "empty", "disabled"} {
		status := model.UserStatusActive
		if id == "disabled" {
			status = model.UserStatusDisabled
		}
		if _, err := users.CreateUser(model.User{ID: id, Username: id, Role: model.UserRoleMember, Status: status}); err != nil {
			t.Fatal(err)
		}
		if _, err := users.CreateSession(model.Session{ID: authService.SessionID("test-token-" + id), UserID: id, ExpiresAt: time.Now().Add(time.Hour)}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := users.CreateSession(model.Session{ID: authService.SessionID("test-token-expired"), UserID: "owner", ExpiresAt: time.Now().Add(-time.Hour)}); err != nil {
		t.Fatal(err)
	}
	repo := repository.NewMemoryComicAssetRepository()
	h := NewComicAssetHandler(service.NewComicAssetService(repo, nil))
	r := gin.New()
	r.Use(middleware.RequestID())
	r.GET(analysisDiscoveryTestPath, middleware.RequireAuth(authService), h.ListAnalysisSessions)
	return r, repo
}

func analysisDiscoveryRequest(r http.Handler, query, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, analysisDiscoveryTestPath+query, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func seedAnalysisDiscoverySession(t *testing.T, repo *repository.MemoryComicAssetRepository, id, owner, scope string) {
	t.Helper()
	_, err := repo.CreatePendingAnalysisSession(model.ComicAssetAnalysisSession{
		ID: id, OwnerID: owner, WorkspaceID: service.WorkspaceIDForScope(scope, owner),
		Title: "Saved " + id, SourceFileName: id + ".txt", Status: model.ComicAnalysisStatusProcessing,
		ExpiresAt: time.Now().Add(time.Hour), SourceText: "private-script-marker",
		SourceStorageKey: "private-storage-marker", AnalysisReceiptKey: "private-receipt-marker",
		AnalysisError: "private-provider-error-marker", DefaultTemplates: model.JSONB(`{"character":"private-template-marker"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
}

func decodeAnalysisDiscovery(t *testing.T, rec *httptest.ResponseRecorder) service.ComicAnalysisDiscovery {
	t.Helper()
	if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("status=%d cache=%q body=%s", rec.Code, rec.Header().Get("Cache-Control"), rec.Body.String())
	}
	var envelope struct {
		Success bool                           `json:"success"`
		Data    service.ComicAnalysisDiscovery `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if !envelope.Success || envelope.Data.Items == nil {
		t.Fatalf("expected successful array response: %s", rec.Body.String())
	}
	return envelope.Data
}

func TestComicAnalysisDiscoveryHTTPAuthentication(t *testing.T) {
	r, repo := newAnalysisDiscoveryTestRouter(t)
	seedAnalysisDiscoverySession(t, repo, "private-analysis", "owner", service.WorkspaceScopePersonal)
	for _, tc := range []struct {
		name, token string
		status      int
	}{
		{"missing", "", http.StatusUnauthorized},
		{"invalid", "not-a-session", http.StatusUnauthorized},
		{"expired", "test-token-expired", http.StatusUnauthorized},
		{"disabled", "test-token-disabled", http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := analysisDiscoveryRequest(r, "?scope=personal&user_id=owner", tc.token)
			var envelope struct {
				Success   bool            `json:"success"`
				Error     string          `json:"error"`
				RequestID string          `json:"request_id"`
				Data      json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
				t.Fatal(err)
			}
			if rec.Code != tc.status || envelope.Success || envelope.Error == "" || envelope.RequestID == "" || len(envelope.Data) != 0 {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), "private-analysis") {
				t.Fatal("unauthenticated response disclosed analysis metadata")
			}
		})
	}
}

func TestComicAnalysisDiscoveryHTTPOwnerWorkspaceIsolationAndSafeSummary(t *testing.T) {
	r, repo := newAnalysisDiscoveryTestRouter(t)
	for _, owner := range []string{"owner", "other"} {
		for _, scope := range []string{service.WorkspaceScopePersonal, service.WorkspaceScopeTeam} {
			seedAnalysisDiscoverySession(t, repo, owner+"-"+scope, owner, scope)
		}
	}
	for _, tc := range []struct {
		name, actor, query, wantID string
	}{
		{"default personal", "owner", "", "owner-personal"},
		{"personal", "owner", "?scope=personal", "owner-personal"},
		{"shared workspace owner", "owner", "?scope=team", "owner-team"},
		{"shared workspace other", "other", "?scope=team", "other-team"},
		{"other personal", "other", "?scope=personal", "other-personal"},
		{"query cannot select owner or workspace", "owner", "?scope=personal&user_id=other&owner_id=other&workspace_id=team:default", "owner-personal"},
		{"empty user", "empty", "?scope=team", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := analysisDiscoveryRequest(r, tc.query, "test-token-"+tc.actor)
			page := decodeAnalysisDiscovery(t, rec)
			if tc.wantID == "" {
				if len(page.Items) != 0 || page.NextCursor != "" {
					t.Fatalf("empty user received foreign records: %+v", page)
				}
				return
			}
			if len(page.Items) != 1 || page.Items[0].ID != tc.wantID || page.NextCursor != "" {
				t.Fatalf("want only %q, got %+v", tc.wantID, page)
			}
			var raw struct {
				Data struct {
					Items []map[string]json.RawMessage `json:"items"`
				} `json:"data"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
				t.Fatal(err)
			}
			allowed := map[string]bool{"id": true, "title": true, "source_file_name": true, "status": true, "created_at": true, "expires_at": true}
			if len(raw.Data.Items[0]) != len(allowed) {
				t.Fatalf("unexpected summary fields: %s", rec.Body.String())
			}
			for field := range raw.Data.Items[0] {
				if !allowed[field] {
					t.Errorf("summary exposed field %q", field)
				}
			}
			if strings.Contains(rec.Body.String(), "private-") {
				t.Fatalf("summary disclosed private values: %s", rec.Body.String())
			}
		})
	}
}

func TestComicAnalysisDiscoveryHTTPPaginationAndCursorErrors(t *testing.T) {
	r, repo := newAnalysisDiscoveryTestRouter(t)
	for i := 0; i <= service.ComicAnalysisDiscoveryPageSize; i++ {
		seedAnalysisDiscoverySession(t, repo, fmt.Sprintf("analysis-%02d", i), "owner", service.WorkspaceScopeTeam)
	}
	seedAnalysisDiscoverySession(t, repo, "foreign-personal", "owner", service.WorkspaceScopePersonal)
	seedAnalysisDiscoverySession(t, repo, "foreign-user", "other", service.WorkspaceScopeTeam)
	first := decodeAnalysisDiscovery(t, analysisDiscoveryRequest(r, "?scope=team", "test-token-owner"))
	if len(first.Items) != service.ComicAnalysisDiscoveryPageSize || first.NextCursor == "" {
		t.Fatalf("missing bounded page or continuation: %+v", first)
	}
	second := decodeAnalysisDiscovery(t, analysisDiscoveryRequest(r, "?scope=team&cursor="+url.QueryEscape(first.NextCursor), "test-token-owner"))
	if len(second.Items) != 1 || second.NextCursor != "" {
		t.Fatalf("incorrect continuation: %+v", second)
	}
	seen := map[string]bool{}
	for _, item := range append(first.Items, second.Items...) {
		if seen[item.ID] || strings.HasPrefix(item.ID, "foreign-") {
			t.Fatalf("duplicate or foreign analysis on paginated response: %s", item.ID)
		}
		seen[item.ID] = true
	}
	// An opaque cursor is only a position, never proof of the requesting user's identity.
	foreign := decodeAnalysisDiscovery(t, analysisDiscoveryRequest(r, "?scope=team&cursor="+url.QueryEscape(first.NextCursor), "test-token-other"))
	for _, item := range foreign.Items {
		if item.ID != "foreign-user" {
			t.Fatalf("another user's cursor leaked %s", item.ID)
		}
	}
	for _, tc := range []struct{ name, cursor string }{
		{"invalid base64", "%!"},
		{"invalid json", base64.RawURLEncoding.EncodeToString([]byte("not-json"))},
		{"missing position", base64.RawURLEncoding.EncodeToString([]byte(`{}`))},
		{"missing id", base64.RawURLEncoding.EncodeToString([]byte(`{"created_at":"2026-01-01T00:00:00Z"}`))},
		{"invalid timestamp", base64.RawURLEncoding.EncodeToString([]byte(`{"created_at":"invalid","id":"analysis"}`))},
		{"oversized", strings.Repeat("x", 4096)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := analysisDiscoveryRequest(r, "?scope=team&cursor="+url.QueryEscape(tc.cursor), "test-token-owner")
			var envelope struct {
				Success   bool            `json:"success"`
				Error     string          `json:"error"`
				RequestID string          `json:"request_id"`
				Data      json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
				t.Fatal(err)
			}
			if rec.Code != http.StatusBadRequest || rec.Header().Get("Cache-Control") != "no-store" || envelope.Success || envelope.Error == "" || envelope.RequestID == "" || len(envelope.Data) != 0 {
				t.Fatalf("status=%d cache=%q body=%s", rec.Code, rec.Header().Get("Cache-Control"), rec.Body.String())
			}
		})
	}
}
