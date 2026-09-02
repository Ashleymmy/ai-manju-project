package handler

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func TestAnnouncementCurrentReadAndRevoke(t *testing.T) {
	router, _, adminCookie, memberCookie, _ := newAnnouncementTestRouter(t)

	create := performJSON(router, http.MethodPost, "/api/admin/announcements", `{"title":"更新通知","content":"今晚会更新模型配置","kind":"update"}`, adminCookie)
	if create.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", create.Code, create.Body.String())
	}
	announcement := decodeAnnouncement(t, create.Body.String())
	if announcement.Kind != model.SystemAnnouncementKindUpdate || announcement.Status != model.SystemAnnouncementStatusActive {
		t.Fatalf("announcement kind/status = %s/%s", announcement.Kind, announcement.Status)
	}

	current := performJSON(router, http.MethodGet, "/api/announcements/current", "", memberCookie)
	if current.Code != http.StatusOK {
		t.Fatalf("current status = %d, body = %s", current.Code, current.Body.String())
	}
	if !strings.Contains(current.Body.String(), announcement.ID) {
		t.Fatalf("current missing announcement id %s: %s", announcement.ID, current.Body.String())
	}

	read := performJSON(router, http.MethodPost, "/api/announcements/"+announcement.ID+"/read", "", memberCookie)
	if read.Code != http.StatusOK {
		t.Fatalf("read status = %d, body = %s", read.Code, read.Body.String())
	}
	afterRead := performJSON(router, http.MethodGet, "/api/announcements/current", "", memberCookie)
	if afterRead.Code != http.StatusOK {
		t.Fatalf("after read current status = %d", afterRead.Code)
	}
	if !strings.Contains(afterRead.Body.String(), `"data":null`) {
		t.Fatalf("after read current should be null: %s", afterRead.Body.String())
	}

	second := performJSON(router, http.MethodPost, "/api/admin/announcements", `{"title":"维护通知","content":"服务维护","kind":"maintenance"}`, adminCookie)
	if second.Code != http.StatusCreated {
		t.Fatalf("second create status = %d, body = %s", second.Code, second.Body.String())
	}
	secondAnnouncement := decodeAnnouncement(t, second.Body.String())
	memberCurrent := performJSON(router, http.MethodGet, "/api/announcements/current", "", memberCookie)
	if !strings.Contains(memberCurrent.Body.String(), secondAnnouncement.ID) {
		t.Fatalf("member should see new active announcement: %s", memberCurrent.Body.String())
	}

	list := performJSON(router, http.MethodGet, "/api/admin/announcements", "", adminCookie)
	if list.Code != http.StatusOK {
		t.Fatalf("list status = %d, body = %s", list.Code, list.Body.String())
	}
	if !strings.Contains(list.Body.String(), model.SystemAnnouncementStatusRevoked) {
		t.Fatalf("old announcement should be revoked in list: %s", list.Body.String())
	}

	revoke := performJSON(router, http.MethodPost, "/api/admin/announcements/"+secondAnnouncement.ID+"/revoke", "", adminCookie)
	if revoke.Code != http.StatusOK {
		t.Fatalf("revoke status = %d, body = %s", revoke.Code, revoke.Body.String())
	}
	afterRevoke := performJSON(router, http.MethodGet, "/api/announcements/current", "", memberCookie)
	if !strings.Contains(afterRevoke.Body.String(), `"data":null`) {
		t.Fatalf("after revoke current should be null: %s", afterRevoke.Body.String())
	}
}

func TestAnnouncementAuthAndAdminGuards(t *testing.T) {
	router, _, _, memberCookie, disabledCookie := newAnnouncementTestRouter(t)

	anonymous := performJSON(router, http.MethodGet, "/api/announcements/current", "", nil)
	if anonymous.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous current status = %d, want 401", anonymous.Code)
	}

	memberCreate := performJSON(router, http.MethodPost, "/api/admin/announcements", `{"title":"x","content":"y","kind":"notice"}`, memberCookie)
	if memberCreate.Code != http.StatusForbidden {
		t.Fatalf("member create status = %d, want 403", memberCreate.Code)
	}

	memberRepublish := performJSON(router, http.MethodPost, "/api/admin/announcements/announcement_missing/republish", `{"title":"x"}`, memberCookie)
	if memberRepublish.Code != http.StatusForbidden {
		t.Fatalf("member republish status = %d, want 403", memberRepublish.Code)
	}

	disabledCurrent := performJSON(router, http.MethodGet, "/api/announcements/current", "", disabledCookie)
	if disabledCurrent.Code != http.StatusForbidden {
		t.Fatalf("disabled current status = %d, want 403", disabledCurrent.Code)
	}
}

