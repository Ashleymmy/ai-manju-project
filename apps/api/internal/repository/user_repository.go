package repository

import (
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
)

var ErrUserNotFound = errors.New("user not found")
var ErrSessionNotFound = errors.New("session not found")

type UserRepository interface {
	ListUsers() ([]model.User, error)
	GetUser(id string) (model.User, error)
	GetUserByUsername(username string) (model.User, error)
	CountUsersByRole(role string) (int64, error)
	CreateUser(user model.User) (model.User, error)
	UpdateUser(user model.User) (model.User, error)
	CreateSession(session model.Session) (model.Session, error)
	GetSession(id string) (model.Session, error)
	RevokeSession(id string) error
}

type MemoryUserRepository struct {
	mu       sync.RWMutex
	users    map[string]model.User
	sessions map[string]model.Session
}

func NewMemoryUserRepository() *MemoryUserRepository {
	return &MemoryUserRepository{
		users:    make(map[string]model.User),
		sessions: make(map[string]model.Session),
	}
}

func (r *MemoryUserRepository) ListUsers() ([]model.User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	users := make([]model.User, 0, len(r.users))
	for _, user := range r.users {
		users = append(users, user)
	}
	sort.Slice(users, func(i, j int) bool {
		return users[i].CreatedAt.Before(users[j].CreatedAt)
	})

	return users, nil
}

func (r *MemoryUserRepository) GetUser(id string) (model.User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	user, ok := r.users[id]
	if !ok {
		return model.User{}, ErrUserNotFound
	}

	return user, nil
}

func (r *MemoryUserRepository) GetUserByUsername(username string) (model.User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, user := range r.users {
		if user.Username == username {
			return user, nil
		}
	}

	return model.User{}, ErrUserNotFound
}

func (r *MemoryUserRepository) CountUsersByRole(role string) (int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var count int64
	for _, user := range r.users {
		if user.Role == role {
			count++
		}
	}

	return count, nil
}

func (r *MemoryUserRepository) CreateUser(user model.User) (model.User, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	user.CreatedAt = now
	user.UpdatedAt = now
	r.users[user.ID] = user

	return user, nil
}

func (r *MemoryUserRepository) UpdateUser(user model.User) (model.User, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	current, ok := r.users[user.ID]
	if !ok {
		return model.User{}, ErrUserNotFound
	}

	user.CreatedAt = current.CreatedAt
	user.UpdatedAt = time.Now().UTC()
	r.users[user.ID] = user

	return user, nil
}

func (r *MemoryUserRepository) CreateSession(session model.Session) (model.Session, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	session.CreatedAt = now
	session.UpdatedAt = now
	r.sessions[session.ID] = session

	return session, nil
}

func (r *MemoryUserRepository) GetSession(id string) (model.Session, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	session, ok := r.sessions[id]
	if !ok {
		return model.Session{}, ErrSessionNotFound
	}

	return session, nil
}

func (r *MemoryUserRepository) RevokeSession(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	session, ok := r.sessions[id]
	if !ok {
		return ErrSessionNotFound
	}

	now := time.Now().UTC()
	session.RevokedAt = &now
	session.UpdatedAt = now
	r.sessions[id] = session

	return nil
}

type GormUserRepository struct {
	db *gorm.DB
}

func NewGormUserRepository(db *gorm.DB) *GormUserRepository {
	return &GormUserRepository{db: db}
}

func (r *GormUserRepository) ListUsers() ([]model.User, error) {
	var users []model.User
	if err := r.db.Order("created_at ASC").Find(&users).Error; err != nil {
		return nil, err
	}

	return users, nil
}

func (r *GormUserRepository) GetUser(id string) (model.User, error) {
	var user model.User
	if err := r.db.First(&user, "id = ?", id).Error; err != nil {
		return model.User{}, mapUserGormError(err)
	}

	return user, nil
}

func (r *GormUserRepository) GetUserByUsername(username string) (model.User, error) {
	var user model.User
	if err := r.db.First(&user, "username = ?", username).Error; err != nil {
		return model.User{}, mapUserGormError(err)
	}

	return user, nil
}

func (r *GormUserRepository) CountUsersByRole(role string) (int64, error) {
	var count int64
	if err := r.db.Model(&model.User{}).Where("role = ?", role).Count(&count).Error; err != nil {
		return 0, err
	}

	return count, nil
}

func (r *GormUserRepository) CreateUser(user model.User) (model.User, error) {
	now := time.Now().UTC()
	user.CreatedAt = now
	user.UpdatedAt = now
	if err := r.db.Create(&user).Error; err != nil {
		return model.User{}, err
	}

	return user, nil
}

func (r *GormUserRepository) UpdateUser(user model.User) (model.User, error) {
	current, err := r.GetUser(user.ID)
	if err != nil {
		return model.User{}, err
	}

	user.CreatedAt = current.CreatedAt
	user.UpdatedAt = time.Now().UTC()
	if err := r.db.Save(&user).Error; err != nil {
		return model.User{}, err
	}

	return user, nil
}

func (r *GormUserRepository) CreateSession(session model.Session) (model.Session, error) {
	now := time.Now().UTC()
	session.CreatedAt = now
	session.UpdatedAt = now
	if err := r.db.Create(&session).Error; err != nil {
		return model.Session{}, err
	}

	return session, nil
}

func (r *GormUserRepository) GetSession(id string) (model.Session, error) {
	var session model.Session
	if err := r.db.First(&session, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.Session{}, ErrSessionNotFound
		}
		return model.Session{}, err
	}

	return session, nil
}

func (r *GormUserRepository) RevokeSession(id string) error {
	now := time.Now().UTC()
	result := r.db.Model(&model.Session{}).
		Where("id = ?", id).
		Updates(map[string]any{"revoked_at": &now, "updated_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrSessionNotFound
	}

	return nil
}

func mapUserGormError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrUserNotFound
	}

	return err
}
