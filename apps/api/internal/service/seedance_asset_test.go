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

func TestSeedanceAssetServiceRegisterURLCreatesGroupAndUsesDedicatedSecret(t *testing.T) {
	var authHeaders []string
	var createAssetPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeaders = append(authHeaders, r.Header.Get("Authorization"))
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/asset/groups":
			_ = json.NewEncoder(w).Encode(map[string]any{"Items": []any{}})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/create/asset/group":
			_ = json.NewEncoder(w).Encode(map[string]any{"Result": map[string]any{"GroupId": "group-1"}})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/create/asset":
			if err := json.NewDecoder(r.Body).Decode(&createAssetPayload); err != nil {
				t.Fatalf("decode create asset payload: %v", err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"Result": map[string]any{"AssetID": "asset-1", "Status": "Processing"}})
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.String())
		}
	}))
	defer server.Close()

	svc, _ := newSeedanceAssetTestService(t, server.URL, "provider-key", map[string]string{VolcanoAssetSecretKey: "asset-key"})
	asset, err := svc.RegisterAssetFromURL(context.Background(), SeedanceAssetRegisterURLInput{
		Name:      "digital human",
		AssetType: model.SeedanceAssetTypeImage,
		SourceURL: "https://assets.example.test/person.png",
		CreatedBy: "admin",
	})
	if err != nil {
		t.Fatalf("RegisterAssetFromURL error: %v", err)
	}
	if asset.VolcanoAssetID != "asset-1" || asset.Status != model.SeedanceAssetStatusProcessing {
		t.Fatalf("asset = %#v", asset)
	}
	for _, got := range authHeaders {
		if got != "Bearer asset-key" {
			t.Fatalf("Authorization = %q", got)
		}
	}
	if createAssetPayload["GroupId"] != "group-1" || createAssetPayload["URL"] != "https://assets.example.test/person.png" {
		t.Fatalf("create asset payload = %#v", createAssetPayload)
	}
	if _, ok := createAssetPayload["ProjectName"]; ok {
		t.Fatalf("create asset payload should match sd-video without ProjectName: %#v", createAssetPayload)
	}
}

func TestSeedanceAssetServiceSyncAndEnsureActive(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer provider-key" {
			t.Fatalf("Authorization = %q", r.Header.Get("Authorization"))
		}
		if r.Method != http.MethodPost || r.URL.Path != "/v1/asset/list" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.String())
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"Items": []map[string]any{
				{"Id": "asset-active", "GroupId": "group-1", "Name": "active asset", "AssetType": "Image", "Status": "Active"},
			},
		})
	}))
	defer server.Close()

	svc, assetRepo := newSeedanceAssetTestService(t, server.URL, "provider-key", nil)
	if _, err := assetRepo.UpsertGroup(model.SeedanceAssetGroup{
		ID:             "group-local",
		ProviderID:     "seedance",
		VolcanoGroupID: "group-1",
		Name:           model.SeedanceAssetGroupDefaultName,
		GroupType:      model.SeedanceAssetGroupTypeAIGC,
		ProjectName:    model.SeedanceAssetProjectDefault,
	}); err != nil {
		t.Fatalf("upsert group: %v", err)
	}
	if _, err := assetRepo.UpsertAsset(model.SeedanceAsset{ID: "local-active", ProviderID: "seedance", VolcanoAssetID: "asset-active", VolcanoGroupID: "group-1", Status: model.SeedanceAssetStatusProcessing, AssetType: model.SeedanceAssetTypeImage}); err != nil {
		t.Fatalf("upsert active asset: %v", err)
	}
	if _, err := assetRepo.UpsertAsset(model.SeedanceAsset{ID: "local-pending", ProviderID: "seedance", VolcanoAssetID: "asset-pending", VolcanoGroupID: "group-1", Status: model.SeedanceAssetStatusProcessing, AssetType: model.SeedanceAssetTypeImage}); err != nil {
		t.Fatalf("upsert pending asset: %v", err)
	}

	count, err := svc.SyncAssets(context.Background())
	if err != nil {
		t.Fatalf("SyncAssets error: %v", err)
	}
	if count != 1 {
		t.Fatalf("sync count = %d", count)
	}
	if err := svc.EnsureAssetsActive(context.Background(), []string{"asset-active"}); err != nil {
		t.Fatalf("EnsureAssetsActive active error: %v", err)
	}
	if err := svc.EnsureAssetsActive(context.Background(), []string{"asset-pending"}); err == nil || !strings.Contains(err.Error(), "status=Processing") {
		t.Fatalf("EnsureAssetsActive pending error = %v", err)
	}
}

