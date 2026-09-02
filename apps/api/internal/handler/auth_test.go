package handler

import (
	"encoding/json"
	"errors"
	"fmt"
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

func TestAuthLoginMeAndLogout(t *testing.T) {
	router, _, _ := newAuthTestRouter(t)

	login := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"username":"admin","password":"secret"}`))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(login, req)
	if login.Code != http.StatusOK {
		t.Fatalf("login status = %d, body = %s", login.Code, login.Body.String())
	}
	cookie := findSessionCookie(t, login.Result().Cookies())
	if !cookie.HttpOnly {
		t.Fatalf("session cookie is not HttpOnly")
	}
	token := loginToken(t, login.Body.String())

	me := httptest.NewRecorder()
	meReq := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	meReq.AddCookie(cookie)
	router.ServeHTTP(me, meReq)
	if me.Code != http.StatusOK {
		t.Fatalf("me status = %d, body = %s", me.Code, me.Body.String())
	}

	bearerMe := httptest.NewRecorder()
	bearerMeReq := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	bearerMeReq.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(bearerMe, bearerMeReq)
	if bearerMe.Code != http.StatusOK {
		t.Fatalf("bearer me status = %d, body = %s", bearerMe.Code, bearerMe.Body.String())
	}

	staleBearerWithCookie := performJSONWithBearer(router, http.MethodGet, "/api/auth/me", "", cookie, "stale-token")
	if staleBearerWithCookie.Code != http.StatusOK {
		t.Fatalf("stale bearer with valid cookie status = %d, want 200; body = %s", staleBearerWithCookie.Code, staleBearerWithCookie.Body.String())
	}

	bearerLogout := httptest.NewRecorder()
	bearerLogoutReq := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	bearerLogoutReq.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(bearerLogout, bearerLogoutReq)
	if bearerLogout.Code != http.StatusOK {
		t.Fatalf("bearer logout status = %d, body = %s", bearerLogout.Code, bearerLogout.Body.String())
	}

	bearerAfterLogout := httptest.NewRecorder()
	bearerAfterLogoutReq := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	bearerAfterLogoutReq.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(bearerAfterLogout, bearerAfterLogoutReq)
	if bearerAfterLogout.Code != http.StatusUnauthorized {
		t.Fatalf("bearer me after logout status = %d, want 401; body = %s", bearerAfterLogout.Code, bearerAfterLogout.Body.String())
	}

	cookie = loginCookie(t, router, "admin", "secret")

	logout := httptest.NewRecorder()
	logoutReq := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	logoutReq.AddCookie(cookie)
	router.ServeHTTP(logout, logoutReq)
	if logout.Code != http.StatusOK {
		t.Fatalf("logout status = %d, body = %s", logout.Code, logout.Body.String())
	}

	after := httptest.NewRecorder()
	afterReq := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	afterReq.AddCookie(cookie)
	router.ServeHTTP(after, afterReq)
	if after.Code != http.StatusUnauthorized {
		t.Fatalf("me after logout status = %d, want 401; body = %s", after.Code, after.Body.String())
	}
}

func TestAuthCookiesRespectSecureConfig(t *testing.T) {
	router, _, _ := newAuthTestRouterWithConfig(t, config.Config{AllowPublicSignup: true, CookieSecure: true})

	login := performJSON(router, http.MethodPost, "/api/auth/login", `{"username":"admin","password":"secret"}`, nil)
	if login.Code != http.StatusOK {
		t.Fatalf("login status = %d, body = %s", login.Code, login.Body.String())
	}
	loginCookie := findSessionCookie(t, login.Result().Cookies())
	if !loginCookie.Secure {
		t.Fatalf("login cookie Secure = false, want true")
	}

	register := performJSON(router, http.MethodPost, "/api/auth/register", `{"username":"secure_member","password":"strong-pass"}`, nil)
	if register.Code != http.StatusCreated {
		t.Fatalf("register status = %d, body = %s", register.Code, register.Body.String())
	}
	registerCookie := findSessionCookie(t, register.Result().Cookies())
	if !registerCookie.Secure {
		t.Fatalf("register cookie Secure = false, want true")
	}

	logout := performJSON(router, http.MethodPost, "/api/auth/logout", "", loginCookie)
	if logout.Code != http.StatusOK {
		t.Fatalf("logout status = %d, body = %s", logout.Code, logout.Body.String())
	}
	clearCookie := findSessionCookie(t, logout.Result().Cookies())
	if !clearCookie.Secure {
		t.Fatalf("logout clear cookie Secure = false, want true")
	}
	if clearCookie.MaxAge >= 0 {
		t.Fatalf("logout clear cookie MaxAge = %d, want negative", clearCookie.MaxAge)
	}
}

func TestAuthRememberControlsFixedDatabaseAndCookieTTL(t *testing.T) {
	router, userRepo, _ := newAuthTestRouter(t)
	testCases := []struct {
		name     string
		remember bool
		wantTTL  time.Duration
	}{
		{name: "ordinary login", remember: false, wantTTL: auth.DefaultSessionTTL},
		{name: "remember login", remember: true, wantTTL: auth.RememberedSessionTTL},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			started := time.Now().UTC()
			body := fmt.Sprintf(`{"username":"admin","password":"secret","remember":%t}`, tc.remember)
			login := performJSON(router, http.MethodPost, "/api/auth/login", body, nil)
			if login.Code != http.StatusOK {
				t.Fatalf("login status=%d body=%s", login.Code, login.Body.String())
			}
			cookie := findSessionCookie(t, login.Result().Cookies())
			if cookie.MaxAge != int(tc.wantTTL.Seconds()) {
				t.Fatalf("cookie MaxAge=%d want=%d", cookie.MaxAge, int(tc.wantTTL.Seconds()))
			}
			if delta := cookie.Expires.Sub(started); delta < tc.wantTTL-time.Minute || delta > tc.wantTTL+time.Minute {
				t.Fatalf("cookie expiry delta=%v want~%v", delta, tc.wantTTL)
			}
			token := loginToken(t, login.Body.String())
			authService := auth.NewService(userRepo, config.Config{})
			sessionID := authService.SessionID(token)
			session, err := userRepo.GetSession(sessionID)
			if err != nil {
				t.Fatal(err)
			}
			if delta := session.ExpiresAt.Sub(started); delta < tc.wantTTL-time.Minute || delta > tc.wantTTL+time.Minute {
				t.Fatalf("database expiry delta=%v want~%v", delta, tc.wantTTL)
			}

			me := performJSON(router, http.MethodGet, "/api/auth/me", "", cookie)
			if me.Code != http.StatusOK {
				t.Fatalf("me status=%d body=%s", me.Code, me.Body.String())
			}
			after, err := userRepo.GetSession(sessionID)
			if err != nil || !after.ExpiresAt.Equal(session.ExpiresAt) {
				t.Fatalf("authentication slid expiry before=%v after=%v err=%v", session.ExpiresAt, after.ExpiresAt, err)
			}
		})
	}
}

func TestAuthRejectsWrongPasswordAndDisabledUser(t *testing.T) {
	router, userRepo, _ := newAuthTestRouter(t)
	hash, err := auth.HashPassword("secret")
	if err != nil {
		t.Fatal(err)
	}
	_, err = userRepo.CreateUser(model.User{
		ID:           "user_disabled",
		Username:     "disabled",
		PasswordHash: hash,
		DisplayName:  "Disabled",
		Role:         model.UserRoleMember,
		Status:       model.UserStatusDisabled,
	})
	if err != nil {
		t.Fatal(err)
	}

	wrong := performJSON(router, http.MethodPost, "/api/auth/login", `{"username":"admin","password":"bad"}`, nil)
	if wrong.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password status = %d, want 401", wrong.Code)
	}

	disabled := performJSON(router, http.MethodPost, "/api/auth/login", `{"username":"disabled","password":"secret"}`, nil)
	if disabled.Code != http.StatusForbidden {
		t.Fatalf("disabled status = %d, want 403", disabled.Code)
	}
}

func TestAuthFallsBackToCookieWhenBearerIsStale(t *testing.T) {
	router, _, memberCookie := newAuthTestRouter(t)

	recorder := performJSONWithBearer(router, http.MethodGet, "/api/auth/me", "", memberCookie, "stale-token")
	if recorder.Code != http.StatusOK {
		t.Fatalf("me with stale bearer and valid cookie status = %d, want 200; body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestLogoutRevokesCookieSessionWhenBearerIsStale(t *testing.T) {
	router, _, memberCookie := newAuthTestRouter(t)

	logout := performJSONWithBearer(router, http.MethodPost, "/api/auth/logout", "", memberCookie, "stale-token")
	if logout.Code != http.StatusOK {
		t.Fatalf("logout with stale bearer and valid cookie status = %d, want 200; body = %s", logout.Code, logout.Body.String())
	}

	after := performJSON(router, http.MethodGet, "/api/auth/me", "", memberCookie)
	if after.Code != http.StatusUnauthorized {
		t.Fatalf("me after cookie fallback logout status = %d, want 401; body = %s", after.Code, after.Body.String())
	}
}

func TestAuthDoesNotFallbackWhenBearerUserIsDisabled(t *testing.T) {
	router, userRepo, memberCookie := newAuthTestRouter(t)
	hash, err := auth.HashPassword("secret")
	if err != nil {
		t.Fatal(err)
	}
	_, err = userRepo.CreateUser(model.User{
		ID:           "user_disabled_bearer",
		Username:     "disabled_bearer",
		PasswordHash: hash,
		DisplayName:  "Disabled Bearer",
		Role:         model.UserRoleMember,
		Status:       model.UserStatusDisabled,
	})
	if err != nil {
		t.Fatal(err)
	}

	login := performJSON(router, http.MethodPost, "/api/auth/login", `{"username":"disabled_bearer","password":"secret"}`, nil)
	if login.Code != http.StatusForbidden {
		t.Fatalf("disabled login status = %d, want 403", login.Code)
	}

	// Create a disabled-user session directly to prove a forbidden bearer cannot be bypassed
	// by also sending another user's valid cookie.
	authService := auth.NewService(userRepo, config.Config{})
	rawToken := "disabled-raw-token"
	if _, err := userRepo.CreateSession(model.Session{
		ID:        authService.SessionID(rawToken),
		UserID:    "user_disabled_bearer",
		ExpiresAt: time.Now().UTC().Add(auth.DefaultSessionTTL),
	}); err != nil {
		t.Fatal(err)
	}
	recorder := performJSONWithBearer(router, http.MethodGet, "/api/auth/me", "", memberCookie, rawToken)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("me with disabled bearer and valid cookie status = %d, want 403; body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestPublicRegisterCreatesMemberAndSession(t *testing.T) {
	router, userRepo, _ := newAuthTestRouter(t)

	recorder := performJSON(router, http.MethodPost, "/api/auth/register", `{"account":"new_member","username":"New Member Name","password":"strong-pass","display_name":"New Member"}`, nil)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("register status = %d, want 201; body = %s", recorder.Code, recorder.Body.String())
	}
	cookie := findSessionCookie(t, recorder.Result().Cookies())
	if !cookie.HttpOnly {
		t.Fatalf("session cookie is not HttpOnly")
	}
	token := loginToken(t, recorder.Body.String())
	if token == "" {
		t.Fatalf("register token missing in body = %s", recorder.Body.String())
	}
	user, err := userRepo.GetUserByUsername("new_member")
	if err != nil {
		t.Fatal(err)
	}
	if user.Role != model.UserRoleMember || user.Status != model.UserStatusActive {
		t.Fatalf("registered user role/status = %s/%s", user.Role, user.Status)
	}
	if !strings.Contains(recorder.Body.String(), `"account":"new_member"`) {
		t.Fatalf("register response missing account: %s", recorder.Body.String())
	}
}

func TestPublicRegisterBlockedWhenDisabled(t *testing.T) {
	router, userRepo, _ := newAuthTestRouterWithConfig(t, config.Config{AllowPublicSignup: false})

	recorder := performJSON(router, http.MethodPost, "/api/auth/register", `{"username":"new_member","password":"strong-pass","display_name":"New Member"}`, nil)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("register status = %d, want 403; body = %s", recorder.Code, recorder.Body.String())
	}
	if _, err := userRepo.GetUserByUsername("new_member"); !errors.Is(err, repository.ErrUserNotFound) {
		t.Fatalf("registered user lookup err = %v, want ErrUserNotFound", err)
	}
}

func TestPublicRegisterDuplicateUsernameReturnsConflict(t *testing.T) {
	router, _, _ := newAuthTestRouter(t)

	recorder := performJSON(router, http.MethodPost, "/api/auth/register", `{"username":"member","password":"strong-pass","display_name":"Duplicate"}`, nil)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("register status = %d, want 409; body = %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "username already exists") {
		t.Fatalf("duplicate username response is not clear: %s", recorder.Body.String())
	}
}

func TestPublicRegisterValidatesUsernameAndPassword(t *testing.T) {
	router, userRepo, _ := newAuthTestRouter(t)
	testCases := []struct {
		name string
		body string
		want string
	}{
		{
			name: "too short username",
			body: `{"username":"ab","password":"strong-pass"}`,
			want: "username must be 3-32 characters",
		},
		{
			name: "invalid username characters",
			body: `{"username":"bad name","password":"strong-pass"}`,
			want: "username can only contain letters",
		},
		{
			name: "short password",
			body: `{"username":"valid_name","password":"short"}`,
			want: "password must be at least 8 characters",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := performJSON(router, http.MethodPost, "/api/auth/register", tc.body, nil)
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("register status = %d, want 400; body = %s", recorder.Code, recorder.Body.String())
			}
			if !strings.Contains(recorder.Body.String(), tc.want) {
				t.Fatalf("register response %q does not contain %q", recorder.Body.String(), tc.want)
			}
		})
	}

	if _, err := userRepo.GetUserByUsername("valid_name"); !errors.Is(err, repository.ErrUserNotFound) {
		t.Fatalf("invalid registration created user; err = %v", err)
	}
}

func TestAdminRequiresSuperAdmin(t *testing.T) {
	router, _, memberCookie := newAuthTestRouter(t)

	anonymous := performJSON(router, http.MethodGet, "/api/admin/users", "", nil)
	if anonymous.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous status = %d, want 401", anonymous.Code)
	}

	member := performJSON(router, http.MethodGet, "/api/admin/users", "", memberCookie)
	if member.Code != http.StatusForbidden {
		t.Fatalf("member status = %d, want 403", member.Code)
	}

	adminCookie := loginCookie(t, router, "admin", "secret")
	admin := performJSON(router, http.MethodGet, "/api/admin/users", "", adminCookie)
	if admin.Code != http.StatusOK {
		t.Fatalf("admin status = %d, want 200; body = %s", admin.Code, admin.Body.String())
	}
}

func TestSuperAdminSeedDoesNotOverrideExisting(t *testing.T) {
	userRepo := repository.NewMemoryUserRepository()
	hash, err := auth.HashPassword("existing")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := userRepo.CreateUser(model.User{
		ID:           "user_existing_admin",
		Username:     "root",
		PasswordHash: hash,
		DisplayName:  "Root",
		Role:         model.UserRoleSuperAdmin,
		Status:       model.UserStatusActive,
	}); err != nil {
		t.Fatal(err)
	}

	service := auth.NewService(userRepo, config.Config{AdminUsername: "admin", AdminPassword: "secret"})
	if err := service.SeedSuperAdmin(config.Config{AdminUsername: "admin", AdminPassword: "secret"}); err != nil {
		t.Fatal(err)
	}

	count, err := userRepo.CountUsersByRole(model.UserRoleSuperAdmin)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("super_admin count = %d, want 1", count)
	}
}

func newAuthTestRouter(t *testing.T) (*gin.Engine, repository.UserRepository, *http.Cookie) {
	t.Helper()
	return newAuthTestRouterWithConfig(t, config.Config{AllowPublicSignup: true})
}

func newAuthTestRouterWithConfig(t *testing.T, cfg config.Config) (*gin.Engine, repository.UserRepository, *http.Cookie) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	userRepo := repository.NewMemoryUserRepository()
	authService := auth.NewService(userRepo, cfg)
	if err := authService.SeedSuperAdmin(config.Config{AdminUsername: "admin", AdminPassword: "secret", AdminDisplayName: "Admin"}); err != nil {
		t.Fatal(err)
	}
	memberHash, err := auth.HashPassword("secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := userRepo.CreateUser(model.User{
		ID:           "user_member",
		Username:     "member",
		PasswordHash: memberHash,
		DisplayName:  "Member",
		Role:         model.UserRoleMember,
		Status:       model.UserStatusActive,
	}); err != nil {
		t.Fatal(err)
	}

	handler := NewAuthHandler(authService, userRepo, cfg)
	router := gin.New()
	router.Use(middleware.RequestID())
	api := router.Group("/api")
	api.POST("/auth/register", handler.Register)
	api.POST("/auth/login", handler.Login)
	api.GET("/auth/me", middleware.RequireAuth(authService), handler.Me)
	api.POST("/auth/logout", middleware.RequireAuth(authService), handler.Logout)
	admin := api.Group("/admin", middleware.RequireSuperAdmin(authService))
	admin.GET("/users", handler.ListUsers)

	return router, userRepo, loginCookie(t, router, "member", "secret")
}

func performJSON(router *gin.Engine, method string, path string, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		request.AddCookie(cookie)
	}
	router.ServeHTTP(recorder, request)
	return recorder
}

func performJSONWithBearer(router *gin.Engine, method string, path string, body string, cookie *http.Cookie, bearerToken string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if bearerToken != "" {
		request.Header.Set("Authorization", "Bearer "+bearerToken)
	}
	if cookie != nil {
		request.AddCookie(cookie)
	}
	router.ServeHTTP(recorder, request)
	return recorder
}

func loginCookie(t *testing.T, router *gin.Engine, username string, password string) *http.Cookie {
	t.Helper()
	recorder := performJSON(router, http.MethodPost, "/api/auth/login", `{"username":"`+username+`","password":"`+password+`"}`, nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("login %s status = %d; body = %s", username, recorder.Code, recorder.Body.String())
	}
	return findSessionCookie(t, recorder.Result().Cookies())
}

func findSessionCookie(t *testing.T, cookies []*http.Cookie) *http.Cookie {
	t.Helper()
	for _, cookie := range cookies {
		if cookie.Name == auth.CookieName {
			return cookie
		}
	}
	payload, _ := json.Marshal(cookies)
	t.Fatalf("%s cookie not found in %s", auth.CookieName, string(payload))
	return nil
}

func loginToken(t *testing.T, body string) string {
	t.Helper()
	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		t.Fatalf("decode login body failed: %v; body = %s", err, body)
	}
	if !payload.Success || payload.Data.Token == "" {
		t.Fatalf("login token missing in body = %s", body)
	}
	return payload.Data.Token
}
