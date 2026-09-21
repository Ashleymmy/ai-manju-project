package handler

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/gin-gonic/gin"
)

type AuthHandler struct {
	authService *auth.Service
	userRepo    repository.UserRepository
	cfg         config.Config
	// registerBonus grants the new-user credit bonus (WP-M3). Nil when billing
	// is disabled. Bonus failures must never fail registration (不卡死).
	registerBonus func(userID string)
	// auditRepo records admin-tier logins (WP-M5). Nil disables the hook.
	auditRepo repository.AuditRepository
	// inviteValidate / inviteBind wire 邀请有礼 (WP-M9). Nil when billing is
	// disabled; a provided invite_code is then silently ignored.
	inviteValidate func(code string) error
	inviteBind     func(inviteeID string, code string) error
}

// maxDisplayNameRunes 昵称长度上限（按 Unicode 字符数计，中文按 1 字）。
const maxDisplayNameRunes = 32

func NewAuthHandler(authService *auth.Service, userRepo repository.UserRepository, cfg config.Config) *AuthHandler {
	return &AuthHandler{authService: authService, userRepo: userRepo, cfg: cfg}
}

// SetRegisterBonusHook wires the credit engine's register bonus. Router sets
// this only when cfg.BillingEnabled is true.
func (h *AuthHandler) SetRegisterBonusHook(hook func(userID string)) {
	h.registerBonus = hook
}

// SetAuditRepository wires the append-only admin audit log (WP-M5). Admin-tier
// logins are recorded per the document's 模块8（登录留痕）; nil disables it.
func (h *AuthHandler) SetAuditRepository(auditRepo repository.AuditRepository) {
	h.auditRepo = auditRepo
}

