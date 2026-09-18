package service

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/storage"
)

const (
	// VolcanoOfficialProviderPresetID identifies the direct official Ark
	// provider. It is intentionally separate from the managed sdvideo entry.
	VolcanoOfficialProviderPresetID = "volcengine_ark_official"
	VolcanoOfficialAssetProtocolKey = "volcano_asset_protocol"
	VolcanoOfficialAssetProtocol    = "ark_hmac"
	VolcanoOfficialAssetBaseURL     = "volcano_official_asset_base_url"
	VolcanoOfficialAssetRegion      = "volcano_official_asset_region"
	VolcanoOfficialAssetProject     = "volcano_official_asset_project"
	VolcanoOfficialAssetVersion     = "volcano_official_asset_version"
	VolcanoOfficialAssetCreateGroup = "volcano_official_asset_create_group"
	VolcanoOfficialAssetCreate      = "volcano_official_asset_create"
	VolcanoOfficialAssetGet         = "volcano_official_asset_get"
	VolcanoOfficialAssetDelete      = "volcano_official_asset_delete"

	// These keys are encrypted in ModelProviderConfig.SecretsEncrypted.
	VolcanoOfficialAccessKeyIDSecret     = "volcengine_access_key_id"
	VolcanoOfficialSecretAccessKeySecret = "volcengine_secret_access_key"
	VolcanoOfficialSecurityTokenSecret   = "volcengine_security_token"

	VolcanoAssetEndpointBaseURL     = "volcano_asset_base_url"
	VolcanoAssetEndpointListGroups  = "volcano_asset_list_groups"
	VolcanoAssetEndpointCreateGroup = "volcano_asset_create_group"
	VolcanoAssetEndpointCreate      = "volcano_asset_create"
	VolcanoAssetEndpointList        = "volcano_asset_list"
	VolcanoAssetEndpointDelete      = "volcano_asset_delete"

	VolcanoAssetSecretKey = "volcengine_asset_api_key"
)

type seedanceAssetProviderKind string

const (
	seedanceAssetProviderOfficial seedanceAssetProviderKind = "official"
	seedanceAssetProviderVolcano  seedanceAssetProviderKind = "volcano"
	seedanceAssetProviderMaterial seedanceAssetProviderKind = "material"

	// Readiness protocol values identify which upstream asset-library contract is active.
	SeedanceAssetProviderProtocolOfficial = "volcengine_ark_official_asset"
	SeedanceAssetProviderProtocolVolcano  = "volcano_asset"
	SeedanceAssetProviderProtocolMaterial = "tokenspace_material"
	// SeedanceMaterialInitializationURL is the TokenSpace terminal-user setup page documented for first use.
	SeedanceMaterialInitializationURL = "https://api.tokenspace.net.cn/material/init"
)

type seedanceAssetProvider struct {
	config          model.ModelProviderConfig
	apiKey          string
	accessKeyID     string
	secretAccessKey string
	securityToken   string
	region          string
	projectName     string
	kind            seedanceAssetProviderKind
}

var DefaultVolcanoAssetEndpointOverrides = map[string]string{
	VolcanoAssetEndpointBaseURL:     "https://ark.cn-beijing.volces.com/api/v3",
	VolcanoAssetEndpointListGroups:  "/v1/asset/groups?limit=100&offset=0",
	VolcanoAssetEndpointCreateGroup: "/v1/create/asset/group",
	VolcanoAssetEndpointCreate:      "/v1/create/asset",
	VolcanoAssetEndpointList:        "/v1/asset/list",
	VolcanoAssetEndpointDelete:      "/v1/delete/asset",
}

// DefaultVolcanoOfficialAssetEndpointOverrides contains the first-party Ark
// AIGC asset API contract. Its requests are signed with AK/SK and must not be
// sent through the legacy bearer-token asset endpoints above.
var DefaultVolcanoOfficialAssetEndpointOverrides = map[string]string{
	VolcanoOfficialAssetProtocolKey: VolcanoOfficialAssetProtocol,
	VolcanoOfficialAssetBaseURL:     "https://ark.cn-beijing.volcengineapi.com",
	VolcanoOfficialAssetRegion:      "cn-beijing",
	VolcanoOfficialAssetProject:     "default",
	VolcanoOfficialAssetVersion:     "2024-01-01",
	VolcanoOfficialAssetCreateGroup: "CreateAssetGroup",
	VolcanoOfficialAssetCreate:      "CreateAsset",
	VolcanoOfficialAssetGet:         "GetAsset",
	VolcanoOfficialAssetDelete:      "DeleteAsset",
}

var (
	ErrSeedanceAssetProviderNotConfigured = errors.New("Seedance asset provider is not configured")
	ErrSeedanceAssetNotActive             = errors.New("Seedance asset is not Active")
	ErrPublicAssetURLNotConfigured        = errors.New("public asset base url is required for upload registration")
)

type SeedanceAssetService struct {
	providerRepo       repository.ModelProviderRepository
	assetRepo          repository.SeedanceAssetRepository
	secretBox          provider.SecretBox
	storage            storage.Storage
	publicAssetBaseURL string
	client             *http.Client
}

type SeedanceAssetListInput struct {
	Status     string
	Type       string
	TagID      string
	Search     string
	ActiveOnly bool
	Limit      int
	Offset     int
}

type SeedanceAssetListResult struct {
	Items []model.SeedanceAsset `json:"items"`
	Total int64                 `json:"total"`
}

// SeedanceAssetReadiness exposes only non-secret configuration readiness for
// the WP-027 simulated-human asset library. TokenSpace material_* is a unified
// asset library: simulated humans create a group directly, while live humans
// obtain an authorized group through the visual-validation flow.
type SeedanceAssetReadiness struct {
	ProviderConfigured           bool   `json:"provider_configured"`
	ProviderID                   string `json:"provider_id,omitempty"`
	ProviderProtocol             string `json:"provider_protocol,omitempty"`
	ProviderError                string `json:"provider_error,omitempty"`
	MaterialInitializationURL    string `json:"material_initialization_url,omitempty"`
	UploadRegistrationAvailable  bool   `json:"upload_registration_available"`
	PublicAssetBaseURLConfigured bool   `json:"public_asset_base_url_configured"`
}

type SeedanceAssetUploadInput struct {
	Name        string
	Description string
	AssetType   string
	ContentType string
	SizeLimit   int64
	Reader      io.Reader
	FileName    string
	CreatedBy   string
	TagIDs      []string
}

type SeedanceAssetRegisterURLInput struct {
	Name        string
	Description string
	AssetType   string
	SourceURL   string
	CreatedBy   string
	TagIDs      []string
}

type SeedanceAssetUpdateInput struct {
	Name        *string
	Description *string
	TagIDs      *[]string
}

type SeedanceAssetTagInput struct {
	Name      string
	Color     string
	CreatedBy string
}

func NewSeedanceAssetService(providerRepo repository.ModelProviderRepository, assetRepo repository.SeedanceAssetRepository, secretBox provider.SecretBox, store storage.Storage, publicAssetBaseURL string) *SeedanceAssetService {
	return &SeedanceAssetService{
		providerRepo:       providerRepo,
		assetRepo:          assetRepo,
		secretBox:          secretBox,
		storage:            store,
		publicAssetBaseURL: strings.TrimRight(strings.TrimSpace(publicAssetBaseURL), "/"),
		client:             &http.Client{Timeout: 60 * time.Second},
	}
}

