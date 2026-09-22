package repository

import (
	"errors"
	"testing"

	"github.com/ai-manju/api/internal/model"
)

func TestProviderAllowlistUsesAccountIDsAndOnlySuperAdminBypasses(t *testing.T) {
	repo := NewMemoryModelProviderRepository()
	_, _ = repo.UpsertModelProvider(model.ModelProviderConfig{ID: "private", AllowedUserIDs: model.JSONB(`["allowed"]`)})
	_, _ = repo.UpsertModelProvider(model.ModelProviderConfig{ID: "public"})
	for _, tc := range []struct {
		name    string
		user    model.User
		allowed bool
	}{
		{"allowed after rename", model.User{ID: "allowed", Username: "renamed", Role: model.UserRoleMember}, true},
		{"super admin", model.User{ID: "boss", Role: model.UserRoleSuperAdmin}, true},
		{"same display name", model.User{ID: "other", Username: "ysc", DisplayName: "杨思超", Role: model.UserRoleMember}, false},
		{"ops admin", model.User{ID: "ops", Role: model.UserRoleOpsAdmin}, false},
		{"auditor", model.User{ID: "audit", Role: model.UserRoleAuditor}, false},
		{"no actor", model.User{}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			scoped := ForUserModelProviders(repo, tc.user)
			_, err := scoped.GetModelProvider("private")
			if tc.allowed != (err == nil) || (!tc.allowed && !errors.Is(err, ErrModelProviderAccessDenied)) {
				t.Fatalf("access=%v err=%v", tc.allowed, err)
			}
			configs, err := scoped.ListModelProviders()
			if err != nil {
				t.Fatal(err)
			}
			want := 1
			if tc.allowed {
				want++
			}
			if len(configs) != want {
				t.Fatalf("visible=%d want=%d", len(configs), want)
			}
		})
	}
	admin := ForUserModelProviders(repo, model.User{Role: model.UserRoleSuperAdmin})
	updated, err := admin.UpsertModelProvider(model.ModelProviderConfig{ID: "private", Name: "new preset"})
	if err != nil || string(updated.AllowedUserIDs) != `["allowed"]` {
		t.Fatalf("policy lost on save: %v", err)
	}
	denied := ForUserModelProviders(repo, model.User{ID: "other"})
	if _, err := denied.UpsertModelProvider(model.ModelProviderConfig{ID: "private"}); !errors.Is(err, ErrModelProviderAccessDenied) {
		t.Fatalf("upsert bypass: %v", err)
	}
	if err := denied.DeleteModelProvider("private"); !errors.Is(err, ErrModelProviderAccessDenied) {
		t.Fatalf("delete bypass: %v", err)
	}
}

func TestProviderMalformedAllowlistFailsClosed(t *testing.T) {
	repo := NewMemoryModelProviderRepository()
	for _, raw := range []string{`{"allow":[]}`, `[5]`, `[""]`, `invalid`} {
		_, _ = repo.UpsertModelProvider(model.ModelProviderConfig{ID: "bad", AllowedUserIDs: model.JSONB(raw)})
		if _, err := ForUserModelProviders(repo, model.User{ID: "member"}).GetModelProvider("bad"); !errors.Is(err, ErrModelProviderAccessDenied) {
			t.Fatalf("policy %s allowed access", raw)
		}
	}
}

func TestProviderUnsetPolicyMatchesDatabaseJSONBRoundTrip(t *testing.T) {
	for _, raw := range []any{nil, []byte(`{}`), []byte(`[]`), []byte(`null`)} {
		var policy model.JSONB
		if err := policy.Scan(raw); err != nil {
			t.Fatal(err)
		}
		repo := NewMemoryModelProviderRepository()
		_, _ = repo.UpsertModelProvider(model.ModelProviderConfig{ID: "public", AllowedUserIDs: policy})
		if _, err := ForUserModelProviders(repo, model.User{ID: "member"}).GetModelProvider("public"); err != nil {
			t.Fatalf("unset policy blocked: %v", err)
		}
	}
}