// SetInviteHooks wires invite-code validation and binding (WP-M9).
func (h *AuthHandler) SetInviteHooks(validate func(code string) error, bind func(inviteeID string, code string) error) {
	h.inviteValidate = validate
	h.inviteBind = bind
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req struct {
		Account  string `json:"account"`
		Username string `json:"username"`
		Password string `json:"password" binding:"required"`
		Remember bool   `json:"remember"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	account := firstNonEmptyString(req.Account, req.Username)
	if strings.TrimSpace(account) == "" {
		response.Error(c, http.StatusBadRequest, "account is required")
		return
	}
	user, token, err := h.authService.Login(account, req.Password, req.Remember)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			response.Error(c, http.StatusUnauthorized, "invalid username or password")
			return
		}
		if errors.Is(err, auth.ErrUserDisabled) {
			response.Error(c, http.StatusForbidden, "user is disabled")
			return
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	// 管理员登录留痕（文档模块8：登录、修改积分、退款、改套餐全部留痕）。
	if h.auditRepo != nil && model.IsAdminRole(user.Role) {
		detail, _ := json.Marshal(map[string]any{"account": user.Username, "role": user.Role})
		if _, auditErr := h.auditRepo.Append(model.AdminAuditLog{
			AdminID:    user.ID,
			Action:     model.AuditActionLogin,
			TargetType: "session",
			TargetID:   user.ID,
			Detail:     model.JSONB(detail),
			IP:         c.ClientIP(),
			CreatedAt:  time.Now().UTC(),
		}); auditErr != nil {
			log.Printf("event=admin_login_audit_failed admin_id=%s reason=%q", user.ID, auditErr.Error())
		}
	}

	setSessionCookie(c, token, h.cfg, auth.SessionTTL(req.Remember))
	response.OK(c, gin.H{
		"token": token,
		"user":  userResponse(user),
	})
}

func (h *AuthHandler) Register(c *gin.Context) {
	if !h.cfg.AllowPublicSignup {
		response.Error(c, http.StatusForbidden, "public signup is disabled")
		return
	}

	var req struct {
		Account     string `json:"account"`
		Username    string `json:"username"`
		Password    string `json:"password" binding:"required"`
		DisplayName string `json:"display_name"`
		Remember    bool   `json:"remember"`
		InviteCode  string `json:"invite_code"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	account := normalizeUsername(firstNonEmptyString(req.Account, req.Username))
	if account == "" {
		response.Error(c, http.StatusBadRequest, "account is required")
		return
	}
	if len(account) < 3 || len(account) > 32 {
		response.Error(c, http.StatusBadRequest, "username must be 3-32 characters")
		return
	}
	if !isAllowedUsername(account) {
		response.Error(c, http.StatusBadRequest, "username can only contain letters, numbers, underscore, dot, or hyphen")
		return
	}
	password := strings.TrimSpace(req.Password)
	if len(password) < 8 {
		response.Error(c, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}
	// 邀请码前置校验（WP-M9）：码不合规直接 400，不创建账号。
	inviteCode := strings.TrimSpace(req.InviteCode)
	if inviteCode != "" && h.inviteValidate != nil {
		if err := h.inviteValidate(inviteCode); err != nil {
			response.Error(c, http.StatusBadRequest, "invite code is invalid")
			return
		}
	}
	if _, err := h.userRepo.GetUserByUsername(account); err == nil {
		response.Error(c, http.StatusConflict, "username already exists")
		return
	} else if !errors.Is(err, repository.ErrUserNotFound) {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	passwordHash, err := auth.HashPassword(password)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	displayName := strings.TrimSpace(req.DisplayName)
	if displayName == "" {
		displayName = strings.TrimSpace(req.Username)
	}
	if displayName == "" {
		displayName = account
	}

	createdUser, err := h.userRepo.CreateUser(model.User{
		ID:           "user_" + randomHex(8),
		Username:     account,
		PasswordHash: passwordHash,
		DisplayName:  displayName,
		Role:         model.UserRoleMember,
		Status:       model.UserStatusActive,
	})
	if err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	// 注册赠送体验积分（WP-M3）。赠送失败不阻断注册，由对账/后台补发。
	if h.registerBonus != nil {
		h.registerBonus(createdUser.ID)
	}
	// 邀请绑定（WP-M9）：已通过前置校验，绑定失败只记录不阻断。
	if inviteCode != "" && h.inviteBind != nil {
		if err := h.inviteBind(createdUser.ID, inviteCode); err != nil {
			log.Printf("event=invite_bind_failed user_id=%s reason=%q", createdUser.ID, err.Error())
		}
	}

	user, token, err := h.authService.Login(account, password, req.Remember)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	setSessionCookie(c, token, h.cfg, auth.SessionTTL(req.Remember))
	response.Created(c, gin.H{
		"token": token,
		"user":  userResponse(user),
	})
}

func (h *AuthHandler) Me(c *gin.Context) {
	user, ok := auth.CurrentUser(c)
	if !ok {
		response.Error(c, http.StatusUnauthorized, "authentication required")
		return
	}

	response.OK(c, userResponse(user))
}

// UpdateMe 用户自助改名（账号弹窗"修改昵称"）：仅允许更新本人 display_name，
// 角色/状态等仍只有管理员能改（PUT /api/admin/users/:id）。
func (h *AuthHandler) UpdateMe(c *gin.Context) {
	current, ok := auth.CurrentUser(c)
	if !ok {
		response.Error(c, http.StatusUnauthorized, "authentication required")
		return
	}

	var req struct {
		DisplayName string `json:"display_name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	displayName := strings.TrimSpace(req.DisplayName)
	if displayName == "" {
		response.Error(c, http.StatusBadRequest, "display name is required")
		return
	}
	if utf8.RuneCountInString(displayName) > maxDisplayNameRunes {
		response.Error(c, http.StatusBadRequest, "display name must be at most 32 characters")
		return
	}

	current.DisplayName = displayName
	user, err := h.userRepo.UpdateUser(current)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	response.OK(c, userResponse(user))
}

func (h *AuthHandler) Logout(c *gin.Context) {
	token := sessionToken(c)
	if err := h.authService.Logout(token); err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	clearSessionCookie(c, h.cfg)
	response.OK(c, gin.H{})
}

func sessionToken(c *gin.Context) string {
	if token := auth.CurrentSessionToken(c); token != "" {
		return token
	}
	header := strings.TrimSpace(c.GetHeader("Authorization"))
	if strings.HasPrefix(strings.ToLower(header), "bearer ") {
		return strings.TrimSpace(header[7:])
	}
	token, _ := c.Cookie(auth.CookieName)
	return token
}

func (h *AuthHandler) ListUsers(c *gin.Context) {
	users, err := h.userRepo.ListUsers()
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	result := make([]gin.H, 0, len(users))
	for _, user := range users {
		result = append(result, userResponse(user))
	}
	response.OK(c, result)
}

func (h *AuthHandler) CreateUser(c *gin.Context) {
	var req struct {
		Account     string `json:"account"`
		Username    string `json:"username"`
		Password    string `json:"password" binding:"required"`
		DisplayName string `json:"display_name"`
		Role        string `json:"role"`
		Status      string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	username := normalizeUsername(firstNonEmptyString(req.Account, req.Username))
	if username == "" {
		response.Error(c, http.StatusBadRequest, "account is required")
		return
	}
	if strings.TrimSpace(req.Password) == "" {
		response.Error(c, http.StatusBadRequest, "password is required")
		return
	}

	role := normalizeRole(req.Role)
	if operator, ok := auth.CurrentUser(c); ok && operator.Role != model.UserRoleSuperAdmin && role != model.UserRoleMember {
		response.Error(c, http.StatusForbidden, "only super administrators may assign administrator roles")
		return
	}
	status := normalizeStatus(req.Status)
	passwordHash, err := auth.HashPassword(req.Password)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	displayName := strings.TrimSpace(req.DisplayName)
	if displayName == "" {
		displayName = strings.TrimSpace(req.Username)
	}
	if displayName == "" {
		displayName = username
	}

	user, err := h.userRepo.CreateUser(model.User{
		ID:           "user_" + randomHex(8),
		Username:     username,
		PasswordHash: passwordHash,
		DisplayName:  displayName,
		Role:         role,
		Status:       status,
	})
	if err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	response.Created(c, userResponse(user))
}

func (h *AuthHandler) UpdateUser(c *gin.Context) {
	current, err := h.userRepo.GetUser(c.Param("id"))
	if err != nil {
		if errors.Is(err, repository.ErrUserNotFound) {
			response.Error(c, http.StatusNotFound, "user not found")
			return
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	var req struct {
		Password    *string `json:"password"`
		DisplayName *string `json:"display_name"`
		Role        *string `json:"role"`
		Status      *string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if operator, ok := auth.CurrentUser(c); ok && operator.Role != model.UserRoleSuperAdmin {
		if current.Role != model.UserRoleMember || (req.Role != nil && normalizeRole(*req.Role) != model.UserRoleMember) {
			response.Error(c, http.StatusForbidden, "only super administrators may manage administrator accounts")
			return
		}
	}

	if req.DisplayName != nil {
		current.DisplayName = strings.TrimSpace(*req.DisplayName)
		if current.DisplayName == "" {
			current.DisplayName = current.Username
		}
	}
	if req.Role != nil {
		current.Role = normalizeRole(*req.Role)
	}
	if req.Status != nil {
		current.Status = normalizeStatus(*req.Status)
	}
	if req.Password != nil {
		if strings.TrimSpace(*req.Password) == "" {
			response.Error(c, http.StatusBadRequest, "password is required")
			return
		}
		passwordHash, err := auth.HashPassword(*req.Password)
		if err != nil {
			response.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		current.PasswordHash = passwordHash
	}

	user, err := h.userRepo.UpdateUser(current)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	response.OK(c, userResponse(user))
}

func setSessionCookie(c *gin.Context, token string, cfg config.Config, ttlValues ...time.Duration) {
	ttl := auth.DefaultSessionTTL
	if len(ttlValues) > 0 && ttlValues[0] > 0 {
		ttl = ttlValues[0]
	}
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     auth.CookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(ttl.Seconds()),
		Expires:  time.Now().UTC().Add(ttl),
		HttpOnly: true,
		Secure:   cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func clearSessionCookie(c *gin.Context, cfg config.Config) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     auth.CookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func userResponse(user model.User) gin.H {
	return gin.H{
		"id":           user.ID,
		"account":      user.Username,
		"username":     user.Username,
		"display_name": user.DisplayName,
		"role":         user.Role,
		"status":       user.Status,
		"created_at":   user.CreatedAt,
		"updated_at":   user.UpdatedAt,
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func normalizeUsername(username string) string {
	return strings.ToLower(strings.TrimSpace(username))
}

func isAllowedUsername(username string) bool {
	for _, char := range username {
		if char >= 'a' && char <= 'z' {
			continue
		}
		if char >= '0' && char <= '9' {
			continue
		}
		if char == '_' || char == '-' || char == '.' {
			continue
		}
		return false
	}
	return true
}

func normalizeRole(role string) string {
	switch strings.TrimSpace(role) {
	case model.UserRoleSuperAdmin:
		return model.UserRoleSuperAdmin
	case model.UserRoleOpsAdmin:
		return model.UserRoleOpsAdmin
	case model.UserRoleAuditor:
		return model.UserRoleAuditor
	default:
		return model.UserRoleMember
	}
}

func normalizeStatus(status string) string {
	switch strings.TrimSpace(status) {
	case model.UserStatusDisabled:
		return model.UserStatusDisabled
	default:
		return model.UserStatusActive
	}
}