func (s *SeedanceAssetService) Readiness() SeedanceAssetReadiness {
	readiness := SeedanceAssetReadiness{
		PublicAssetBaseURLConfigured: s.publicAssetBaseURL != "",
		UploadRegistrationAvailable:  s.publicAssetBaseURL != "",
	}
	assetProvider, err := s.loadSeedanceAssetProvider()
	if err != nil {
		readiness.ProviderError = err.Error()
		readiness.UploadRegistrationAvailable = false
		return readiness
	}
	readiness.ProviderConfigured = true
	readiness.ProviderID = assetProvider.config.ID
	switch assetProvider.kind {
	case seedanceAssetProviderOfficial:
		readiness.ProviderProtocol = SeedanceAssetProviderProtocolOfficial
	case seedanceAssetProviderMaterial:
		readiness.ProviderProtocol = SeedanceAssetProviderProtocolMaterial
		readiness.MaterialInitializationURL = SeedanceMaterialInitializationURL
	default:
		readiness.ProviderProtocol = SeedanceAssetProviderProtocolVolcano
	}
	return readiness
}

func (s *SeedanceAssetService) ListAssets(input SeedanceAssetListInput) (SeedanceAssetListResult, error) {
	items, total, err := s.assetRepo.ListAssets(repository.SeedanceAssetFilter{
		Status:     input.Status,
		Type:       input.Type,
		TagID:      input.TagID,
		Search:     input.Search,
		ActiveOnly: input.ActiveOnly,
		Limit:      clampSeedanceAssetLimit(input.Limit),
		Offset:     maxInt(input.Offset, 0),
	})
	if err != nil {
		return SeedanceAssetListResult{}, err
	}
	return SeedanceAssetListResult{Items: sanitizeSeedanceAssets(items), Total: total}, nil
}

func (s *SeedanceAssetService) GetAsset(id string) (model.SeedanceAsset, error) {
	asset, err := s.assetRepo.GetAsset(strings.TrimSpace(id))
	if err != nil {
		return model.SeedanceAsset{}, err
	}
	return sanitizeSeedanceAsset(asset), nil
}

func (s *SeedanceAssetService) RegisterAssetFromUpload(ctx context.Context, input SeedanceAssetUploadInput) (model.SeedanceAsset, error) {
	assetType := normalizeSeedanceAssetType(input.AssetType, input.ContentType, input.FileName)
	if assetType == "" {
		return model.SeedanceAsset{}, errors.New("unsupported asset type")
	}
	extension := seedanceAssetExtension(input.FileName, input.ContentType, assetType)
	localID := "seedasset_" + randomHex(8)
	key := filepath.ToSlash(filepath.Join("seedance-assets", strings.ToLower(assetType), localID+extension))
	object, err := s.storage.Put(ctx, key, input.Reader, storage.PutMeta{ContentType: input.ContentType, Size: input.SizeLimit})
	if err != nil {
		return model.SeedanceAsset{}, err
	}
	if input.SizeLimit > 0 && object.Size > input.SizeLimit {
		_ = s.storage.Delete(ctx, key)
		return model.SeedanceAsset{}, ErrPayloadTooLarge
	}
	sourceURL, err := s.publicURLForStorageObject(ctx, object)
	if err != nil {
		_ = s.storage.Delete(ctx, key)
		return model.SeedanceAsset{}, err
	}
	asset, err := s.createRemoteAsset(ctx, SeedanceAssetRegisterURLInput{
		Name:        firstNonEmptyString(input.Name, input.FileName, localID),
		Description: input.Description,
		AssetType:   assetType,
		SourceURL:   sourceURL,
		CreatedBy:   input.CreatedBy,
		TagIDs:      input.TagIDs,
	}, key, object.ContentType, object.Size)
	if err != nil {
		_ = s.storage.Delete(ctx, key)
		return model.SeedanceAsset{}, err
	}
	return asset, nil
}

func (s *SeedanceAssetService) RegisterAssetFromURL(ctx context.Context, input SeedanceAssetRegisterURLInput) (model.SeedanceAsset, error) {
	sourceURL := strings.TrimSpace(input.SourceURL)
	if err := validateSeedanceAssetSourceURL(sourceURL); err != nil {
		return model.SeedanceAsset{}, err
	}
	assetType := normalizeSeedanceAssetType(input.AssetType, "", sourceURL)
	if assetType == "" {
		return model.SeedanceAsset{}, errors.New("unsupported asset type")
	}
	return s.createRemoteAsset(ctx, SeedanceAssetRegisterURLInput{
		Name:        firstNonEmptyString(input.Name, filepath.Base(sourceURL), "seedance asset"),
		Description: input.Description,
		AssetType:   assetType,
		SourceURL:   sourceURL,
		CreatedBy:   input.CreatedBy,
		TagIDs:      input.TagIDs,
	}, "", "", 0)
}

func (s *SeedanceAssetService) createRemoteAsset(ctx context.Context, input SeedanceAssetRegisterURLInput, storageKey string, contentType string, size int64) (model.SeedanceAsset, error) {
	assetProvider, err := s.loadSeedanceAssetProvider()
	if err != nil {
		return model.SeedanceAsset{}, err
	}
	group, err := s.getOrCreateAssetGroup(ctx, assetProvider)
	if err != nil {
		return model.SeedanceAsset{}, err
	}
	raw, err := s.createRemoteAssetRecord(ctx, assetProvider, group, input)
	if err != nil {
		return model.SeedanceAsset{}, err
	}
	volcanoAssetID := firstNonEmptyString(seedanceMaterialString(raw, "asset_id", "AssetID", "AssetId", "Id", "id"), seedanceMaterialString(mapFromAny(raw["Result"]), "asset_id", "AssetID", "AssetId", "Id", "id"))
	if volcanoAssetID == "" {
		return model.SeedanceAsset{}, errors.New("Seedance asset response missing asset id")
	}
	status := firstNonEmptyString(seedanceMaterialString(raw, "status", "Status"), seedanceMaterialString(mapFromAny(raw["Result"]), "status", "Status"), model.SeedanceAssetStatusProcessing)
	asset, err := s.assetRepo.UpsertAsset(model.SeedanceAsset{
		ID:             "sasset_" + randomHex(8),
		ProviderID:     assetProvider.config.ID,
		VolcanoAssetID: volcanoAssetID,
		VolcanoGroupID: group.VolcanoGroupID,
		Name:           input.Name,
		Description:    input.Description,
		AssetType:      input.AssetType,
		StorageKey:     storageKey,
		SourceURL:      input.SourceURL,
		ContentType:    contentType,
		Size:           size,
		Status:         normalizeSeedanceAssetStatus(status),
		CreatedBy:      input.CreatedBy,
		Metadata:       model.JSONB("{}"),
	})
	if err != nil {
		return model.SeedanceAsset{}, err
	}
	if err := s.assetRepo.SetAssetTags(asset.ID, input.TagIDs); err != nil {
		return model.SeedanceAsset{}, err
	}
	return s.GetAsset(asset.ID)
}

