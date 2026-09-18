package handler

import (
	"net/http"
	"testing"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/gin-gonic/gin"
)

// 管理员登录留痕（文档模块8）：admin 角色登录写审计，member 不写。
func TestAdminLoginIsAudited(t *testing.T) {
	gin.SetMode(gin.TestMode)
	userRepo := repository.NewMemoryUserRepository()
	cfg := config.Config{AppSecret: "test-secret-test-secret"}
	authService := auth.NewService(userRepo, cfg)
	auditRepo := repository.NewMemoryAuditRepository()

	for _, account := range []struct {
		username string
		role     string
	}{
		{"boss", model.UserRoleSuperAdmin},
		{"ops", model.UserRoleOpsAdmin},
		{"member", model.UserRoleMember},
	} {
		hash, err := auth.HashPassword("secret-password")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := userRepo.CreateUser(model.User{
			ID: "user_" + account.username, Username: account.username, PasswordHash: hash,
			DisplayName: account.username, Role: account.role, Status: model.UserStatusActive,
		}); err != nil {
			t.Fatal(err)
		}
	}

	handler := NewAuthHandler(authService, userRepo, cfg)
	handler.SetAuditRepository(auditRepo)
	router := gin.New()
	router.POST("/api/auth/login", handler.Login)

	// 管理员登录 → 留痕。
	if recorder := performJSON(router, http.MethodPost, "/api/auth/login", `{"username":"boss","password":"secret-password"}`, nil); recorder.Code != http.StatusOK {
		t.Fatalf("boss login status = %d", recorder.Code)
	}
	if recorder := performJSON(router, http.MethodPost, "/api/auth/login", `{"username":"ops","password":"secret-password"}`, nil); recorder.Code != http.StatusOK {
		t.Fatalf("ops login status = %d", recorder.Code)
	}
	// 普通成员登录 → 不留痕。
	if recorder := performJSON(router, http.MethodPost, "/api/auth/login", `{"username":"member","password":"secret-password"}`, nil); recorder.Code != http.StatusOK {
		t.Fatalf("member login status = %d", recorder.Code)
	}

	logs, total, err := auditRepo.List("", model.AuditActionLogin, 1, 50)
	if err != nil || total != 2 {
		t.Fatalf("login audit entries = %d err=%v, want 2（boss+ops，member 不留痕）", total, err)
	}
	for _, entry := range logs {
		if entry.Action != model.AuditActionLogin || entry.AdminID == "" {
			t.Fatalf("bad entry: %+v", entry)
		}
	}
}

// 未接线审计仓储时登录不受影响（nil 安全）。
func TestLoginWithoutAuditRepositoryStillWorks(t *testing.T) {
	gin.SetMode(gin.TestMode)
	userRepo := repository.NewMemoryUserRepository()
	cfg := config.Config{AppSecret: "test-secret-test-secret"}
	authService := auth.NewService(userRepo, cfg)
	hash, _ := auth.HashPassword("secret-password")
	if _, err := userRepo.CreateUser(model.User{
		ID: "user_boss2", Username: "boss2", PasswordHash: hash,
		DisplayName: "boss2", Role: model.UserRoleSuperAdmin, Status: model.UserStatusActive,
	}); err != nil {
		t.Fatal(err)
	}
	handler := NewAuthHandler(authService, userRepo, cfg) // 不设置 auditRepo
	router := gin.New()
	router.POST("/api/auth/login", handler.Login)
	if recorder := performJSON(router, http.MethodPost, "/api/auth/login", `{"username":"boss2","password":"secret-password"}`, nil); recorder.Code != http.StatusOK {
		t.Fatalf("login without audit repo status = %d", recorder.Code)
	}
}
