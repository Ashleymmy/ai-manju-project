package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/providerpresetmigration"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

func TestChinaMobilPresetCreatesIndependentProvider(t *testing.T) {
	router, repo := newProviderTestRouter(t, "secret")
	old := configFromPreset("volcengine_seedance")
	old.ID, old.Name, old.APIKeyEncrypted = "company", "sdvideo", "existing-ciphertext"
	old.DefaultFor = mustProviderJSONB([]string{model.ModelCapabilityVideo})
	before, err := repo.UpsertModelProvider(old)
	if err != nil {
		t.Fatal(err)
	}
	admin := loginCookie(t, router, "admin", "secret")
	catalog := performJSON(router, http.MethodGet, "/api/admin/model-provider-presets", "", admin)
	if catalog.Code != http.StatusOK || !strings.Contains(catalog.Body.String(), chinaMobilTokenSpacePresetID) {
		t.Fatal("ChinaMobil missing from admin preset catalog")
	}
	create := performJSON(router, http.MethodPost, "/api/admin/model-providers",
		`{"id":"chinamobil","preset_id":"`+chinaMobilTokenSpacePresetID+`","api_key":"new-test-key","default_for":[]}`, admin)
	if create.Code != http.StatusOK {
		t.Fatalf("create: %d %s", create.Code, create.Body.String())
	}
	if strings.Contains(create.Body.String(), "new-test-key") {
		t.Fatal("API key leaked in response")
	}
	saved, err := repo.GetModelProvider("chinamobil")
	if err != nil {
		t.Fatal(err)
	}
	box := provider.NewSecretBox("secret")
	key, err := box.Decrypt(saved.APIKeyEncrypted)
	if err != nil || key != "new-test-key" {
		t.Fatal("independent key not saved")
	}
	if saved.Name != "ChinaMobil（tokenspace）" || saved.BaseURL != "https://api.tokenspace.net.cn/api/v3" || saved.AuthType != model.ModelProviderAuthTypeBearer {
		t.Fatal("incorrect channel defaults")
	}
	after, err := repo.GetModelProvider(old.ID)
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatal("creating ChinaMobil changed the company Provider")
	}
	// Applying the existing migration must not add legacy/official asset endpoints.
	if _, err := providerpresetmigration.Apply(repo); err != nil {
		t.Fatal(err)
	}
	migrated, err := repo.GetModelProvider(saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(jsonStringMapFromJSONB(saved.EndpointOverrides), jsonStringMapFromJSONB(migrated.EndpointOverrides)) {
		t.Fatal("migration changed TokenSpace material protocol")
	}
	readiness := service.NewSeedanceAssetService(repo, repository.NewMemorySeedanceAssetRepository(), box, nil, "").ForProvider(saved.ID).Readiness()
	if !readiness.ProviderConfigured || readiness.ProviderProtocol != service.SeedanceAssetProviderProtocolMaterial {
		t.Fatalf("wrong material adapter: %#v", readiness)
	}
}