func (s *SeedanceAssetService) createRemoteAssetRecord(ctx context.Context, assetProvider seedanceAssetProvider, group model.SeedanceAssetGroup, input SeedanceAssetRegisterURLInput) (map[string]any, error) {
	payload := map[string]any{
		"GroupId":   group.VolcanoGroupID,
		"URL":       input.SourceURL,
		"AssetType": input.AssetType,
		"Name":      input.Name,
	}
	if assetProvider.kind == seedanceAssetProviderMaterial {
		return s.doMaterialAssetJSON(ctx, assetProvider.config, assetProvider.apiKey, SeedanceMaterialActionCreateAsset, payload)
	}
	if assetProvider.kind == seedanceAssetProviderOfficial {
		return s.doOfficialVolcanoAssetJSON(ctx, assetProvider, VolcanoOfficialAssetCreate, payload)
	}
	payload["PollInterval"] = 3
	payload["PollTimeout"] = 120
	return s.doVolcanoAssetJSON(ctx, assetProvider.config, assetProvider.apiKey, http.MethodPost, VolcanoAssetEndpointCreate, payload)
}

func (s *SeedanceAssetService) UpdateAsset(id string, input SeedanceAssetUpdateInput) (model.SeedanceAsset, error) {
	asset, err := s.assetRepo.GetAsset(strings.TrimSpace(id))
	if err != nil {
		return model.SeedanceAsset{}, err
	}
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" {
			return model.SeedanceAsset{}, errors.New("name is required")
		}
		asset.Name = name
	}
	if input.Description != nil {
		asset.Description = strings.TrimSpace(*input.Description)
	}
	if _, err := s.assetRepo.UpdateAsset(asset); err != nil {
		return model.SeedanceAsset{}, err
	}
	if input.TagIDs != nil {
		if err := s.assetRepo.SetAssetTags(asset.ID, *input.TagIDs); err != nil {
			return model.SeedanceAsset{}, err
		}
	}
	return s.GetAsset(asset.ID)
}

func (s *SeedanceAssetService) DeleteAsset(ctx context.Context, id string) error {
	asset, err := s.assetRepo.GetAsset(strings.TrimSpace(id))
	if err != nil {
		return err
	}
	assetProvider, err := s.loadSeedanceAssetProvider()
	if err != nil {
		return err
	}
	deletePayload := map[string]any{
		"Id":          asset.VolcanoAssetID,
		"ProjectName": model.SeedanceAssetProjectDefault,
	}
	if assetProvider.kind == seedanceAssetProviderOfficial {
		deletePayload = map[string]any{"Id": asset.VolcanoAssetID}
		_, err = s.doOfficialVolcanoAssetJSON(ctx, assetProvider, VolcanoOfficialAssetDelete, deletePayload)
	} else if assetProvider.kind == seedanceAssetProviderMaterial {
		deletePayload = map[string]any{"Id": asset.VolcanoAssetID}
		_, err = s.doMaterialAssetJSON(ctx, assetProvider.config, assetProvider.apiKey, SeedanceMaterialActionDeleteAsset, deletePayload)
	} else {
		_, err = s.doVolcanoAssetJSON(ctx, assetProvider.config, assetProvider.apiKey, http.MethodPost, VolcanoAssetEndpointDelete, deletePayload)
	}
	if err != nil {
		return err
	}
	if err := s.assetRepo.DeleteAsset(asset.ID); err != nil {
		return err
	}
	if strings.TrimSpace(asset.StorageKey) != "" {
		_ = s.storage.Delete(ctx, asset.StorageKey)
	}
	return nil
}

func (s *SeedanceAssetService) SyncAssets(ctx context.Context) (int, error) {
	assetProvider, err := s.loadSeedanceAssetProvider()
	if err != nil {
		return 0, err
	}
	if assetProvider.kind == seedanceAssetProviderOfficial {
		return s.syncOfficialLocalAssets(ctx, assetProvider)
	}
	if assetProvider.kind == seedanceAssetProviderMaterial {
		return s.syncMaterialLocalAssets(ctx, assetProvider)
	}
	group, err := s.getOrCreateAssetGroup(ctx, assetProvider)
	if err != nil {
		return 0, err
	}
	count, err := s.syncRemoteAssets(ctx, assetProvider.config, assetProvider.apiKey, group.VolcanoGroupID, []string{model.SeedanceAssetStatusActive, model.SeedanceAssetStatusProcessing, model.SeedanceAssetStatusCreating, model.SeedanceAssetStatusQueued, model.SeedanceAssetStatusFailed})
	return count, err
}

func (s *SeedanceAssetService) PollPendingOnce(ctx context.Context) (int, error) {
	pending, err := s.assetRepo.ListPendingAssets(100)
	if err != nil {
		return 0, err
	}
	if len(pending) == 0 {
		return 0, nil
	}
	assetProvider, err := s.loadSeedanceAssetProvider()
	if err != nil {
		return 0, err
	}
	if assetProvider.kind == seedanceAssetProviderOfficial {
		count := 0
		for _, asset := range pending {
			if asset.ProviderID != "" && asset.ProviderID != assetProvider.config.ID {
				continue
			}
			if err := s.refreshOfficialAssetStatus(ctx, assetProvider, asset); err != nil {
				return count, err
			}
			count++
		}
		return count, nil
	}
	if assetProvider.kind == seedanceAssetProviderMaterial {
		count := 0
		for _, asset := range pending {
			if asset.ProviderID != "" && asset.ProviderID != assetProvider.config.ID {
				continue
			}
			if err := s.refreshMaterialAssetStatus(ctx, assetProvider, asset); err != nil {
				return count, err
			}
			count++
		}
		return count, nil
	}
	groupIDs := uniqueNonEmptyStrings(assetGroupIDs(pending))
	count := 0
	for _, groupID := range groupIDs {
		updated, err := s.syncRemoteAssets(ctx, assetProvider.config, assetProvider.apiKey, groupID, []string{model.SeedanceAssetStatusActive, model.SeedanceAssetStatusProcessing, model.SeedanceAssetStatusCreating, model.SeedanceAssetStatusQueued, model.SeedanceAssetStatusFailed})
		if err != nil {
			return count, err
		}
		count += updated
	}
	return count, nil
}

func (s *SeedanceAssetService) EnsureAssetsActive(ctx context.Context, volcanoAssetIDs []string) error {
	for _, assetID := range uniqueNonEmptyStrings(volcanoAssetIDs) {
		asset, err := s.assetRepo.GetAssetByVolcanoID(assetID)
		if err == nil && asset.Status == model.SeedanceAssetStatusActive {
			continue
		}
		if err == nil && asset.Status != model.SeedanceAssetStatusActive {
			_ = s.refreshAssetStatus(ctx, asset)
			asset, _ = s.assetRepo.GetAsset(asset.ID)
		}
		if err != nil || asset.Status != model.SeedanceAssetStatusActive {
			status := "missing"
			if err == nil {
				status = asset.Status
			}
			return fmt.Errorf("%w: %s status=%s", ErrSeedanceAssetNotActive, assetID, status)
		}
	}
	return nil
}

func (s *SeedanceAssetService) ListTags() ([]model.SeedanceAssetTag, error) {
	return s.assetRepo.ListTags()
}

