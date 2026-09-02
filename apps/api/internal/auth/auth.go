package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

const CookieName = "ai_manju_session"
const ContextUserKey = "current_user"
const ContextSessionTokenKey = "current_session_token"
const DefaultSessionTTL = 24 * time.Hour
const RememberedSessionTTL = 30 * 24 * time.Hour

var ErrInvalidCredentials = errors.New("invalid username or password")
var ErrUserDisabled = errors.New("user is disabled")
var ErrUnauthorized = errors.New("unauthorized")

type Service struct {
	repo      repository.UserRepository
	appSecret string
	now       func() time.Time
}

func NewService(repo repository.UserRepository, cfg config.Config) *Service {
	return &Service{
		repo:      repo,
		appSecret: cfg.AppSecret,
		now:       func() time.Time { return time.Now().UTC() },
	}
}

func (s *Service) SeedSuperAdmin(cfg config.Config) error {
	count, err := s.repo.CountUsersByRole(model.UserRoleSuperAdmin)
	if err != nil {
		return err
	}
	if count > 0 || cfg.AdminUsername == "" || cfg.AdminPassword == "" {
		return nil
	}

	passwordHash, err := HashPassword(cfg.AdminPassword)
	if err != nil {
		return err
	}

	displayName := cfg.AdminDisplayName
	if displayName == "" {
		displayName = cfg.AdminUsername
	}

	_, err = s.repo.CreateUser(model.User{
		ID:           "user_" + randomHex(8),
		Username:     normalizeUsername(cfg.AdminUsername),
		PasswordHash: passwordHash,
		DisplayName:  displayName,
		Role:         model.UserRoleSuperAdmin,
		Status:       model.UserStatusActive,
	})
	return err
}

func (s *Service) Login(username string, password string, rememberValues ...bool) (model.User, string, error) {
	user, err := s.repo.GetUserByUsername(normalizeUsername(username))
	if err != nil {
		if errors.Is(err, repository.ErrUserNotFound) {
			return model.User{}, "", ErrInvalidCredentials
		}
		return model.User{}, "", err
	}
	if user.Status == model.UserStatusDisabled {
		return model.User{}, "", ErrUserDisabled
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return model.User{}, "", ErrInvalidCredentials
	}

	rawToken := randomHex(32)
	sessionID := s.SessionID(rawToken)
	remember := len(rememberValues) > 0 && rememberValues[0]
	_, err = s.repo.CreateSession(model.Session{
		ID:        sessionID,
		UserID:    user.ID,
		ExpiresAt: s.now().Add(SessionTTL(remember)),
	})
	if err != nil {
		return model.User{}, "", err
	}

	return user, rawToken, nil
}

// SessionTTL returns a fixed lifetime. Sessions are never extended by reads.
func SessionTTL(remember bool) time.Duration {
	if remember {
		return RememberedSessionTTL
	}
	return DefaultSessionTTL
}

func (s *Service) Authenticate(rawToken string) (model.User, error) {
	if strings.TrimSpace(rawToken) == "" {
		return model.User{}, ErrUnauthorized
	}

	session, err := s.repo.GetSession(s.SessionID(rawToken))
	if err != nil {
		if errors.Is(err, repository.ErrSessionNotFound) {
			return model.User{}, ErrUnauthorized
		}
		return model.User{}, err
	}
	if session.RevokedAt != nil || !session.ExpiresAt.After(s.now()) {
		return model.User{}, ErrUnauthorized
	}

	user, err := s.repo.GetUser(session.UserID)
	if err != nil {
		if errors.Is(err, repository.ErrUserNotFound) {
			return model.User{}, ErrUnauthorized
		}
		return model.User{}, err
	}
	if user.Status == model.UserStatusDisabled {
		return model.User{}, ErrUserDisabled
	}

	return user, nil
}

func (s *Service) Logout(rawToken string) error {
	if strings.TrimSpace(rawToken) == "" {
		return nil
	}

	err := s.repo.RevokeSession(s.SessionID(rawToken))
	if errors.Is(err, repository.ErrSessionNotFound) {
		return nil
	}

	return err
}

func (s *Service) SessionID(rawToken string) string {
	sum := sha256.Sum256([]byte(s.appSecret + ":" + rawToken))
	return hex.EncodeToString(sum[:])
}

func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}

	return string(bytes), nil
}

func CurrentUser(c *gin.Context) (model.User, bool) {
	value, ok := c.Get(ContextUserKey)
	if !ok {
		return model.User{}, false
	}
	user, ok := value.(model.User)
	return user, ok
}

func MustCurrentUser(c *gin.Context) model.User {
	user, _ := CurrentUser(c)
	return user
}

func CurrentSessionToken(c *gin.Context) string {
	value, ok := c.Get(ContextSessionTokenKey)
	if !ok {
		return ""
	}
	token, _ := value.(string)
	return strings.TrimSpace(token)
}

func normalizeUsername(username string) string {
	return strings.ToLower(strings.TrimSpace(username))
}

func randomHex(bytesCount int) string {
	bytes := make([]byte, bytesCount)
	if _, err := rand.Read(bytes); err != nil {
		return hex.EncodeToString([]byte(time.Now().UTC().Format("20060102150405.000000000")))
	}

	return hex.EncodeToString(bytes)
}
