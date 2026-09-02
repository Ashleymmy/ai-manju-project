package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/storage"
)

const (
	// ComicBatchDefaultConcurrency matches the reviewed production-safe default.
	ComicBatchDefaultConcurrency = 2
	// ComicBatchMaxConcurrency prevents one asset project from consuming every worker slot.
	ComicBatchMaxConcurrency = 2
	// ComicBatchDispatchInterval is the default recovery/reconciliation cadence.
	ComicBatchDispatchInterval = time.Second
	// ComicBatchClaimRecoveryDelay lets another API replica finish publishing a
	// claimed item before an unassigned claim is recovered after a crash.
	ComicBatchClaimRecoveryDelay = 15 * time.Second
	// ComicProjectSourceMaxBytes bounds persisted DOCX/TXT/MD/XLSX project sources.
	ComicProjectSourceMaxBytes int64 = 40 << 20
	// ComicProjectImportMaxAssets prevents one malformed workbook from creating an unbounded transaction.
	ComicProjectImportMaxAssets = 500
	// ComicBatchMaxVariantsPerAsset keeps batch expansion and billing explicit.
	ComicBatchMaxVariantsPerAsset = 4
	// ComicBatchMaxReferenceAssets matches the interactive image editor limit.
	ComicBatchMaxReferenceAssets = 11
	defaultComicImageSize        = "1024x1024"
	defaultComicOutputFormat     = "png"
)

var (
	ErrComicTitleRequired      = errors.New("comic asset project title is required")
	ErrComicAssetNameRequired  = errors.New("comic asset name is required")
	ErrComicAssetClassInvalid  = errors.New("comic asset class is invalid")
	ErrComicPromptRequired     = errors.New("comic asset prompt is required")
	ErrComicPromptNotApproved  = errors.New("comic asset prompt is not approved")
	ErrComicBatchEmpty         = errors.New("comic asset generation batch has no eligible assets")
	ErrComicBatchConcurrency   = errors.New("comic asset generation concurrency must be 1 or 2")
	ErrComicImageModelRequired = errors.New("image model is required")
	ErrComicImageProvider      = errors.New("image model provider is unavailable; please contact an administrator")
	ErrComicImageVariants      = errors.New("comic asset image variants must be between 1 and 4")
	ErrComicImageOutputFormat  = errors.New("comic asset image output format must be png")
	ErrComicReferenceAsset     = errors.New("comic asset reference image is invalid")
	ErrComicDestinationMode    = errors.New("comic asset destination mode must be auto or custom")
	ErrComicDestinationFolder  = errors.New("comic asset destination folder is required")
	ErrComicImportEmpty        = errors.New("comic asset import has no assets")
	ErrComicImportTooMany      = errors.New("comic asset import exceeds 500 assets")
	ErrComicSourceRequired     = errors.New("comic asset project source file is required")
	ErrComicSourceInvalid      = errors.New("comic asset project source file type is invalid")
	ErrComicSourceTooLarge     = errors.New("comic asset project source file exceeds 40 MiB")
	ErrComicSourceUnavailable  = errors.New("comic asset project source storage is unavailable")
	comicPromptPlaceholder     = regexp.MustCompile(`\{\{\s*([^{}]+?)\s*\}\}`)
	comicPromptWhitespace      = regexp.MustCompile(`[ \t]+`)
	comicPromptEpisodeTerm     = regexp.MustCompile(`第\s*\d+\s*集`)
	comicErrorCredential       = regexp.MustCompile(`(?i)(bearer\s+|api[_ -]?key[\s"':=]+|token[\s"':=]+|secret[\s"':=]+)[^\s,;"'}]+`)
	comicErrorURLCredential    = regexp.MustCompile(`(?i)(https?://)[^/@\s]+@`)
	comicPromptManagementTerms = []string{"集数", "剧情用途", "复用", "后期", "审核", "工作流", "资产管理", "状态管理"}
)

var systemComicPromptTemplates = map[string]string{
	model.ComicAssetClassCharacter:   "需求美术风格：{{美术风格}}。生成《{{资产名称}}》人物设定图，{{资产设定}}。当前状态：{{状态}}。纯净背景，完整人物，外貌、服装、材质和色彩清晰，无文字，无水印。",
	model.ComicAssetClassEnvironment: "需求美术风格：{{美术风格}}。生成《{{资产名称}}》场景设定图，{{资产设定}}。当前状态：{{状态}}。空间结构、陈设、材质、光线和色彩关系清晰，无人物特写，无文字，无水印。",
	model.ComicAssetClassProp:        "需求美术风格：{{美术风格}}。生成《{{资产名称}}》道具设定图，{{资产设定}}。当前状态：{{状态}}。单一主体，结构、材质和功能细节清晰，纯净背景，无文字，无水印。",
	model.ComicAssetClassUI:          "需求美术风格：{{美术风格}}。生成《{{资产名称}}》UI视觉资产，{{资产设定}}。当前状态：{{状态}}。正视构图，边界和层级清晰，文字区域留白，无乱码，无水印。",
}

// comicPromptPlaceholderAliases keeps user-authored templates compatible with
// the documented Chinese fields and common English/legacy spellings. Unknown
// placeholders remain untouched so prompt approval can still block them.
var comicPromptPlaceholderAliases = map[string]string{
	"美术风格":               "style",
	"风格":                 "style",
	"项目风格":               "style",
	"画风":                 "style",
	"style":              "style",
	"art_style":          "style",
	"project_style":      "style",
	"资产名称":               "name",
	"角色名称":               "name",
	"场景名称":               "name",
	"道具名称":               "name",
	"ui名称":               "name",
	"name":               "name",
	"asset_name":         "name",
	"资产类别":               "class",
	"类别":                 "class",
	"分类":                 "class",
	"class":              "class",
	"category":           "class",
	"asset_class":        "class",
	"资产设定":               "description",
	"角色设定":               "description",
	"场景设定":               "description",
	"道具设定":               "description",
	"视觉设定":               "description",
	"description":        "description",
	"visual_description": "description",
	"asset_description":  "description",
	"状态":                 "state",
	"state":              "state",
}

type ComicImageJobResolution struct {
	Selector   string
	Model      string
	TaskKwargs map[string]any
}

type ComicImageJobResolver func(requestedModel string, jobType string) (ComicImageJobResolution, error)

type ComicAssetService struct {
	repo          repository.ComicAssetRepository
	jobs          *JobService
	resolver      ComicImageJobResolver
	sourceStorage storage.Storage
	assetService  *AssetService
	assetFolders  *AssetFolderService
	jobInputs     *JobInputService
	assetRefs     repository.AssetReferenceRepository
	textGenerator ComicTextGenerator
}

func NewComicAssetService(repo repository.ComicAssetRepository, jobs *JobService) *ComicAssetService {
	return &ComicAssetService{repo: repo, jobs: jobs}
}

func (s *ComicAssetService) SetImageJobResolver(resolver ComicImageJobResolver) {
	s.resolver = resolver
}

func (s *ComicAssetService) SetSourceStorage(store storage.Storage) {
	s.sourceStorage = store
}

func (s *ComicAssetService) SetReferenceServices(assetService *AssetService, jobInputs *JobInputService) {
	s.assetService = assetService
	s.jobInputs = jobInputs
}

func (s *ComicAssetService) SetAssetFolderService(folders *AssetFolderService) {
	s.assetFolders = folders
}

func (s *ComicAssetService) SetAssetReferenceRepository(references repository.AssetReferenceRepository) {
	s.assetRefs = references
}

type CreateComicProjectInput struct {
	Title            string
	StylePreset      string
	DefaultTemplates map[string]string
}

type ImportComicProjectInput struct {
	CreateComicProjectInput
	SourceType        string
	SourceFileName    string
	SourceContentType string
	SourceSize        int64
	Source            io.Reader
	Assets            []ComicAssetInput
}

type ComicProjectSourceContent struct {
	Project model.ComicAssetProject
	Object  storage.StorageObject
	Reader  io.ReadCloser
}

type UpdateComicProjectInput struct {
	Title            *string
	StylePreset      *string
	DefaultTemplates *map[string]string
}

type ComicProjectDetail struct {
	Project model.ComicAssetProject `json:"project"`
	Assets  []model.ComicAsset      `json:"assets"`
}

func (s *ComicAssetService) ListProjects(userID string, scope string) ([]model.ComicAssetProject, error) {
	projects, err := s.repo.ListProjects(WorkspaceIDForScope(scope, userID))
	for index := range projects {
		projects[index].Scope = WorkspaceScopeFromID(projects[index].WorkspaceID)
	}
	return projects, err
}