func (s *SeedanceAssetService) UpsertTag(input SeedanceAssetTagInput) (model.SeedanceAssetTag, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return model.SeedanceAssetTag{}, errors.New("tag name is required")
	}
	color := strings.TrimSpace(input.Color)
	if color == "" {
		color = "#666666"
	}
	return s.assetRepo.UpsertTag(model.SeedanceAssetTag{
		ID:        "stag_" + randomHex(8),
		Name:      name,
		Color:     color,
		Scope:     model.SeedanceAssetTagScope,
		CreatedBy: input.CreatedBy,
	})
}

func (s *SeedanceAssetService) DeleteTag(id string) error {
	return s.assetRepo.DeleteTag(strings.TrimSpace(id))
}

func (s *SeedanceAssetService) AddTag(assetID string, tagID string) error {
	return s.assetRepo.AddTag(strings.TrimSpace(assetID), strings.TrimSpace(tagID))
}

func (s *SeedanceAssetService) RemoveTag(assetID string, tagID string) error {
	return s.assetRepo.RemoveTag(strings.TrimSpace(assetID), strings.TrimSpace(tagID))
}

func (s *SeedanceAssetService) getOrCreateAssetGroup(ctx context.Context, assetProvider seedanceAssetProvider) (model.SeedanceAssetGroup, error) {
	if group, err := s.assetRepo.GetGroupByProvider(assetProvider.config.ID); err == nil && strings.TrimSpace(group.VolcanoGroupID) != "" {
		return group, nil
	}
	if assetProvider.kind == seedanceAssetProviderMaterial {
		return s.createMaterialAssetGroup(ctx, assetProvider)
	}
	if assetProvider.kind == seedanceAssetProviderOfficial {
		raw, err := s.doOfficialVolcanoAssetJSON(ctx, assetProvider, VolcanoOfficialAssetCreateGroup, map[string]any{
			"Name":        model.SeedanceAssetGroupDefaultName,
			"Description": "拟真人素材资产库",
			"GroupType":   model.SeedanceAssetGroupTypeAIGC,
		})
		if err != nil {
			return model.SeedanceAssetGroup{}, err
		}
		groupID := firstNonEmptyString(seedanceMaterialString(raw, "group_id", "GroupID", "GroupId", "Id", "id"), seedanceMaterialString(mapFromAny(raw["Result"]), "group_id", "GroupID", "GroupId", "Id", "id"))
		if groupID == "" {
			return model.SeedanceAssetGroup{}, errors.New("Seedance official asset group response missing group id")
		}
		return s.assetRepo.UpsertGroup(model.SeedanceAssetGroup{
			ID:             "sag_" + randomHex(8),
			ProviderID:     assetProvider.config.ID,
			VolcanoGroupID: groupID,
			Name:           model.SeedanceAssetGroupDefaultName,
			GroupType:      model.SeedanceAssetGroupTypeAIGC,
			ProjectName:    assetProvider.projectName,
		})
	}
	raw, err := s.doVolcanoAssetJSON(ctx, assetProvider.config, assetProvider.apiKey, http.MethodGet, VolcanoAssetEndpointListGroups, nil)
	if err != nil {
		return model.SeedanceAssetGroup{}, err
	}
	for _, item := range listFromAny(firstNonNil(raw["items"], raw["Items"], mapFromAny(raw["Result"])["items"], mapFromAny(raw["Result"])["Items"])) {
		record := mapFromAny(item)
		if strings.TrimSpace(seedanceMaterialString(record, "name", "Name")) != model.SeedanceAssetGroupDefaultName {
			continue
		}
		groupID := seedanceMaterialString(record, "group_id", "GroupID", "GroupId", "Id", "id")
		if groupID == "" {
			continue
		}
		return s.assetRepo.UpsertGroup(model.SeedanceAssetGroup{
			ID:             "sag_" + randomHex(8),
			ProviderID:     assetProvider.config.ID,
			VolcanoGroupID: groupID,
			Name:           model.SeedanceAssetGroupDefaultName,
			GroupType:      model.SeedanceAssetGroupTypeAIGC,
			ProjectName:    model.SeedanceAssetProjectDefault,
		})
	}
	raw, err = s.doVolcanoAssetJSON(ctx, assetProvider.config, assetProvider.apiKey, http.MethodPost, VolcanoAssetEndpointCreateGroup, map[string]any{
		"Name":        model.SeedanceAssetGroupDefaultName,
		"Description": "拟真人素材资产库",
		"GroupType":   model.SeedanceAssetGroupTypeAIGC,
		"ProjectName": model.SeedanceAssetProjectDefault,
	})
	if err != nil {
		return model.SeedanceAssetGroup{}, err
	}
	groupID := firstNonEmptyString(seedanceMaterialString(raw, "group_id", "GroupID", "GroupId", "Id", "id"), seedanceMaterialString(mapFromAny(raw["Result"]), "group_id", "GroupID", "GroupId", "Id", "id"))
	if groupID == "" {
		return model.SeedanceAssetGroup{}, errors.New("Seedance asset group response missing group id")
	}
	return s.assetRepo.UpsertGroup(model.SeedanceAssetGroup{
		ID:             "sag_" + randomHex(8),
		ProviderID:     assetProvider.config.ID,
		VolcanoGroupID: groupID,
		Name:           model.SeedanceAssetGroupDefaultName,
		GroupType:      model.SeedanceAssetGroupTypeAIGC,
		ProjectName:    model.SeedanceAssetProjectDefault,
	})
}

func (s *SeedanceAssetService) createMaterialAssetGroup(ctx context.Context, assetProvider seedanceAssetProvider) (model.SeedanceAssetGroup, error) {
	raw, err := s.doMaterialAssetJSON(ctx, assetProvider.config, assetProvider.apiKey, SeedanceMaterialActionCreateAssetGroup, map[string]any{
		"Name":        model.SeedanceAssetGroupDefaultName,
		"Description": "digital human asset library",
	})
	if err != nil {
		return model.SeedanceAssetGroup{}, err
	}
	groupID := firstNonEmptyString(seedanceMaterialString(raw, "group_id", "GroupID", "GroupId", "Id", "id"), seedanceMaterialString(mapFromAny(raw["Result"]), "group_id", "GroupID", "GroupId", "Id", "id"))
	if groupID == "" {
		return model.SeedanceAssetGroup{}, errors.New("Seedance asset group response missing group id")
	}
	return s.assetRepo.UpsertGroup(model.SeedanceAssetGroup{
		ID:             "sag_" + randomHex(8),
		ProviderID:     assetProvider.config.ID,
		VolcanoGroupID: groupID,
		Name:           model.SeedanceAssetGroupDefaultName,
		GroupType:      model.SeedanceAssetGroupTypeAIGC,
		ProjectName:    model.SeedanceAssetProjectDefault,
	})
}