func TestSeedanceAssetServiceRegisterURLPrefersSeedanceProxyVolcanoAssetEndpoints(t *testing.T) {
	var createAssetPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer provider-key" {
			t.Fatalf("Authorization = %q", r.Header.Get("Authorization"))
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/asset/groups":
			_ = json.NewEncoder(w).Encode(map[string]any{"items": []any{}})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/create/asset/group":
			_ = json.NewEncoder(w).Encode(map[string]any{"Result": map[string]any{"Id": "group-ts"}})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/create/asset":
			if err := json.NewDecoder(r.Body).Decode(&createAssetPayload); err != nil {
				t.Fatalf("decode create asset payload: %v", err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"Result": map[string]any{"Id": "asset-ts", "Status": "Active"}})
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.String())
		}
	}))
	defer server.Close()

	svc, _ := newSeedanceProxyAssetTestService(t, server.URL, server.URL+"/api/material", "provider-key", nil)
	asset, err := svc.RegisterAssetFromURL(context.Background(), SeedanceAssetRegisterURLInput{
		Name:      "token space asset",
		AssetType: model.SeedanceAssetTypeImage,
		SourceURL: "https://assets.example.test/person.jpeg?token=abc",
		CreatedBy: "admin",
	})
	if err != nil {
		t.Fatalf("RegisterAssetFromURL error: %v", err)
	}
	if asset.ProviderID != "seedance-material" || asset.VolcanoAssetID != "asset-ts" || asset.Status != model.SeedanceAssetStatusActive {
		t.Fatalf("asset = %#v", asset)
	}
	if createAssetPayload["GroupId"] != "group-ts" || createAssetPayload["URL"] != "https://assets.example.test/person.jpeg?token=abc" {
		t.Fatalf("create asset payload = %#v", createAssetPayload)
	}
	if _, ok := createAssetPayload["ProjectName"]; ok {
		t.Fatalf("create asset payload should match sd-video without ProjectName: %#v", createAssetPayload)
	}
}