func (s *ComicAssetService) GetProject(id string, userID string, scope string) (ComicProjectDetail, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	project, err := s.repo.GetProject(id, workspaceID)
	if err != nil {
		return ComicProjectDetail{}, err
	}
	assets, err := s.repo.ListAssets(id, workspaceID)
	if err != nil {
		return ComicProjectDetail{}, err
	}
	project.Scope = WorkspaceScopeFromID(project.WorkspaceID)
	return ComicProjectDetail{Project: project, Assets: assets}, nil
}

func (s *ComicAssetService) CreateProject(userID string, scope string, input CreateComicProjectInput) (ComicProjectDetail, error) {
	projectInput := newComicProject(userID, scope, input)
	if projectInput.Title == "" {
		return ComicProjectDetail{}, ErrComicTitleRequired
	}
	project, err := s.repo.CreateProject(projectInput)
	if err != nil {
		return ComicProjectDetail{}, err
	}
	project.Scope = WorkspaceScopeFromID(project.WorkspaceID)
	return ComicProjectDetail{Project: project, Assets: []model.ComicAsset{}}, nil
}

func (s *ComicAssetService) ImportProject(ctx context.Context, userID string, scope string, input ImportComicProjectInput) (ComicProjectDetail, error) {
	if len(input.Assets) == 0 {
		return ComicProjectDetail{}, ErrComicImportEmpty
	}
	if len(input.Assets) > ComicProjectImportMaxAssets {
		return ComicProjectDetail{}, ErrComicImportTooMany
	}
	if s.sourceStorage == nil {
		return ComicProjectDetail{}, ErrComicSourceUnavailable
	}
	sourceType, extension, contentType, err := normalizeComicProjectSource(input.SourceType, input.SourceFileName, input.SourceContentType)
	if err != nil {
		return ComicProjectDetail{}, err
	}
	if input.Source == nil {
		return ComicProjectDetail{}, ErrComicSourceRequired
	}
	if input.SourceSize > ComicProjectSourceMaxBytes {
		return ComicProjectDetail{}, ErrComicSourceTooLarge
	}
	project := newComicProject(userID, scope, input.CreateComicProjectInput)
	if strings.TrimSpace(project.Title) == "" {
		return ComicProjectDetail{}, ErrComicTitleRequired
	}
	classSequence := make(map[string]int)
	assets := make([]model.ComicAsset, 0, len(input.Assets))
	seenCodes := make(map[string]bool, len(input.Assets))
	for _, candidate := range input.Assets {
		assetClass := strings.TrimSpace(valueOrEmpty(candidate.Class))
		classSequence[assetClass]++
		fallbackCode := comicImportedAssetCode(assetClass, classSequence[assetClass])
		asset, buildErr := newComicAsset(project.ID, candidate, fallbackCode)
		if buildErr != nil {
			return ComicProjectDetail{}, buildErr
		}
		asset.Code = strings.ToUpper(strings.TrimSpace(asset.Code))
		if seenCodes[asset.Code] {
			return ComicProjectDetail{}, repository.ErrComicAssetConflict
		}
		seenCodes[asset.Code] = true
		assets = append(assets, asset)
	}
	storageKey := comicProjectSourceStorageKey(project.WorkspaceID, project.ID, extension)
	object, err := s.sourceStorage.Put(ctx, storageKey, io.LimitReader(input.Source, ComicProjectSourceMaxBytes+1), storage.PutMeta{
		ContentType: contentType,
		Size:        ComicProjectSourceMaxBytes + 1,
	})
	if err != nil {
		return ComicProjectDetail{}, err
	}
	if object.Size > ComicProjectSourceMaxBytes {
		_ = s.sourceStorage.Delete(ctx, storageKey)
		return ComicProjectDetail{}, ErrComicSourceTooLarge
	}
	project.SourceType = sourceType
	project.SourceFileName = filepath.Base(strings.ReplaceAll(strings.TrimSpace(input.SourceFileName), "\\", "/"))
	project.SourceStorageKey = storageKey
	project.SourceContentType = contentType
	project.SourceSize = object.Size
	project, assets, err = s.repo.CreateProjectWithAssets(project, assets)
	if err != nil {
		_ = s.sourceStorage.Delete(ctx, storageKey)
		return ComicProjectDetail{}, err
	}
	project.Scope = WorkspaceScopeFromID(project.WorkspaceID)
	return ComicProjectDetail{Project: project, Assets: assets}, nil
}

func (s *ComicAssetService) OpenProjectSource(ctx context.Context, projectID string, userID string, scope string) (ComicProjectSourceContent, error) {
	project, err := s.repo.GetProject(projectID, WorkspaceIDForScope(scope, userID))
	if err != nil {
		return ComicProjectSourceContent{}, err
	}
	if s.sourceStorage == nil || strings.TrimSpace(project.SourceStorageKey) == "" {
		return ComicProjectSourceContent{}, ErrComicSourceUnavailable
	}
	reader, object, err := s.sourceStorage.Get(ctx, project.SourceStorageKey)
	if err != nil {
		return ComicProjectSourceContent{}, err
	}
	project.Scope = WorkspaceScopeFromID(project.WorkspaceID)
	return ComicProjectSourceContent{Project: project, Object: object, Reader: reader}, nil
}

func (s *ComicAssetService) UpdateProject(id string, userID string, scope string, input UpdateComicProjectInput) (ComicProjectDetail, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	project, err := s.repo.GetProject(id, workspaceID)
	if err != nil {
		return ComicProjectDetail{}, err
	}
	if input.Title != nil {
		project.Title = strings.TrimSpace(*input.Title)
		if project.Title == "" {
			return ComicProjectDetail{}, ErrComicTitleRequired
		}
	}
	if input.StylePreset != nil {
		project.StylePreset = strings.TrimSpace(*input.StylePreset)
	}
	if input.DefaultTemplates != nil {
		project.DefaultTemplates = encodeComicJSON(normalizeComicTemplates(*input.DefaultTemplates), "{}")
	}
	project, err = s.repo.UpdateProject(project, workspaceID)
	if err != nil {
		return ComicProjectDetail{}, err
	}
	assets, err := s.repo.ListAssets(id, workspaceID)
	if err != nil {
		return ComicProjectDetail{}, err
	}
	project.Scope = WorkspaceScopeFromID(project.WorkspaceID)
	return ComicProjectDetail{Project: project, Assets: assets}, nil
}

func (s *ComicAssetService) DeleteProject(id string, userID string, scope string) error {
	workspaceID := WorkspaceIDForScope(scope, userID)
	project, err := s.repo.GetProject(id, workspaceID)
	if err != nil {
		return err
	}
	referenceItemIDs := make([]string, 0)
	if s.assetRefs != nil {
		if batches, listErr := s.repo.ListBatches(id, workspaceID); listErr == nil {
			for _, batch := range batches {
				_, items, getErr := s.repo.GetBatchInternal(batch.ID)
				if getErr == nil {
					for _, item := range items {
						referenceItemIDs = append(referenceItemIDs, item.ID)
					}
				}
			}
		}
	}
	if err := s.repo.DeleteProject(id, workspaceID); err != nil {
		return err
	}
	for _, itemID := range referenceItemIDs {
		if err := s.assetRefs.DeleteForSource(workspaceID, model.AssetReferenceTypeComicInput, itemID); err != nil {
			log.Printf("comic input reference cleanup failed item_id=%s error=%v", itemID, err)
		}
		if err := s.assetRefs.DeleteForSource(workspaceID, model.AssetReferenceTypeComicOutput, itemID); err != nil {
			log.Printf("comic output reference cleanup failed item_id=%s error=%v", itemID, err)
		}
	}
	if s.sourceStorage != nil && strings.TrimSpace(project.SourceStorageKey) != "" {
		if err := s.sourceStorage.Delete(context.Background(), project.SourceStorageKey); err != nil {
			log.Printf("comic project source cleanup failed project_id=%s error=%v", project.ID, err)
		}
	}
	return nil
}

type ComicAssetInput struct {
	Code              *string
	Class             *string
	Name              *string
	State             *string
	Description       *string
	VisualDescription *string
	ChangeRequest     *string
	SourcePrompt      *string
	PromptTemplate    *string
	ArchiveStatus     *string
}

func (s *ComicAssetService) CreateAsset(projectID string, userID string, scope string, input ComicAssetInput) (model.ComicAsset, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	if _, err := s.repo.GetProject(projectID, workspaceID); err != nil {
		return model.ComicAsset{}, err
	}
	asset, err := newComicAsset(projectID, input, "")
	if err != nil {
		return model.ComicAsset{}, err
	}
	return s.repo.CreateAsset(asset, workspaceID)
}

