package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
)

func TestSeedanceMaterialServiceUsesConfiguredEndpointAndDedicatedSecret(t *testing.T) {
	var gotAuth string
	var gotAction string
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotAction = r.URL.Query().Get("Action")
		gotPath = r.URL.Path
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if len(body) != 1 || body["Id"] != "asset-1" {
			t.Fatalf("body = %#v", body)
		}
		if r.URL.Query().Get("Id") != "" {
			t.Fatalf("GetAsset Id must be sent only in JSON body: %s", r.URL.RawQuery)
		}
		_, _ = w.Write([]byte(`{"Result":{"Id":"asset-1","Status":"Active"}}`))
	}))
	defer server.Close()

	svc := newSeedanceMaterialTestService(t, server.URL+"/api/material", "provider-key", map[string]string{SeedanceMaterialSecretKey: "material-key"})
	raw, err := svc.GetAsset(context.Background(), "asset-1")
	if err != nil {
		t.Fatalf("GetAsset error: %v", err)
	}
	if gotAuth != "Bearer material-key" {
		t.Fatalf("Authorization = %q", gotAuth)
	}
	if gotAction != "GetAsset" || gotPath != "/api/material" {
		t.Fatalf("endpoint = path %q action %q", gotPath, gotAction)
	}
	if status := seedanceMaterialString(raw, "Status"); status != "Active" {
		t.Fatalf("status = %q", status)
	}
}

func TestSeedanceMaterialServicePropagatesBusinessErrorAndBlocksInactiveAsset(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		switch body["Id"] {
		case "bad":
			_, _ = w.Write([]byte(`{"Result":{"Error":{"Code":"InvalidAsset","Message":"asset does not exist"}}}`))
		default:
			_, _ = w.Write([]byte(`{"Result":{"Id":"pending","Status":"Pending"}}`))
		}
	}))
	defer server.Close()

	svc := newSeedanceMaterialTestService(t, server.URL+"/api/material", "provider-key", nil)
	if _, err := svc.GetAsset(context.Background(), "bad"); err == nil || !strings.Contains(err.Error(), "asset does not exist") {
		t.Fatalf("GetAsset error = %v", err)
	}
	if err := svc.EnsureAssetsActive(context.Background(), []string{"pending"}); err == nil || !strings.Contains(err.Error(), "status=pending") {
		t.Fatalf("EnsureAssetsActive error = %v", err)
	}
}

func TestSanitizeMaterialResponseKeepsValidationSessionTokenOnly(t *testing.T) {
	raw := map[string]any{
		"Result": map[string]any{
			"BytedToken":  "session-token",
			"H5Link":      "https://validate.example.test/session",
			"AccessToken": "provider-token",
			"api_key":     "provider-key",
		},
		"Authorization": "Bearer provider-key",
	}

	sanitized := sanitizeMaterialResponse(raw)
	result := mapFromAny(sanitized["Result"])
	if result["BytedToken"] != "session-token" {
		t.Fatalf("BytedToken = %v, want validation session token", result["BytedToken"])
	}
	if result["H5Link"] != "https://validate.example.test/session" {
		t.Fatalf("H5Link = %v", result["H5Link"])
	}
	if result["AccessToken"] != "***" || result["api_key"] != "***" || sanitized["Authorization"] != "***" {
		t.Fatalf("provider credentials were not redacted: %#v", sanitized)
	}
}

func newSeedanceMaterialTestService(t *testing.T, baseURL string, apiKey string, secrets map[string]string) *SeedanceMaterialService {
	t.Helper()
	secretBox := provider.NewSecretBox("unit-test-secret")
	encryptedKey, err := secretBox.Encrypt(apiKey)
	if err != nil {
		t.Fatalf("encrypt api key: %v", err)
	}
	encryptedSecrets := make(map[string]string)
	for key, value := range secrets {
		encrypted, err := secretBox.Encrypt(value)
		if err != nil {
			t.Fatalf("encrypt secret %s: %v", key, err)
		}
		encryptedSecrets[key] = encrypted
	}
	repo := repository.NewMemoryModelProviderRepository()
	_, err = repo.UpsertModelProvider(model.ModelProviderConfig{
		ID:               "seedance",
		Name:             "Seedance",
		PresetID:         "volcengine_seedance",
		ProviderType:     model.ModelProviderTypeVolcengineArk,
		Mode:             model.ModelProviderModeOpenAICompatible,
		BaseURL:          "https://ark.example.test/api/v3",
		AuthType:         model.ModelProviderAuthTypeBearer,
		APIKeyEncrypted:  encryptedKey,
		VideoModel:       "seedance-1-0-pro",
		Capabilities:     testJSONB(t, []string{model.ModelCapabilityVideo}),
		DefaultFor:       testJSONB(t, []string{model.ModelCapabilityVideo}),
		SecretsEncrypted: testJSONB(t, encryptedSecrets),
		EndpointOverrides: testJSONB(t, map[string]string{
			"material_base_url":  baseURL,
			"material_get_asset": "?Action=GetAsset",
		}),
		TimeoutMS: model.ModelProviderDefaultTimeoutMilli,
		Enabled:   true,
	})
	if err != nil {
		t.Fatalf("upsert provider: %v", err)
	}
	return NewSeedanceMaterialService(repo, secretBox)
}

func testJSONB(t *testing.T, value any) model.JSONB {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal jsonb: %v", err)
	}
	return model.JSONB(data)
}