func TestSeedanceAssetServiceRegisterURLUsesMaterialOnlyProvider(t *testing.T) {
	var createAssetPayload map[string]any
	var getAssetPayload map[string]any
	var deleteAssetPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/material" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.String())
		}
		if r.Header.Get("Authorization") != "Bearer material-key" {
			t.Fatalf("Authorization = %q", r.Header.Get("Authorization"))
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode material payload: %v", err)
		}
		switch r.URL.Query().Get("Action") {
		case "CreateAssetGroup":
			if payload["Name"] != model.SeedanceAssetGroupDefaultName || payload["Description"] != "digital human asset library" {
				t.Fatalf("create group payload = %#v", payload)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"Result": map[string]any{"Id": "group-material", "GroupType": 1}})
		case "CreateAsset":
			createAssetPayload = payload
			_ = json.NewEncoder(w).Encode(map[string]any{"Result": map[string]any{"Id": "asset-material"}})
		case "GetAsset":
			getAssetPayload = payload
			_ = json.NewEncoder(w).Encode(map[string]any{"Result": map[string]any{
				"Id": "asset-material", "GroupId": "group-material", "Name": "material active", "AssetType": "Image", "Status": "Active",
			}})
		case "DeleteAsset":
			deleteAssetPayload = payload
			_ = json.NewEncoder(w).Encode(map[string]any{"Result": map[string]any{}})
		default:
			t.Fatalf("unexpected material action %q", r.URL.Query().Get("Action"))
		}
	}))
	defer server.Close()

	svc, _ := newSeedanceMaterialAssetTestService(t, "", server.URL+"/api/material", "provider-key", map[string]string{SeedanceMaterialSecretKey: "material-key"})
	readiness := svc.Readiness()
	if !readiness.ProviderConfigured || readiness.ProviderProtocol != SeedanceAssetProviderProtocolMaterial || readiness.MaterialInitializationURL != SeedanceMaterialInitializationURL {
		t.Fatalf("readiness = %#v", readiness)
	}
	asset, err := svc.RegisterAssetFromURL(context.Background(), SeedanceAssetRegisterURLInput{
		Name:      "token space material",
		AssetType: model.SeedanceAssetTypeImage,
		SourceURL: "https://assets.example.test/person.jpeg?token=abc",
		CreatedBy: "admin",
	})
	if err != nil {
		t.Fatalf("RegisterAssetFromURL error: %v", err)
	}
	if asset.VolcanoAssetID != "asset-material" || asset.VolcanoGroupID != "group-material" || asset.Status != model.SeedanceAssetStatusProcessing {
		t.Fatalf("asset = %#v", asset)
	}
	if len(createAssetPayload) != 4 || createAssetPayload["GroupId"] != "group-material" || createAssetPayload["URL"] != "https://assets.example.test/person.jpeg?token=abc" || createAssetPayload["Name"] != "token space material" || createAssetPayload["AssetType"] != "Image" {
		t.Fatalf("create asset payload = %#v", createAssetPayload)
	}

	count, err := svc.PollPendingOnce(context.Background())
	if err != nil || count != 1 {
		t.Fatalf("PollPendingOnce count=%d err=%v", count, err)
	}
	asset, err = svc.GetAsset(asset.ID)
	if err != nil {
		t.Fatalf("GetAsset error: %v", err)
	}
	if asset.Status != model.SeedanceAssetStatusActive || asset.Name != "material active" {
		t.Fatalf("polled asset = %#v", asset)
	}
	if len(getAssetPayload) != 1 || getAssetPayload["Id"] != "asset-material" {
		t.Fatalf("get asset payload = %#v", getAssetPayload)
	}

	if err := svc.DeleteAsset(context.Background(), asset.ID); err != nil {
		t.Fatalf("DeleteAsset error: %v", err)
	}
	if len(deleteAssetPayload) != 1 || deleteAssetPayload["Id"] != "asset-material" {
		t.Fatalf("delete asset payload = %#v", deleteAssetPayload)
	}
	listed, err := svc.ListAssets(SeedanceAssetListInput{})
	if err != nil || listed.Total != 0 {
		t.Fatalf("ListAssets total=%d err=%v", listed.Total, err)
	}
}

func TestSeedanceAssetProviderCandidateRequiresCompleteVolcanoEndpoints(t *testing.T) {
	config := model.ModelProviderConfig{
		PresetID:     "openai_compatible_custom",
		ProviderType: model.ModelProviderTypeOpenAICompatible,
		VideoModel:   "doubao-seedance-2-0-mini-260615",
		EndpointOverrides: testJSONB(t, map[string]string{
			VolcanoAssetEndpointBaseURL: "https://assets.example.test",
			VolcanoAssetEndpointCreate:  "/v1/create/asset",
			VolcanoAssetEndpointList:    "/v1/asset/list",
		}),
	}
	if _, _, ok := seedanceAssetProviderCandidate(config); ok {
		t.Fatal("incomplete volcano_asset_* configuration must not be accepted")
	}
}