func (s *SeedanceAssetService) syncRemoteAssets(ctx context.Context, config model.ModelProviderConfig, apiKey string, groupID string, statuses []string) (int, error) {
	raw, err := s.doVolcanoAssetJSON(ctx, config, apiKey, http.MethodPost, VolcanoAssetEndpointList, map[string]any{
		"Filter": map[string]any{
			"GroupIds":  []string{groupID},
			"GroupType": model.SeedanceAssetGroupTypeAIGC,
			"Statuses":  statuses,
		},
		"PageNumber":  1,
		"PageSize":    100,
		"SortBy":      "CreateTime",
		"SortOrder":   "Desc",
		"ProjectName": model.SeedanceAssetProjectDefault,
	})
	if err != nil {
		return 0, err
	}
	items := listFromAny(firstNonNil(raw["Items"], raw["items"], mapFromAny(raw["Result"])["Items"], mapFromAny(raw["Result"])["items"]))
	now := time.Now().UTC()
	count := 0
	for _, item := range items {
		record := mapFromAny(item)
		volcanoID := seedanceMaterialString(record, "Id", "id", "AssetID", "asset_id")
		if volcanoID == "" {
			continue
		}
		current, err := s.assetRepo.GetAssetByVolcanoID(volcanoID)
		if err != nil {
			current = model.SeedanceAsset{
				ID:             "sasset_" + randomHex(8),
				ProviderID:     config.ID,
				VolcanoAssetID: volcanoID,
				VolcanoGroupID: groupID,
				Metadata:       model.JSONB("{}"),
			}
		}
		current.ProviderID = firstNonEmptyString(current.ProviderID, config.ID)
		current.VolcanoGroupID = firstNonEmptyString(seedanceMaterialString(record, "GroupId", "GroupID", "group_id"), current.VolcanoGroupID, groupID)
		current.Name = firstNonEmptyString(seedanceMaterialString(record, "Name", "name"), current.Name, volcanoID)
		current.AssetType = firstNonEmptyString(seedanceMaterialString(record, "AssetType", "asset_type"), current.AssetType, model.SeedanceAssetTypeImage)
		current.SourceURL = firstNonEmptyString(seedanceMaterialString(record, "URL", "Url", "url"), current.SourceURL)
		current.Status = normalizeSeedanceAssetStatus(firstNonEmptyString(seedanceMaterialString(record, "Status", "status"), current.Status, model.SeedanceAssetStatusProcessing))
		current.LastSyncAt = &now
		current.ErrorMessage = sanitizeMaterialErrorText(firstNonEmptyString(seedanceMaterialString(record, "Error", "error", "Message", "message"), current.ErrorMessage))
		if _, err := s.assetRepo.UpsertAsset(current); err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}

func (s *SeedanceAssetService) refreshAssetStatus(ctx context.Context, asset model.SeedanceAsset) error {
	assetProvider, err := s.loadSeedanceAssetProvider()
	if err != nil {
		return err
	}
	if assetProvider.kind == seedanceAssetProviderOfficial {
		return s.refreshOfficialAssetStatus(ctx, assetProvider, asset)
	}
	if assetProvider.kind == seedanceAssetProviderMaterial {
		return s.refreshMaterialAssetStatus(ctx, assetProvider, asset)
	}
	_, err = s.syncRemoteAssets(ctx, assetProvider.config, assetProvider.apiKey, asset.VolcanoGroupID, []string{model.SeedanceAssetStatusActive, model.SeedanceAssetStatusProcessing, model.SeedanceAssetStatusCreating, model.SeedanceAssetStatusQueued, model.SeedanceAssetStatusFailed})
	return err
}

func (s *SeedanceAssetService) syncMaterialLocalAssets(ctx context.Context, assetProvider seedanceAssetProvider) (int, error) {
	assets, _, err := s.assetRepo.ListAssets(repository.SeedanceAssetFilter{})
	if err != nil {
		return 0, err
	}
	count := 0
	for _, asset := range assets {
		if asset.ProviderID != "" && asset.ProviderID != assetProvider.config.ID {
			continue
		}
		if strings.TrimSpace(asset.VolcanoAssetID) == "" {
			continue
		}
		if err := s.refreshMaterialAssetStatus(ctx, assetProvider, asset); err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}

func (s *SeedanceAssetService) syncOfficialLocalAssets(ctx context.Context, assetProvider seedanceAssetProvider) (int, error) {
	assets, _, err := s.assetRepo.ListAssets(repository.SeedanceAssetFilter{})
	if err != nil {
		return 0, err
	}
	count := 0
	for _, asset := range assets {
		if asset.ProviderID != "" && asset.ProviderID != assetProvider.config.ID {
			continue
		}
		if strings.TrimSpace(asset.VolcanoAssetID) == "" {
			continue
		}
		if err := s.refreshOfficialAssetStatus(ctx, assetProvider, asset); err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}

func (s *SeedanceAssetService) refreshOfficialAssetStatus(ctx context.Context, assetProvider seedanceAssetProvider, asset model.SeedanceAsset) error {
	raw, err := s.doOfficialVolcanoAssetJSON(ctx, assetProvider, VolcanoOfficialAssetGet, map[string]any{"Id": asset.VolcanoAssetID})
	if err != nil {
		return err
	}
	record := mapFromAny(firstNonNil(raw["Result"], raw["result"]))
	if record == nil {
		record = raw
	}
	now := time.Now().UTC()
	asset.ProviderID = firstNonEmptyString(asset.ProviderID, assetProvider.config.ID)
	asset.VolcanoAssetID = firstNonEmptyString(seedanceMaterialString(record, "Id", "id", "AssetID", "AssetId", "asset_id"), asset.VolcanoAssetID)
	asset.VolcanoGroupID = firstNonEmptyString(seedanceMaterialString(record, "GroupId", "GroupID", "group_id"), asset.VolcanoGroupID)
	asset.Name = firstNonEmptyString(seedanceMaterialString(record, "Name", "name"), asset.Name, asset.VolcanoAssetID)
	asset.AssetType = firstNonEmptyString(seedanceMaterialString(record, "AssetType", "asset_type"), asset.AssetType, model.SeedanceAssetTypeImage)
	asset.SourceURL = firstNonEmptyString(seedanceMaterialString(record, "URL", "Url", "url"), asset.SourceURL)
	asset.Status = normalizeSeedanceAssetStatus(firstNonEmptyString(seedanceMaterialString(record, "Status", "status"), asset.Status, model.SeedanceAssetStatusProcessing))
	asset.LastSyncAt = &now
	asset.ErrorMessage = sanitizeMaterialErrorText(firstNonEmptyString(seedanceMaterialString(record, "Error", "error", "Message", "message"), asset.ErrorMessage))
	_, err = s.assetRepo.UpsertAsset(asset)
	return err
}

func (s *SeedanceAssetService) refreshMaterialAssetStatus(ctx context.Context, assetProvider seedanceAssetProvider, asset model.SeedanceAsset) error {
	raw, err := s.doMaterialAssetJSON(ctx, assetProvider.config, assetProvider.apiKey, SeedanceMaterialActionGetAsset, map[string]any{
		"Id": asset.VolcanoAssetID,
	})
	if err != nil {
		return err
	}
	_, err = s.upsertMaterialAssetFromRemote(assetProvider, asset, raw)
	return err
}

func (s *SeedanceAssetService) upsertMaterialAssetFromRemote(assetProvider seedanceAssetProvider, current model.SeedanceAsset, raw map[string]any) (model.SeedanceAsset, error) {
	record := mapFromAny(firstNonNil(raw["Result"], raw["result"]))
	if record == nil {
		record = raw
	}
	now := time.Now().UTC()
	current.ProviderID = firstNonEmptyString(current.ProviderID, assetProvider.config.ID)
	current.VolcanoAssetID = firstNonEmptyString(seedanceMaterialString(record, "Id", "id", "AssetID", "AssetId", "asset_id"), current.VolcanoAssetID)
	current.VolcanoGroupID = firstNonEmptyString(seedanceMaterialString(record, "GroupId", "GroupID", "group_id"), current.VolcanoGroupID)
	current.Name = firstNonEmptyString(seedanceMaterialString(record, "Name", "name"), current.Name, current.VolcanoAssetID)
	current.AssetType = firstNonEmptyString(seedanceMaterialString(record, "AssetType", "asset_type"), current.AssetType, model.SeedanceAssetTypeImage)
	current.SourceURL = firstNonEmptyString(seedanceMaterialString(record, "URL", "Url", "url"), current.SourceURL)
	current.Status = normalizeSeedanceAssetStatus(firstNonEmptyString(seedanceMaterialString(record, "Status", "status"), current.Status, model.SeedanceAssetStatusProcessing))
	current.LastSyncAt = &now
	current.ErrorMessage = sanitizeMaterialErrorText(firstNonEmptyString(seedanceMaterialString(record, "Error", "error", "Message", "message"), current.ErrorMessage))
	if strings.TrimSpace(string(current.Metadata)) == "" {
		current.Metadata = model.JSONB("{}")
	}
	return s.assetRepo.UpsertAsset(current)
}

func (s *SeedanceAssetService) loadSeedanceAssetProvider() (seedanceAssetProvider, error) {
	configs, err := s.providerRepo.ListModelProviders()
	if err != nil {
		return seedanceAssetProvider{}, err
	}
	var fallback *seedanceAssetProvider
	for i := range configs {
		config, kind, ok := seedanceAssetProviderCandidate(configs[i])
		if !ok {
			continue
		}
		if fallback == nil {
			current := seedanceAssetProvider{config: config, kind: kind}
			fallback = &current
		}
		if supportsDefaultVideo(config) {
			return s.withSeedanceAssetCredentials(config, kind)
		}
	}
	if fallback != nil {
		return s.withSeedanceAssetCredentials(fallback.config, fallback.kind)
	}
	return seedanceAssetProvider{}, ErrSeedanceAssetProviderNotConfigured
}

func seedanceAssetProviderCandidate(config model.ModelProviderConfig) (model.ModelProviderConfig, seedanceAssetProviderKind, bool) {
	config = withDefaultSeedanceAssetEndpoints(config)
	if isOfficialVolcengineArkProvider(config) {
		return config, seedanceAssetProviderOfficial, true
	}
	if hasVolcanoAssetEndpoint(config) {
		return config, seedanceAssetProviderVolcano, true
	}
	if hasMaterialAssetEndpoint(config) {
		return config, seedanceAssetProviderMaterial, true
	}
	return model.ModelProviderConfig{}, "", false
}

func (s *SeedanceAssetService) withSeedanceAssetCredentials(config model.ModelProviderConfig, kind seedanceAssetProviderKind) (seedanceAssetProvider, error) {
	if !config.Enabled {
		return seedanceAssetProvider{}, provider.ErrProviderDisabled
	}
	secrets := stringMapFromJSONB(config.SecretsEncrypted)
	result := seedanceAssetProvider{config: config, kind: kind, projectName: model.SeedanceAssetProjectDefault}
	if kind == seedanceAssetProviderOfficial {
		result.region, result.projectName = officialAssetSetting(config, VolcanoOfficialAssetRegion, "cn-beijing"), officialAssetSetting(config, VolcanoOfficialAssetProject, "default")
		var err error
		if result.securityToken, err = decryptFirstSecret(s.secretBox, secrets, []string{VolcanoOfficialSecurityTokenSecret, "security_token"}); err != nil {
			return seedanceAssetProvider{}, err
		}
		if result.accessKeyID, err = decryptFirstSecret(s.secretBox, secrets, []string{VolcanoOfficialAccessKeyIDSecret, "access_key_id"}); err != nil {
			return seedanceAssetProvider{}, err
		}
		if result.secretAccessKey, err = decryptFirstSecret(s.secretBox, secrets, []string{VolcanoOfficialSecretAccessKeySecret, "secret_access_key"}); err != nil {
			return seedanceAssetProvider{}, err
		}
		if result.accessKeyID == "" || result.secretAccessKey == "" {
			return seedanceAssetProvider{}, provider.ErrProviderNotConfigured
		}
	}
	secretKeys := []string{VolcanoAssetSecretKey, "volcano_api_key", "api_key"}
	if kind == seedanceAssetProviderMaterial {
		secretKeys = []string{SeedanceMaterialSecretKey, "token_space_api_key", "material_api_key", VolcanoAssetSecretKey, "api_key"}
	}
	for _, key := range secretKeys {
		if encrypted := strings.TrimSpace(secrets[key]); encrypted != "" {
			apiKey, err := s.secretBox.Decrypt(encrypted)
			result.apiKey = apiKey
			return result, err
		}
	}
	if strings.TrimSpace(config.APIKeyEncrypted) == "" {
		if config.AuthType == model.ModelProviderAuthTypeNone {
			return result, nil
		}
		return seedanceAssetProvider{}, provider.ErrProviderNotConfigured
	}
	apiKey, err := s.secretBox.Decrypt(config.APIKeyEncrypted)
	result.apiKey = apiKey
	return result, err
}

func decryptFirstSecret(secretBox provider.SecretBox, secrets map[string]string, keys []string) (string, error) {
	for _, key := range keys {
		if encrypted := strings.TrimSpace(secrets[key]); encrypted != "" {
			value, err := secretBox.Decrypt(encrypted)
			return strings.TrimSpace(value), err
		}
	}
	return "", nil
}

func officialAssetSetting(config model.ModelProviderConfig, key string, fallback string) string {
	value := strings.TrimSpace(stringMapFromJSONB(config.EndpointOverrides)[key])
	if value == "" {
		value = fallback
	}
	return value
}

func (s *SeedanceAssetService) doVolcanoAssetJSON(ctx context.Context, config model.ModelProviderConfig, apiKey string, method string, action string, payload map[string]any) (map[string]any, error) {
	endpoint, err := volcanoAssetEndpoint(config, action)
	if err != nil {
		return nil, err
	}
	var body io.Reader
	if method != http.MethodGet {
		raw, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(apiKey) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}
	res, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	rawBody, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	raw := map[string]any{}
	if len(bytes.TrimSpace(rawBody)) > 0 {
		if err := json.Unmarshal(rawBody, &raw); err != nil {
			return nil, fmt.Errorf("Volcengine asset returned invalid JSON: %w", err)
		}
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return sanitizeMaterialResponse(raw), fmt.Errorf("Volcengine asset request failed with status %d: %s", res.StatusCode, sanitizeMaterialErrorText(materialErrorText(raw)))
	}
	return raw, materialBusinessError(raw)
}

func (s *SeedanceAssetService) doOfficialVolcanoAssetJSON(ctx context.Context, assetProvider seedanceAssetProvider, actionKey string, payload map[string]any) (map[string]any, error) {
	overrides := stringMapFromJSONB(assetProvider.config.EndpointOverrides)
	baseURL := strings.TrimRight(strings.TrimSpace(overrides[VolcanoOfficialAssetBaseURL]), "/")
	if baseURL == "" || assetProvider.accessKeyID == "" || assetProvider.secretAccessKey == "" {
		return nil, provider.ErrProviderNotConfigured
	}
	action := strings.TrimSpace(overrides[actionKey])
	if action == "" {
		return nil, ErrSeedanceAssetProviderNotConfigured
	}
	version := officialAssetSetting(assetProvider.config, VolcanoOfficialAssetVersion, "2024-01-01")
	query := map[string]string{"Action": action, "Version": version}
	endpoint, err := url.Parse(baseURL + "/")
	if err != nil || endpoint.Scheme != "https" || endpoint.Host == "" {
		return nil, ErrSeedanceAssetProviderNotConfigured
	}
	bodyPayload := make(map[string]any, len(payload)+1)
	for key, value := range payload {
		bodyPayload[key] = value
	}
	bodyPayload["ProjectName"] = assetProvider.projectName
	rawBody, err := json.Marshal(bodyPayload)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	queryString := canonicalOfficialQuery(query)
	bodyHash := sha256.Sum256(rawBody)
	bodyHashHex := hex.EncodeToString(bodyHash[:])
	host := endpoint.Hostname()
	if endpoint.Port() != "" && endpoint.Port() != "443" {
		host = endpoint.Host
	}
	date := now.Format("20060102T150405Z")
	headers := map[string]string{
		"content-type":     "application/json",
		"host":             host,
		"x-content-sha256": bodyHashHex,
		"x-date":           date,
	}
	if assetProvider.securityToken != "" {
		headers["x-security-token"] = assetProvider.securityToken
	}
	signedHeaders := sortedOfficialHeaderNames(headers)
	canonicalHeaders := canonicalOfficialHeaders(headers, signedHeaders)
	canonicalRequest := strings.Join([]string{"POST", "/", queryString, canonicalHeaders, strings.Join(signedHeaders, ";"), bodyHashHex}, "\n")
	scope := date[:8] + "/" + assetProvider.region + "/ark/request"
	requestHash := sha256.Sum256([]byte(canonicalRequest))
	stringToSign := "HMAC-SHA256\n" + date + "\n" + scope + "\n" + hex.EncodeToString(requestHash[:])
	signingKey := hmacSHA256([]byte(assetProvider.secretAccessKey), date[:8])
	signingKey = hmacSHA256(signingKey, assetProvider.region)
	signingKey = hmacSHA256(signingKey, "ark")
	signingKey = hmacSHA256(signingKey, "request")
	signature := hex.EncodeToString(hmacSHA256(signingKey, stringToSign))
	authorization := "HMAC-SHA256 Credential=" + assetProvider.accessKeyID + "/" + scope + ", SignedHeaders=" + strings.Join(signedHeaders, ";") + ", Signature=" + signature
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String()+"?"+queryString, bytes.NewReader(rawBody))
	if err != nil {
		return nil, err
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	req.Header.Set("Authorization", authorization)
	res, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	raw := map[string]any{}
	if len(bytes.TrimSpace(responseBody)) > 0 {
		if err := json.Unmarshal(responseBody, &raw); err != nil {
			return nil, fmt.Errorf("Volcengine official asset returned invalid JSON: %w", err)
		}
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return sanitizeMaterialResponse(raw), fmt.Errorf("Volcengine official asset request failed with status %d: %s", res.StatusCode, sanitizeMaterialErrorText(materialErrorText(raw)))
	}
	return raw, materialBusinessError(raw)
}

func hmacSHA256(key []byte, value string) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}

func canonicalOfficialQuery(query map[string]string) string {
	keys := make([]string, 0, len(query))
	for key := range query {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, url.QueryEscape(key)+"="+url.QueryEscape(query[key]))
	}
	return strings.Join(parts, "&")
}

func sortedOfficialHeaderNames(headers map[string]string) []string {
	keys := make([]string, 0, len(headers))
	for key := range headers {
		keys = append(keys, strings.ToLower(strings.TrimSpace(key)))
	}
	sort.Strings(keys)
	return keys
}

func canonicalOfficialHeaders(headers map[string]string, names []string) string {
	lines := make([]string, 0, len(names))
	for _, name := range names {
		lines = append(lines, name+":"+strings.TrimSpace(headers[name])+"\n")
	}
	return strings.Join(lines, "")
}

func (s *SeedanceAssetService) doMaterialAssetJSON(ctx context.Context, config model.ModelProviderConfig, apiKey string, action string, payload map[string]any) (map[string]any, error) {
	endpoint, err := materialEndpoint(config, action, nil)
	if err != nil {
		return nil, err
	}
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(rawPayload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(apiKey) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}
	res, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	rawBody, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	raw := map[string]any{}
	if len(bytes.TrimSpace(rawBody)) > 0 {
		if err := json.Unmarshal(rawBody, &raw); err != nil {
			return nil, fmt.Errorf("TokenSpace material returned invalid JSON: %w", err)
		}
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return sanitizeMaterialResponse(raw), fmt.Errorf("TokenSpace material request failed with status %d: %s", res.StatusCode, sanitizeMaterialErrorText(materialErrorText(raw)))
	}
	return raw, materialBusinessError(raw)
}

func (s *SeedanceAssetService) publicURLForStorageObject(ctx context.Context, object storage.StorageObject) (string, error) {
	urlValue := strings.TrimSpace(object.URL)
	if strings.HasPrefix(urlValue, "http://") || strings.HasPrefix(urlValue, "https://") {
		return urlValue, nil
	}
	if s.publicAssetBaseURL == "" {
		return "", ErrPublicAssetURLNotConfigured
	}
	if urlValue == "" {
		var err error
		urlValue, err = s.storage.URL(ctx, object.Key)
		if err != nil {
			return "", err
		}
	}
	return strings.TrimRight(s.publicAssetBaseURL, "/") + "/" + strings.TrimLeft(urlValue, "/"), nil
}

func volcanoAssetEndpoint(config model.ModelProviderConfig, action string) (string, error) {
	config = withDefaultSeedanceAssetEndpoints(config)
	overrides := stringMapFromJSONB(config.EndpointOverrides)
	baseURL := strings.TrimSpace(overrides[VolcanoAssetEndpointBaseURL])
	if baseURL == "" {
		baseURL = strings.TrimSpace(config.BaseURL)
	}
	actionPath := strings.TrimSpace(overrides[action])
	if baseURL == "" || actionPath == "" {
		return "", ErrSeedanceAssetProviderNotConfigured
	}
	return joinMaterialURL(baseURL, actionPath)
}

// DefaultSeedanceAssetEndpointOverrides returns only first-party Volcengine
// asset-library endpoints. OpenAI-compatible Seedance proxies must configure
// volcano_asset_base_url explicitly because proxy asset hosts are deployment
// specific and cannot be inferred safely from the model BaseURL.
func DefaultSeedanceAssetEndpointOverrides(config model.ModelProviderConfig) map[string]string {
	baseURL := defaultSeedanceAssetBaseURL(config)
	if baseURL == "" {
		return map[string]string{}
	}
	overrides := make(map[string]string, len(DefaultVolcanoAssetEndpointOverrides))
	for key, value := range DefaultVolcanoAssetEndpointOverrides {
		overrides[key] = value
	}
	overrides[VolcanoAssetEndpointBaseURL] = baseURL
	return overrides
}

func withDefaultSeedanceAssetEndpoints(config model.ModelProviderConfig) model.ModelProviderConfig {
	if !isSeedanceProvider(config) {
		return config
	}
	overrides := stringMapFromJSONB(config.EndpointOverrides)
	if isOfficialVolcengineArkProvider(config) {
		for key, value := range DefaultVolcanoOfficialAssetEndpointOverrides {
			if strings.TrimSpace(overrides[key]) == "" {
				overrides[key] = value
			}
		}
		config.EndpointOverrides = mustJSONB(overrides)
		return config
	}
	defaults := DefaultSeedanceAssetEndpointOverrides(config)
	for key, value := range defaults {
		current := strings.TrimSpace(overrides[key])
		if current == "" || shouldReplaceDefaultVolcanoAssetOverride(config, key, current) {
			overrides[key] = value
		}
	}
	config.EndpointOverrides = mustJSONB(overrides)
	return config
}

func defaultSeedanceAssetBaseURL(config model.ModelProviderConfig) string {
	if isOfficialVolcengineAssetProvider(config) {
		return DefaultVolcanoAssetEndpointOverrides[VolcanoAssetEndpointBaseURL]
	}
	return ""
}

func isOfficialVolcengineAssetProvider(config model.ModelProviderConfig) bool {
	if !isVolcengineSeedanceProvider(config) {
		return false
	}
	baseURL := strings.TrimSpace(config.BaseURL)
	if baseURL == "" {
		return true
	}
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Host)
	return strings.Contains(host, "volces.com") ||
		strings.Contains(host, "volcengine.com") ||
		strings.Contains(host, "byteplus.com")
}

