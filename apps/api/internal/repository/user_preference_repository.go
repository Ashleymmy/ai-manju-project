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
	Modify(userID string, change func(model.UserPreference) (model.UserPreference, error)) (model.UserPreference, error)
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
	return r.upsertLocked(preference), nil
}

func (r *MemoryUserPreferenceRepository) upsertLocked(preference model.UserPreference) model.UserPreference {

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

	return preference
}

// Modify keeps the read/merge/write atomic, including the first preference save.
func (r *MemoryUserPreferenceRepository) Modify(userID string, change func(model.UserPreference) (model.UserPreference, error)) (model.UserPreference, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	current := r.preferences[userID]
	current.Generation = append(model.JSONB(nil), current.Generation...)
	current.Shortcuts = append(model.JSONB(nil), current.Shortcuts...)
	current.Canvas = append(model.JSONB(nil), current.Canvas...)
	next, err := change(current)
	if err != nil {
		return model.UserPreference{}, err
	}
	next.UserID = userID
	return r.upsertLocked(next), nil
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

func (r *GormUserPreferenceRepository) Modify(userID string, change func(model.UserPreference) (model.UserPreference, error)) (model.UserPreference, error) {
	var result model.UserPreference
	err := r.db.Transaction(func(tx *gorm.DB) error {
		initial := model.UserPreference{ID: "pref_" + randomRepositoryHex(8), UserID: userID,
			Generation: model.JSONB(`{}`), Shortcuts: model.JSONB(`{}`), Canvas: model.JSONB(`{}`)}
		if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}}, DoNothing: true}).Create(&initial).Error; err != nil {
			return err
		}
		var current model.UserPreference
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&current, "user_id = ?", userID).Error; err != nil {
			return err
		}
		next, err := change(current)
		if err != nil {
			return err
		}
		next.ID, next.UserID, next.CreatedAt = current.ID, userID, current.CreatedAt
		next.UpdatedAt = time.Now().UTC()
		if err := tx.Save(&next).Error; err != nil {
			return err
		}
		result = next
		return nil
	})
	return result, err
}
