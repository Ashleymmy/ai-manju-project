package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/middleware"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/gin-gonic/gin"
)

func TestUserPreferenceDefaultsSaveAndIsolation(t *testing.T) {
	router, _, memberCookie, otherCookie, _ := newUserPreferenceTestRouter(t)

	defaults := performJSON(router, http.MethodGet, "/api/user/preferences", "", memberCookie)
	if defaults.Code != http.StatusOK {
		t.Fatalf("defaults status = %d, body = %s", defaults.Code, defaults.Body.String())
	}
	memberDefaults := decodeUserPreferences(t, defaults.Body.String())
	if memberDefaults.Generation["quality"] != "auto" || memberDefaults.Canvas["middleButtonLockHint"] != true {
		t.Fatalf("defaults mismatch: %+v", memberDefaults)
	}
	if presets, ok := memberDefaults.Canvas["promptPresets"].([]any); !ok || len(presets) != 0 {
		t.Fatalf("default prompt presets mismatch: %+v", memberDefaults.Canvas["promptPresets"])
	}

	save := performJSON(router, http.MethodPut, "/api/user/preferences", `{
		"generation":{"size":"16:9","count":"4","systemPrompt":"保持镜头连续","apiKey":"should-not-save"},
		"shortcuts":{"delete":["X","X","Delete"],"runSelection":["Ctrl+Enter"],"bad":"Ctrl+B"},
		"canvas":{"backgroundMode":"dots","wheelZoomRequiresCtrl":false,"webdavPassword":"secret","promptPresets":[{"id":"preset-1","title":"电影感","prompt":"cinematic light","tags":["cinematic","portrait"],"priority":"high","sort_order":7,"createdAt":"2026-07-03T00:00:00.000Z","updatedAt":"2026-07-03T00:00:00.000Z"},{"id":"","title":"bad","prompt":"bad"}]}
	}`, memberCookie)
	if save.Code != http.StatusOK {
		t.Fatalf("save status = %d, body = %s", save.Code, save.Body.String())
	}
	saved := decodeUserPreferences(t, save.Body.String())
	if saved.Generation["size"] != "16:9" || saved.Generation["count"] != "4" || saved.Generation["systemPrompt"] != "保持镜头连续" {
		t.Fatalf("saved generation mismatch: %+v", saved.Generation)
	}
	if _, ok := saved.Generation["apiKey"]; ok {
		t.Fatalf("sensitive generation field should be ignored: %+v", saved.Generation)
	}
	if saved.Canvas["backgroundMode"] != "dots" || saved.Canvas["wheelZoomRequiresCtrl"] != false {
		t.Fatalf("saved canvas mismatch: %+v", saved.Canvas)
	}
	if _, ok := saved.Canvas["webdavPassword"]; ok {
		t.Fatalf("sensitive canvas field should be ignored: %+v", saved.Canvas)
	}
	presets, ok := saved.Canvas["promptPresets"].([]any)
	if !ok || len(presets) != 1 {
		t.Fatalf("prompt presets should be saved and sanitized: %+v", saved.Canvas["promptPresets"])
	}
	preset, ok := presets[0].(map[string]any)
	if !ok || preset["id"] != "preset-1" || preset["prompt"] != "cinematic light" || preset["priority"] != "high" || preset["sort_order"] != float64(7) {
		t.Fatalf("prompt preset payload mismatch: %+v", presets[0])
	}
	deleteKeys, ok := saved.Shortcuts["delete"].([]any)
	if !ok || len(deleteKeys) != 2 || deleteKeys[0] != "X" || deleteKeys[1] != "Delete" {
		t.Fatalf("shortcuts should be normalized and deduplicated: %+v", saved.Shortcuts)
	}

	again := performJSON(router, http.MethodGet, "/api/user/preferences", "", memberCookie)
	if again.Code != http.StatusOK {
		t.Fatalf("again status = %d, body = %s", again.Code, again.Body.String())
	}
	if !strings.Contains(again.Body.String(), "保持镜头连续") {
		t.Fatalf("saved preference missing on next read: %s", again.Body.String())
	}

	other := performJSON(router, http.MethodGet, "/api/user/preferences", "", otherCookie)
	if other.Code != http.StatusOK {
		t.Fatalf("other status = %d, body = %s", other.Code, other.Body.String())
	}
	otherPreferences := decodeUserPreferences(t, other.Body.String())
	if otherPreferences.Generation["systemPrompt"] == "保持镜头连续" || otherPreferences.Generation["size"] == "16:9" {
		t.Fatalf("preferences leaked across users: %+v", otherPreferences.Generation)
	}
	if otherPresets, ok := otherPreferences.Canvas["promptPresets"].([]any); !ok || len(otherPresets) != 0 {
		t.Fatalf("prompt presets leaked across users: %+v", otherPreferences.Canvas)
	}
}

func TestUserPreferenceAuthGuards(t *testing.T) {
	router, _, _, _, disabledCookie := newUserPreferenceTestRouter(t)

	anonymous := performJSON(router, http.MethodGet, "/api/user/preferences", "", nil)
	if anonymous.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous status = %d, want 401; body = %s", anonymous.Code, anonymous.Body.String())
	}

	disabled := performJSON(router, http.MethodGet, "/api/user/preferences", "", disabledCookie)
	if disabled.Code != http.StatusForbidden {
		t.Fatalf("disabled status = %d, want 403; body = %s", disabled.Code, disabled.Body.String())
	}
}