func TestAnnouncementRepublishCreatesNewActiveAnnouncement(t *testing.T) {
	router, _, adminCookie, memberCookie, _ := newAnnouncementTestRouter(t)

	create := performJSON(router, http.MethodPost, "/api/admin/announcements", `{"title":"旧公告","content":"旧内容","kind":"notice"}`, adminCookie)
	if create.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", create.Code, create.Body.String())
	}
	oldAnnouncement := decodeAnnouncement(t, create.Body.String())
	read := performJSON(router, http.MethodPost, "/api/announcements/"+oldAnnouncement.ID+"/read", "", memberCookie)
	if read.Code != http.StatusOK {
		t.Fatalf("read status = %d, body = %s", read.Code, read.Body.String())
	}

	republish := performJSON(router, http.MethodPost, "/api/admin/announcements/"+oldAnnouncement.ID+"/republish", `{"title":"新公告","content":"新内容","kind":"update"}`, adminCookie)
	if republish.Code != http.StatusCreated {
		t.Fatalf("republish status = %d, body = %s", republish.Code, republish.Body.String())
	}
	newAnnouncement := decodeAnnouncement(t, republish.Body.String())
	if newAnnouncement.ID == oldAnnouncement.ID {
		t.Fatalf("republish reused original id")
	}
	if newAnnouncement.Title != "新公告" || newAnnouncement.Content != "新内容" || newAnnouncement.Kind != model.SystemAnnouncementKindUpdate {
		t.Fatalf("republish content mismatch: %+v", newAnnouncement)
	}

	current := performJSON(router, http.MethodGet, "/api/announcements/current", "", memberCookie)
	if current.Code != http.StatusOK {
		t.Fatalf("current status = %d, body = %s", current.Code, current.Body.String())
	}
	if !strings.Contains(current.Body.String(), newAnnouncement.ID) {
		t.Fatalf("new announcement should be unread even after old read: %s", current.Body.String())
	}

	list := performJSON(router, http.MethodGet, "/api/admin/announcements", "", adminCookie)
	if list.Code != http.StatusOK {
		t.Fatalf("list status = %d, body = %s", list.Code, list.Body.String())
	}
	if !strings.Contains(list.Body.String(), oldAnnouncement.ID) || !strings.Contains(list.Body.String(), model.SystemAnnouncementStatusRevoked) {
		t.Fatalf("old announcement should remain as revoked history: %s", list.Body.String())
	}
}