func (s *ComicAssetService) UpdateAsset(projectID string, assetID string, userID string, scope string, input ComicAssetInput) (model.ComicAsset, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	asset, err := s.repo.GetAsset(projectID, assetID, workspaceID)
	if err != nil {
		return model.ComicAsset{}, err
	}
	promptInputsChanged := false
	apply := func(target *string, value *string, affectsPrompt bool) {
		if value == nil {
			return
		}
		next := strings.TrimSpace(*value)
		if *target != next {
			*target = next
			promptInputsChanged = promptInputsChanged || affectsPrompt
		}
	}
	apply(&asset.Code, input.Code, false)
	if input.Class != nil {
		nextClass := strings.TrimSpace(*input.Class)
		if !isComicAssetClass(nextClass) {
			return model.ComicAsset{}, ErrComicAssetClassInvalid
		}
		if asset.Class != nextClass {
			asset.Class = nextClass
			promptInputsChanged = true
		}
	}
	apply(&asset.Name, input.Name, true)
	if asset.Name == "" {
		return model.ComicAsset{}, ErrComicAssetNameRequired
	}
	apply(&asset.State, input.State, true)
	apply(&asset.Description, input.Description, true)
	apply(&asset.VisualDescription, input.VisualDescription, true)
	apply(&asset.ChangeRequest, input.ChangeRequest, true)
	if input.SourcePrompt != nil {
		apply(&asset.SourcePrompt, input.SourcePrompt, true)
	}
	apply(&asset.PromptTemplate, input.PromptTemplate, true)
	if input.ArchiveStatus != nil {
		asset.ArchiveStatus = strings.TrimSpace(*input.ArchiveStatus)
	}
	if promptInputsChanged {
		asset.PromptStatus = model.ComicPromptStatusNeedsReview
	}
	return s.repo.UpdateAsset(asset, workspaceID)
}

func (s *ComicAssetService) DeleteAsset(projectID string, assetID string, userID string, scope string) error {
	return s.repo.DeleteAsset(projectID, assetID, WorkspaceIDForScope(scope, userID))
}

type ComicPromptPreview struct {
	AssetID        string   `json:"asset_id"`
	SourcePrompt   string   `json:"source_prompt"`
	DraftPrompt    string   `json:"draft_prompt"`
	ApprovedPrompt string   `json:"approved_prompt"`
	Template       string   `json:"template"`
	TemplateSource string   `json:"template_source"`
	Warnings       []string `json:"warnings"`
	Blockers       []string `json:"blockers"`
}

func (s *ComicAssetService) PreviewPrompt(projectID string, assetID string, userID string, scope string) (ComicPromptPreview, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	project, err := s.repo.GetProject(projectID, workspaceID)
	if err != nil {
		return ComicPromptPreview{}, err
	}
	asset, err := s.repo.GetAsset(projectID, assetID, workspaceID)
	if err != nil {
		return ComicPromptPreview{}, err
	}
	template, templateSource := resolveComicTemplate(project, asset)
	draft := renderComicPrompt(template, project, asset)
	warnings, blockers := comicPromptIssues(draft)
	return ComicPromptPreview{
		AssetID: asset.ID, SourcePrompt: asset.SourcePrompt, DraftPrompt: draft, ApprovedPrompt: asset.ApprovedPrompt,
		Template: template, TemplateSource: templateSource, Warnings: warnings, Blockers: blockers,
	}, nil
}

type SaveComicPromptInput struct {
	Content string
	Source  string
	Action  string
}

func (s *ComicAssetService) SavePrompt(projectID string, assetID string, userID string, scope string, input SaveComicPromptInput) (model.ComicAsset, error) {
	workspaceID := WorkspaceIDForScope(scope, userID)
	asset, err := s.repo.GetAsset(projectID, assetID, workspaceID)
	if err != nil {
		return model.ComicAsset{}, err
	}
	content := normalizeComicPrompt(input.Content)
	if content == "" {
		return model.ComicAsset{}, ErrComicPromptRequired
	}
	warnings, blockers := comicPromptIssues(content)
	asset.DraftPrompt = content
	asset.PromptWarnings = encodeComicJSON(warnings, "[]")
	asset.PromptVersion++
	action := strings.TrimSpace(strings.ToLower(input.Action))
	approved := action == "approve"
	if approved {
		if len(blockers) > 0 {
			return model.ComicAsset{}, fmt.Errorf("%w: %s", ErrComicPromptRequired, strings.Join(blockers, "; "))
		}
		asset.ApprovedPrompt = content
		asset.PromptStatus = model.ComicPromptStatusApproved
		asset.ChangeRequest = ""
	} else if asset.PromptStatus != model.ComicPromptStatusApproved {
		asset.PromptStatus = model.ComicPromptStatusNeedsReview
	}
	revisions := decodeComicPromptRevisions(asset.PromptRevisions)
	revision := model.ComicPromptRevision{
		Version: asset.PromptVersion, Source: defaultStringValue(input.Source, "manual"), Content: content, Approved: approved, CreatedAt: time.Now().UTC(),
	}
	if revision.Source == "merge" {
		revision.Operation = ComicPromptOperationMerge
		for index := len(revisions) - 1; index >= 0; index-- {
			if revisions[index].Operation == ComicPromptOperationMerge && normalizeComicPrompt(revisions[index].Content) == content {
				revision.BasedOn = append([]string(nil), revisions[index].BasedOn...)
				revision.Direction = revisions[index].Direction
				revision.RequestedModel = revisions[index].RequestedModel
				revision.ResponseModel = revisions[index].ResponseModel
				revision.MergeReport = revisions[index].MergeReport
				break
			}
		}
	} else if revision.Source == "ai" {
		revision.Operation = ComicPromptOperationOptimize
	}
	revisions = append(revisions, revision)
	asset.PromptRevisions = encodeComicJSON(revisions, "[]")
	return s.repo.UpdateAsset(asset, workspaceID)
}

type CreateComicBatchInput struct {
	AssetIDs                 []string
	ModelSelector            string
	Size                     string
	Quality                  string
	OutputFormat             string
	SystemPrompt             string
	VariantsPerAsset         int
	ReferenceAssetIDs        []string
	AssetConfigs             []ComicAssetGenerationConfigInput
	Concurrency              int
	IdempotencyKey           string
	DestinationMode          string
	DestinationFolderID      string
	CreateCategorySubfolders *bool
}

type ComicAssetGenerationConfigInput struct {
	AssetID           string   `json:"asset_id"`
	ModelSelector     string   `json:"model_selector"`
	Size              string   `json:"size"`
	Quality           string   `json:"quality"`
	OutputFormat      string   `json:"output_format"`
	SystemPrompt      string   `json:"system_prompt"`
	Variants          int      `json:"variants"`
	ReferenceAssetIDs []string `json:"reference_asset_ids"`
}

type ComicGenerationConfigSnapshot struct {
	ModelSelector     string   `json:"model_selector"`
	Model             string   `json:"model"`
	Size              string   `json:"size"`
	Quality           string   `json:"quality"`
	OutputFormat      string   `json:"output_format"`
	SystemPrompt      string   `json:"system_prompt"`
	ReferenceAssetIDs []string `json:"reference_asset_ids"`
	AssetCategory     string   `json:"asset_category,omitempty"`
}

type normalizedComicAssetGenerationConfig struct {
	AssetID           string
	ModelSelector     string
	Size              string
	Quality           string
	OutputFormat      string
	SystemPrompt      string
	Variants          int
	ReferenceAssetIDs []string
}

type ComicBatchDetail struct {
	Batch model.ComicAssetGenerationBatch  `json:"batch"`
	Items []model.ComicAssetGenerationItem `json:"items"`
}