func TestSeedanceAssetProviderCandidateRequiresCompleteMaterialEndpoints(t *testing.T) {
	config := model.ModelProviderConfig{
		PresetID:     "openai_compatible_custom",
		ProviderType: model.ModelProviderTypeOpenAICompatible,
		VideoModel:   "doubao-seedance-2-0-mini-260615",
		EndpointOverrides: testJSONB(t, map[string]string{
			"material_base_url":                    "https://api.tokenspace.net.cn/api/material",
			SeedanceMaterialActionCreateAssetGroup: "?Action=CreateAssetGroup",
			SeedanceMaterialActionCreateAsset:      "?Action=CreateAsset",
			SeedanceMaterialActionGetAsset:         "?Action=GetAsset",
		}),
	}
	if _, _, ok := seedanceAssetProviderCandidate(config); ok {
		t.Fatal("incomplete material_* configuration must not be accepted")
	}
	config.EndpointOverrides = testJSONB(t, map[string]string{
		"material_base_url":                    "https://api.tokenspace.net.cn/api/material",
		SeedanceMaterialActionCreateAssetGroup: "?Action=CreateAssetGroup",
		SeedanceMaterialActionGetAssetGroup:    "?Action=GetAssetGroup",
		SeedanceMaterialActionDeleteAssetGroup: "?Action=DeleteAssetGroup",
		SeedanceMaterialActionCreateAsset:      "?Action=CreateAsset",
		SeedanceMaterialActionGetAsset:         "?Action=GetAsset",
		SeedanceMaterialActionDeleteAsset:      "?Action=DeleteAsset",
	})
	_, kind, ok := seedanceAssetProviderCandidate(config)
	if !ok || kind != seedanceAssetProviderMaterial {
		t.Fatalf("complete material_* provider kind=%q ok=%v", kind, ok)
	}
}
func TestSeedanceAssetServiceReadinessReportsUploadPrerequisite(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("readiness must not call the upstream provider: %s %s", r.Method, r.URL.String())
	}))
	defer server.Close()

	svc, _ := newSeedanceAssetTestService(t, server.URL, "provider-key", nil)
	readiness := svc.Readiness()
	if !readiness.ProviderConfigured || readiness.ProviderID != "seedance" || readiness.ProviderProtocol != SeedanceAssetProviderProtocolVolcano {
		t.Fatalf("provider readiness = %#v", readiness)
	}
	if readiness.PublicAssetBaseURLConfigured || readiness.UploadRegistrationAvailable {
		t.Fatalf("upload should be unavailable without PUBLIC_ASSET_BASE_URL: %#v", readiness)
	}

	svc.publicAssetBaseURL = "https://assets.example.test"
	readiness = svc.Readiness()
	if !readiness.PublicAssetBaseURLConfigured || !readiness.UploadRegistrationAvailable {
		t.Fatalf("upload should be available with PUBLIC_ASSET_BASE_URL: %#v", readiness)
	}
}

func TestDefaultSeedanceAssetEndpointOverridesDoesNotInferProjectSpecificTokenSpaceProxyBase(t *testing.T) {
	overrides := DefaultSeedanceAssetEndpointOverrides(model.ModelProviderConfig{
		PresetID:     "openai_compatible_custom",
		ProviderType: model.ModelProviderTypeOpenAICompatible,
		BaseURL:      "https://api.tokenspace.net.cn",
		VideoModel:   "doubao-seedance-2-0-mini-260615",
	})
	if _, ok := overrides[VolcanoAssetEndpointBaseURL]; ok {
		t.Fatalf("volcano asset base_url should not be inferred for project-specific proxy: %#v", overrides)
	}
}

func newSeedanceAssetTestService(t *testing.T, baseURL string, apiKey string, secrets map[string]string) (*SeedanceAssetService, *repository.MemorySeedanceAssetRepository) {
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
	providerRepo := repository.NewMemoryModelProviderRepository()
	if _, err := providerRepo.UpsertModelProvider(model.ModelProviderConfig{
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
			VolcanoAssetEndpointBaseURL:     baseURL,
			VolcanoAssetEndpointListGroups:  "/v1/asset/groups?limit=100&offset=0",
			VolcanoAssetEndpointCreateGroup: "/v1/create/asset/group",
			VolcanoAssetEndpointCreate:      "/v1/create/asset",
			VolcanoAssetEndpointList:        "/v1/asset/list",
			VolcanoAssetEndpointDelete:      "/v1/delete/asset",
		}),
		TimeoutMS: model.ModelProviderDefaultTimeoutMilli,
		Enabled:   true,
	}); err != nil {
		t.Fatalf("upsert provider: %v", err)
	}
	assetRepo := repository.NewMemorySeedanceAssetRepository()
	return NewSeedanceAssetService(providerRepo, assetRepo, secretBox, nil, ""), assetRepo
}

