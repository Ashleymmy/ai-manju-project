package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
)

func TestComicProvidersUseCurrentInitiatingAccount(t *testing.T) {
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"output_text":"mock text"}`))
	}))
	defer upstream.Close()
	users := repository.NewMemoryUserRepository()
	for _, user := range []model.User{
		{ID: "allowed", Role: model.UserRoleMember, Status: model.UserStatusActive},
		{ID: "super", Role: model.UserRoleSuperAdmin, Status: model.UserStatusActive},
		{ID: "other", Role: model.UserRoleMember, Status: model.UserStatusActive},
		{ID: "disabled", Role: model.UserRoleSuperAdmin, Status: model.UserStatusDisabled},
	} {
		if _, err := users.CreateUser(user); err != nil {
			t.Fatal(err)
		}
	}
	providers := repository.NewMemoryModelProviderRepository()
	config := generationTestConfig("private", "shared-image")
	config.TextModel, config.BaseURL = "shared-text", upstream.URL+"/v1"
	config.AllowedUserIDs = model.JSONB(`["allowed"]`)
	if _, err := providers.UpsertModelProvider(config); err != nil {
		t.Fatal(err)
	}
	h := NewModelProviderHandler(providers, provider.NewSecretBox("test"))
	h.SetBackgroundUserRepository(users)
	for _, tc := range []struct {
		id      string
		allowed bool
	}{{"allowed", true}, {"super", true}, {"other", false}, {"disabled", false}, {"missing", false}, {"", false}} {
		t.Run(tc.id, func(t *testing.T) {
			before := calls.Load()
			text, textErr := h.GenerateBackgroundTextForUser(context.Background(), tc.id, "private::shared-text", provider.TextGenerationRequest{Prompt: "mock"})
			image, imageErr := h.ResolveBackgroundImageJobForUser(tc.id, "private::shared-image", model.JobTypeImageEdit)
			if tc.allowed {
				if textErr != nil || imageErr != nil || text.Text != "mock text" || image.Selector != "private::shared-image" || calls.Load()-before != 1 {
					t.Fatalf("authorized actor rejected: text=%v image=%v", textErr, imageErr)
				}
				return
			}
			if !errors.Is(textErr, repository.ErrModelProviderAccessDenied) || !errors.Is(imageErr, repository.ErrModelProviderAccessDenied) || calls.Load() != before {
				t.Fatalf("unauthorized actor reached provider: text=%v image=%v", textErr, imageErr)
			}
		})
	}

	// Public suppliers advertising the same model must never override an explicit
	// denied selection, or gain the private supplier as an unauthorized fallback.
	public := config
	public.ID, public.AllowedUserIDs = "public", nil
	if _, err := providers.UpsertModelProvider(public); err != nil {
		t.Fatal(err)
	}
	if _, err := h.ResolveBackgroundImageJobForUser("other", "private::shared-image"); !errors.Is(err, repository.ErrModelProviderAccessDenied) {
		t.Fatalf("explicit denied supplier fell back: %v", err)
	}
	image, err := h.ResolveBackgroundImageJobForUser("other", "public::shared-image")
	if err != nil || len(image.TaskKwargs["provider_candidates"].([]map[string]any)) != 1 {
		t.Fatalf("private fallback escaped filtering: %v", err)
	}

	// Neither the user role nor the provider policy is frozen at batch creation.
	config.AllowedUserIDs = model.JSONB(`["different-user"]`)
	if _, err := providers.UpsertModelProvider(config); err != nil {
		t.Fatal(err)
	}
	before := calls.Load()
	if _, err := h.GenerateBackgroundTextForUser(context.Background(), "allowed", "private::shared-text", provider.TextGenerationRequest{Prompt: "mock"}); !errors.Is(err, repository.ErrModelProviderAccessDenied) || calls.Load() != before {
		t.Fatalf("revoked provider policy ignored: %v", err)
	}
	super, _ := users.GetUser("super")
	super.Role = model.UserRoleMember
	if _, err := users.UpdateUser(super); err != nil {
		t.Fatal(err)
	}
	if _, err := h.ResolveBackgroundImageJobForUser("super", "private::shared-image"); !errors.Is(err, repository.ErrModelProviderAccessDenied) {
		t.Fatalf("revoked administrator role ignored: %v", err)
	}
	allowed, _ := users.GetUser("allowed")
	allowed.Status = model.UserStatusDisabled
	if _, err := users.UpdateUser(allowed); err != nil {
		t.Fatal(err)
	}
	if _, err := h.ResolveBackgroundImageJobForUser("allowed", "public::shared-image"); !errors.Is(err, repository.ErrModelProviderAccessDenied) {
		t.Fatalf("disabled actor reached public provider: %v", err)
	}
}