func (s *ComicAssetService) CreateBatch(projectID string, userID string, scope string, input CreateComicBatchInput) (ComicBatchDetail, error) {
	concurrency := input.Concurrency
	if concurrency == 0 {
		concurrency = ComicBatchDefaultConcurrency
	}
	if concurrency < 1 || concurrency > ComicBatchMaxConcurrency {
		return ComicBatchDetail{}, ErrComicBatchConcurrency
	}
	workspaceID := WorkspaceIDForScope(scope, userID)
	destinationMode := strings.ToLower(strings.TrimSpace(input.DestinationMode))
	if destinationMode == "" {
		destinationMode = model.AssetDestinationModeAuto
	}
	if destinationMode != model.AssetDestinationModeAuto && destinationMode != model.AssetDestinationModeCustom {
		return ComicBatchDetail{}, ErrComicDestinationMode
	}
	destinationFolderID := strings.TrimSpace(input.DestinationFolderID)
	createCategorySubfolders := true
	if input.CreateCategorySubfolders != nil {
		createCategorySubfolders = *input.CreateCategorySubfolders
	}
	if destinationMode == model.AssetDestinationModeCustom && destinationFolderID == "" {
		return ComicBatchDetail{}, ErrComicDestinationFolder
	}
	selected := make(map[string]bool, len(input.AssetIDs))
	for _, assetID := range input.AssetIDs {
		if assetID = strings.TrimSpace(assetID); assetID != "" {
			selected[assetID] = true
		}
	}
	selectedIDs := make([]string, 0, len(selected))
	for assetID := range selected {
		selectedIDs = append(selectedIDs, assetID)
	}
	sort.Strings(selectedIDs)
	defaultConfig, err := normalizeComicAssetGenerationConfig(normalizedComicAssetGenerationConfig{
		ModelSelector:     input.ModelSelector,
		Size:              input.Size,
		Quality:           input.Quality,
		OutputFormat:      input.OutputFormat,
		SystemPrompt:      input.SystemPrompt,
		Variants:          input.VariantsPerAsset,
		ReferenceAssetIDs: input.ReferenceAssetIDs,
	}, normalizedComicAssetGenerationConfig{})
	if err != nil {
		return ComicBatchDetail{}, err
	}
	configByAssetID := make(map[string]normalizedComicAssetGenerationConfig, len(input.AssetConfigs))
	canonicalConfigs := make([]normalizedComicAssetGenerationConfig, 0, len(input.AssetConfigs))
	for _, assetConfig := range input.AssetConfigs {
		assetID := strings.TrimSpace(assetConfig.AssetID)
		if assetID == "" {
			return ComicBatchDetail{}, repository.ErrComicAssetNotFound
		}
		if _, exists := configByAssetID[assetID]; exists {
			return ComicBatchDetail{}, repository.ErrComicAssetConflict
		}
		normalized, normalizeErr := normalizeComicAssetGenerationConfig(normalizedComicAssetGenerationConfig{
			AssetID:           assetID,
			ModelSelector:     assetConfig.ModelSelector,
			Size:              assetConfig.Size,
			Quality:           assetConfig.Quality,
			OutputFormat:      assetConfig.OutputFormat,
			SystemPrompt:      assetConfig.SystemPrompt,
			Variants:          assetConfig.Variants,
			ReferenceAssetIDs: assetConfig.ReferenceAssetIDs,
		}, defaultConfig)
		if normalizeErr != nil {
			return ComicBatchDetail{}, normalizeErr
		}
		configByAssetID[assetID] = normalized
		canonicalConfigs = append(canonicalConfigs, normalized)
	}
	sort.Slice(canonicalConfigs, func(i, j int) bool { return canonicalConfigs[i].AssetID < canonicalConfigs[j].AssetID })
	fingerprint := comicBatchRequestFingerprint(projectID, selectedIDs, defaultConfig, canonicalConfigs, concurrency, destinationMode, destinationFolderID, createCategorySubfolders)
	if isLegacyComicBatchInput(input) {
		fingerprint = legacyComicBatchRequestFingerprint(
			projectID, selectedIDs, strings.TrimSpace(input.ModelSelector),
			defaultStringValue(input.Size, defaultComicImageSize), strings.TrimSpace(input.Quality), concurrency,
		)
	}
	clientIdempotencyKey := strings.TrimSpace(input.IdempotencyKey)
	persistedIdempotencyKey := ""
	if clientIdempotencyKey != "" {
		persistedIdempotencyKey = comicBatchIdempotencyKey(userID, workspaceID, clientIdempotencyKey)
		existing, existingItems, err := s.repo.GetBatchByIdempotencyKey(persistedIdempotencyKey)
		if err == nil {
			if existing.ProjectID != projectID || existing.WorkspaceID != workspaceID || existing.UserID != userID || existing.RequestFingerprint != fingerprint {
				return ComicBatchDetail{}, repository.ErrComicAssetConflict
			}
			existing.Scope = WorkspaceScopeFromID(existing.WorkspaceID)
			return ComicBatchDetail{Batch: existing, Items: existingItems}, nil
		}
		if !errors.Is(err, repository.ErrComicAssetBatchNotFound) {
			return ComicBatchDetail{}, err
		}
	}
	if s.resolver == nil {
		return ComicBatchDetail{}, errors.New("comic image job resolver is not configured")
	}
	project, err := s.repo.GetProject(projectID, workspaceID)
	if err != nil {
		return ComicBatchDetail{}, err
	}
	assets, err := s.repo.ListAssets(projectID, workspaceID)
	if err != nil {
		return ComicBatchDetail{}, err
	}
	known := make(map[string]bool, len(assets))
	for _, asset := range assets {
		known[asset.ID] = true
	}
	if len(selected) > 0 {
		for assetID := range selected {
			if !known[assetID] {
				return ComicBatchDetail{}, repository.ErrComicAssetNotFound
			}
		}
	}
	for assetID := range configByAssetID {
		if !known[assetID] || (len(selected) > 0 && !selected[assetID]) {
			return ComicBatchDetail{}, repository.ErrComicAssetNotFound
		}
	}
	eligible := make([]model.ComicAsset, 0)
	for _, asset := range assets {
		if len(selected) > 0 && !selected[asset.ID] {
			continue
		}
		if len(selected) == 0 && asset.ArchiveStatus != model.ComicAssetArchivePending && asset.ArchiveStatus != model.ComicAssetArchiveFailed {
			continue
		}
		if asset.PromptStatus != model.ComicPromptStatusApproved {
			if len(selected) > 0 {
				return ComicBatchDetail{}, fmt.Errorf("%w: %s", ErrComicPromptNotApproved, asset.Name)
			}
			continue
		}
		_, blockers := comicPromptIssues(asset.ApprovedPrompt)
		if len(blockers) > 0 {
			if len(selected) > 0 {
				return ComicBatchDetail{}, fmt.Errorf("%w: %s: %s", ErrComicPromptRequired, asset.Name, strings.Join(blockers, "; "))
			}
			continue
		}
		eligible = append(eligible, asset)
	}
	if len(eligible) == 0 {
		return ComicBatchDetail{}, ErrComicBatchEmpty
	}
	sort.Slice(eligible, func(i, j int) bool { return eligible[i].Code < eligible[j].Code })
	resolvedConfigs := make(map[string]ComicGenerationConfigSnapshot, len(eligible))
	variantsByAsset := make(map[string]int, len(eligible))
	outputFolderByAsset := make(map[string]string, len(eligible))
	if s.assetFolders != nil {
		if destinationMode == model.AssetDestinationModeAuto {
			categoryFolders, folderErr := s.assetFolders.EnsureComicProjectFolders(userID, scope, project.ID, project.Title)
			if folderErr != nil {
				return ComicBatchDetail{}, folderErr
			}
			for _, asset := range eligible {
				category, _ := NormalizeAssetCategory(asset.Class)
				outputFolderByAsset[asset.ID] = categoryFolders[category].ID
			}
		} else {
			baseFolder, folderErr := s.assetFolders.ValidateDestination(destinationFolderID, userID, scope)
			if folderErr != nil {
				return ComicBatchDetail{}, folderErr
			}
			for _, asset := range eligible {
				category, _ := NormalizeAssetCategory(asset.Class)
				target := baseFolder
				if createCategorySubfolders {
					target, folderErr = s.assetFolders.EnsureCategoryChild(userID, scope, baseFolder.ID, category)
					if folderErr != nil {
						return ComicBatchDetail{}, folderErr
					}
				}
				outputFolderByAsset[asset.ID] = target.ID
			}
		}
	} else if destinationMode == model.AssetDestinationModeCustom {
		return ComicBatchDetail{}, ErrComicDestinationFolder
	}
	resolutionCache := make(map[string]ComicImageJobResolution)
	for _, asset := range eligible {
		config := defaultConfig
		if override, ok := configByAssetID[asset.ID]; ok {
			config = override
		}
		config.AssetID = asset.ID
		if err := s.validateComicReferenceAssets(userID, scope, config.ReferenceAssetIDs); err != nil {
			return ComicBatchDetail{}, fmt.Errorf("%w: %s", err, asset.Name)
		}
		jobType := model.JobTypeImageGenerate
		if len(config.ReferenceAssetIDs) > 0 {
			jobType = model.JobTypeImageEdit
		}
		cacheKey := config.ModelSelector + "\x00" + jobType
		resolution, ok := resolutionCache[cacheKey]
		if !ok {
			resolution, err = s.resolver(config.ModelSelector, jobType)
			if err != nil {
				return ComicBatchDetail{}, ErrComicImageProvider
			}
			if strings.TrimSpace(resolution.Model) == "" {
				return ComicBatchDetail{}, ErrComicImageModelRequired
			}
			resolutionCache[cacheKey] = resolution
		}
		resolvedConfigs[asset.ID] = ComicGenerationConfigSnapshot{
			ModelSelector:     resolution.Selector,
			Model:             resolution.Model,
			Size:              config.Size,
			Quality:           config.Quality,
			OutputFormat:      config.OutputFormat,
			SystemPrompt:      config.SystemPrompt,
			ReferenceAssetIDs: append([]string(nil), config.ReferenceAssetIDs...),
			AssetCategory:     asset.Class,
		}
		variantsByAsset[asset.ID] = config.Variants
	}
	batchID := "comic_batch_" + randomHex(10)
	if persistedIdempotencyKey == "" {
		persistedIdempotencyKey = "comic-create:" + batchID
	}
	firstConfig := resolvedConfigs[eligible[0].ID]
	batch := model.ComicAssetGenerationBatch{
		ID: batchID, ProjectID: projectID, UserID: userID, WorkspaceID: workspaceID,
		IdempotencyKey: persistedIdempotencyKey, RequestFingerprint: fingerprint,
		Status: model.ComicBatchStatusQueued, ModelSelector: firstConfig.ModelSelector, Model: firstConfig.Model,
		Size: firstConfig.Size, Quality: firstConfig.Quality, DestinationMode: destinationMode,
		DestinationFolderID: destinationFolderID, CreateCategorySubfolders: createCategorySubfolders, Concurrency: concurrency,
	}
	totalItems := 0
	for _, count := range variantsByAsset {
		totalItems += count
	}
	items := make([]model.ComicAssetGenerationItem, 0, totalItems)
	position := 0
	for _, asset := range eligible {
		snapshot := resolvedConfigs[asset.ID]
		for variant := 1; variant <= variantsByAsset[asset.ID]; variant++ {
			items = append(items, model.ComicAssetGenerationItem{
				ID: "comic_item_" + randomHex(10), BatchID: batchID, ComicAssetID: asset.ID,
				AssetCode: asset.Code, AssetName: asset.Name, Position: position, VariantIndex: variant,
				Status: model.ComicBatchItemStatusPending, PromptSnapshot: asset.ApprovedPrompt,
				ConfigSnapshot: encodeComicJSON(snapshot, "{}"), Attempt: 1, Error: model.JSONB("{}"), OutputFolderID: outputFolderByAsset[asset.ID],
			})
			position++
		}
	}
	createdBatch, createdItems, err := s.repo.CreateBatch(batch, items)
	if err != nil {
		return ComicBatchDetail{}, err
	}
	if s.assetRefs != nil {
		for _, item := range createdItems {
			config := resolvedConfigs[item.ComicAssetID]
			if referenceErr := s.assetRefs.ReplaceForSource(workspaceID, model.AssetReferenceTypeComicInput, item.ID, config.ReferenceAssetIDs); referenceErr != nil {
				log.Printf("comic input reference index failed item_id=%s error=%v", item.ID, referenceErr)
			}
		}
	}
	createdBatch.Scope = WorkspaceScopeFromID(createdBatch.WorkspaceID)
	return ComicBatchDetail{Batch: createdBatch, Items: createdItems}, nil
}

