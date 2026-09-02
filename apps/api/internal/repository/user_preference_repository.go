package repository

import (
	"errors"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrUserPreferenceNotFound = errors.New("user preference not found")

type UserPreferenceRepository interface {
	GetByUser(userID string) (model.UserPreference, error)
	Upsert(preference model.UserPreference) (model.UserPreference, error)
}

type MemoryUserPreferenceRepository struct {
	mu          sync.RWMutex
	preferences map[string]model.UserPreference
}

func NewMemoryUserPreferenceRepository() *MemoryUserPreferenceRepository {
	return &MemoryUserPreferenceRepository{preferences: make(map[string]model.UserPreference)}
}

func (r *MemoryUserPreferenceRepository) GetByUser(userID string) (model.UserPreference, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	preference, ok := r.preferences[userID]
	if !ok {
		return model.UserPreference{}, ErrUserPreferenceNotFound
	}

	return preference, nil
}

func (r *MemoryUserPreferenceRepository) Upsert(preference model.UserPreference) (model.UserPreference, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	current, exists := r.preferences[preference.UserID]
	if preference.ID == "" {
		preference.ID = current.ID
	}
	if preference.ID == "" {
		preference.ID = "pref_" + randomRepositoryHex(8)
	}
	if exists {
		preference.CreatedAt = current.CreatedAt
	} else {
		preference.CreatedAt = now
	}
	preference.UpdatedAt = now
	r.preferences[preference.UserID] = preference

	return preference, nil
}

type GormUserPreferenceRepository struct {
	db *gorm.DB
}

func NewGormUserPreferenceRepository(db *gorm.DB) *GormUserPreferenceRepository {
	return &GormUserPreferenceRepository{db: db}
}

func (r *GormUserPreferenceRepository) GetByUser(userID string) (model.UserPreference, error) {
	var preference model.UserPreference
	if err := r.db.First(&preference, "user_id = ?", userID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.UserPreference{}, ErrUserPreferenceNotFound
		}
		return model.UserPreference{}, err
	}

	return preference, nil
}

func (r *GormUserPreferenceRepository) Upsert(preference model.UserPreference) (model.UserPreference, error) {
	now := time.Now().UTC()
	current, err := r.GetByUser(preference.UserID)
	if err == nil {
		preference.ID = current.ID
		preference.CreatedAt = current.CreatedAt
	} else if errors.Is(err, ErrUserPreferenceNotFound) {
		if preference.ID == "" {
			preference.ID = "pref_" + randomRepositoryHex(8)
		}
		preference.CreatedAt = now
	} else {
		return model.UserPreference{}, err
	}
	preference.UpdatedAt = now

	if err := r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}},
		UpdateAll: true,
	}).Create(&preference).Error; err != nil {
		return model.UserPreference{}, err
	}

	return preference, nil
}
