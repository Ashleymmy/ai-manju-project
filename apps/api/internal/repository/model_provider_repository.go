package repository

import (
	"errors"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/gorm"
)

var ErrModelProviderNotFound = errors.New("model provider not found")

type ModelProviderRepository interface {
	ListModelProviders() ([]model.ModelProviderConfig, error)
	GetModelProvider(id string) (model.ModelProviderConfig, error)
	UpsertModelProvider(config model.ModelProviderConfig) (model.ModelProviderConfig, error)
	DeleteModelProvider(id string) error
	GetDefaultModelProvider() (model.ModelProviderConfig, error)
	UpsertDefaultModelProvider(config model.ModelProviderConfig) (model.ModelProviderConfig, error)
}

type MemoryModelProviderRepository struct {
	mu      sync.RWMutex
	configs map[string]model.ModelProviderConfig
}

func NewMemoryModelProviderRepository() *MemoryModelProviderRepository {
	return &MemoryModelProviderRepository{configs: make(map[string]model.ModelProviderConfig)}
}

func (r *MemoryModelProviderRepository) ListModelProviders() ([]model.ModelProviderConfig, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	configs := make([]model.ModelProviderConfig, 0, len(r.configs))
	if config, ok := r.configs[model.ModelProviderIDDefault]; ok {
		configs = append(configs, config)
	}
	for id, config := range r.configs {
		if id == model.ModelProviderIDDefault {
			continue
		}
		configs = append(configs, config)
	}

	return configs, nil
}

func (r *MemoryModelProviderRepository) GetModelProvider(id string) (model.ModelProviderConfig, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	config, ok := r.configs[id]
	if !ok {
		return model.ModelProviderConfig{}, ErrModelProviderNotFound
	}

	return config, nil
}

func (r *MemoryModelProviderRepository) UpsertModelProvider(config model.ModelProviderConfig) (model.ModelProviderConfig, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	if config.ID == "" {
		config.ID = model.ModelProviderIDDefault
	}
	if current, ok := r.configs[config.ID]; ok {
		config.CreatedAt = current.CreatedAt
	} else {
		config.CreatedAt = now
	}
	config.UpdatedAt = now
	r.configs[config.ID] = config

	return config, nil
}

func (r *MemoryModelProviderRepository) DeleteModelProvider(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.configs[id]; !ok {
		return ErrModelProviderNotFound
	}
	delete(r.configs, id)
	return nil
}

func (r *MemoryModelProviderRepository) GetDefaultModelProvider() (model.ModelProviderConfig, error) {
	return r.GetModelProvider(model.ModelProviderIDDefault)
}

func (r *MemoryModelProviderRepository) UpsertDefaultModelProvider(config model.ModelProviderConfig) (model.ModelProviderConfig, error) {
	config.ID = model.ModelProviderIDDefault
	return r.UpsertModelProvider(config)
}

type GormModelProviderRepository struct {
	db *gorm.DB
}

func NewGormModelProviderRepository(db *gorm.DB) *GormModelProviderRepository {
	return &GormModelProviderRepository{db: db}
}

func (r *GormModelProviderRepository) ListModelProviders() ([]model.ModelProviderConfig, error) {
	var configs []model.ModelProviderConfig
	if err := r.db.Order("CASE WHEN id = 'default' THEN 0 ELSE 1 END, created_at ASC, id ASC").Find(&configs).Error; err != nil {
		return nil, err
	}
	return configs, nil
}

func (r *GormModelProviderRepository) GetModelProvider(id string) (model.ModelProviderConfig, error) {
	var config model.ModelProviderConfig
	if err := r.db.First(&config, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.ModelProviderConfig{}, ErrModelProviderNotFound
		}
		return model.ModelProviderConfig{}, err
	}

	return config, nil
}

func (r *GormModelProviderRepository) UpsertModelProvider(config model.ModelProviderConfig) (model.ModelProviderConfig, error) {
	if config.ID == "" {
		config.ID = model.ModelProviderIDDefault
	}
	current, err := r.GetModelProvider(config.ID)
	now := time.Now().UTC()
	config.UpdatedAt = now
	if err == nil {
		config.CreatedAt = current.CreatedAt
		return config, r.db.Save(&config).Error
	}
	if !errors.Is(err, ErrModelProviderNotFound) {
		return model.ModelProviderConfig{}, err
	}

	config.CreatedAt = now
	return config, r.db.Create(&config).Error
}

func (r *GormModelProviderRepository) DeleteModelProvider(id string) error {
	result := r.db.Delete(&model.ModelProviderConfig{}, "id = ?", id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrModelProviderNotFound
	}
	return nil
}

func (r *GormModelProviderRepository) GetDefaultModelProvider() (model.ModelProviderConfig, error) {
	return r.GetModelProvider(model.ModelProviderIDDefault)
}

func (r *GormModelProviderRepository) UpsertDefaultModelProvider(config model.ModelProviderConfig) (model.ModelProviderConfig, error) {
	config.ID = model.ModelProviderIDDefault
	return r.UpsertModelProvider(config)
}