func normalizeComicAssetGenerationConfig(value normalizedComicAssetGenerationConfig, fallback normalizedComicAssetGenerationConfig) (normalizedComicAssetGenerationConfig, error) {
	value.AssetID = strings.TrimSpace(value.AssetID)
	value.ModelSelector = defaultStringValue(value.ModelSelector, fallback.ModelSelector)
	size := strings.TrimSpace(value.Size)
	if size == "" {
		size = strings.TrimSpace(fallback.Size)
	}
	if size == "" {
		size = defaultComicImageSize
	}
	quality := strings.TrimSpace(value.Quality)
	if quality == "" {
		quality = strings.TrimSpace(fallback.Quality)
	}
	outputFormat := strings.ToLower(defaultStringValue(value.OutputFormat, fallback.OutputFormat))
	if outputFormat == "" {
		outputFormat = defaultComicOutputFormat
	}
	if outputFormat != defaultComicOutputFormat {
		return normalizedComicAssetGenerationConfig{}, ErrComicImageOutputFormat
	}
	parameters, err := NormalizeImageGenerationParameters(size, quality, outputFormat)
	if err != nil {
		return normalizedComicAssetGenerationConfig{}, err
	}
	variants := value.Variants
	if variants == 0 {
		variants = fallback.Variants
	}
	if variants == 0 {
		variants = 1
	}
	if variants < 1 || variants > ComicBatchMaxVariantsPerAsset {
		return normalizedComicAssetGenerationConfig{}, ErrComicImageVariants
	}
	referenceAssetIDs := value.ReferenceAssetIDs
	if referenceAssetIDs == nil {
		referenceAssetIDs = fallback.ReferenceAssetIDs
	}
	referenceAssetIDs = uniqueComicReferenceAssetIDs(referenceAssetIDs)
	if len(referenceAssetIDs) > ComicBatchMaxReferenceAssets {
		return normalizedComicAssetGenerationConfig{}, fmt.Errorf("%w: at most %d images", ErrComicReferenceAsset, ComicBatchMaxReferenceAssets)
	}
	systemPrompt := strings.TrimSpace(value.SystemPrompt)
	if systemPrompt == "" {
		systemPrompt = strings.TrimSpace(fallback.SystemPrompt)
	}
	return normalizedComicAssetGenerationConfig{
		AssetID:           value.AssetID,
		ModelSelector:     strings.TrimSpace(value.ModelSelector),
		Size:              parameters.Size,
		Quality:           parameters.Quality,
		OutputFormat:      parameters.OutputFormat,
		SystemPrompt:      systemPrompt,
		Variants:          variants,
		ReferenceAssetIDs: referenceAssetIDs,
	}, nil
}

