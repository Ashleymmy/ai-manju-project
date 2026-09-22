package repository

import (
	"bytes"
	"encoding/json"
	"errors"

	"github.com/ai-manju/api/internal/model"
)

// ErrModelProviderAccessDenied is safe to return without disclosing provider details.
var ErrModelProviderAccessDenied = errors.New("当前账号无权使用此模型通道")

// ForUserModelProviders applies the same policy to Memory and Gorm repositories.
// An absent actor cannot use restricted providers, including in background work.
func ForUserModelProviders(repo ModelProviderRepository, user model.User) ModelProviderRepository {
	return &userModelProviders{ModelProviderRepository: repo, user: user}
}

type userModelProviders struct {
	ModelProviderRepository
	user model.User
}

func (r *userModelProviders) allowed(config model.ModelProviderConfig) bool {
	if r.user.Role == model.UserRoleSuperAdmin {
		return true
	}
	var ids []string
	// The shared JSONB type scans SQL NULL and writes zero values as {}.
	// Treat only that empty object as an unset policy, consistently with Memory.
	if bytes.Equal(bytes.TrimSpace(config.AllowedUserIDs), []byte("{}")) {
		return true
	}
	if len(config.AllowedUserIDs) > 0 && json.Unmarshal(config.AllowedUserIDs, &ids) != nil {
		return false // Malformed policies must never silently become public.
	}
	if len(ids) == 0 {
		return true
	}
	for _, id := range ids {
		if id != "" && id == r.user.ID {
			return true
		}
	}
	return false
}

func (r *userModelProviders) ListModelProviders() ([]model.ModelProviderConfig, error) {
	configs, err := r.ModelProviderRepository.ListModelProviders()
	if err != nil {
		return nil, err
	}
	visible := make([]model.ModelProviderConfig, 0, len(configs))
	for _, config := range configs {
		if r.allowed(config) {
			visible = append(visible, config)
		}
	}
	return visible, nil
}

func (r *userModelProviders) GetModelProvider(id string) (model.ModelProviderConfig, error) {
	config, err := r.ModelProviderRepository.GetModelProvider(id)
	if err == nil && !r.allowed(config) {
		return model.ModelProviderConfig{}, ErrModelProviderAccessDenied
	}
	return config, err
}

func (r *userModelProviders) GetDefaultModelProvider() (model.ModelProviderConfig, error) {
	return r.GetModelProvider(model.ModelProviderIDDefault)
}

func (r *userModelProviders) UpsertModelProvider(config model.ModelProviderConfig) (model.ModelProviderConfig, error) {
	if config.ID == "" {
		config.ID = model.ModelProviderIDDefault
	}
	current, err := r.GetModelProvider(config.ID)
	if err != nil && !errors.Is(err, ErrModelProviderNotFound) {
		return model.ModelProviderConfig{}, err
	}
	// Saving a preset or reusing an ID must not clear the operator-managed policy.
	config.AllowedUserIDs = current.AllowedUserIDs
	return r.ModelProviderRepository.UpsertModelProvider(config)
}

func (r *userModelProviders) UpsertDefaultModelProvider(config model.ModelProviderConfig) (model.ModelProviderConfig, error) {
	config.ID = model.ModelProviderIDDefault
	return r.UpsertModelProvider(config)
}

func (r *userModelProviders) DeleteModelProvider(id string) error {
	if _, err := r.GetModelProvider(id); err != nil {
		return err
	}
	return r.ModelProviderRepository.DeleteModelProvider(id)
}