func TestSanitizePromptPresetsCapsLengthsAndDedupes(t *testing.T) {
	items := make([]any, 0, maxPromptPresetCount+5)
	for i := 0; i < maxPromptPresetCount+5; i++ {
		tags := make([]any, 0, maxPromptPresetTagCount+3)
		for tagIndex := 0; tagIndex < maxPromptPresetTagCount+2; tagIndex++ {
			tags = append(tags, fmt.Sprintf("tag-%02d-%s", tagIndex, strings.Repeat("x", maxPromptPresetTagLength+10)))
		}
		tags = append(tags, tags[0], "", 7)
		items = append(items, map[string]any{
			"id":        fmt.Sprintf("preset-%03d-%s", i, strings.Repeat("x", maxPromptPresetIDLength+10)),
			"title":     strings.Repeat("title", maxPromptPresetTitleLength),
			"prompt":    strings.Repeat("prompt", maxPromptPresetPromptLength),
			"tags":      tags,
			"createdAt": strings.Repeat("2", maxPromptPresetTimestampLength+10),
			"updatedAt": strings.Repeat("3", maxPromptPresetTimestampLength+10),
		})
	}

	presets, ok := sanitizePromptPresets(items)
	if !ok {
		t.Fatal("prompt presets should be accepted")
	}
	if len(presets) != maxPromptPresetCount {
		t.Fatalf("preset count = %d, want %d", len(presets), maxPromptPresetCount)
	}
	first, ok := presets[0].(map[string]any)
	if !ok {
		t.Fatalf("preset payload type mismatch: %+v", presets[0])
	}
	for key, limit := range map[string]int{
		"id":        maxPromptPresetIDLength,
		"title":     maxPromptPresetTitleLength,
		"prompt":    maxPromptPresetPromptLength,
		"createdAt": maxPromptPresetTimestampLength,
		"updatedAt": maxPromptPresetTimestampLength,
	} {
		value, _ := first[key].(string)
		if len([]rune(value)) > limit {
			t.Fatalf("%s length = %d, want <= %d", key, len([]rune(value)), limit)
		}
	}
	tags, ok := first["tags"].([]any)
	if !ok || len(tags) != maxPromptPresetTagCount {
		t.Fatalf("tags should be capped, trimmed, and deduped: %+v", first["tags"])
	}
	if len([]rune(tags[0].(string))) > maxPromptPresetTagLength {
		t.Fatalf("tag length = %d, want <= %d", len([]rune(tags[0].(string))), maxPromptPresetTagLength)
	}
	if first["priority"] != "normal" || first["sort_order"] != 0 {
		t.Fatalf("legacy preset should migrate to normal priority in source order: %+v", first)
	}
}

func newUserPreferenceTestRouter(t *testing.T) (*gin.Engine, repository.UserPreferenceRepository, *http.Cookie, *http.Cookie, *http.Cookie) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	userRepo := repository.NewMemoryUserRepository()
	cfg := config.Config{AdminUsername: "admin", AdminPassword: "secret", AdminDisplayName: "Admin", AllowPublicSignup: true}
	authService := auth.NewService(userRepo, cfg)
	if err := authService.SeedSuperAdmin(cfg); err != nil {
		t.Fatal(err)
	}
	memberHash, err := auth.HashPassword("secret")
	if err != nil {
		t.Fatal(err)
	}
	for _, user := range []model.User{
		{ID: "user_member", Username: "member", PasswordHash: memberHash, DisplayName: "Member", Role: model.UserRoleMember, Status: model.UserStatusActive},
		{ID: "user_other", Username: "other", PasswordHash: memberHash, DisplayName: "Other", Role: model.UserRoleMember, Status: model.UserStatusActive},
		{ID: "user_disabled", Username: "disabled", PasswordHash: memberHash, DisplayName: "Disabled", Role: model.UserRoleMember, Status: model.UserStatusDisabled},
	} {
		if _, err := userRepo.CreateUser(user); err != nil {
			t.Fatal(err)
		}
	}

	disabledRawToken := "disabled-preference-token"
	if _, err := userRepo.CreateSession(model.Session{
		ID:        authService.SessionID(disabledRawToken),
		UserID:    "user_disabled",
		ExpiresAt: time.Now().UTC().Add(auth.DefaultSessionTTL),
	}); err != nil {
		t.Fatal(err)
	}

	preferenceRepo := repository.NewMemoryUserPreferenceRepository()
	preferenceHandler := NewUserPreferenceHandler(preferenceRepo)
	authHandler := NewAuthHandler(authService, userRepo, cfg)
	router := gin.New()
	router.Use(middleware.RequestID())
	api := router.Group("/api")
	api.POST("/auth/login", authHandler.Login)
	userRoutes := api.Group("/user", middleware.RequireAuth(authService))
	userRoutes.GET("/preferences", preferenceHandler.Get)
	userRoutes.PUT("/preferences", preferenceHandler.Put)

	disabledCookie := &http.Cookie{Name: auth.CookieName, Value: disabledRawToken, Path: "/"}
	return router, preferenceRepo, loginCookie(t, router, "member", "secret"), loginCookie(t, router, "other", "secret"), disabledCookie
}

func decodeUserPreferences(t *testing.T, body string) UserPreferences {
	t.Helper()
	var payload struct {
		Success bool            `json:"success"`
		Data    UserPreferences `json:"data"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		t.Fatalf("decode user preferences failed: %v; body = %s", err, body)
	}
	if !payload.Success {
		t.Fatalf("preferences response not successful: %s", body)
	}
	return payload.Data
}
