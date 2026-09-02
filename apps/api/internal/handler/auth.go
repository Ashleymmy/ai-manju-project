package handler

import (
	"errors"
	"net/http"
	"strings"
	"time"

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
}

func NewAuthHandler(authService *auth.Service, userRepo repository.UserRepository, cfg config.Config) *AuthHandler {
	return &AuthHandler{authService: authService, userRepo: userRepo, cfg: cfg}
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

	if _, err := h.userRepo.CreateUser(model.User{
		ID:           "user_" + randomHex(8),
		Username:     account,
		PasswordHash: passwordHash,
		DisplayName:  displayName,
		Role:         model.UserRoleMember,
		Status:       model.UserStatusActive,
	}); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
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
