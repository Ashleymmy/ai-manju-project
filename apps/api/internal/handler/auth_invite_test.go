package handler

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/middleware"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

// 注册携带邀请码（WP-M9）：有效码绑定并发放被邀请人奖励；无效码 400 不建号。
func TestRegisterWithInviteCode(t *testing.T) {
	gin.SetMode(gin.TestMode)
	userRepo := repository.NewMemoryUserRepository()
	cfg := config.Config{AppSecret: "test-secret-test-secret", AllowPublicSignup: true}
	authService := auth.NewService(userRepo, cfg)

	invites := repository.NewMemoryInviteRepository()
	credits := repository.NewMemoryCreditRepository()
	billing := repository.NewMemoryBillingRepository()
	engine := service.NewCreditLedgerService(credits, repository.NewMemoryMembershipRepository(), billing)
	inviteService := service.NewInviteService(invites, engine, billing)

	// 邀请人已有邀请码。
	inviterProfile, err := invites.GetOrCreateProfile("inviter_existing", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}

	handler := NewAuthHandler(authService, userRepo, cfg)
	handler.SetInviteHooks(inviteService.ValidateInviteCode, func(inviteeID string, code string) error {
		return inviteService.BindInviteCode(inviteeID, code)
	})
	router := gin.New()
	router.Use(middleware.RequestID())
	router.POST("/api/auth/register", handler.Register)

	// 有效码：注册成功 + 绑定 + 被邀请人得 500。
	recorder := performJSON(router, http.MethodPost, "/api/auth/register",
		`{"username":"invited_user","password":"strong-pass","invite_code":"`+inviterProfile.InviteCode+`"}`, nil)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("register with valid code status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	invitee, err := userRepo.GetUserByUsername("invited_user")
	if err != nil {
		t.Fatal(err)
	}
	record, err := invites.GetRecordByInvitee(invitee.ID)
	if err != nil || record.InviterID != "inviter_existing" {
		t.Fatalf("record = %+v err=%v", record, err)
	}
	overview, err := engine.Overview(invitee.ID)
	if err != nil || overview.LimitedAvailable != 500 {
		t.Fatalf("invitee limited = %d err=%v, want 500", overview.LimitedAvailable, err)
	}

	// 无效码：400 且不建号。
	recorder = performJSON(router, http.MethodPost, "/api/auth/register",
		`{"username":"bad_code_user","password":"strong-pass","invite_code":"NOPE1234"}`, nil)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("register with invalid code status = %d, want 400", recorder.Code)
	}
	if _, err := userRepo.GetUserByUsername("bad_code_user"); err == nil {
		t.Fatal("user with invalid invite code must not be created")
	}
}

// 未接邀请钩子（billing 关闭）时，invite_code 被忽略，注册不受影响。
func TestRegisterInviteCodeIgnoredWhenHookMissing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	userRepo := repository.NewMemoryUserRepository()
	cfg := config.Config{AppSecret: "test-secret-test-secret", AllowPublicSignup: true}
	authService := auth.NewService(userRepo, cfg)
	handler := NewAuthHandler(authService, userRepo, cfg) // 不接 SetInviteHooks
	router := gin.New()
	router.POST("/api/auth/register", handler.Register)

	recorder := performJSON(router, http.MethodPost, "/api/auth/register",
		`{"username":"plain_user","password":"strong-pass","invite_code":"WHATEVER"}`, nil)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("register without hooks status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "plain_user") {
		t.Fatalf("body = %s", recorder.Body.String())
	}
}
