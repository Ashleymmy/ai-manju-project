package middleware

import (
	"errors"
	"strings"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/response"
	"github.com/gin-gonic/gin"
)

func RequireAuth(authService *auth.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !authenticateRequest(c, authService) {
			c.Abort()
			return
		}

		c.Next()
	}
}

func RequireSuperAdmin(authService *auth.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !authenticateRequest(c, authService) {
			c.Abort()
			return
		}

		user, ok := auth.CurrentUser(c)
		if !ok || user.Role != model.UserRoleSuperAdmin {
			response.Error(c, 403, "super admin required")
			c.Abort()
			return
		}

		c.Next()
	}
}

// RequireAdmin admits any admin tier (super_admin / ops_admin / auditor) per
// the document's 三级权限. Auditors are read-only: mutating verbs get 403
// (只读审计账号仅查看数据不能修改数据). Write access for ops vs super is
// enforced per-route by WP-M7 handlers; destructive routes should keep
// RequireSuperAdmin.
func RequireAdmin(authService *auth.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !authenticateRequest(c, authService) {
			c.Abort()
			return
		}

		user, ok := auth.CurrentUser(c)
		if !ok || !model.IsAdminRole(user.Role) {
			response.Error(c, 403, "admin required")
			c.Abort()
			return
		}
		if model.IsReadOnlyAdminRole(user.Role) && !isReadOnlyMethod(c.Request.Method) {
			response.Error(c, 403, "auditor account is read-only")
			c.Abort()
			return
		}

		c.Next()
	}
}

func isReadOnlyMethod(method string) bool {
	switch method {
	case "GET", "HEAD", "OPTIONS":
		return true
	default:
		return false
	}
}

func authenticateRequest(c *gin.Context, authService *auth.Service) bool {
	token := bearerToken(c.GetHeader("Authorization"))
	if token == "" {
		token = strings.TrimSpace(c.Query("access_token"))
	}
	cookieToken, _ := c.Cookie(auth.CookieName)

	if token != "" {
		if user, err := authService.Authenticate(token); err == nil {
			c.Set(auth.ContextUserKey, user)
			c.Set(auth.ContextSessionTokenKey, token)
			return true
		} else {
			if errors.Is(err, auth.ErrUserDisabled) {
				response.Error(c, 403, "user is disabled")
				return false
			}
			if !errors.Is(err, auth.ErrUnauthorized) || cookieToken == "" || cookieToken == token {
				response.Error(c, 401, "authentication required")
				return false
			}
		}
	}

	if cookieToken == "" {
		response.Error(c, 401, "authentication required")
		return false
	}

	user, err := authService.Authenticate(cookieToken)
	if err != nil {
		if errors.Is(err, auth.ErrUserDisabled) {
			response.Error(c, 403, "user is disabled")
			return false
		}
		response.Error(c, 401, "authentication required")
		return false
	}

	c.Set(auth.ContextUserKey, user)
	c.Set(auth.ContextSessionTokenKey, cookieToken)
	return true
}

func bearerToken(header string) string {
	authHeader := strings.TrimSpace(header)
	if authHeader == "" {
		return ""
	}
	if strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
		return strings.TrimSpace(authHeader[7:])
	}
	return ""
}
