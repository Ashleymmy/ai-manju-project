package providerpresetmigration

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
)

func TestApplyMigratesLegacySeedanceProviderWithoutOverwritingSecretsOrCustomFields(t *testing.T) {
	repo := repository.NewMemoryModelProviderRepository()
	legacy := model.ModelProviderConfig{
		ID:                "provider_5500cd09b9d56c5b",
		Name:              "中国移动api",
		Mode:              model.ModelProviderModeOpenAICompatible,
		BaseURL:           "https://operator.example/api/v3",
		AuthType:          model.ModelProviderAuthTypeBearer,
		APIKeyEncrypted:   "encrypted-production-key",
		VideoModel:        "doubao-seedance-2-0-mini-260615",
		EndpointOverrides: testJSONB(map[string]string{"video_create": "/custom/video/create"}),
		SecretsEncrypted:  testJSONB(map[string]string{"access_key": "encrypted-ak"}),
		ExtraHeaders:      testJSONB(map[string]string{"x-operator": "keep"}),
		TimeoutMS:         180000,
		Enabled:           true,
	}
	if _, err := repo.UpsertModelProvider(legacy); err != nil {
		t.Fatal(err)
	}

	result, err := Apply(repo)
	if err != nil {
		t.Fatal(err)
	}
	if result.Updated != 1 {
		t.Fatalf("Updated = %d, want 1; result = %+v", result.Updated, result)
	}
	migrated, err := repo.GetModelProvider(legacy.ID)
	if err != nil {
		t.Fatal(err)
	}

	if migrated.APIKeyEncrypted != legacy.APIKeyEncrypted {
		t.Fatalf("APIKeyEncrypted changed: %q", migrated.APIKeyEncrypted)
	}
	if migrated.BaseURL != legacy.BaseURL {
		t.Fatalf("BaseURL changed: %q", migrated.BaseURL)
	}
	if migrated.VideoModel != legacy.VideoModel {
		t.Fatalf("VideoModel changed: %q", migrated.VideoModel)
	}
	if migrated.AuthType != legacy.AuthType {
		t.Fatalf("AuthType changed: %q", migrated.AuthType)
	}
	if migrated.PresetID != "volcengine_seedance" {
		t.Fatalf("PresetID = %q, want volcengine_seedance", migrated.PresetID)
	}
	if migrated.ProviderType != model.ModelProviderTypeVolcengineArk {
		t.Fatalf("ProviderType = %q, want volcengine_ark", migrated.ProviderType)
	}

	models := testModelsByCapability(t, migrated.ModelsByCapability)
	if !reflect.DeepEqual(models[model.ModelCapabilityVideo], []string{legacy.VideoModel}) {
		t.Fatalf("video models = %#v", models[model.ModelCapabilityVideo])
	}
	defaultFor := testStringSlice(t, migrated.DefaultFor)
	if !reflect.DeepEqual(defaultFor, []string{model.ModelCapabilityVideo}) {
		t.Fatalf("default_for = %#v, want video", defaultFor)
	}
	overrides := testStringMap(t, migrated.EndpointOverrides)
	if overrides["video_create"] != "/custom/video/create" {
		t.Fatalf("custom video_create override was overwritten: %#v", overrides)
	}
	if overrides["material_base_url"] != seedanceMigrationEndpointOverrides(migrated)["material_base_url"] {
		t.Fatalf("material_base_url was not added: %#v", overrides)
	}
	if _, ok := overrides[service.VolcanoAssetEndpointBaseURL]; ok {
		t.Fatalf("project-specific volcano asset base_url should not be inferred: %#v", overrides)
	}
	if !reflect.DeepEqual(testStringMap(t, migrated.SecretsEncrypted), map[string]string{"access_key": "encrypted-ak"}) {
		t.Fatalf("secrets changed: %s", migrated.SecretsEncrypted)
	}
	if !reflect.DeepEqual(testStringMap(t, migrated.ExtraHeaders), map[string]string{"x-operator": "keep"}) {
		t.Fatalf("extra headers changed: %s", migrated.ExtraHeaders)
	}

	second, err := Apply(repo)
	if err != nil {
		t.Fatal(err)
	}
	if second.Updated != 0 {
		t.Fatalf("second run Updated = %d, want 0; updates = %+v", second.Updated, second.Updates)
	}
}