func isOfficialVolcengineArkProvider(config model.ModelProviderConfig) bool {
	if strings.TrimSpace(config.PresetID) == VolcanoOfficialProviderPresetID {
		return true
	}
	overrides := stringMapFromJSONB(config.EndpointOverrides)
	return strings.TrimSpace(overrides[VolcanoOfficialAssetProtocolKey]) == VolcanoOfficialAssetProtocol
}

func shouldReplaceDefaultVolcanoAssetOverride(config model.ModelProviderConfig, key string, current string) bool {
	if key != VolcanoAssetEndpointBaseURL {
		return false
	}
	defaultBaseURL := strings.TrimRight(DefaultVolcanoAssetEndpointOverrides[VolcanoAssetEndpointBaseURL], "/")
	nextBaseURL := strings.TrimRight(defaultSeedanceAssetBaseURL(config), "/")
	return nextBaseURL != "" && nextBaseURL != defaultBaseURL && strings.TrimRight(current, "/") == defaultBaseURL
}

func withDefaultVolcanoAssetEndpoints(config model.ModelProviderConfig) model.ModelProviderConfig {
	return withDefaultSeedanceAssetEndpoints(config)
}

func hasVolcanoAssetEndpoint(config model.ModelProviderConfig) bool {
	overrides := stringMapFromJSONB(config.EndpointOverrides)
	required := []string{
		VolcanoAssetEndpointBaseURL,
		VolcanoAssetEndpointListGroups,
		VolcanoAssetEndpointCreateGroup,
		VolcanoAssetEndpointCreate,
		VolcanoAssetEndpointList,
		VolcanoAssetEndpointDelete,
	}
	for _, key := range required {
		if strings.TrimSpace(overrides[key]) == "" {
			return false
		}
	}
	return true
}