func TestAnnouncementSSEPublishedAndRevokedEvents(t *testing.T) {
	repo := repository.NewMemoryAnnouncementRepository()
	handler := NewAnnouncementHandler(repo)
	router := gin.New()
	router.GET("/stream", handler.Stream)

	ctx, cancel := context.WithCancel(context.Background())
	request := httptest.NewRequest(http.MethodGet, "/stream", nil).WithContext(ctx)
	recorder := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		router.ServeHTTP(recorder, request)
		close(done)
	}()

	waitForSubscriber(t, handler.hub)
	announcement, err := repo.CreateAnnouncement(model.SystemAnnouncement{
		ID:          "announcement_sse",
		Title:       "更新",
		Content:     "发布事件",
		Kind:        model.SystemAnnouncementKindNotice,
		Status:      model.SystemAnnouncementStatusActive,
		CreatedBy:   "user_admin",
		PublishedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	handler.hub.Broadcast(AnnouncementEvent{Type: announcementEventPublished, Announcement: &announcement, ID: announcement.ID})
	revoked, err := repo.RevokeAnnouncement(announcement.ID)
	if err != nil {
		t.Fatal(err)
	}
	handler.hub.Broadcast(AnnouncementEvent{Type: announcementEventRevoked, Announcement: &revoked, ID: revoked.ID})

	waitForSSEBody(t, recorder, "announcement.revoked")
	request.Context().Done()
	body := recorder.Body.String()
	if !strings.Contains(body, "event: announcement.published") || !strings.Contains(body, "event: announcement.revoked") {
		t.Fatalf("SSE body missing expected events: %s", body)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("SSE stream did not stop after context cancel")
	}
}

func TestAnnouncementRepublishBroadcastsPublishedEvent(t *testing.T) {
	repo := repository.NewMemoryAnnouncementRepository()
	handler := NewAnnouncementHandler(repo)
	router := gin.New()
	router.GET("/stream", handler.Stream)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request := httptest.NewRequest(http.MethodGet, "/stream", nil).WithContext(ctx)
	recorder := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		router.ServeHTTP(recorder, request)
		close(done)
	}()

	waitForSubscriber(t, handler.hub)
	source, err := repo.CreateAnnouncement(model.SystemAnnouncement{
		ID:          "announcement_source",
		Title:       "旧公告",
		Content:     "旧内容",
		Kind:        model.SystemAnnouncementKindNotice,
		Status:      model.SystemAnnouncementStatusActive,
		CreatedBy:   "user_admin",
		PublishedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	republished, err := repo.RepublishAnnouncement(source.ID, model.SystemAnnouncement{
		ID:          "announcement_republished",
		Title:       "新公告",
		Content:     "新内容",
		Kind:        model.SystemAnnouncementKindUpdate,
		Status:      model.SystemAnnouncementStatusActive,
		CreatedBy:   "user_admin",
		PublishedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	handler.hub.Broadcast(AnnouncementEvent{Type: announcementEventPublished, Announcement: &republished, ID: republished.ID})

	waitForSSEBody(t, recorder, "announcement_republished")
	body := recorder.Body.String()
	if !strings.Contains(body, "event: announcement.published") || !strings.Contains(body, "announcement_republished") {
		t.Fatalf("republish SSE body missing published event: %s", body)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("SSE stream did not stop after context cancel")
	}
}

func newAnnouncementTestRouter(t *testing.T) (*gin.Engine, repository.AnnouncementRepository, *http.Cookie, *http.Cookie, *http.Cookie) {
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
	disabledRawToken := "disabled-session-token"
	if _, err := userRepo.CreateSession(model.Session{
		ID:        authService.SessionID(disabledRawToken),
		UserID:    "user_disabled",
		ExpiresAt: time.Now().UTC().Add(auth.DefaultSessionTTL),
	}); err != nil {
		t.Fatal(err)
	}
	for _, user := range []model.User{
		{ID: "user_member", Username: "member", PasswordHash: memberHash, DisplayName: "Member", Role: model.UserRoleMember, Status: model.UserStatusActive},
		{ID: "user_disabled", Username: "disabled", PasswordHash: memberHash, DisplayName: "Disabled", Role: model.UserRoleMember, Status: model.UserStatusDisabled},
	} {
		if _, err := userRepo.CreateUser(user); err != nil {
			t.Fatal(err)
		}
	}

	announcementRepo := repository.NewMemoryAnnouncementRepository()
	announcementHandler := NewAnnouncementHandler(announcementRepo)
	authHandler := NewAuthHandler(authService, userRepo, cfg)
	router := gin.New()
	router.Use(middleware.RequestID())
	api := router.Group("/api")
	api.POST("/auth/login", authHandler.Login)
	api.GET("/announcements/current", middleware.RequireAuth(authService), announcementHandler.Current)
	api.POST("/announcements/:id/read", middleware.RequireAuth(authService), announcementHandler.MarkRead)
	admin := api.Group("/admin", middleware.RequireSuperAdmin(authService))
	admin.GET("/announcements", announcementHandler.AdminList)
	admin.POST("/announcements", announcementHandler.AdminCreate)
	admin.POST("/announcements/:id/republish", announcementHandler.AdminRepublish)
	admin.POST("/announcements/:id/revoke", announcementHandler.AdminRevoke)

	disabledCookie := &http.Cookie{Name: auth.CookieName, Value: disabledRawToken, Path: "/"}
	return router, announcementRepo, loginCookie(t, router, "admin", "secret"), loginCookie(t, router, "member", "secret"), disabledCookie
}

func decodeAnnouncement(t *testing.T, body string) model.SystemAnnouncement {
	t.Helper()
	var payload struct {
		Success bool                     `json:"success"`
		Data    model.SystemAnnouncement `json:"data"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		t.Fatalf("decode announcement failed: %v; body = %s", err, body)
	}
	if !payload.Success || payload.Data.ID == "" {
		t.Fatalf("announcement missing in body: %s", body)
	}
	return payload.Data
}

func waitForSubscriber(t *testing.T, hub *AnnouncementHub) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		hub.mu.RLock()
		count := len(hub.clients)
		hub.mu.RUnlock()
		if count > 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("SSE subscriber did not connect")
}

func waitForSSEBody(t *testing.T, recorder *httptest.ResponseRecorder, token string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(recorder.Body.String(), token) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	scanner := bufio.NewScanner(strings.NewReader(recorder.Body.String()))
	lines := make([]string, 0)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	t.Fatalf("SSE body did not contain %q; lines = %v", token, lines)
}