func TestApplyDoesNotMoveExistingDefaultProviderSelection(t *testing.T) {
	repo := repository.NewMemoryModelProviderRepository()
	currentDefault := model.ModelProviderConfig{
		ID:                 "video-default",
		Name:               "Current Video Default",
		Mode:               model.ModelProviderModeOpenAICompatible,
		BaseURL:            "https://video-default.example/v1",
		AuthType:           model.ModelProviderAuthTypeNone,
		VideoModel:         "operator-video",
		DefaultFor:         testJSONB([]string{model.ModelCapabilityVideo}),
		Capabilities:       testJSONB([]string{model.ModelCapabilityVideo}),
		ModelsByCapability: testJSONB(map[string][]string{model.ModelCapabilityVideo: {"operator-video"}}),
		TimeoutMS:          model.ModelProviderDefaultTimeoutMilli,
		Enabled:            true,
	}
	legacySeedance := model.ModelProviderConfig{
		ID:         "seedance-candidate",
		Name:       "Seedance Candidate",
		Mode:       model.ModelProviderModeOpenAICompatible,
		BaseURL:    "https://operator.example/api/v3",
		AuthType:   model.ModelProviderAuthTypeNone,
		VideoModel: "doubao-seedance-2-0-mini-260615",
		TimeoutMS:  model.ModelProviderDefaultTimeoutMilli,
		Enabled:    true,
	}
	if _, err := repo.UpsertModelProvider(currentDefault); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertModelProvider(legacySeedance); err != nil {
		t.Fatal(err)
	}

	if _, err := Apply(repo); err != nil {
		t.Fatal(err)
	}
	defaultProvider, err := repo.GetModelProvider(currentDefault.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(testStringSlice(t, defaultProvider.DefaultFor), []string{model.ModelCapabilityVideo}) {
		t.Fatalf("current default_for changed: %s", defaultProvider.DefaultFor)
	}
	candidate, err := repo.GetModelProvider(legacySeedance.ID)
	if err != nil {
		t.Fatal(err)
	}
	if values := testStringSlice(t, candidate.DefaultFor); len(values) != 0 {
		t.Fatalf("candidate default_for = %#v, want unchanged empty", values)
	}
	if candidate.VideoModel != legacySeedance.VideoModel {
		t.Fatalf("candidate video model changed: %q", candidate.VideoModel)
	}
}

func TestPlanDoesNotHardcodeProjectSpecificTokenSpaceAssetProxy(t *testing.T) {
	result := Plan([]model.ModelProviderConfig{{
		ID:         "tokenspace-seedance",
		Name:       "TokenSpace Seedance",
		Mode:       model.ModelProviderModeOpenAICompatible,
		BaseURL:    "https://api.tokenspace.net.cn",
		AuthType:   model.ModelProviderAuthTypeBearer,
		VideoModel: "doubao-seedance-2-0-mini-260615",
		TimeoutMS:  model.ModelProviderDefaultTimeoutMilli,
		Enabled:    true,
	}})
	if result.Updated != 1 {
		t.Fatalf("Updated = %d, want 1", result.Updated)
	}
	overrides := testStringMap(t, result.Updates[0].After.EndpointOverrides)
	if _, ok := overrides[service.VolcanoAssetEndpointBaseURL]; ok {
		t.Fatalf("project-specific volcano asset base_url should not be inferred: %#v", overrides)
	}
}

func TestPlanMigratesLegacyDefaultTextAndImageProvider(t *testing.T) {
	configs := []model.ModelProviderConfig{{
		ID:              model.ModelProviderIDDefault,
		Name:            "Default Legacy",
		Mode:            model.ModelProviderModeLocalOpenAI,
		BaseURL:         "https://operator.example/v1",
		AuthType:        model.ModelProviderAuthTypeBearer,
		APIKeyEncrypted: "encrypted-key",
		TextModel:       "gpt-text",
		ImageModel:      "gpt-image-2",
		TimeoutMS:       model.ModelProviderDefaultTimeoutMilli,
		Enabled:         true,
	}}

	result := Plan(configs)
	if result.Updated != 1 {
		t.Fatalf("Updated = %d, want 1", result.Updated)
	}
	after := result.Updates[0].After
	if after.APIKeyEncrypted != configs[0].APIKeyEncrypted {
		t.Fatal("api key was overwritten")
	}
	if after.TextModel != "gpt-text" || after.ImageModel != "gpt-image-2" {
		t.Fatalf("default models changed: text=%q image=%q", after.TextModel, after.ImageModel)
	}
	if got := testStringSlice(t, after.DefaultFor); !reflect.DeepEqual(got, []string{model.ModelCapabilityText, model.ModelCapabilityImage}) {
		t.Fatalf("default_for = %#v", got)
	}
	models := testModelsByCapability(t, after.ModelsByCapability)
	if !reflect.DeepEqual(models[model.ModelCapabilityText], []string{"gpt-text"}) || !reflect.DeepEqual(models[model.ModelCapabilityImage], []string{"gpt-image-2"}) {
		t.Fatalf("models_by_capability = %#v", models)
	}
}

func testJSONB(value any) model.JSONB {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return model.JSONB(data)
}

func testStringSlice(t *testing.T, raw model.JSONB) []string {
	t.Helper()
	var values []string
	if err := json.Unmarshal(raw, &values); err != nil {
		t.Fatalf("json.Unmarshal(%s) error = %v", raw, err)
	}
	return values
}

func testStringMap(t *testing.T, raw model.JSONB) map[string]string {
	t.Helper()
	var values map[string]string
	if err := json.Unmarshal(raw, &values); err != nil {
		t.Fatalf("json.Unmarshal(%s) error = %v", raw, err)
	}
	return values
}

func testModelsByCapability(t *testing.T, raw model.JSONB) map[string][]string {
	t.Helper()
	var values map[string][]string
	if err := json.Unmarshal(raw, &values); err != nil {
		t.Fatalf("json.Unmarshal(%s) error = %v", raw, err)
	}
	return values
}