func hasMaterialAssetEndpoint(config model.ModelProviderConfig) bool {
	overrides := stringMapFromJSONB(config.EndpointOverrides)
	required := []string{
		"material_base_url",
		SeedanceMaterialActionCreateAssetGroup,
		SeedanceMaterialActionGetAssetGroup,
		SeedanceMaterialActionDeleteAssetGroup,
		SeedanceMaterialActionCreateAsset,
		SeedanceMaterialActionGetAsset,
		SeedanceMaterialActionDeleteAsset,
	}
	for _, key := range required {
		if strings.TrimSpace(overrides[key]) == "" {
			return false
		}
	}
	return true
}

func sanitizeSeedanceAssets(items []model.SeedanceAsset) []model.SeedanceAsset {
	out := make([]model.SeedanceAsset, 0, len(items))
	for _, item := range items {
		out = append(out, sanitizeSeedanceAsset(item))
	}
	return out
}

func sanitizeSeedanceAsset(asset model.SeedanceAsset) model.SeedanceAsset {
	asset.SourceURL = sanitizeMaterialErrorText(asset.SourceURL)
	asset.ErrorMessage = sanitizeMaterialErrorText(asset.ErrorMessage)
	return asset
}

func validateSeedanceAssetSourceURL(value string) error {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" {
		return errors.New("source_url must be a valid url")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return errors.New("source_url must use http or https")
	}
	return nil
}