func uniqueComicReferenceAssetIDs(values []string) []string {
	seen := make(map[string]bool, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func (s *ComicAssetService) validateComicReferenceAssets(userID string, scope string, assetIDs []string) error {
	if len(assetIDs) == 0 {
		return nil
	}
	if s.assetService == nil || s.jobInputs == nil {
		return fmt.Errorf("%w: reference storage is unavailable", ErrComicReferenceAsset)
	}
	for _, assetID := range assetIDs {
		asset, err := s.assetService.Get(assetID, userID, scope)
		if err != nil {
			return fmt.Errorf("%w: %s", ErrComicReferenceAsset, assetID)
		}
		if asset.Type != "image" {
			return fmt.Errorf("%w: %s is not an image", ErrComicReferenceAsset, assetID)
		}
	}
	return nil
}

func comicBatchIdempotencyKey(userID string, workspaceID string, clientKey string) string {
	digest := sha256.Sum256([]byte(strings.Join([]string{userID, workspaceID, clientKey}, "\x00")))
	return "comic-create:" + hex.EncodeToString(digest[:])
}

func comicBatchRequestFingerprint(projectID string, assetIDs []string, defaults normalizedComicAssetGenerationConfig, configs []normalizedComicAssetGenerationConfig, concurrency int, destinationMode string, destinationFolderID string, createCategorySubfolders bool) string {
	payload, _ := json.Marshal(struct {
		ProjectID                string                                 `json:"project_id"`
		AssetIDs                 []string                               `json:"asset_ids"`
		Defaults                 normalizedComicAssetGenerationConfig   `json:"defaults"`
		Configs                  []normalizedComicAssetGenerationConfig `json:"configs"`
		Concurrency              int                                    `json:"concurrency"`
		DestinationMode          string                                 `json:"destination_mode"`
		DestinationFolderID      string                                 `json:"destination_folder_id"`
		CreateCategorySubfolders bool                                   `json:"create_category_subfolders"`
	}{ProjectID: projectID, AssetIDs: assetIDs, Defaults: defaults, Configs: configs, Concurrency: concurrency, DestinationMode: destinationMode, DestinationFolderID: destinationFolderID, CreateCategorySubfolders: createCategorySubfolders})
	digest := sha256.Sum256(payload)
	return hex.EncodeToString(digest[:])
}

func isLegacyComicBatchInput(input CreateComicBatchInput) bool {
	return len(input.AssetConfigs) == 0 && len(input.ReferenceAssetIDs) == 0 && input.VariantsPerAsset <= 1 &&
		strings.TrimSpace(input.OutputFormat) == "" && strings.TrimSpace(input.SystemPrompt) == "" &&
		strings.TrimSpace(input.DestinationMode) == "" && strings.TrimSpace(input.DestinationFolderID) == "" && input.CreateCategorySubfolders == nil
}

func legacyComicBatchRequestFingerprint(projectID string, assetIDs []string, modelSelector string, size string, quality string, concurrency int) string {
	payload, _ := json.Marshal(struct {
		ProjectID     string   `json:"project_id"`
		AssetIDs      []string `json:"asset_ids"`
		ModelSelector string   `json:"model_selector"`
		Size          string   `json:"size"`
		Quality       string   `json:"quality"`
		Concurrency   int      `json:"concurrency"`
	}{ProjectID: projectID, AssetIDs: assetIDs, ModelSelector: modelSelector, Size: size, Quality: quality, Concurrency: concurrency})
	digest := sha256.Sum256(payload)
	return hex.EncodeToString(digest[:])
}

func (s *ComicAssetService) ListBatches(projectID string, userID string, scope string) ([]model.ComicAssetGenerationBatch, error) {
	batches, err := s.repo.ListBatches(projectID, WorkspaceIDForScope(scope, userID))
	for index := range batches {
		batches[index].Scope = WorkspaceScopeFromID(batches[index].WorkspaceID)
	}
	return batches, err
}

func (s *ComicAssetService) GetBatch(batchID string, userID string, scope string) (ComicBatchDetail, error) {
	batch, items, err := s.repo.GetBatch(batchID, WorkspaceIDForScope(scope, userID))
	if err != nil {
		return ComicBatchDetail{}, err
	}
	if batch.UserID != userID && WorkspaceScopeFromID(batch.WorkspaceID) != WorkspaceScopeTeam {
		return ComicBatchDetail{}, repository.ErrComicAssetBatchNotFound
	}
	batch.Scope = WorkspaceScopeFromID(batch.WorkspaceID)
	return ComicBatchDetail{Batch: batch, Items: items}, nil
}

func (s *ComicAssetService) ControlBatch(batchID string, userID string, scope string, action string) (ComicBatchDetail, error) {
	if _, err := s.GetBatch(batchID, userID, scope); err != nil {
		return ComicBatchDetail{}, err
	}
	batch, items, err := s.repo.ControlBatch(batchID, WorkspaceIDForScope(scope, userID), action)
	batch.Scope = WorkspaceScopeFromID(batch.WorkspaceID)
	return ComicBatchDetail{Batch: batch, Items: items}, err
}

func (s *ComicAssetService) RetryBatchItems(batchID string, itemIDs []string, userID string, scope string) (ComicBatchDetail, error) {
	if _, err := s.GetBatch(batchID, userID, scope); err != nil {
		return ComicBatchDetail{}, err
	}
	batch, items, err := s.repo.RetryBatchItems(batchID, WorkspaceIDForScope(scope, userID), itemIDs)
	batch.Scope = WorkspaceScopeFromID(batch.WorkspaceID)
	return ComicBatchDetail{Batch: batch, Items: items}, err
}

func (s *ComicAssetService) StartDispatcher(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = ComicBatchDispatchInterval
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			if err := s.DispatchOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("event=comic_asset_dispatch_failed reason=%q", err.Error())
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

func (s *ComicAssetService) DispatchOnce(ctx context.Context) error {
	if s.jobs == nil || s.resolver == nil {
		return nil
	}
	batches, err := s.repo.ListActiveBatches()
	if err != nil {
		return err
	}
	var combined error
	for _, batch := range batches {
		if err := s.repo.RecoverUnassignedItems(batch.ID, time.Now().UTC().Add(-ComicBatchClaimRecoveryDelay)); err != nil {
			combined = errors.Join(combined, err)
			continue
		}
		if err := s.reconcileBatch(ctx, batch.ID); err != nil {
			combined = errors.Join(combined, err)
			continue
		}
		batch, _, err = s.repo.GetBatchInternal(batch.ID)
		if err != nil {
			combined = errors.Join(combined, err)
			continue
		}
		if batch.Status != model.ComicBatchStatusQueued && batch.Status != model.ComicBatchStatusRunning {
			continue
		}
		_, claimed, err := s.repo.ClaimPendingItems(batch.ID)
		if err != nil {
			combined = errors.Join(combined, err)
			continue
		}
		if len(claimed) == 0 {
			continue
		}
		for _, item := range claimed {
			config := comicGenerationConfigForItem(batch, item)
			jobType := model.JobTypeImageGenerate
			if len(config.ReferenceAssetIDs) > 0 {
				jobType = model.JobTypeImageEdit
			}
			resolution, resolveErr := s.resolver(config.ModelSelector, jobType)
			if resolveErr != nil {
				_ = s.repo.SyncItemFromJob(item.ID, "", model.JobStatusFailed, "", comicErrorJSON("provider_unavailable", "model provider is unavailable"))
				continue
			}
			if strings.TrimSpace(config.Model) == "" {
				config.Model = resolution.Model
			}
			resolution.Model = config.Model
			setComicResolvedJobModel(resolution.TaskKwargs, config.Model)
			prompt := comicPromptWithReferences(item.PromptSnapshot, len(config.ReferenceAssetIDs))
			if strings.TrimSpace(config.SystemPrompt) != "" {
				prompt = strings.TrimSpace(config.SystemPrompt) + "\n\n" + prompt
			}
			payload := map[string]any{
				"prompt": prompt,
				"model":  config.Model,
				"asset_registration": map[string]any{
					"folder_id": item.OutputFolderID, "category": config.AssetCategory,
					"source_type": model.AssetSourceComicBatch, "source_project_id": batch.ProjectID,
					"source_batch_id": batch.ID, "source_item_id": item.ID,
					"source_metadata": map[string]any{"variant_index": item.VariantIndex, "asset_code": item.AssetCode},
				},
			}
			strictGPTImage2Edit := jobType == model.JobTypeImageEdit && provider.IsGPTImage2Model(config.Model)
			if !strictGPTImage2Edit {
				payload["n"] = 1
				payload["response_format"] = "b64_json"
				payload["output_format"] = defaultStringValue(config.OutputFormat, defaultComicOutputFormat)
			}
			if strings.TrimSpace(config.Size) != "" {
				payload["size"] = config.Size
			}
			if strings.TrimSpace(config.Quality) != "" {
				payload["quality"] = config.Quality
			}
			var stagedInputs []StagedJobInput
			if len(config.ReferenceAssetIDs) > 0 {
				stagedInputs, err = s.stageComicReferenceInputs(ctx, batch, config.ReferenceAssetIDs)
				if err != nil {
					_ = s.repo.SyncItemFromJob(item.ID, "", model.JobStatusFailed, "", comicErrorJSON("reference_asset_unavailable", "reference image could not be prepared"))
					continue
				}
				files := make([]map[string]any, 0, len(stagedInputs))
				for _, staged := range stagedInputs {
					files = append(files, staged.Payload())
				}
				payload["files"] = files
				payload["references"] = files
				payload[StagedInputKeysPayloadField] = StagedInputKeys(stagedInputs)
			}
			payloadJSON, marshalErr := json.Marshal(payload)
			if marshalErr != nil {
				s.cleanupComicStagedInputs(ctx, batch.WorkspaceID, stagedInputs)
				_ = s.repo.SyncItemFromJob(item.ID, "", model.JobStatusFailed, "", comicErrorJSON("invalid_job_payload", "image job payload could not be created"))
				continue
			}
			result, enqueueErr := s.jobs.Enqueue(ctx, EnqueueJobInput{
				UserID: batch.UserID, Scope: WorkspaceScopeFromID(batch.WorkspaceID), Type: jobType,
				Payload: model.JSONB(payloadJSON), TaskKwargs: resolution.TaskKwargs,
				IdempotencyKey: fmt.Sprintf("comic-batch:%s:%s:%d", batch.ID, item.ID, item.Attempt), RepublishExisting: true,
			})
			if enqueueErr != nil || !result.Created || result.Job.ID == "" {
				s.cleanupComicStagedInputs(ctx, batch.WorkspaceID, stagedInputs)
			}
			if result.Job.ID != "" && (enqueueErr == nil || result.Created) {
				if setErr := s.repo.SetItemJob(item.ID, item.Attempt, result.Job.ID); setErr != nil {
					combined = errors.Join(combined, setErr)
				}
			}
			if enqueueErr != nil && result.Job.ID == "" {
				_ = s.repo.SyncItemFromJob(item.ID, "", model.JobStatusFailed, "", comicErrorJSON("job_enqueue_failed", "image job could not be queued"))
			}
		}
	}
	return combined
}

func comicGenerationConfigForItem(batch model.ComicAssetGenerationBatch, item model.ComicAssetGenerationItem) ComicGenerationConfigSnapshot {
	config := ComicGenerationConfigSnapshot{
		ModelSelector: batch.ModelSelector,
		Model:         batch.Model,
		Size:          batch.Size,
		Quality:       batch.Quality,
		OutputFormat:  defaultComicOutputFormat,
	}
	if len(item.ConfigSnapshot) > 0 {
		_ = json.Unmarshal(item.ConfigSnapshot, &config)
	}
	config.ModelSelector = defaultStringValue(config.ModelSelector, batch.ModelSelector)
	config.Model = defaultStringValue(config.Model, batch.Model)
	config.OutputFormat = defaultStringValue(config.OutputFormat, defaultComicOutputFormat)
	config.ReferenceAssetIDs = uniqueComicReferenceAssetIDs(config.ReferenceAssetIDs)
	return config
}

func comicPromptWithReferences(prompt string, referenceCount int) string {
	prompt = strings.TrimSpace(prompt)
	if referenceCount <= 0 {
		return prompt
	}
	labels := make([]string, referenceCount)
	for index := range labels {
		labels[index] = fmt.Sprintf("图片%d", index+1)
	}
	return fmt.Sprintf("参考图片编号：%s。请按这些编号理解提示词中的图片引用。\n\n%s", strings.Join(labels, "、"), prompt)
}

func (s *ComicAssetService) stageComicReferenceInputs(ctx context.Context, batch model.ComicAssetGenerationBatch, assetIDs []string) ([]StagedJobInput, error) {
	if len(assetIDs) == 0 {
		return []StagedJobInput{}, nil
	}
	if s.assetService == nil || s.jobInputs == nil {
		return nil, ErrComicReferenceAsset
	}
	scope := WorkspaceScopeFromID(batch.WorkspaceID)
	uploads := make([]JobInputUpload, 0, len(assetIDs))
	readers := make([]io.ReadCloser, 0, len(assetIDs))
	for index, assetID := range assetIDs {
		content, err := s.assetService.OpenContent(ctx, assetID, batch.UserID, scope)
		if err != nil || content.Asset.Type != "image" {
			if content.Reader != nil {
				_ = content.Reader.Close()
			}
			for _, reader := range readers {
				_ = reader.Close()
			}
			return nil, ErrComicReferenceAsset
		}
		readers = append(readers, content.Reader)
		fileName := defaultStringValue(content.Asset.Name, fmt.Sprintf("reference_%d.png", index+1))
		uploads = append(uploads, JobInputUpload{
			FieldName: "image", FileName: fileName, ContentType: content.Asset.ContentType, Reader: content.Reader,
		})
	}
	staged, err := s.jobInputs.Stage(ctx, batch.WorkspaceID, uploads)
	for _, reader := range readers {
		_ = reader.Close()
	}
	return staged, err
}

func (s *ComicAssetService) cleanupComicStagedInputs(ctx context.Context, workspaceID string, inputs []StagedJobInput) {
	if s.jobInputs == nil || len(inputs) == 0 {
		return
	}
	if err := s.jobInputs.Cleanup(context.WithoutCancel(ctx), workspaceID, StagedInputKeys(inputs)); err != nil {
		log.Printf("event=comic_reference_cleanup_failed workspace_id=%s reason=%q", workspaceID, err.Error())
	}
}

func (s *ComicAssetService) reconcileBatch(_ context.Context, batchID string) error {
	batch, items, err := s.repo.GetBatchInternal(batchID)
	if err != nil {
		return err
	}
	projectTitle := ""
	if project, projectErr := s.repo.GetProject(batch.ProjectID, batch.WorkspaceID); projectErr == nil {
		projectTitle = project.Title
	}
	var combined error
	for _, item := range items {
		if item.JobID == "" || (item.Status != model.ComicBatchItemStatusQueued && item.Status != model.ComicBatchItemStatusRunning) {
			continue
		}
		job, err := s.jobs.GetForUser(item.JobID, batch.UserID)
		if err != nil {
			combined = errors.Join(combined, err)
			continue
		}
		outputAssetID := ""
		status := job.Status
		if status == model.JobStatusSucceeded {
			outputAssetID = comicOutputAssetID(job.Result)
			if outputAssetID == "" {
				status = model.JobStatusFailed
				job.Error = comicErrorJSON("missing_output_asset", "generated job did not return an asset")
			}
		} else if status == model.JobStatusFailed || status == model.JobStatusCanceled {
			job.Error = sanitizeComicJobError(job.Error)
		}
		if outputAssetID != "" && s.assetFolders != nil && s.assetService != nil {
			config := comicGenerationConfigForItem(batch, item)
			category := config.AssetCategory
			if strings.TrimSpace(category) == "" {
				if comicAsset, assetErr := s.repo.GetAsset(batch.ProjectID, item.ComicAssetID, batch.WorkspaceID); assetErr == nil {
					category = comicAsset.Class
				}
			}
			_, registrationErr := s.assetService.ApplyRegistration(outputAssetID, batch.UserID, WorkspaceScopeFromID(batch.WorkspaceID), AssetRegistrationContext{
				FolderID: item.OutputFolderID, Category: category, SourceType: model.AssetSourceComicBatch,
				SourceProjectID: batch.ProjectID, SourceProjectName: projectTitle, SourceBatchID: batch.ID, SourceItemID: item.ID, SourceJobID: job.ID,
				SourceMetadata: map[string]any{"variant_index": item.VariantIndex, "asset_code": item.AssetCode},
			})
			if registrationErr != nil {
				log.Printf("event=comic_asset_registration_failed asset_id=%s batch_id=%s item_id=%s reason=%q", outputAssetID, batch.ID, item.ID, registrationErr.Error())
			}
		}
		if err := s.repo.SyncItemFromJob(item.ID, item.JobID, status, outputAssetID, job.Error); err != nil {
			combined = errors.Join(combined, err)
		} else if outputAssetID != "" && s.assetRefs != nil {
			if referenceErr := s.assetRefs.ReplaceForSource(batch.WorkspaceID, model.AssetReferenceTypeComicOutput, item.ID, []string{outputAssetID}); referenceErr != nil {
				combined = errors.Join(combined, referenceErr)
			}
		}
	}
	return combined
}

func resolveComicTemplate(project model.ComicAssetProject, asset model.ComicAsset) (string, string) {
	if template := strings.TrimSpace(asset.PromptTemplate); template != "" {
		return template, "asset"
	}
	defaults := map[string]string{}
	_ = json.Unmarshal(project.DefaultTemplates, &defaults)
	if template := strings.TrimSpace(defaults[asset.Class]); template != "" {
		return template, "project"
	}
	return systemComicPromptTemplates[asset.Class], "system"
}

func renderComicPrompt(template string, project model.ComicAssetProject, asset model.ComicAsset) string {
	description := defaultStringValue(asset.VisualDescription, asset.Description)
	values := map[string]string{
		"style":       project.StylePreset,
		"name":        asset.Name,
		"class":       asset.Class,
		"description": description,
		"state":       defaultStringValue(asset.State, "默认"),
	}
	rendered := comicPromptPlaceholder.ReplaceAllStringFunc(template, func(placeholder string) string {
		match := comicPromptPlaceholder.FindStringSubmatch(placeholder)
		if len(match) != 2 {
			return placeholder
		}
		key := strings.ToLower(strings.TrimSpace(match[1]))
		field, ok := comicPromptPlaceholderAliases[key]
		if !ok {
			return placeholder
		}
		return values[field]
	})
	return normalizeComicPrompt(rendered)
}

func comicPromptIssues(prompt string) ([]string, []string) {
	prompt = strings.TrimSpace(prompt)
	warnings := make([]string, 0)
	blockers := make([]string, 0)
	if prompt == "" {
		blockers = append(blockers, "提示词不能为空")
	}
	if placeholders := unresolvedComicPromptPlaceholders(prompt); len(placeholders) > 0 {
		blockers = append(blockers, "仍有未替换的模板占位符："+strings.Join(placeholders, "、"))
	}
	for _, term := range comicPromptManagementTerms {
		if strings.Contains(prompt, term) {
			warnings = append(warnings, fmt.Sprintf("包含制作管理语：%s", term))
		}
	}
	if comicPromptEpisodeTerm.MatchString(prompt) {
		warnings = append(warnings, "包含制作管理语：具体集数")
	}
	return uniqueComicStrings(warnings), blockers
}

func unresolvedComicPromptPlaceholders(prompt string) []string {
	result := make([]string, 0)
	seen := make(map[string]bool)
	for _, match := range comicPromptPlaceholder.FindAllStringSubmatch(prompt, -1) {
		if len(match) != 2 {
			continue
		}
		name := strings.TrimSpace(match[1])
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		result = append(result, name)
	}
	return result
}

func normalizeComicPrompt(value string) string {
	lines := strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n")
	result := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(comicPromptWhitespace.ReplaceAllString(line, " "))
		if line != "" {
			result = append(result, line)
		}
	}
	return strings.Join(result, "\n")
}

func decodeComicPromptRevisions(value model.JSONB) []model.ComicPromptRevision {
	revisions := make([]model.ComicPromptRevision, 0)
	_ = json.Unmarshal(value, &revisions)
	return revisions
}

func encodeComicJSON(value any, fallback string) model.JSONB {
	data, err := json.Marshal(value)
	if err != nil {
		return model.JSONB(fallback)
	}
	return model.JSONB(data)
}

func normalizeComicTemplates(templates map[string]string) map[string]string {
	normalized := make(map[string]string)
	for key, value := range templates {
		key = strings.TrimSpace(key)
		if isComicAssetClass(key) && strings.TrimSpace(value) != "" {
			normalized[key] = strings.TrimSpace(value)
		}
	}
	return normalized
}

func comicOutputAssetID(result model.JSONB) string {
	var raw map[string]any
	if json.Unmarshal(result, &raw) != nil {
		return ""
	}
	if assets, ok := raw["assets"].([]any); ok {
		for _, value := range assets {
			if item, ok := value.(map[string]any); ok {
				if id := strings.TrimSpace(fmt.Sprint(item["id"])); id != "" && id != "<nil>" {
					return id
				}
			}
		}
	}
	if outputs, ok := raw["outputs"].([]any); ok {
		for _, value := range outputs {
			if item, ok := value.(map[string]any); ok {
				if id := strings.TrimSpace(fmt.Sprint(item["asset_id"])); id != "" && id != "<nil>" {
					return id
				}
			}
		}
	}
	return ""
}

func comicErrorJSON(code string, message string) model.JSONB {
	return encodeComicJSON(map[string]string{"code": code, "message": message, "suggestion": comicErrorSuggestion(code)}, "{}")
}

func sanitizeComicJobError(value model.JSONB) model.JSONB {
	var raw map[string]any
	_ = json.Unmarshal(value, &raw)
	code := strings.TrimSpace(fmt.Sprint(raw["code"]))
	if code == "" || code == "<nil>" {
		code = strings.TrimSpace(fmt.Sprint(raw["reason"]))
	}
	if code == "" || code == "<nil>" || len(code) > 80 {
		code = "generation_failed"
	}
	message := strings.TrimSpace(fmt.Sprint(raw["message"]))
	if message == "" || message == "<nil>" {
		message = strings.TrimSpace(fmt.Sprint(raw["error"]))
	}
	if message == "" || message == "<nil>" {
		message = "图片生成任务失败"
	}
	message = comicErrorCredential.ReplaceAllString(message, "$1***")
	message = comicErrorURLCredential.ReplaceAllString(message, "$1***@")
	if len([]rune(message)) > 300 {
		message = string([]rune(message)[:300]) + "…"
	}
	return comicErrorJSON(code, message)
}

func comicErrorSuggestion(code string) string {
	value := strings.ToLower(code)
	switch {
	case strings.Contains(value, "timeout"):
		return "请稍后重试，或检查模型渠道超时配置"
	case strings.Contains(value, "auth"), strings.Contains(value, "key"), strings.Contains(value, "provider"):
		return "请管理员检查图片模型渠道与密钥配置"
	case strings.Contains(value, "quota"), strings.Contains(value, "rate"):
		return "请检查渠道额度或稍后重试"
	default:
		return "请检查模型、尺寸和提示词后重试失败项"
	}
}

func setComicResolvedJobModel(kwargs map[string]any, modelID string) {
	providerConfig, ok := kwargs["provider"].(map[string]any)
	if !ok {
		return
	}
	providerConfig["model"] = strings.TrimSpace(modelID)
}

func newComicProject(userID string, scope string, input CreateComicProjectInput) model.ComicAssetProject {
	return model.ComicAssetProject{
		ID:               "comic_proj_" + randomHex(10),
		OwnerID:          userID,
		WorkspaceID:      WorkspaceIDForScope(scope, userID),
		Title:            strings.TrimSpace(input.Title),
		StylePreset:      defaultStringValue(input.StylePreset, "3D动漫PBR"),
		DefaultTemplates: encodeComicJSON(normalizeComicTemplates(input.DefaultTemplates), "{}"),
	}
}

func newComicAsset(projectID string, input ComicAssetInput, fallbackCode string) (model.ComicAsset, error) {
	assetClass := strings.TrimSpace(valueOrEmpty(input.Class))
	if !isComicAssetClass(assetClass) {
		return model.ComicAsset{}, ErrComicAssetClassInvalid
	}
	name := strings.TrimSpace(valueOrEmpty(input.Name))
	if name == "" {
		return model.ComicAsset{}, ErrComicAssetNameRequired
	}
	sourcePrompt := strings.TrimSpace(valueOrEmpty(input.SourcePrompt))
	code := strings.TrimSpace(valueOrEmpty(input.Code))
	if code == "" {
		code = strings.TrimSpace(fallbackCode)
	}
	if code == "" {
		code = comicAssetCode(assetClass, randomHex(3))
	}
	return model.ComicAsset{
		ID:                "comic_asset_" + randomHex(10),
		ProjectID:         projectID,
		Code:              strings.ToUpper(code),
		Class:             assetClass,
		Name:              name,
		State:             defaultStringValue(valueOrEmpty(input.State), "默认"),
		Description:       strings.TrimSpace(valueOrEmpty(input.Description)),
		VisualDescription: strings.TrimSpace(valueOrEmpty(input.VisualDescription)),
		ChangeRequest:     strings.TrimSpace(valueOrEmpty(input.ChangeRequest)),
		SourcePrompt:      sourcePrompt,
		DraftPrompt:       sourcePrompt,
		PromptTemplate:    strings.TrimSpace(valueOrEmpty(input.PromptTemplate)),
		PromptStatus:      model.ComicPromptStatusNeedsReview,
		PromptVersion:     0,
		PromptWarnings:    model.JSONB("[]"),
		PromptRevisions:   model.JSONB("[]"),
		ArchiveStatus:     defaultStringValue(valueOrEmpty(input.ArchiveStatus), model.ComicAssetArchivePending),
		Outputs:           model.JSONB("[]"),
	}, nil
}

func normalizeComicProjectSource(sourceType string, fileName string, _ string) (string, string, string, error) {
	sourceType = strings.ToLower(strings.TrimSpace(sourceType))
	extension := strings.ToLower(filepath.Ext(strings.TrimSpace(fileName)))
	if sourceType == "script" {
		switch extension {
		case ".docx":
			return sourceType, extension, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", nil
		case ".txt":
			return sourceType, extension, "text/plain; charset=utf-8", nil
		case ".md":
			return sourceType, extension, "text/markdown; charset=utf-8", nil
		}
	}
	if sourceType == "workbook" && extension == ".xlsx" {
		return sourceType, extension, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", nil
	}
	return "", "", "", ErrComicSourceInvalid
}

func comicProjectSourceStorageKey(workspaceID string, projectID string, extension string) string {
	return filepath.ToSlash(filepath.Join(assetWorkspacePath(workspaceID), "comic-projects", projectID, "source"+extension))
}

func comicImportedAssetCode(class string, sequence int) string {
	prefix := map[string]string{
		model.ComicAssetClassCharacter:   "C",
		model.ComicAssetClassEnvironment: "S",
		model.ComicAssetClassProp:        "P",
		model.ComicAssetClassUI:          "U",
	}[class]
	if prefix == "" {
		return ""
	}
	return fmt.Sprintf("%s%03d", prefix, sequence)
}

func isComicAssetClass(value string) bool {
	return value == model.ComicAssetClassCharacter || value == model.ComicAssetClassEnvironment || value == model.ComicAssetClassProp || value == model.ComicAssetClassUI
}

func comicAssetCode(class string, suffix string) string {
	prefix := map[string]string{model.ComicAssetClassCharacter: "C", model.ComicAssetClassEnvironment: "S", model.ComicAssetClassProp: "P", model.ComicAssetClassUI: "U"}[class]
	return strings.ToUpper(prefix + suffix)
}

func defaultStringValue(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return strings.TrimSpace(fallback)
	}
	return strings.TrimSpace(value)
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func uniqueComicStrings(values []string) []string {
	seen := make(map[string]bool)
	result := make([]string, 0, len(values))
	for _, value := range values {
		if !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	return result
}