func TestChinaMobilMaterialLifecycleAndVideoRouting(t *testing.T) {
	ctx := context.Background()
	var actions []string
	polls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/material" || r.Header.Get("Authorization") != "Bearer new-test-key" {
			t.Error("material request used the wrong route or credentials")
			http.Error(w, "wrong protocol", http.StatusBadRequest)
			return
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			http.Error(w, "bad body", http.StatusBadRequest)
			return
		}
		action := r.URL.Query().Get("Action")
		actions = append(actions, action)
		result := map[string]any{}
		switch action {
		case "CreateAssetGroup":
			if body["Name"] == "" || body["Description"] == "" {
				t.Error("missing material group fields")
			}
			result["Id"] = "new-group"
		case "CreateAsset":
			if body["GroupId"] != "new-group" || body["AssetType"] != "Image" || body["URL"] != "https://media.example.test/person.png" || body["Name"] != "character" {
				t.Error("wrong material registration payload")
			}
			result["Id"] = "new-asset"
		case "GetAsset":
			if body["Id"] != "new-asset" {
				t.Error("polled another account's asset")
			}
			result = map[string]any{"Id": "new-asset", "GroupId": "new-group", "Status": "Active", "AssetType": "Image"}
			polls++
			if polls == 1 {
				result["Status"] = "Processing"
			}
		default:
			t.Errorf("unexpected action %q", action)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ResponseMetadata": map[string]any{"RequestId": "mock"}, "Result": result})
	}))
	defer server.Close()

	box := provider.NewSecretBox("test-secret")
	repo := repository.NewMemoryModelProviderRepository()
	config := configFromPreset(chinaMobilTokenSpacePresetID)
	config.ID = "chinamobil"
	var err error
	config.APIKeyEncrypted, err = box.Encrypt("new-test-key")
	if err != nil {
		t.Fatal(err)
	}
	overrides := jsonStringMapFromJSONB(config.EndpointOverrides)
	for key := range overrides {
		if strings.HasPrefix(key, "volcano_asset_") {
			t.Fatal("TokenSpace preset includes another asset protocol")
		}
	}
	// Replace only the material origin. Video submission remains an offline queue.
	overrides["material_base_url"] = server.URL + "/api/material"
	config.EndpointOverrides = mustProviderJSONB(overrides)
	if _, err := repo.UpsertModelProvider(config); err != nil {
		t.Fatal(err)
	}
	other := config
	other.ID, other.Name = "company", "sdvideo"
	other.APIKeyEncrypted, err = box.Encrypt("old-test-key")
	if err != nil {
		t.Fatal(err)
	}
	other.DefaultFor = mustProviderJSONB([]string{model.ModelCapabilityVideo})
	if _, err := repo.UpsertModelProvider(other); err != nil {
		t.Fatal(err)
	}
	assetRepo := repository.NewMemorySeedanceAssetRepository()
	if _, err := assetRepo.UpsertGroup(model.SeedanceAssetGroup{ID: "old-group", ProviderID: other.ID, VolcanoGroupID: "company-group"}); err != nil {
		t.Fatal(err)
	}
	if _, err := assetRepo.UpsertAsset(model.SeedanceAsset{ID: "old", ProviderID: other.ID, CreatedBy: "owner", VolcanoAssetID: "company-asset", Status: "Active"}); err != nil {
		t.Fatal(err)
	}
	assets := service.NewSeedanceAssetService(repo, assetRepo, box, nil, "")
	scoped := assets.ForProvider(config.ID).ForOwner("owner")
	asset, err := scoped.RegisterAssetFromURL(ctx, service.SeedanceAssetRegisterURLInput{
		Name: "character", AssetType: model.SeedanceAssetTypeImage, SourceURL: "https://media.example.test/person.png", CreatedBy: "owner",
	})
	if err != nil || asset.ProviderID != config.ID || asset.VolcanoGroupID != "new-group" || asset.Status != model.SeedanceAssetStatusProcessing {
		t.Fatalf("registration did not use the independent material library: %v", err)
	}
	if err := scoped.EnsureAssetsActive(ctx, []string{"new-asset"}); err == nil {
		t.Fatal("processing asset was allowed")
	}
	asset, err = scoped.RefreshAsset(ctx, asset.ID)
	if err != nil || asset.Status != model.SeedanceAssetStatusActive {
		t.Fatalf("material polling failed: %v", err)
	}
	if !reflect.DeepEqual(actions, []string{"CreateAssetGroup", "CreateAsset", "GetAsset", "GetAsset"}) {
		t.Fatalf("wrong registration lifecycle: %v", actions)
	}
	producer := &queue.MemoryProducer{}
	h := NewAIHandler(NewModelProviderHandler(repo, box), service.NewJobService(repository.NewMemoryJobRepository(), producer, "celery", 3))
	h.SetSeedanceAssetService(assets)
	generate := func(modelID, assetID, owner string) *httptest.ResponseRecorder {
		t.Helper()
		body := map[string]any{"model": config.ID + "::" + modelID, "duration": 5, "content": []any{
			map[string]any{"type": "text", "text": "move"},
			map[string]any{"type": "image_url", "image_url": map[string]any{"url": "asset://" + assetID}, "role": "reference_image"},
		}}
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/ai/contents/generations/tasks", strings.NewReader(string(encoded)))
		c.Request.Header.Set("Content-Type", "application/json")
		c.Set(auth.ContextUserKey, model.User{ID: owner})
		h.SeedanceTaskCreate(c)
		return rec
	}
	for _, invalid := range []struct{ asset, owner string }{{"company-asset", "owner"}, {"new-asset", "another-owner"}} {
		if rec := generate(config.VideoModel, invalid.asset, invalid.owner); rec.Code != http.StatusBadRequest || len(producer.Messages) != 0 {
			t.Fatal("cross-provider or cross-owner material was queued")
		}
	}
	var models map[string][]string
	if err := json.Unmarshal(config.ModelsByCapability, &models); err != nil {
		t.Fatal(err)
	}
	for _, modelID := range models[model.ModelCapabilityVideo] {
		rec := generate(modelID, "new-asset", "owner")
		if rec.Code != http.StatusOK {
			t.Fatalf("video not queued: %d %s", rec.Code, rec.Body.String())
		}
		candidates := producer.Messages[len(producer.Messages)-1].Kwargs["provider_candidates"].([]map[string]any)
		if len(candidates) != 1 {
			t.Fatal("provider-bound model fell back to company channel")
		}
		candidate := candidates[0]
		if candidate["api_key"] != "new-test-key" || candidate["base_url"] != config.BaseURL || candidate["endpoint"] != "contents/generations/tasks" || candidate["video_protocol"] != "seedance" {
			t.Fatal("wrong video endpoint, protocol or key")
		}
		body := candidate["video_request_body"].(map[string]any)
		if body["model"] != modelID || !reflect.DeepEqual(seedanceAssetIDsFromPayload(body), []string{"new-asset"}) {
			t.Fatal("model or registered asset reference changed")
		}
	}
	// Plain videos retain same-model failover; only account-bound assets pin it.
	candidates, err := h.providerHandler.generationCandidates(model.ModelCapabilityVideo, config.ID+"::"+config.VideoModel)
	if err != nil || len(candidates) != 2 {
		t.Fatal("ordinary same-model failover changed")
	}
	queued := len(producer.Messages)
	for _, unavailable := range []string{"disabled", "invalid-key", "missing"} {
		changed := config
		switch unavailable {
		case "disabled":
			changed.Enabled = false
		case "invalid-key":
			changed.APIKeyEncrypted = "not-valid-ciphertext"
		case "missing":
			if err := repo.DeleteModelProvider(config.ID); err != nil {
				t.Fatal(err)
			}
		}
		if unavailable != "missing" {
			if _, err := repo.UpsertModelProvider(changed); err != nil {
				t.Fatal(err)
			}
		}
		if rec := generate(config.VideoModel, "new-asset", "owner"); rec.Code != http.StatusBadRequest || len(producer.Messages) != queued {
			t.Fatalf("%s Provider's asset fell back to another account", unavailable)
		}
	}
}