func newSeedanceProxyAssetTestService(t *testing.T, baseURL string, materialBaseURL string, apiKey string, secrets map[string]string) (*SeedanceAssetService, *repository.MemorySeedanceAssetRepository) {
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
	endpointOverrides := map[string]string{
		"material_base_url":                    materialBaseURL,
		SeedanceMaterialActionCreateAssetGroup: "?Action=CreateAssetGroup",
		SeedanceMaterialActionGetAssetGroup:    "?Action=GetAssetGroup",
		SeedanceMaterialActionDeleteAssetGroup: "?Action=DeleteAssetGroup",
		SeedanceMaterialActionCreateAsset:      "?Action=CreateAsset",
		SeedanceMaterialActionGetAsset:         "?Action=GetAsset",
		SeedanceMaterialActionDeleteAsset:      "?Action=DeleteAsset",
	}
	if strings.TrimSpace(baseURL) != "" {
		endpointOverrides[VolcanoAssetEndpointBaseURL] = baseURL
		endpointOverrides[VolcanoAssetEndpointListGroups] = "/v1/asset/groups?limit=100&offset=0"
		endpointOverrides[VolcanoAssetEndpointCreateGroup] = "/v1/create/asset/group"
		endpointOverrides[VolcanoAssetEndpointCreate] = "/v1/create/asset"
		endpointOverrides[VolcanoAssetEndpointList] = "/v1/asset/list"
		endpointOverrides[VolcanoAssetEndpointDelete] = "/v1/delete/asset"
	}
	providerRepo := repository.NewMemoryModelProviderRepository()
	if _, err := providerRepo.UpsertModelProvider(model.ModelProviderConfig{
		ID:                 "seedance-material",
		Name:               "TokenSpace Seedance",
		PresetID:           "openai_compatible_custom",
		ProviderType:       model.ModelProviderTypeOpenAICompatible,
		Mode:               model.ModelProviderModeOpenAICompatible,
		BaseURL:            baseURL,
		AuthType:           model.ModelProviderAuthTypeBearer,
		APIKeyEncrypted:    encryptedKey,
		VideoModel:         "doubao-seedance-2-0-mini-260615",
		Capabilities:       testJSONB(t, []string{model.ModelCapabilityVideo}),
		ModelsByCapability: testJSONB(t, map[string][]string{model.ModelCapabilityVideo: {"doubao-seedance-2-0-mini-260615"}}),
		DefaultFor:         testJSONB(t, []string{model.ModelCapabilityVideo}),
		SecretsEncrypted:   testJSONB(t, encryptedSecrets),
		EndpointOverrides:  testJSONB(t, endpointOverrides),
		TimeoutMS:          model.ModelProviderDefaultTimeoutMilli,
		Enabled:            true,
	}); err != nil {
		t.Fatalf("upsert provider: %v", err)
	}
	assetRepo := repository.NewMemorySeedanceAssetRepository()
	return NewSeedanceAssetService(providerRepo, assetRepo, secretBox, nil, ""), assetRepo
}

func newSeedanceMaterialAssetTestService(t *testing.T, baseURL string, materialBaseURL string, apiKey string, secrets map[string]string) (*SeedanceAssetService, *repository.MemorySeedanceAssetRepository) {
	t.Helper()
	return newSeedanceProxyAssetTestService(t, baseURL, materialBaseURL, apiKey, secrets)
}