func normalizeSeedanceAssetType(value string, contentType string, fileName string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "image":
		return model.SeedanceAssetTypeImage
	case "video":
		return model.SeedanceAssetTypeVideo
	case strings.ToLower(model.SeedanceAssetTypeImage):
		return model.SeedanceAssetTypeImage
	case strings.ToLower(model.SeedanceAssetTypeVideo):
		return model.SeedanceAssetTypeVideo
	}
	contentType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	if strings.HasPrefix(contentType, "image/") {
		return model.SeedanceAssetTypeImage
	}
	if strings.HasPrefix(contentType, "video/") {
		return model.SeedanceAssetTypeVideo
	}
	switch strings.ToLower(filepath.Ext(fileName)) {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif":
		return model.SeedanceAssetTypeImage
	case ".mp4", ".webm", ".mov":
		return model.SeedanceAssetTypeVideo
	default:
		return ""
	}
}

func normalizeSeedanceAssetStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "active":
		return model.SeedanceAssetStatusActive
	case "failed", "fail":
		return model.SeedanceAssetStatusFailed
	case "creating":
		return model.SeedanceAssetStatusCreating
	case "queued", "queue":
		return model.SeedanceAssetStatusQueued
	case "processing", "":
		return model.SeedanceAssetStatusProcessing
	default:
		return strings.TrimSpace(value)
	}
}

func seedanceAssetExtension(fileName string, contentType string, assetType string) string {
	if ext := filepath.Ext(fileName); ext != "" {
		return ext
	}
	if extensions, err := mime.ExtensionsByType(strings.TrimSpace(contentType)); err == nil && len(extensions) > 0 {
		return extensions[0]
	}
	if assetType == model.SeedanceAssetTypeVideo {
		return ".mp4"
	}
	return ".png"
}

func clampSeedanceAssetLimit(limit int) int {
	if limit <= 0 {
		return 20
	}
	if limit > 100 {
		return 100
	}
	return limit
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func listFromAny(value any) []any {
	if value == nil {
		return nil
	}
	switch typed := value.(type) {
	case []any:
		return typed
	case []map[string]any:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, item)
		}
		return out
	default:
		return nil
	}
}

func assetGroupIDs(items []model.SeedanceAsset) []string {
	values := make([]string, 0, len(items))
	for _, item := range items {
		values = append(values, item.VolcanoGroupID)
	}
	return values
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func mustJSONB(value any) model.JSONB {
	raw, err := json.Marshal(value)
	if err != nil {
		return model.JSONB("{}")
	}
	return model.JSONB(raw)
}
