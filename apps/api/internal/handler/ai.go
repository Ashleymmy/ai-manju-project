package handler

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"log"
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/httpsecurity"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/monitoring"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/sdvideo"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

const (
	clientClosedRequestStatus = 499
	// Seedance returns signed object-storage URLs; keep server-side downloads bounded.
	maxSeedanceRemoteVideoBytes int64 = 512 * 1024 * 1024
	// Structured text requests are bounded before proxying to protect the API
	// while remaining comfortably above the four-step Canvas Agent loop.
	maxTextRequestMessages = 200
	maxTextRequestTools    = 64
	// Wan 3.0 accepts image URLs or Base64 images within 300-8000 px per side.
	wanMinImageDimension = 300
	wanMaxImageDimension = 8000
)

type AIHandler struct {
	providerHandler  *ModelProviderHandler
	monitoringRepo   repository.MonitoringRepository
	ai               *service.AIService
	jobs             *service.JobService
	jobInputs        *service.JobInputService
	materials        *service.SeedanceMaterialService
	seedanceAssets   *service.SeedanceAssetService
	assetFolders     *service.AssetFolderService
	generationAssets *service.AssetService
	assets           *service.AssetService
	sdVideo          *sdvideo.Client
	projects         *service.ProjectService
	receipts         *service.GenerationReceiptService
	comicOperations  *service.ComicAssetService
	// clonedVoices 复刻音色的展示元数据（中文别名、属主），nil = 不启用。
	clonedVoices repository.ClonedVoiceRepository
	// tempClonedVoices 缓存即克隆即删模式下临时注册的音色（20 秒内连续生成复用，
	// 到期自动从服务商删除），避免每次生成都重新克隆。
	tempClonedVoices sync.Map
	// entitlements Agent 模式门禁（WP-M6）：nil = 不启用（billing 关闭时）。
	entitlements *service.EntitlementGate
}

func NewAIHandler(providerHandler *ModelProviderHandler, jobService *service.JobService, monitoringRepo ...repository.MonitoringRepository) *AIHandler {
	var repo repository.MonitoringRepository
	if len(monitoringRepo) > 0 {
		repo = monitoringRepo[0]
	}
	return &AIHandler{providerHandler: providerHandler, monitoringRepo: repo, ai: service.NewAIService(), jobs: jobService}
}

func (h *AIHandler) SetSeedanceMaterialService(materials *service.SeedanceMaterialService) {
	h.materials = materials
}

func (h *AIHandler) SetSeedanceAssetService(assets *service.SeedanceAssetService) {
	h.seedanceAssets = assets
}

func (h *AIHandler) SetJobInputService(jobInputs *service.JobInputService) {
	h.jobInputs = jobInputs
}

func (h *AIHandler) SetAssetFolderService(folders *service.AssetFolderService) {
	h.assetFolders = folders
}

func (h *AIHandler) SetAssetService(assets *service.AssetService) {
	h.assets = assets
}

func (h *AIHandler) SetProjectService(projects *service.ProjectService) { h.projects = projects }

// SetClonedVoiceRepository wires the metadata store for cloned-voice aliases.
func (h *AIHandler) SetClonedVoiceRepository(repo repository.ClonedVoiceRepository) {
	h.clonedVoices = repo
}

// SetEntitlementGate wires the membership gate (WP-M6). Only called when
// billing is enabled; nil keeps agent mode open (pre-billing behavior).
func (h *AIHandler) SetEntitlementGate(gate *service.EntitlementGate) { h.entitlements = gate }

// SetSDVideoClient configures the optional private SD-video Gateway. The
// browser-facing API remains unchanged when the gateway is disabled.
func (h *AIHandler) SetSDVideoClient(client *sdvideo.Client) {
	h.sdVideo = client
}

func (h *AIHandler) Models(c *gin.Context) {
	client, config, ok := h.providerHandler.LoadClient(c)
	if !ok {
		return
	}

	models, err := client.ListModels(c.Request.Context())
	if err != nil {
		writeProviderError(c, config.BaseURL, err)
		return
	}

	response.OK(c, gin.H{
		"models":              models.Models,
		"text_models":         modelsWithDefault(filterModelsByCapability(models.Models, model.ModelCapabilityText), config.TextModel),
		"image_models":        imageModelsWithDefault(models.Models, config.ImageModel),
		"video_models":        filterModelsByCapability(models.Models, "video"),
		"audio_models":        filterModelsByCapability(models.Models, "audio"),
		"default_text_model":  config.TextModel,
		"default_image_model": config.ImageModel,
	})
}

func (h *AIHandler) Text(c *gin.Context) {
	startedAt := time.Now().UTC()
	var req provider.TextGenerationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" && len(req.Messages) == 0 {
		response.Error(c, http.StatusBadRequest, "prompt or messages is required")
		return
	}
	if len(req.Messages) > maxTextRequestMessages {
		response.Error(c, http.StatusBadRequest, "too many messages")
		return
	}
	if len(req.Tools) > maxTextRequestTools {
		response.Error(c, http.StatusBadRequest, "too many tools")
		return
	}
	if req.Stream {
		response.Error(c, http.StatusBadRequest, "stream must be false")
		return
	}
	if req.ParallelToolCalls != nil && *req.ParallelToolCalls {
		response.Error(c, http.StatusBadRequest, "parallel_tool_calls must be false")
		return
	}
	// Agent 模式门禁（WP-M6）：携带工具的调用视为 Agent 模式，仅会员可用。
	if h.entitlements != nil && len(req.Tools) > 0 {
		user := auth.MustCurrentUser(c)
		if err := h.entitlements.AgentAccess(user.ID); err != nil {
			if errors.Is(err, service.ErrAgentRequiresMember) {
				response.Error(c, http.StatusForbidden, "Agent 模式需要会员，请先订阅")
				return
			}
			response.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
	}
	req.Prompt = prompt
	parallelToolCalls := false
	req.ParallelToolCalls = &parallelToolCalls
	inputCount := len(req.Messages)
	if inputCount == 0 {
		inputCount = 1
	}

	candidates, ok := h.providerHandler.LoadGenerationCandidates(c, model.ModelCapabilityText, req.Model)
	if !ok {
		return
	}

	modelID := candidates[0].Model
	text, config, err := generateTextWithCandidates(c.Request.Context(), candidates, req)
	if err != nil {
		h.recordAIRequestAsync(c, aiRequestLogInput{StartedAt: startedAt, Config: config, Operation: "text", Model: modelID, InputCount: inputCount, OutputCount: 0, Err: err})
		response.Error(c, http.StatusBadGateway, generationPublicError(err))
		return
	}
	outputCount := len(text.ToolCalls)
	if outputCount == 0 {
		outputCount = 1
	}
	h.recordAIRequestAsync(c, aiRequestLogInput{StartedAt: startedAt, Config: config, Operation: "text", Model: text.Model, InputCount: inputCount, OutputCount: outputCount})

	response.OK(c, gin.H{
		"text":          text.Text,
		"model":         text.Model,
		"tool_calls":    text.ToolCalls,
		"finish_reason": text.FinishReason,
	})
}

func (h *AIHandler) ImageGenerations(c *gin.Context) {
	startedAt := time.Now().UTC()
	imageRequest, err := decodeImageGenerationRequest(c)
	if err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(imageRequest.Prompt) == "" {
		response.Error(c, http.StatusBadRequest, "prompt is required")
		return
	}
	parameters, err := service.NormalizeImageGenerationParameters(imageRequest.Size, imageRequest.Quality, stringFromAny(imageRequest.Extra["output_format"]))
	if err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	imageRequest.Size = parameters.Size
	imageRequest.Quality = parameters.Quality
	if parameters.OutputFormat != "" {
		imageRequest.Extra["output_format"] = parameters.OutputFormat
	}
	registration, err := h.resolveImageAssetRegistration(c, imageRequest.Extra["asset_context"])
	if err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	delete(imageRequest.Extra, "asset_context")
	delete(imageRequest.Extra, "asset_registration")

	candidates, ok := h.providerHandler.LoadGenerationCandidates(c, model.ModelCapabilityImage, imageRequest.Model)
	if !ok {
		return
	}
	config, modelID := candidates[0].Config, candidates[0].Model
	if modelID == "" {
		writeProviderError(c, config.BaseURL, provider.ErrImageModelNotConfigured)
		return
	}
	imageRequest.Model = modelID
	payloadMap := imageGenerationJobPayload(imageRequest, modelID)
	payloadMap["asset_registration"] = registration
	payload, err := marshalJSONB(payloadMap)
	if err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	jobResult, err := h.enqueueAIJob(c, model.JobTypeImageGenerate, payload, h.generationJobKwargs(candidates, "generate"))
	job := jobResult.Job
	if err != nil {
		h.recordAIRequestAsync(c, aiRequestLogInput{StartedAt: startedAt, Config: config, Operation: "image_generation", Model: modelID, InputCount: 1, OutputCount: requestedImageCount(imageRequest.N), Err: err})
		return
	}
	h.recordAIRequestAsync(c, aiRequestLogInput{StartedAt: startedAt, Config: config, Operation: "image_generation", Model: modelID, InputCount: 1, OutputCount: 0})
	response.Accepted(c, aiJobResponse(job))
}

func (h *AIHandler) ImageEdits(c *gin.Context) {
	startedAt := time.Now().UTC()
	editRequest, err := decodeImageEditRequest(c)
	if err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	defer closeImageEditFiles(editRequest.Files)
	if strings.TrimSpace(editRequest.Prompt) == "" {
		response.Error(c, http.StatusBadRequest, "prompt is required")
		return
	}
	parameters, err := service.NormalizeImageGenerationParameters(editRequest.Size, editRequest.Quality, editRequest.Extra["output_format"])
	if err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	editRequest.Size = parameters.Size
	editRequest.Quality = parameters.Quality
	if parameters.OutputFormat != "" {
		editRequest.Extra["output_format"] = parameters.OutputFormat
	}
	registration, err := h.resolveImageAssetRegistration(c, editRequest.Extra["asset_context"])
	if err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	delete(editRequest.Extra, "asset_context")
	delete(editRequest.Extra, "asset_registration")

	candidates, ok := h.providerHandler.LoadGenerationCandidates(c, model.ModelCapabilityImage, editRequest.Model)
	if !ok {
		return
	}
	config, modelID := candidates[0].Config, candidates[0].Model
	if modelID == "" {
		writeProviderError(c, config.BaseURL, provider.ErrImageModelNotConfigured)
		return
	}
	editRequest.Model = modelID
	workspaceID := service.WorkspaceIDForScope(requestWorkspaceScope(c), auth.MustCurrentUser(c).ID)
	stagedInputs, err := h.stageImageEditInputs(c.Request.Context(), workspaceID, editRequest.Files)
	if err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	payloadMap := imageEditJobPayload(editRequest, modelID, stagedInputPayloads(stagedInputs))
	payloadMap["asset_registration"] = registration
	payloadMap[service.StagedInputKeysPayloadField] = service.StagedInputKeys(stagedInputs)
	payload, err := marshalJSONB(payloadMap)
	if err != nil {
		h.cleanupStagedInputs(c, workspaceID, stagedInputs)
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	fingerprintPayload, err := marshalJSONB(stagedInputFingerprintPayload(payloadMap))
	if err != nil {
		h.cleanupStagedInputs(c, workspaceID, stagedInputs)
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	jobResult, err := h.enqueueAIJob(c, model.JobTypeImageEdit, payload, h.generationJobKwargs(candidates, "edit"), fingerprintPayload)
	job := jobResult.Job
	if err != nil || !jobResult.Created {
		h.cleanupStagedInputs(c, workspaceID, stagedInputs)
	}
	if err != nil {
		h.recordAIRequestAsync(c, aiRequestLogInput{StartedAt: startedAt, Config: config, Operation: "image_edit", Model: modelID, InputCount: len(editRequest.Files), OutputCount: requestedImageCount(editRequest.N), Err: err})
		return
	}
	h.recordAIRequestAsync(c, aiRequestLogInput{StartedAt: startedAt, Config: config, Operation: "image_edit", Model: modelID, InputCount: len(editRequest.Files), OutputCount: 0})
	response.Accepted(c, aiJobResponse(job))
}

func (h *AIHandler) resolveImageAssetRegistration(c *gin.Context, raw any) (map[string]any, error) {
	context := service.AssetRegistrationContext{SourceType: model.AssetSourceImageWorkbench, Category: model.AssetCategoryOther}
	if raw != nil {
		var payload []byte
		switch value := raw.(type) {
		case string:
			payload = []byte(strings.TrimSpace(value))
		default:
			encoded, err := json.Marshal(value)
			if err != nil {
				return nil, errors.New("asset_context is invalid")
			}
			payload = encoded
		}
		if len(payload) > 0 {
			if err := json.Unmarshal(payload, &context); err != nil {
				return nil, errors.New("asset_context must be a JSON object")
			}
		}
	}
	context.SourceType = strings.ToLower(strings.TrimSpace(context.SourceType))
	if context.SourceType == "" {
		context.SourceType = model.AssetSourceImageWorkbench
	}
	if context.SourceType != model.AssetSourceImageWorkbench && context.SourceType != model.AssetSourceCanvas {
		return nil, errors.New("asset_context source_type must be image_workbench or canvas")
	}
	context.SourceBatchID = ""
	context.SourceItemID = ""
	context.SourceJobID = ""
	if h.assetFolders != nil {
		user := auth.MustCurrentUser(c)
		resolved, err := h.assetFolders.ResolveRegistration(user.ID, requestWorkspaceScope(c), context)
		if err != nil {
			return nil, err
		}
		context = resolved
	}
	return map[string]any{
		"name": context.AssetName, "folder_id": context.FolderID, "category": context.Category,
		"source_type": context.SourceType, "source_project_id": context.SourceProjectID,
		"source_batch_id": context.SourceBatchID, "source_item_id": context.SourceItemID,
		"source_metadata": context.SourceMetadata, "parent_asset_ids": context.ParentAssetIDs,
		"relation_type": context.RelationType, "source_node_id": context.SourceNodeID,
	}, nil
}

func (h *AIHandler) VideoTaskCreate(c *gin.Context) {
	var payloadMap map[string]any
	var stagedInputs []service.StagedJobInput
	var workspaceID string
	var err error
	if strings.HasPrefix(c.GetHeader("Content-Type"), "multipart/form-data") {
		fields, files, decodeErr := decodeProxyMultipart(c)
		if decodeErr != nil {
			response.Error(c, http.StatusBadRequest, decodeErr.Error())
			return
		}
		defer closeProxyMultipartFiles(files)
		if h.shouldUseSDVideo(fields["model"]) {
			h.createSDVideoMultipart(c, fields, files)
			return
		}
		workspaceID = service.WorkspaceIDForScope(requestWorkspaceScope(c), auth.MustCurrentUser(c).ID)
		stagedInputs, err = h.stageProxyMultipartInputs(c.Request.Context(), workspaceID, files)
		if err == nil {
			payloadMap = proxyMultipartJobPayload(fields, stagedInputPayloads(stagedInputs))
			payloadMap[service.StagedInputKeysPayloadField] = service.StagedInputKeys(stagedInputs)
			if len(stagedInputs) > 0 {
				payloadMap[service.InputStorageKeyPayloadField] = stagedInputs[0].StorageKey
			}
		}
	} else {
		payloadMap = make(map[string]any)
		err = c.ShouldBindJSON(&payloadMap)
	}
	if err != nil {
		h.cleanupStagedInputs(c, workspaceID, stagedInputs)
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	requestedModel := stringFromAny(payloadMap["model"])
	if h.shouldUseSDVideo(requestedModel) {
		h.createSDVideoTask(c, payloadMap)
		return
	}
	candidates, ok := h.providerHandler.LoadGenerationCandidates(c, model.ModelCapabilityVideo, requestedModel)
	if !ok {
		h.cleanupStagedInputs(c, workspaceID, stagedInputs)
		return
	}
	config, modelID := candidates[0].Config, candidates[0].Model
	if modelID == "" {
		h.cleanupStagedInputs(c, workspaceID, stagedInputs)
		writeProviderError(c, config.BaseURL, errors.New("video model is not configured"))
		return
	}
	if err := h.providerHandler.videoCapabilities(modelID).validate(payloadMap); err != nil {
		h.cleanupStagedInputs(c, workspaceID, stagedInputs)
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	payloadMap["studio_model"] = requestedModel
	if err := h.prepareVideoAssetRegistration(c, payloadMap); err != nil {
		h.cleanupStagedInputs(c, workspaceID, stagedInputs)
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	payloadMap["model"] = modelID
	removeGenerationPrivateFields(payloadMap)
	payload, err := marshalJSONB(payloadMap)
	if err != nil {
		h.cleanupStagedInputs(c, workspaceID, stagedInputs)
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	var fingerprintPayload model.JSONB
	if len(stagedInputs) > 0 {
		fingerprintPayload, err = marshalJSONB(stagedInputFingerprintPayload(payloadMap))
		if err != nil {
			h.cleanupStagedInputs(c, workspaceID, stagedInputs)
			response.Error(c, http.StatusBadRequest, err.Error())
			return
		}
	}
	jobResult, err := h.enqueueAIJob(c, model.JobTypeVideoGenerate, payload, h.generationJobKwargs(candidates, "video"), fingerprintPayload)
	job := jobResult.Job
	if err != nil || !jobResult.Created {
		h.cleanupStagedInputs(c, workspaceID, stagedInputs)
	}
	if err != nil {
		return
	}
	response.Accepted(c, aiJobResponse(job))
}

func (h *AIHandler) enqueueAIJob(c *gin.Context, jobType string, payload model.JSONB, kwargs map[string]any, idempotencyPayload ...model.JSONB) (service.EnqueueJobResult, error) {
	if h.jobs == nil {
		response.Error(c, http.StatusServiceUnavailable, "job service is not configured")
		return service.EnqueueJobResult{}, errors.New("job service is not configured")
	}
	user := auth.MustCurrentUser(c)
	billingPolicy, policyErr := h.automaticVideoBillingPolicy(c, jobType, payload)
	if policyErr != nil {
		response.Error(c, http.StatusBadRequest, policyErr.Error())
		return service.EnqueueJobResult{}, policyErr
	}
	var stablePayload model.JSONB
	if len(idempotencyPayload) > 0 {
		stablePayload = idempotencyPayload[0]
	}
	// Correlation metadata must not change the payload used for deduplication.
	if len(stablePayload) == 0 {
		stablePayload = payload
	}
	var metadata map[string]any
	if json.Unmarshal(payload, &metadata) == nil && metadata != nil {
		metadata["request_id"] = response.RequestID(c)
		if correlated, marshalErr := json.Marshal(metadata); marshalErr == nil {
			payload = model.JSONB(correlated)
		}
	}
	result, err := h.jobs.Enqueue(c.Request.Context(), service.EnqueueJobInput{
		UserID:             user.ID,
		Scope:              requestWorkspaceScope(c),
		Type:               jobType,
		Payload:            payload,
		IdempotencyPayload: stablePayload,
		TaskKwargs:         kwargs,
		IdempotencyKey:     c.GetHeader("Idempotency-Key"),
		VideoBillingPolicy: billingPolicy,
	})
	if err != nil {
		if errors.Is(err, service.ErrAutomaticVideoPolicyUnavailable) {
			response.Error(c, http.StatusBadRequest, err.Error())
			return result, err
		}
		if errors.Is(err, repository.ErrInsufficientCredits) {
			response.Error(c, http.StatusPaymentRequired, "积分余额不足，请充值后重试")
			return result, err
		}
		if errors.Is(err, service.ErrConcurrencyLimitExceeded) {
			response.Error(c, http.StatusTooManyRequests, "当前任务并发已达上限，请稍后重试或升级会员")
			return result, err
		}
		response.ErrorWithData(c, http.StatusBadGateway, "failed to enqueue job", gin.H{
			"job":   aiJobResponse(result.Job),
			"error": err.Error(),
		})
		return result, err
	}
	return result, nil
}

func aiJobResponse(job model.Job) gin.H {
	return gin.H{
		"id":     job.ID,
		"job_id": job.ID,
		"status": job.Status,
	}
}

func (h *AIHandler) VideoTaskGet(c *gin.Context) {
	if h.shouldUseSDVideoTask(c) {
		h.getSDVideoTask(c)
		return
	}
	if h.serveGenerationVideoJob(c, false) {
		return
	}
	h.proxyProviderJSON(c, http.MethodGet, "/videos/"+url.PathEscape(c.Param("id")), nil, false, model.ModelCapabilityVideo, c.Query("model"))
}

func (h *AIHandler) VideoTaskContent(c *gin.Context) {
	if h.shouldUseSDVideoTask(c) {
		h.getSDVideoTaskContent(c)
		return
	}
	if h.serveGenerationVideoJob(c, true) {
		return
	}
	client, config, _, ok := h.providerHandler.LoadClientForModel(c, model.ModelCapabilityVideo, c.Query("model"))
	if !ok {
		return
	}
	body, contentType, err := client.ProxyBlob(c.Request.Context(), http.MethodGet, "/videos/"+url.PathEscape(c.Param("id"))+"/content", nil, true)
	if err != nil {
		writeProviderError(c, config.BaseURL, err)
		return
	}
	if strings.TrimSpace(contentType) == "" {
		contentType = "application/octet-stream"
	}
	c.Data(http.StatusOK, contentType, body)
}

func (h *AIHandler) SeedanceTaskCreate(c *gin.Context) {
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if requestedModel := firstNonEmpty(stringFromAny(body["model"]), c.Query("model")); h.shouldUseSDVideo(requestedModel) {
		body["model"] = requestedModel
		h.createSDVideoTask(c, body)
		return
	}
	// Authorize before any material lookup or upstream request, including stale canvas selections.
	if _, ok := h.providerHandler.LoadGenerationCandidates(c, model.ModelCapabilityVideo, firstNonEmpty(stringFromAny(body["model"]), c.Query("model"))); !ok {
		return
	}
	if err := h.ensureSeedanceAssetsActive(c.Request.Context(), body, auth.MustCurrentUser(c)); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	h.enqueueNativeVideo(c, body)
}

func (h *AIHandler) ensureSeedanceAssetsActive(ctx context.Context, payload map[string]any, user model.User) error {
	assetIDs := seedanceAssetIDsFromPayload(payload)
	if len(assetIDs) == 0 {
		return nil
	}
	if h.seedanceAssets != nil {
		if providerID, _ := decodeProviderModel(stringFromAny(payload["model"])); providerID != "" {
			// Provider-bound assets must never fall back to a different account's library.
			return h.seedanceAssets.ForUser(user).ForProvider(providerID).ForOwner(user.ID).EnsureAssetsActive(ctx, assetIDs)
		}
		err := h.seedanceAssets.ForUser(user).EnsureAssetsActive(ctx, assetIDs)
		if err == nil {
			return nil
		}
		if h.materials == nil || !strings.Contains(err.Error(), "status=missing") {
			return err
		}
	}
	if h.materials != nil {
		return h.materials.ForUser(user).EnsureAssetsActive(ctx, assetIDs)
	}
	return nil
}

func (h *AIHandler) SeedanceTaskGet(c *gin.Context) {
	if h.shouldUseSDVideoTask(c) {
		h.getSDVideoTask(c)
		return
	}
	if h.serveGenerationVideoJob(c, false) {
		return
	}
	requestedModel := c.Query("model")
	config, configOK := h.providerConfigForVideoModel(c, requestedModel)
	if !configOK {
		return
	}
	if config.ProviderType == model.ModelProviderTypeAliyunYike {
		client, loadedConfig, modelID, loaded := h.providerHandler.LoadClientForModel(c, model.ModelCapabilityVideo, requestedModel)
		if !loaded {
			return
		}
		raw, err := client.ProxyJSON(c.Request.Context(), http.MethodGet, providerProxyPath(loadedConfig, "/contents/generations/tasks/"+url.PathEscape(c.Param("id"))), nil, false)
		if err != nil {
			writeProviderError(c, loadedConfig.BaseURL, err)
			return
		}
		response.OK(c, yikeTaskResponse(raw, modelID))
		return
	}
	h.proxyProviderJSON(c, http.MethodGet, "/contents/generations/tasks/"+url.PathEscape(c.Param("id")), nil, false, model.ModelCapabilityVideo, c.Query("model"))
}

func (h *AIHandler) providerConfigForVideoModel(c *gin.Context, requestedModel string) (model.ModelProviderConfig, bool) {
	config, _, _, ok := h.providerHandler.LoadConfigForModel(c, model.ModelCapabilityVideo, requestedModel)
	return config, ok
}

func yikeVideoRequest(body map[string]any, modelID string) (map[string]any, error) {
	content, _ := body["content"].([]any)
	prompt := strings.TrimSpace(stringFromAny(body["prompt"]))
	wanModel := isWan30VideoModel(modelID)
	imageURLs := make([]string, 0)
	firstFrameURL := ""
	lastFrameURL := ""
	for _, item := range content {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}
		switch stringFromAny(record["type"]) {
		case "text":
			if prompt == "" {
				prompt = strings.TrimSpace(stringFromAny(record["text"]))
			}
		case "image_url":
			image, _ := record["image_url"].(map[string]any)
			if value := strings.TrimSpace(stringFromAny(image["url"])); value != "" {
				switch strings.ToLower(strings.TrimSpace(stringFromAny(record["role"]))) {
				case "first_frame":
					firstFrameURL = value
				case "last_frame":
					if wanModel {
						lastFrameURL = value
					} else {
						imageURLs = append(imageURLs, value)
					}
				default:
					imageURLs = append(imageURLs, value)
				}
			}
		case "video_url", "audio_url":
			return nil, errors.New("阿里云 Wan 3.0 暂不支持参考视频或参考音频")
		}
	}
	if prompt == "" {
		return nil, errors.New("prompt is required")
	}
	duration := integerValue(body["duration"], 5)
	if duration <= 0 {
		duration = 5
	}
	if duration > 30 {
		duration = 30
	}
	parameters := map[string]any{
		"resolution": strings.ToUpper(firstNonEmpty(stringFromAny(body["resolution"]), "480p")),
		"ratio":      explicitVideoRatio(stringFromAny(body["ratio"])),
		"duration":   duration,
	}
	input := map[string]any{"prompt": prompt}
	if wanModel {
		if len(imageURLs) > 0 && (firstFrameURL != "" || lastFrameURL != "") {
			return nil, errors.New("Wan 3.0 参考图模式不能与首帧/尾帧模式混用，请只保留一种参考方式")
		}
		media := make([]map[string]any, 0, len(imageURLs)+2)
		appendMedia := func(mediaType string, rawURL string) error {
			if rawURL == "" {
				return nil
			}
			normalizedURL, err := normalizeWanMediaURL(rawURL)
			if err != nil {
				return err
			}
			media = append(media, map[string]any{"type": mediaType, "url": normalizedURL})
			return nil
		}
		if err := appendMedia("first_frame", firstFrameURL); err != nil {
			return nil, err
		}
		if err := appendMedia("last_frame", lastFrameURL); err != nil {
			return nil, err
		}
		for _, imageURL := range imageURLs {
			if err := appendMedia("reference_image", imageURL); err != nil {
				return nil, err
			}
		}
		if len(media) > 0 {
			input["media"] = media
		}
		return map[string]any{"model": modelID, "input": input, "parameters": parameters}, nil
	}
	if firstFrameURL != "" {
		input["first_frame_url"] = firstFrameURL
	}
	if lastFrameURL != "" {
		input["last_frame_url"] = lastFrameURL
	}
	if len(imageURLs) > 0 {
		refs := append([]string(nil), imageURLs...)
		input["reference_urls"] = refs
		if firstFrameURL == "" && len(refs) == 1 {
			input["img_url"] = refs[0]
		}
	}
	return map[string]any{"model": modelID, "input": input, "parameters": parameters}, nil
}

func isWan30VideoModel(modelID string) bool {
	value := strings.ToLower(strings.TrimSpace(modelID))
	return strings.Contains(value, "wan3.0") || strings.Contains(value, "wan3-0") || strings.Contains(value, "wan3_0")
}

func normalizeWanMediaURL(rawURL string) (string, error) {
	value := strings.TrimSpace(rawURL)
	if !strings.HasPrefix(strings.ToLower(value), "data:image/") {
		return value, nil
	}
	header, encoded, ok := strings.Cut(value, ",")
	if !ok || !strings.Contains(strings.ToLower(header), ";base64") {
		return value, nil
	}
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		// Preserve provider-supported Data URLs whose local decoder cannot inspect.
		return value, nil
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(decoded))
	if err != nil || config.Width <= 0 || config.Height <= 0 {
		return value, nil
	}
	if config.Width >= wanMinImageDimension && config.Height >= wanMinImageDimension && config.Width <= wanMaxImageDimension && config.Height <= wanMaxImageDimension {
		return value, nil
	}
	source, _, err := image.Decode(bytes.NewReader(decoded))
	if err != nil {
		return "", errors.New("Wan 3.0 参考图解码失败，请重新上传图片")
	}
	targetWidth, targetHeight := wanImageTargetSize(config.Width, config.Height)
	canvasWidth := max(wanMinImageDimension, targetWidth)
	canvasHeight := max(wanMinImageDimension, targetHeight)
	canvas := image.NewRGBA(image.Rect(0, 0, canvasWidth, canvasHeight))
	draw.Draw(canvas, canvas.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	drawScaledOnWhite(canvas, source, (canvasWidth-targetWidth)/2, (canvasHeight-targetHeight)/2, targetWidth, targetHeight)

	var output bytes.Buffer
	if err := jpeg.Encode(&output, canvas, &jpeg.Options{Quality: 92}); err != nil {
		return "", errors.New("Wan 3.0 参考图尺寸调整失败")
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(output.Bytes()), nil
}

func wanImageTargetSize(width int, height int) (int, int) {
	if width <= 0 || height <= 0 {
		return wanMinImageDimension, wanMinImageDimension
	}
	scale := min(1.0, min(float64(wanMaxImageDimension)/float64(width), float64(wanMaxImageDimension)/float64(height)))
	return max(1, int(float64(width)*scale+0.5)), max(1, int(float64(height)*scale+0.5))
}

func drawScaledOnWhite(destination *image.RGBA, source image.Image, offsetX int, offsetY int, width int, height int) {
	bounds := source.Bounds()
	sourceWidth := bounds.Dx()
	sourceHeight := bounds.Dy()
	for y := 0; y < height; y++ {
		sourceY := bounds.Min.Y + min(sourceHeight-1, y*sourceHeight/height)
		for x := 0; x < width; x++ {
			sourceX := bounds.Min.X + min(sourceWidth-1, x*sourceWidth/width)
			r, g, b, a := source.At(sourceX, sourceY).RGBA()
			// Color values are alpha-premultiplied; composite transparency on white.
			destination.SetRGBA(offsetX+x, offsetY+y, color.RGBA{
				R: uint8((r + 0xffff - a) >> 8),
				G: uint8((g + 0xffff - a) >> 8),
				B: uint8((b + 0xffff - a) >> 8),
				A: 0xff,
			})
		}
	}
}

func yikeTaskResponse(raw json.RawMessage, fallbackModel string) map[string]any {
	var value map[string]any
	_ = json.Unmarshal(raw, &value)
	output, _ := value["output"].(map[string]any)
	id := firstNonEmpty(stringFromAny(output["task_id"]), stringFromAny(output["id"]), stringFromAny(value["task_id"]), stringFromAny(value["id"]))
	errorCode := firstNonEmpty(stringFromAny(output["code"]), stringFromAny(output["error_code"]), stringFromAny(value["code"]), stringFromAny(value["error_code"]))
	errorMessage := firstNonEmpty(stringFromAny(value["error_message"]), stringFromAny(output["error_message"]), stringFromAny(output["message"]), stringFromAny(value["message"]))
	defaultStatus := "queued"
	if errorMessage != "" {
		defaultStatus = "failed"
	}
	status := strings.ToLower(firstNonEmpty(stringFromAny(output["task_status"]), stringFromAny(output["status"]), stringFromAny(value["status"]), defaultStatus))
	switch status {
	case "pending", "submitted":
		status = "queued"
	case "succeeded", "success", "completed":
		status = "succeeded"
	case "failed", "error":
		status = "failed"
	case "cancelled", "canceled":
		status = "cancelled"
	default:
		status = "running"
	}
	videoURL := seedanceVideoURLFromValue(value)
	result := map[string]any{"id": id, "status": status, "content": map[string]any{"video_url": videoURL}, "model": fallbackModel}
	if requestID := firstNonEmpty(stringFromAny(value["request_id"]), stringFromAny(value["requestId"])); requestID != "" {
		result["request_id"] = requestID
	}
	if status == "failed" {
		result["error"] = map[string]any{"code": errorCode, "message": firstNonEmpty(errorMessage, "上游 Wan 3.0 请求失败")}
	}
	return result
}

func integerValue(value any, fallback int) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case string:
		if parsed, err := strconv.Atoi(strings.TrimSpace(typed)); err == nil {
			return parsed
		}
	}
	return fallback
}

func (h *AIHandler) SeedanceTaskContent(c *gin.Context) {
	if h.shouldUseSDVideoTask(c) {
		h.getSDVideoTaskContent(c)
		return
	}
	if h.serveGenerationVideoJob(c, true) {
		return
	}
	requestedModel := c.Query("model")
	client, config, _, ok := h.providerHandler.LoadClientForModel(c, model.ModelCapabilityVideo, requestedModel)
	if !ok {
		return
	}
	raw, err := client.ProxyJSON(c.Request.Context(), http.MethodGet, providerProxyPath(config, "/contents/generations/tasks/"+url.PathEscape(c.Param("id"))), nil, false)
	if err != nil {
		writeProviderError(c, config.BaseURL, err)
		return
	}
	videoURL := seedanceVideoURLFromRaw(raw)
	if videoURL == "" {
		response.Error(c, http.StatusBadGateway, "Seedance task did not return a video URL")
		return
	}
	body, contentType, err := downloadSeedanceVideoContent(c.Request.Context(), videoURL, config.BaseURL)
	if err != nil {
		response.Error(c, http.StatusBadGateway, err.Error())
		return
	}
	c.Data(http.StatusOK, firstNonEmpty(contentType, "video/mp4"), body)
}

func (h *AIHandler) AudioSpeech(c *gin.Context) {
	startedAt := time.Now().UTC()
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(stringFromAny(body["input"])) == "" &&
		strings.TrimSpace(stringFromAny(body["prompt"])) == "" &&
		strings.TrimSpace(stringFromAny(body["lyrics"])) == "" {
		response.Error(c, http.StatusBadRequest, "音频生成内容不能为空")
		return
	}
	candidates, ok := h.providerHandler.LoadGenerationCandidates(c, model.ModelCapabilityAudio, stringFromAny(body["model"]))
	if !ok {
		return
	}
	removeGenerationPrivateFields(body)
	var lastConfig model.ModelProviderConfig
	var lastErr error
	lastModel := stringFromAny(body["model"])
	for _, candidate := range candidates {
		config := candidate.Config
		lastConfig = config
		config.TimeoutMS = max(config.TimeoutMS, int(model.GenerationMediaRequestTimeout.Milliseconds()))
		body["model"] = candidate.Model
		lastModel = candidate.Model
		for attempt := 0; attempt < model.GenerationAttemptsPerProvider; attempt++ {
			if c.Request.Context().Err() != nil {
				return
			}
			client, err := provider.NewOpenAICompatibleClient(config, candidate.APIKey)
			if err != nil {
				lastErr = err
				continue
			}
			var content []byte
			var contentType string
			if client.HandlesSpecializedAudio(candidate.Model) {
				// Monitoring records the model actually called (CosyVoice v3.5 may fall back).
				lastModel = client.SpecializedAudioUpstreamModel(body, candidate.Model)
				secrets, _ := h.providerHandler.DecryptSecrets(config)
				requestBody := body
				voiceValue := stringFromAny(body["voice"])
				var materializeErr error
				if strings.HasPrefix(voiceValue, localClonedVoicePrefix) {
					// 本地音色：参考音频临时注册为服务商音色（20 秒内复用，到期自动删除）。
					if !provider.IsCosyVoiceModel(candidate.Model) {
						materializeErr = errors.New("local cloned voice requires a CosyVoice model")
					} else {
						var tempVoiceID string
						tempVoiceID, materializeErr = h.materializeLocalClonedVoice(c, voiceValue, client, secrets)
						if materializeErr == nil {
							requestBody = make(map[string]any, len(body)+1)
							for key, value := range body {
								requestBody[key] = value
							}
							requestBody["voice"] = tempVoiceID
							lastModel = client.SpecializedAudioUpstreamModel(requestBody, candidate.Model)
						}
					}
				}
				if materializeErr == nil {
					content, contentType, err = client.SynthesizeSpecializedAudio(c.Request.Context(), requestBody, candidate.Model, secrets)
				}
				if materializeErr != nil {
					// 临时克隆（含参考音频解析）失败：请求尚未提交合成，直接报错是安全的，
					// 不能走"结果不确定"流程，否则收据会卡在 409。
					err = materializeErr
					h.recordAIRequestAsync(c, aiRequestLogInput{StartedAt: startedAt, Config: config, Operation: "audio", Model: lastModel, InputCount: 1, Err: err})
					switch {
					case errors.Is(err, errLocalVoiceUnavailable):
						response.Error(c, http.StatusBadRequest, "该音色不存在或已被删除，请重新选择音色")
					case errors.Is(err, errVoiceReferenceMissing):
						response.Error(c, http.StatusBadRequest, "该音色的参考音频已被删除，音色无法使用，请删除后重新克隆")
					default:
						logProviderError(c, err)
						response.Error(c, http.StatusBadGateway, "音色准备失败，请重试")
					}
					return
				}
				if err != nil && strings.HasPrefix(voiceValue, localClonedVoicePrefix) {
					// 合成失败时移除缓存的临时音色（可能已在服务商侧失效），下次生成重新克隆。
					h.tempClonedVoices.Delete(voiceValue)
				}
			} else {
				content, contentType, err = client.ProxyBlob(c.Request.Context(), http.MethodPost, providerProxyPath(config, "/audio/speech"), body, true)
			}
			if err == nil && validSpeechOutput(content, contentType) {
				h.recordAIRequestAsync(c, aiRequestLogInput{StartedAt: startedAt, Config: config, Operation: "audio", Model: lastModel, InputCount: 1, OutputCount: 1})
				c.Data(http.StatusOK, firstNonEmpty(contentType, "application/octet-stream"), content)
				return
			}
			if err == nil {
				err = errors.New("provider returned invalid speech media")
			}
			lastErr = err
			if !safeToRepeatGeneration(err) {
				err = uncertainGeneration(err)
				h.recordAIRequestAsync(c, aiRequestLogInput{StartedAt: startedAt, Config: config, Operation: "audio", Model: lastModel, InputCount: 1, Err: err})
				response.Error(c, http.StatusBadGateway, audioSpeechPublicError(err))
				return
			}
		}
	}
	h.recordAIRequestAsync(c, aiRequestLogInput{StartedAt: startedAt, Config: lastConfig, Operation: "audio", Model: lastModel, InputCount: 1, Err: lastErr})
	message := errGenerationUnavailable.Error()
	if providerRateLimited(lastErr) {
		message = errGenerationRateLimited.Error()
	}
	response.Error(c, http.StatusBadGateway, message)
}

func (h *AIHandler) proxyProviderJSON(c *gin.Context, method string, path string, body any, longRequest bool, capability string, requestedModel string) {
	client, config, modelID, ok := h.providerHandler.LoadClientForModel(c, capability, requestedModel)
	if !ok {
		return
	}
	if payload, ok := body.(map[string]any); ok && modelID != "" {
		payload["model"] = modelID
	}

	raw, err := client.ProxyJSON(c.Request.Context(), method, providerProxyPath(config, path), body, longRequest)
	if err != nil {
		writeProviderError(c, config.BaseURL, err)
		return
	}
	response.OK(c, rawJSONPayload(raw))
}

func imageGenerationJobPayload(req provider.ImageGenerationRequest, modelID string) map[string]any {
	payload := make(map[string]any)
	for key, value := range req.Extra {
		payload[key] = value
	}
	removeGenerationPrivateFields(payload)
	setStringPayload(payload, "model", modelID)
	setStringPayload(payload, "prompt", req.Prompt)
	setStringPayload(payload, "size", req.Size)
	setStringPayload(payload, "quality", req.Quality)
	setStringPayload(payload, "style", req.Style)
	setStringPayload(payload, "response_format", req.ResponseFormat)
	if req.N > 0 {
		payload["n"] = req.N
	}
	return payload
}

func imageEditJobPayload(req provider.ImageEditRequest, modelID string, files []map[string]any) map[string]any {
	payload := make(map[string]any)
	strictGPTImage2Edit := provider.IsGPTImage2Model(modelID)
	for key, value := range req.Extra {
		if strictGPTImage2Edit && provider.ShouldOmitGPTImage2EditExtra(key) {
			continue
		}
		setStringPayload(payload, key, value)
	}
	setStringPayload(payload, "model", modelID)
	setStringPayload(payload, "prompt", req.Prompt)
	setStringPayload(payload, "size", req.Size)
	setStringPayload(payload, "quality", req.Quality)
	setStringPayload(payload, "style", req.Style)
	if !strictGPTImage2Edit {
		setStringPayload(payload, "response_format", req.ResponseFormat)
	}
	if req.N > 0 && !strictGPTImage2Edit {
		payload["n"] = req.N
	}
	payload["files"] = files
	payload["references"] = files
	removeGenerationPrivateFields(payload)
	return payload
}

func proxyMultipartJobPayload(fields map[string]string, files []map[string]any) map[string]any {
	payload := make(map[string]any, len(fields)+1)
	for key, value := range fields {
		setStringPayload(payload, key, value)
	}
	if len(files) > 0 {
		payload["files"] = files
	}
	return payload
}

func (h *AIHandler) stageImageEditInputs(ctx context.Context, workspaceID string, files []provider.ImageEditFile) ([]service.StagedJobInput, error) {
	if h.jobInputs == nil {
		return nil, errors.New("job input storage is not configured")
	}
	uploads := make([]service.JobInputUpload, 0, len(files))
	for _, file := range files {
		contentType, prefix, err := provider.ImageContentTypeForUpload(file.Header, file.FileName, file.File)
		if err != nil {
			return nil, err
		}
		uploads = append(uploads, service.JobInputUpload{
			FieldName:   file.FieldName,
			FileName:    file.FileName,
			ContentType: contentType,
			Reader:      io.MultiReader(bytes.NewReader(prefix), file.File),
		})
	}
	return h.jobInputs.Stage(ctx, workspaceID, uploads)
}

func (h *AIHandler) stageProxyMultipartInputs(ctx context.Context, workspaceID string, files []provider.ProxyMultipartFile) ([]service.StagedJobInput, error) {
	if h.jobInputs == nil {
		return nil, errors.New("job input storage is not configured")
	}
	uploads := make([]service.JobInputUpload, 0, len(files))
	for _, file := range files {
		contentType := strings.TrimSpace(file.Header.Get("Content-Type"))
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		uploads = append(uploads, service.JobInputUpload{
			FieldName:   file.FieldName,
			FileName:    file.FileName,
			ContentType: contentType,
			Reader:      file.File,
		})
	}
	return h.jobInputs.Stage(ctx, workspaceID, uploads)
}

func stagedInputPayloads(inputs []service.StagedJobInput) []map[string]any {
	payloads := make([]map[string]any, 0, len(inputs))
	for _, input := range inputs {
		payloads = append(payloads, input.Payload())
	}
	return payloads
}

func stagedInputFingerprintPayload(payload map[string]any) map[string]any {
	stable := make(map[string]any, len(payload))
	for key, value := range payload {
		if key == service.StagedInputKeysPayloadField || key == service.InputStorageKeyPayloadField {
			continue
		}
		if key == "files" || key == "references" {
			stable[key] = stagedInputFingerprintFiles(value)
			continue
		}
		stable[key] = value
	}
	return stable
}

func stagedInputFingerprintFiles(value any) []map[string]any {
	items, ok := value.([]map[string]any)
	if !ok {
		return []map[string]any{}
	}
	stable := make([]map[string]any, 0, len(items))
	for _, item := range items {
		copy := make(map[string]any, len(item))
		for key, value := range item {
			if key != "storage_key" {
				copy[key] = value
			}
		}
		stable = append(stable, copy)
	}
	return stable
}

func (h *AIHandler) cleanupStagedInputs(c *gin.Context, workspaceID string, inputs []service.StagedJobInput) {
	if h.jobInputs == nil || len(inputs) == 0 {
		return
	}
	if err := h.jobInputs.Cleanup(context.Background(), workspaceID, service.StagedInputKeys(inputs)); err != nil {
		log.Printf("request_id=%s event=staged_input_cleanup_failed reason=%q", response.RequestID(c), err.Error())
	}
}

func setStringPayload(payload map[string]any, key string, value string) {
	key = strings.TrimSpace(key)
	value = strings.TrimSpace(value)
	if key == "" || value == "" {
		return
	}
	payload[key] = value
}

func marshalJSONB(value map[string]any) (model.JSONB, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return model.JSONB(data), nil
}

func imageProviderJobKwargs(config model.ModelProviderConfig, apiKey string, modelID string, operation string, gateSecrets ...string) map[string]any {
	protocol := resolveImageProtocol(config, modelID)
	apiPath := "/images/generations"
	if operation == "edit" {
		apiPath = "/images/edits"
	}
	switch protocol {
	case model.ImageProtocolOpenAIResponses:
		apiPath = "/responses"
	case model.ImageProtocolOpenAIChatCompletions:
		apiPath = "/chat/completions"
	case model.ImageProtocolGeminiGenerateContent:
		apiPath = "/models/" + strings.TrimPrefix(strings.TrimSpace(modelID), "models/") + ":generateContent"
	case model.ImageProtocolDashScopeMultimodal:
		apiPath = "/api/v1/services/aigc/multimodal-generation/generation"
	case model.ImageProtocolStabilityImage:
		apiPath = "/v2beta/stable-image/generate/sd3"
	}
	kwargs := providerJobKwargs(config, apiKey, modelID, apiPath, gateSecrets...)
	providerConfig, _ := kwargs["provider"].(map[string]any)
	if providerConfig == nil {
		return kwargs
	}
	providerConfig["protocol"] = protocol
	if protocol == model.ImageProtocolDashScopeMultimodal {
		providerConfig["endpoint"] = "api/v1/services/aigc/multimodal-generation/generation"
	} else if protocol == model.ImageProtocolStabilityImage {
		providerConfig["endpoint"] = "v2beta/stable-image/generate/sd3"
	}
	overrideKey := "image_generation"
	if operation == "edit" {
		overrideKey = "image_edit"
	}
	if override := strings.TrimSpace(jsonStringMapFromJSONB(config.EndpointOverrides)[overrideKey]); override != "" {
		providerConfig["endpoint"] = strings.TrimPrefix(override, "/")
	}
	return kwargs
}
func providerJobKwargs(config model.ModelProviderConfig, apiKey string, modelID string, apiPath string, gateSecrets ...string) map[string]any {
	endpoint := providerJobEndpoint(config.BaseURL, apiPath)
	if override := providerEndpointOverride(config, apiPath); override != "" {
		endpoint = strings.TrimPrefix(override, "/")
	}
	gateSecret := ""
	if len(gateSecrets) > 0 {
		gateSecret = strings.TrimSpace(gateSecrets[0])
	}
	providerGateKey := providerGateFingerprint(gateSecret, config.BaseURL, apiKey)
	return map[string]any{
		"provider": map[string]any{
			"id":                 strings.TrimSpace(config.ID),
			"preset_id":          strings.TrimSpace(config.PresetID),
			"provider_type":      strings.TrimSpace(config.ProviderType),
			"base_url":           strings.TrimSpace(config.BaseURL),
			"auth_type":          strings.TrimSpace(config.AuthType),
			"custom_auth_header": strings.TrimSpace(config.CustomAuthHeader),
			"auth_query_param":   strings.TrimSpace(config.AuthQueryParam),
			"api_key":            apiKey,
			"model":              strings.TrimSpace(modelID),
			"timeout_ms":         provider.ImageRequestTimeout(config.TimeoutMS).Milliseconds(),
			"endpoint":           endpoint,
			"endpoint_overrides": jsonStringMapFromJSONB(config.EndpointOverrides),
			"extra_headers":      jsonStringMapFromJSONB(config.ExtraHeaders),
			"gate_key":           providerGateKey,
			"max_concurrency":    clampProviderConcurrency(config.MaxConcurrency),
		},
	}
}

func providerGateFingerprint(secret string, baseURL string, apiKey string) string {
	secret = strings.TrimSpace(secret)
	baseURL = normalizeProviderGateBaseURL(baseURL)
	if secret == "" || baseURL == "" {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(baseURL))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(strings.TrimSpace(apiKey)))
	return "provider_gate_" + hex.EncodeToString(mac.Sum(nil))
}

func normalizeProviderGateBaseURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return strings.ToLower(strings.TrimRight(strings.TrimSpace(raw), "/"))
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	host := strings.ToLower(parsed.Hostname())
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	port := parsed.Port()
	if port != "" && !((parsed.Scheme == "https" && port == "443") || (parsed.Scheme == "http" && port == "80")) {
		host += ":" + port
	}
	parsed.Host = host
	parsed.User = nil
	parsed.RawQuery = ""
	parsed.Fragment = ""
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.RawPath = ""
	return parsed.String()
}

func providerEndpointOverride(config model.ModelProviderConfig, apiPath string) string {
	overrides := jsonStringMapFromJSONB(config.EndpointOverrides)
	normalizedPath := strings.Trim(apiPath, "/")
	switch normalizedPath {
	case "responses", "chat/completions":
		return overrides[provider.EndpointOverrideTextGenerationKey]
	case "audio/speech":
		return overrides[provider.EndpointOverrideAudioSpeechKey]
	case "images/generations":
		return overrides["image_generation"]
	case "images/edits":
		return overrides["image_edit"]
	case "videos", "contents/generations/tasks":
		return overrides["video_create"]
	default:
		if taskID, ok := taskIDFromPath(normalizedPath, "contents/generations/tasks/"); ok {
			return applyIDPathOverride(overrides["video_get"], taskID)
		}
		if taskID, ok := taskIDFromPath(normalizedPath, "videos/"); ok {
			return applyIDPathOverride(overrides["video_get"], taskID)
		}
		return ""
	}
}

func providerProxyPath(config model.ModelProviderConfig, apiPath string) string {
	if override := providerEndpointOverride(config, apiPath); override != "" {
		return override
	}
	return apiPath
}

func taskIDFromPath(normalizedPath string, prefix string) (string, bool) {
	if !strings.HasPrefix(normalizedPath, prefix) {
		return "", false
	}
	id := strings.TrimSpace(strings.TrimPrefix(normalizedPath, prefix))
	if id == "" || strings.Contains(id, "/") {
		return "", false
	}
	return id, true
}

func applyIDPathOverride(override string, taskID string) string {
	override = strings.TrimSpace(override)
	if override == "" {
		return ""
	}
	replacer := strings.NewReplacer("{id}", taskID, "{task_id}", taskID)
	replaced := replacer.Replace(override)
	if replaced != override {
		return replaced
	}
	return strings.TrimRight(override, "/") + "/" + taskID
}

func providerJobEndpoint(baseURL string, apiPath string) string {
	apiPath = strings.TrimPrefix(strings.TrimSpace(apiPath), "/")
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return "v1/" + apiPath
	}
	basePath := strings.ToLower(strings.TrimRight(parsed.Path, "/"))
	if basePath == "/v1" || basePath == "/v1beta" || basePath == "/api/v3" || strings.HasSuffix(basePath, "/v1") || strings.HasSuffix(basePath, "/v1beta") || strings.HasSuffix(basePath, "/api/v3") || strings.Contains(basePath, "/api/plan/v3") {
		return apiPath
	}
	return "v1/" + apiPath
}

func decodeImageGenerationRequest(c *gin.Context) (provider.ImageGenerationRequest, error) {
	var raw map[string]any
	if err := json.NewDecoder(c.Request.Body).Decode(&raw); err != nil {
		return provider.ImageGenerationRequest{}, err
	}

	req := provider.ImageGenerationRequest{Extra: make(map[string]any)}
	for key, value := range raw {
		switch key {
		case "model":
			req.Model = stringFromAny(value)
		case "prompt":
			req.Prompt = stringFromAny(value)
		case "size":
			req.Size = stringFromAny(value)
		case "quality":
			req.Quality = stringFromAny(value)
		case "style":
			req.Style = stringFromAny(value)
		case "response_format":
			req.ResponseFormat = stringFromAny(value)
		case "n":
			req.N = intFromAny(value)
		default:
			req.Extra[key] = value
		}
	}

	return req, nil
}

func decodeImageEditRequest(c *gin.Context) (provider.ImageEditRequest, error) {
	if err := c.Request.ParseMultipartForm(128 << 20); err != nil {
		return provider.ImageEditRequest{}, err
	}

	req := provider.ImageEditRequest{
		Model:          c.PostForm("model"),
		Prompt:         c.PostForm("prompt"),
		Size:           c.PostForm("size"),
		Quality:        c.PostForm("quality"),
		Style:          c.PostForm("style"),
		ResponseFormat: c.PostForm("response_format"),
		N:              intFromString(c.PostForm("n")),
		Extra:          make(map[string]string),
	}
	known := map[string]bool{
		"model": true, "prompt": true, "size": true, "quality": true, "style": true, "response_format": true, "n": true,
	}
	if c.Request.MultipartForm != nil {
		for key, values := range c.Request.MultipartForm.Value {
			if !known[key] && len(values) > 0 {
				req.Extra[key] = values[0]
			}
		}
		for key, fileHeaders := range c.Request.MultipartForm.File {
			for _, fileHeader := range fileHeaders {
				file, err := fileHeader.Open()
				if err != nil {
					closeImageEditFiles(req.Files)
					return provider.ImageEditRequest{}, err
				}
				req.Files = append(req.Files, provider.ImageEditFile{
					FieldName: key,
					FileName:  fileHeader.Filename,
					Header:    fileHeader.Header,
					File:      file,
				})
			}
		}
	}

	return req, nil
}

func decodeProxyMultipart(c *gin.Context) (map[string]string, []provider.ProxyMultipartFile, error) {
	if err := c.Request.ParseMultipartForm(128 << 20); err != nil {
		return nil, nil, err
	}
	fields := make(map[string]string)
	files := make([]provider.ProxyMultipartFile, 0)
	if c.Request.MultipartForm == nil {
		return fields, files, nil
	}
	for key, values := range c.Request.MultipartForm.Value {
		if len(values) > 0 {
			fields[key] = values[0]
		}
	}
	for key, fileHeaders := range c.Request.MultipartForm.File {
		for _, fileHeader := range fileHeaders {
			file, err := fileHeader.Open()
			if err != nil {
				closeProxyMultipartFiles(files)
				return nil, nil, err
			}
			files = append(files, provider.ProxyMultipartFile{
				FieldName: key,
				FileName:  fileHeader.Filename,
				Header:    fileHeader.Header,
				File:      file,
			})
		}
	}
	return fields, files, nil
}

func closeImageEditFiles(files []provider.ImageEditFile) {
	for _, file := range files {
		if file.File != nil {
			_ = file.File.Close()
		}
	}
}

func closeProxyMultipartFiles(files []provider.ProxyMultipartFile) {
	for _, file := range files {
		if file.File != nil {
			_ = file.File.Close()
		}
	}
}

func rawJSONPayload(raw json.RawMessage) any {
	if len(raw) == 0 {
		return gin.H{}
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return string(raw)
	}
	return value
}

func seedanceVideoURLFromRaw(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return ""
	}
	return seedanceVideoURLFromValue(value)
}

func seedanceVideoURLFromValue(value any) string {
	switch typed := value.(type) {
	case map[string]any:
		if content, ok := typed["content"]; ok {
			if videoURL := seedanceVideoURLFromValue(content); videoURL != "" {
				return videoURL
			}
		}
		for _, key := range []string{"video_url", "videoUrl", "output_url", "outputUrl", "download_url", "downloadUrl", "url"} {
			if videoURL := stringFromAny(typed[key]); isRemoteMediaURL(videoURL) {
				return videoURL
			}
		}
		for _, key := range []string{"data", "result", "results", "output", "outputs", "items"} {
			if videoURL := seedanceVideoURLFromValue(typed[key]); videoURL != "" {
				return videoURL
			}
		}
	case []any:
		for _, item := range typed {
			if videoURL := seedanceVideoURLFromValue(item); videoURL != "" {
				return videoURL
			}
		}
	}
	return ""
}

func seedanceAssetIDsFromPayload(payload map[string]any) []string {
	seen := make(map[string]bool)
	ids := make([]string, 0)
	var walk func(any)
	walk = func(value any) {
		switch typed := value.(type) {
		case map[string]any:
			for _, item := range typed {
				walk(item)
			}
		case []any:
			for _, item := range typed {
				walk(item)
			}
		case string:
			value := strings.TrimSpace(typed)
			if !strings.HasPrefix(value, "asset://") {
				return
			}
			assetID := strings.TrimSpace(strings.TrimPrefix(value, "asset://"))
			if assetID == "" || seen[assetID] {
				return
			}
			seen[assetID] = true
			ids = append(ids, assetID)
		}
	}
	walk(payload)
	return ids
}

func downloadSeedanceVideoContent(ctx context.Context, rawURL string, trustedOrigins ...string) ([]byte, string, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Host == "" || parsed.User != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, "", errors.New("Seedance returned an invalid video URL")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Accept", "video/*,application/octet-stream;q=0.9,*/*;q=0.1")
	client := httpsecurity.NewMediaClient(10*time.Minute, trustedOrigins...)
	res, err := client.Do(req)
	if err != nil {
		return nil, "", errors.New("Seedance video download temporarily unavailable")
	}
	defer res.Body.Close()

	body, err := io.ReadAll(io.LimitReader(res.Body, maxSeedanceRemoteVideoBytes+1))
	if err != nil {
		return nil, "", err
	}
	if int64(len(body)) > maxSeedanceRemoteVideoBytes {
		return nil, "", errors.New("Seedance video is too large")
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, "", fmt.Errorf("Seedance video download failed with status %d", res.StatusCode)
	}
	contentType := strings.TrimSpace(strings.Split(res.Header.Get("Content-Type"), ";")[0])
	if contentType == "" || contentType == "application/octet-stream" {
		if detected := http.DetectContentType(body); strings.HasPrefix(detected, "video/") {
			contentType = detected
		}
	}
	if contentType == "" {
		contentType = "video/mp4"
	}
	if !strings.HasPrefix(contentType, "video/") && contentType != "application/octet-stream" {
		return nil, "", fmt.Errorf("Seedance video download returned %s", contentType)
	}
	return body, contentType, nil
}

func isRemoteMediaURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	return err == nil && parsed.Host != "" && (parsed.Scheme == "http" || parsed.Scheme == "https")
}

func stringFromAny(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

func intFromAny(value any) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	default:
		return 0
	}
}

func intFromString(value string) int {
	if value == "" {
		return 0
	}
	var parsed int
	_, _ = fmt.Sscanf(value, "%d", &parsed)
	return parsed
}

type aiRequestLogInput struct {
	StartedAt   time.Time
	Config      model.ModelProviderConfig
	Operation   string
	Model       string
	InputCount  int
	OutputCount int
	Err         error
}

func (h *AIHandler) recordAIRequest(c *gin.Context, input aiRequestLogInput) {
	if h.monitoringRepo == nil {
		return
	}
	logEntry, operation, requestID := buildAIRequestLog(c, input)
	if err := h.monitoringRepo.CreateAIRequestLog(logEntry); err != nil {
		log.Printf("request_id=%s operation=%s event=monitoring_log_error", requestID, operation)
	} else {
		c.Set(monitoring.AIRecordedKey, true)
	}
}

func (h *AIHandler) recordAIRequestAsync(c *gin.Context, input aiRequestLogInput) {
	// Failures must be persisted before middleware decides whether to fall back.
	if input.Err != nil {
		h.recordAIRequest(c, input)
		return
	}
	if h.monitoringRepo == nil {
		return
	}
	logEntry, operation, requestID := buildAIRequestLog(c, input)
	c.Set(monitoring.AIRecordedKey, true)
	go func() {
		if err := h.monitoringRepo.CreateAIRequestLog(logEntry); err != nil {
			log.Printf("request_id=%s operation=%s event=monitoring_log_error", requestID, operation)
		}
	}()
}

func buildAIRequestLog(c *gin.Context, input aiRequestLogInput) (model.AIRequestLog, string, string) {
	startedAt := input.StartedAt
	if startedAt.IsZero() {
		startedAt = time.Now().UTC()
	}
	operation := strings.TrimSpace(input.Operation)
	if operation == "" {
		operation = strings.TrimPrefix(c.FullPath(), "/api/ai/")
	}
	modelID := strings.TrimSpace(input.Model)
	if modelID == "" {
		if strings.Contains(operation, "image") {
			modelID = input.Config.ImageModel
		} else {
			modelID = input.Config.TextModel
		}
	}
	status := model.AIRequestStatusSuccess
	httpStatus := http.StatusOK
	providerStatus := 0
	errorMessage := ""
	errorReason := ""
	errorSuggestion := ""
	diagnostics, observedStatus := requestProviderDiagnostics(c, input.Err)
	if input.Err != nil {
		status = model.AIRequestStatusError
		errorInfo := describeProviderError(input.Config.BaseURL, input.Err)
		httpStatus = errorInfo.HTTPStatus
		providerStatus = errorInfo.ProviderStatus
		if observedStatus > 0 {
			providerStatus = observedStatus
		}
		errorMessage = errorInfo.Message
		errorReason = errorInfo.Reason
		errorSuggestion = errorInfo.Suggestion
	}
	user, _ := auth.CurrentUser(c)
	requestID := response.RequestID(c)
	endpoint := c.FullPath()
	logEntry := model.AIRequestLog{
		ID:              "aireq_" + randomHexString(10),
		RequestID:       requestID,
		UserID:          user.ID,
		Username:        user.Username,
		UserDisplayName: user.DisplayName,
		Operation:       operation,
		Endpoint:        endpoint,
		Model:           modelID,
		ProviderMode:    input.Config.Mode,
		ProviderHost:    providerHost(input.Config.BaseURL),
		Status:          status,
		HTTPStatus:      httpStatus,
		ProviderStatus:  providerStatus,
		DurationMS:      time.Since(startedAt).Milliseconds(),
		InputCount:      input.InputCount,
		OutputCount:     input.OutputCount,
		EstimatedUnits:  estimatedUnits(operation, input.InputCount, input.OutputCount),
		ErrorMessage:    monitoring.SafeText(errorMessage),
		ErrorReason:     monitoring.SafeText(errorReason),
		Diagnostics:     diagnostics,
		ErrorSuggestion: monitoring.SafeText(errorSuggestion),
		CreatedAt:       startedAt,
	}
	return logEntry, endpoint, requestID
}

func requestedImageCount(count int) int {
	if count <= 0 {
		return 1
	}
	if count > 15 {
		return 15
	}
	return count
}

func estimatedUnits(operation string, inputCount int, outputCount int) int {
	output := outputCount
	if output <= 0 {
		output = 1
	}
	input := inputCount
	if input < 0 {
		input = 0
	}
	switch operation {
	case "image_edit":
		return output * (1 + input)
	case "image_generation":
		return output
	case "text":
		return 1
	default:
		return output
	}
}

func providerHost(baseURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return ""
	}
	return parsed.Host
}

func randomHexString(bytesCount int) string {
	bytes := make([]byte, bytesCount)
	if _, err := rand.Read(bytes); err != nil {
		return hex.EncodeToString([]byte(time.Now().UTC().Format("20060102150405.000000000")))
	}
	return hex.EncodeToString(bytes)
}

type providerErrorInfo struct {
	HTTPStatus     int
	ProviderStatus int
	Message        string
	Reason         string
	Suggestion     string
	RetryAfterSec  int
	ProviderBody   string
	ProviderURL    string
	ProviderMethod string
}

func describeProviderError(baseURL string, err error) providerErrorInfo {
	info := providerErrorInfo{
		HTTPStatus: http.StatusBadGateway,
		Message:    "模型服务暂不可用",
		Suggestion: "请稍后重试；如果持续失败，请联系管理员检查模型服务配置。",
	}
	if err == nil {
		return info
	}
	info.Reason = strings.TrimSpace(err.Error())
	if errors.Is(err, provider.ErrProviderNotConfigured) || errors.Is(err, provider.ErrProviderDisabled) || errors.Is(err, provider.ErrUnsupportedImageUpload) {
		info.HTTPStatus = http.StatusBadRequest
	}
	var httpErr *provider.ProviderHTTPError
	if errors.Is(err, context.Canceled) {
		info.HTTPStatus = clientClosedRequestStatus
		info.Message = "请求已被取消"
		info.Reason = "客户端连接已断开或主动取消了请求。"
		info.Suggestion = "如果不是主动取消，请检查浏览器网络或重试。"
		return info
	}
	if errors.Is(err, context.DeadlineExceeded) || isProviderTimeoutError(err) {
		info.HTTPStatus = http.StatusGatewayTimeout
		info.Message = "模型服务响应超时"
		info.Reason = "上游模型服务未在超时时间内返回响应头或结果。"
		info.Suggestion = "建议稍后重试，或在后台模型服务中调大超时时间并检查上游负载。"
		return info
	}
	if !errors.As(err, &httpErr) {
		if hint := provider.DockerLocalhostHint(baseURL); hint != "" {
			info.Suggestion = hint
		}
		return info
	}

	info.ProviderStatus = httpErr.StatusCode
	info.ProviderURL = httpErr.SafeURL()
	info.ProviderMethod = httpErr.Method
	info.ProviderBody = httpErr.BodySnippet(2000)
	info.Message = fmt.Sprintf("模型服务返回 %d，生成失败", httpErr.StatusCode)

	bodyReason, bodySuggestion, retryAfter := readableProviderBody(httpErr.Body)
	if bodyReason != "" {
		info.Reason = bodyReason
	}
	if bodySuggestion != "" {
		info.Suggestion = bodySuggestion
	}
	if retryAfter > 0 {
		info.RetryAfterSec = retryAfter
	}
	if info.Reason == "" {
		info.Reason = providerStatusReason(httpErr.StatusCode)
	}
	if info.Suggestion == "" {
		info.Suggestion = providerStatusSuggestion(httpErr.StatusCode)
	}
	return info
}

func isProviderTimeoutError(err error) bool {
	lower := strings.ToLower(err.Error())
	return strings.Contains(lower, "client.timeout") ||
		strings.Contains(lower, "timeout awaiting response headers") ||
		strings.Contains(lower, "responseheadertimeout") ||
		strings.Contains(lower, "i/o timeout")
}

func readableProviderBody(body string) (string, string, int) {
	text := strings.TrimSpace(body)
	if text == "" {
		return "", "", 0
	}
	var payload map[string]any
	if json.Unmarshal([]byte(text), &payload) == nil {
		retryAfter := intField(payload["retry_after"])
		detail := stringFromAny(payload["detail"])
		title := stringFromAny(payload["title"])
		errorName := stringFromAny(payload["error_name"])
		output, _ := payload["output"].(map[string]any)
		if errorName == "" {
			errorName = firstNonEmpty(stringFromAny(output["code"]), stringFromAny(payload["code"]))
		}
		message := firstNonEmpty(stringFromAny(payload["error_message"]), stringFromAny(output["error_message"]), stringFromAny(output["message"]), nestedStringField(payload["error"], "message"))
		if message == "" {
			message = stringFromAny(payload["message"])
		}
		reason := readableProviderReason(title, detail, errorName, message)
		suggestion := readableProviderSuggestion(payload, retryAfter)
		return reason, suggestion, retryAfter
	}
	cleaned := compactWhitespace(text)
	if cleaned == "" {
		return "", "", 0
	}
	return trimRunes(cleaned, 240), "", 0
}

func readableProviderReason(title string, detail string, errorName string, message string) string {
	lower := strings.ToLower(strings.Join([]string{title, detail, errorName, message}, " "))
	if strings.Contains(lower, "cloudflare") && strings.Contains(lower, "502") {
		return "上游源站返回 502 Bad Gateway，通常表示源站过载、不可达或配置异常。"
	}
	if strings.Contains(lower, "origin") && strings.Contains(lower, "bad gateway") {
		return "上游源站过载或配置异常，代理没有拿到完整响应。"
	}
	if message != "" {
		return trimRunes(compactWhitespace(message), 240)
	}
	if detail != "" {
		return trimRunes(compactWhitespace(detail), 240)
	}
	if title != "" {
		return trimRunes(compactWhitespace(title), 240)
	}
	return ""
}

func readableProviderSuggestion(payload map[string]any, retryAfter int) string {
	if raw := stringFromAny(payload["what_you_should_do"]); raw != "" {
		cleaned := strings.ReplaceAll(raw, "**", "")
		cleaned = strings.TrimSpace(cleaned)
		if strings.Contains(strings.ToLower(cleaned), "wait and retry") {
			if retryAfter > 0 {
				return fmt.Sprintf("建议至少等待 %d 秒后重试；如果仍失败，请管理员检查上游模型服务健康和配置。", retryAfter)
			}
			return "建议稍后重试；如果仍失败，请管理员检查上游模型服务健康和配置。"
		}
		return trimRunes(compactWhitespace(cleaned), 240)
	}
	if retryAfter > 0 {
		return fmt.Sprintf("建议至少等待 %d 秒后重试；如果持续失败，请联系管理员检查上游服务。", retryAfter)
	}
	return ""
}

func providerStatusReason(status int) string {
	switch status {
	case http.StatusUnauthorized, http.StatusForbidden:
		return "上游模型服务拒绝了请求，可能是 API Key、权限或模型访问范围不正确。"
	case http.StatusTooManyRequests:
		return "上游模型服务限流或额度不足。"
	case http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return "上游模型服务暂时不可用，可能过载、超时或代理链路异常。"
	case http.StatusBadRequest:
		return "上游模型服务认为请求参数不合法。"
	default:
		if status >= 500 {
			return "上游模型服务发生服务器错误。"
		}
		if status >= 400 {
			return "上游模型服务拒绝了请求。"
		}
		return "模型服务返回异常响应。"
	}
}

func providerStatusSuggestion(status int) string {
	switch status {
	case http.StatusUnauthorized, http.StatusForbidden:
		return "请管理员检查后台模型服务的 API Key、鉴权方式和模型权限。"
	case http.StatusTooManyRequests:
		return "建议稍后重试，或检查上游额度和并发限制。"
	case http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return "建议稍后重试；如果持续失败，请管理员检查上游服务健康和代理配置。"
	case http.StatusBadRequest:
		return "请检查模型、尺寸、参考图格式和提示词参数是否被该模型支持。"
	default:
		return "请稍后重试；如果持续失败，请联系管理员查看后台监控日志。"
	}
}

func nestedStringField(value any, key string) string {
	record, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	return stringFromAny(record[key])
}

func intField(value any) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case string:
		var parsed int
		_, _ = fmt.Sscanf(typed, "%d", &parsed)
		return parsed
	default:
		return 0
	}
}

var whitespacePattern = regexp.MustCompile(`\s+`)

func compactWhitespace(value string) string {
	return strings.TrimSpace(whitespacePattern.ReplaceAllString(value, " "))
}

func trimRunes(value string, limit int) string {
	runes := []rune(value)
	if limit <= 0 || len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "..."
}

func (h *AIHandler) ImageUpscale(c *gin.Context) {
	startedAt := time.Now().UTC()
	var req provider.ImageUpscaleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	client, config, modelID, ok := h.providerHandler.LoadClientForModel(c, model.ModelCapabilityImageUpscale, req.Model)
	if !ok {
		return
	}
	if modelID == "" {
		writeProviderError(c, config.BaseURL, provider.ErrImageUpscaleModelNotConfigured)
		return
	}
	secrets, err := h.providerHandler.DecryptSecrets(config)
	if err != nil {
		writeUpscaleFailure(c, fmt.Errorf("decrypt provider secrets: %w", err), false)
		return
	}
	resolvedURL, err := h.resolveUpscaleInputURL(
		c,
		client,
		secrets,
		firstNonEmptyString(req.URL, req.ImageURL, req.DataURL),
		req.AssetID,
		req.Scope,
		".png",
	)
	if err != nil {
		if strings.Contains(err.Error(), "data_url") {
			logProviderError(c, err)
			response.Error(c, http.StatusBadRequest, imageUpscaleUnreadable)
			return
		}
		writeUpscaleFailure(c, fmt.Errorf("prepare upscale input: %w", err), false)
		return
	}
	preparedAt := time.Now()
	req.URL = resolvedURL
	req.ImageURL = resolvedURL
	normalized, err := provider.NormalizeImageUpscaleRequest(req)
	if err != nil {
		writeUpscaleFailure(c, fmt.Errorf("normalize upscale request: %w", err), false)
		return
	}
	normalized.Model = modelID
	result, err := client.UpscaleImage(c.Request.Context(), normalized, secrets)
	upscaledAt := time.Now()
	if err != nil {
		h.recordAIRequestAsync(c, aiRequestLogInput{
			StartedAt:   startedAt,
			Config:      config,
			Operation:   "image_upscale",
			Model:       modelID,
			InputCount:  1,
			OutputCount: 0,
			Err:         err,
		})
		writeUpscaleFailure(c, err, false)
		return
	}
	dataURL := result.DataURL
	outputBytes, outputSize := 0, "unknown"
	if dataURL == "" && strings.HasPrefix(strings.ToLower(result.URL), "http") {
		if rawBytes, contentType, dlErr := client.DownloadMediaBytes(c.Request.Context(), result.URL); dlErr == nil && len(rawBytes) > 0 {
			mimeType := contentType
			if !strings.HasPrefix(strings.ToLower(mimeType), "image/") {
				switch result.OutputFormat {
				case "png":
					mimeType = "image/png"
				case "bmp":
					mimeType = "image/bmp"
				default:
					mimeType = "image/jpeg"
				}
			}
			dataURL = "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(rawBytes)
			outputBytes = len(rawBytes)
			if size, _, sizeErr := image.DecodeConfig(bytes.NewReader(rawBytes)); sizeErr == nil {
				outputSize = fmt.Sprintf("%dx%d", size.Width, size.Height)
			}
		}
	}
	// Proof of the real Alibaba Cloud call: its RequestId can be looked up in the VIAPI console.
	log.Printf("request_id=%s operation=image_upscale aliyun_request_id=%s action=%s input_host=%s factor=%d mode=%s format=%s prepare_ms=%d aliyun_ms=%d download_ms=%d output_bytes=%d output_size=%s",
		response.RequestID(c), result.RequestID, result.Model, upscaleURLHost(resolvedURL), result.UpscaleFactor, result.Mode, result.OutputFormat,
		preparedAt.Sub(startedAt).Milliseconds(), upscaledAt.Sub(preparedAt).Milliseconds(), time.Since(upscaledAt).Milliseconds(), outputBytes, outputSize)
	h.recordAIRequestAsync(c, aiRequestLogInput{
		StartedAt:   startedAt,
		Config:      config,
		Operation:   "image_upscale",
		Model:       modelID,
		InputCount:  1,
		OutputCount: 1,
	})
	response.OK(c, gin.H{
		"request_id":     result.RequestID,
		"url":            result.URL,
		"data_url":       dataURL,
		"model":          encodeProviderModel(config.ID, result.Model),
		"mode":           result.Mode,
		"upscale_factor": result.UpscaleFactor,
		"output_format":  result.OutputFormat,
		"output_quality": result.OutputQuality,
	})
}

func (h *AIHandler) VideoUpscaleCreate(c *gin.Context) {
	startedAt := time.Now().UTC()
	var req provider.VideoUpscaleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	client, config, modelID, ok := h.providerHandler.LoadClientForModel(c, model.ModelCapabilityVideoUpscale, req.Model)
	if !ok {
		return
	}
	if modelID == "" {
		writeProviderError(c, config.BaseURL, provider.ErrVideoUpscaleModelNotConfigured)
		return
	}
	secrets, err := h.providerHandler.DecryptSecrets(config)
	if err != nil {
		writeUpscaleFailure(c, fmt.Errorf("decrypt provider secrets: %w", err), true)
		return
	}
	resolvedURL, err := h.resolveUpscaleInputURL(
		c,
		client,
		secrets,
		firstNonEmptyString(req.VideoURL, req.URL),
		req.AssetID,
		req.Scope,
		".mp4",
	)
	if err != nil {
		writeUpscaleFailure(c, fmt.Errorf("prepare upscale input: %w", err), true)
		return
	}
	req.VideoURL = resolvedURL
	req.URL = resolvedURL
	normalized, err := provider.NormalizeVideoUpscaleRequest(req)
	if err != nil {
		writeUpscaleFailure(c, fmt.Errorf("normalize upscale request: %w", err), true)
		return
	}
	normalized.Model = modelID
	result, err := client.CreateVideoUpscaleTask(c.Request.Context(), normalized, secrets)
	if err != nil {
		h.recordAIRequestAsync(c, aiRequestLogInput{
			StartedAt:   startedAt,
			Config:      config,
			Operation:   "video_upscale",
			Model:       modelID,
			InputCount:  1,
			OutputCount: 0,
			Err:         err,
		})
		writeUpscaleFailure(c, err, true)
		return
	}
	h.recordAIRequestAsync(c, aiRequestLogInput{
		StartedAt:   startedAt,
		Config:      config,
		Operation:   "video_upscale",
		Model:       modelID,
		InputCount:  1,
		OutputCount: 0,
	})
	response.OK(c, gin.H{
		"id":              result.ID,
		"job_id":          result.JobID,
		"request_id":      result.RequestID,
		"status":          result.Status,
		"upstream_status": result.UpstreamCode,
		"video_url":       result.VideoURL,
		"model":           encodeProviderModel(config.ID, result.Model),
		"bit_rate":        result.BitRate,
		"message":         result.Message,
	})
}

func (h *AIHandler) VideoUpscaleGet(c *gin.Context) {
	rawID := strings.TrimSpace(c.Param("id"))
	if rawID == "" {
		response.Error(c, http.StatusBadRequest, "job id is required")
		return
	}
	providerID, jobID := decodeProviderModel(rawID)
	requestedModel := strings.TrimSpace(c.Query("model"))
	if requestedModel == "" && providerID != "" {
		requestedModel = providerID + providerModelSeparator
	}
	if jobID == "" {
		jobID = rawID
	}
	client, config, modelID, ok := h.providerHandler.LoadClientForModel(c, model.ModelCapabilityVideoUpscale, requestedModel)
	if !ok {
		return
	}
	secrets, err := h.providerHandler.DecryptSecrets(config)
	if err != nil {
		writeUpscaleFailure(c, fmt.Errorf("decrypt provider secrets: %w", err), true)
		return
	}
	result, err := client.GetVideoUpscaleTask(c.Request.Context(), jobID, modelID, secrets)
	if err != nil {
		writeUpscaleFailure(c, err, true)
		return
	}
	errorMessage := ""
	if result.Status == "failed" {
		errorMessage = publicVideoUpscaleFailure(c, jobID, result.ErrorCode, result.ErrorMessage)
	}
	payload := gin.H{
		"id":              result.ID,
		"job_id":          result.JobID,
		"request_id":      result.RequestID,
		"status":          result.Status,
		"upstream_status": result.UpstreamCode,
		"video_url":       result.VideoURL,
		"model":           encodeProviderModel(config.ID, result.Model),
		"error_code":      result.ErrorCode,
		"error_message":   errorMessage,
	}
	if result.Status == "succeeded" && result.VideoURL != "" && c.Query("save_asset") == "1" && h.assets != nil {
		asset, saveErr := h.saveUpscaledVideoAsset(c, client, result)
		if saveErr != nil {
			log.Printf("request_id=%s operation=video_upscale job_id=%s save_asset_error=%v", response.RequestID(c), jobID, saveErr)
		} else if asset.ID != "" {
			payload["asset_id"] = asset.ID
			payload["asset_url"] = asset.URL
			payload["mime_type"] = asset.ContentType
			payload["bytes"] = asset.Size
		}
	}
	response.OK(c, payload)
}

func (h *AIHandler) resolveUpscaleInputURL(
	c *gin.Context,
	client *provider.OpenAICompatibleClient,
	secrets map[string]string,
	rawURL string,
	assetID string,
	scope string,
	defaultExt string,
) (string, error) {
	rawURL = strings.TrimSpace(rawURL)
	assetID = strings.TrimSpace(assetID)
	if assetID == "" && strings.HasPrefix(rawURL, "/api/assets/") && strings.HasSuffix(rawURL, "/content") {
		trimmed := strings.TrimSuffix(strings.TrimPrefix(rawURL, "/api/assets/"), "/content")
		assetID = strings.Trim(trimmed, "/")
	}
	if strings.HasPrefix(rawURL, "data:") {
		comma := strings.Index(rawURL, ",")
		if comma < 0 {
			return "", errors.New("invalid data_url format")
		}
		header := rawURL[:comma]
		decoded, err := base64.StdEncoding.DecodeString(rawURL[comma+1:])
		if err != nil {
			return "", fmt.Errorf("invalid base64 data_url: %w", err)
		}
		ext := defaultExt
		if strings.Contains(header, "image/jpeg") || strings.Contains(header, "image/jpg") {
			ext = ".jpg"
		} else if strings.Contains(header, "image/bmp") {
			ext = ".bmp"
		} else if strings.Contains(header, "video/mp4") {
			ext = ".mp4"
		} else if strings.Contains(header, "audio/wav") || strings.Contains(header, "audio/x-wav") {
			ext = ".wav"
		} else if strings.Contains(header, "audio/mp4") || strings.Contains(header, "audio/x-m4a") {
			ext = ".m4a"
		} else if strings.Contains(header, "audio/") {
			ext = ".mp3"
		}
		uploaded, upErr := client.UploadMediaToVIAPITempOSS(c.Request.Context(), bytes.NewReader(decoded), ext, secrets)
		if upErr == nil {
			return uploaded, nil
		}
		if !errors.Is(upErr, provider.ErrAliyunVIAPICredentialsMissing) {
			// With AccessKeys configured the VIAPI upload is the only path; report its real failure.
			return "", upErr
		}
		return client.UploadMediaToDashScopeTemp(c.Request.Context(), bytes.NewReader(decoded), ext, "voice-enrollment")
	}
	if assetID != "" && h.assets != nil {
		user := auth.MustCurrentUser(c)
		resolvedScope := strings.TrimSpace(scope)
		if resolvedScope == "" {
			resolvedScope = requestWorkspaceScope(c)
		}
		content, err := h.assets.DescribeContent(c.Request.Context(), assetID, user.ID, resolvedScope)
		if err != nil {
			return "", err
		}
		if deliveryURL, err := h.assets.ContentDeliveryURL(c.Request.Context(), content); err == nil && strings.HasPrefix(deliveryURL, "http") {
			return deliveryURL, nil
		}
		opened, err := h.assets.OpenResolvedContent(c.Request.Context(), content)
		if err != nil {
			return "", err
		}
		defer opened.Reader.Close()
		ext := filepath.Ext(opened.Object.Key)
		if ext == "" {
			ext = defaultExt
		}
		uploaded, upErr := client.UploadMediaToVIAPITempOSS(c.Request.Context(), opened.Reader, ext, secrets)
		if upErr == nil {
			return uploaded, nil
		}
		if !errors.Is(upErr, provider.ErrAliyunVIAPICredentialsMissing) {
			return "", upErr
		}
		// 未配置 AK/SK 时回落到 DashScope 临时上传（与 data_url 路径一致）。
		return client.UploadMediaToDashScopeTemp(c.Request.Context(), opened.Reader, ext, "voice-enrollment")
	}
	return rawURL, nil
}

func (h *AIHandler) saveUpscaledVideoAsset(
	c *gin.Context,
	client *provider.OpenAICompatibleClient,
	result provider.VideoUpscaleTaskResponse,
) (model.Asset, error) {
	videoBytes, contentType, err := client.DownloadMediaBytes(c.Request.Context(), result.VideoURL)
	if err != nil {
		return model.Asset{}, err
	}
	if !strings.HasPrefix(strings.ToLower(contentType), "video/") {
		contentType = "video/mp4"
	}
	user := auth.MustCurrentUser(c)
	scope := strings.TrimSpace(c.Query("scope"))
	if scope == "" {
		scope = requestWorkspaceScope(c)
	}
	title := strings.TrimSpace(c.Query("title"))
	if title == "" {
		title = "视频-AI超分"
	}
	projectID := strings.TrimSpace(c.Query("project_id"))
	sourceNodeID := strings.TrimSpace(c.Query("node_id"))
	return h.assets.Upload(c.Request.Context(), service.AssetUploadInput{
		ID:             "vid_sr_" + sanitizeProviderID(result.JobID),
		IdempotencyKey: "video_upscale:" + result.JobID,
		UserID:         user.ID,
		Scope:          scope,
		Type:           "video",
		Name:           title,
		Extension:      ".mp4",
		ContentType:    contentType,
		Reader:         bytes.NewReader(videoBytes),
		SourceNodeID:   sourceNodeID,
		Registration: service.AssetRegistrationContext{
			Category:        "other",
			SourceType:      "canvas",
			SourceProjectID: projectID,
			SourceJobID:     result.JobID,
			SourceMetadata: map[string]any{
				"operation":  "video_upscale",
				"job_id":     result.JobID,
				"request_id": result.RequestID,
				"node_id":    sourceNodeID,
			},
		},
	})
}

func (h *AIHandler) AudioVoiceCloneCreate(c *gin.Context) {
	startedAt := time.Now().UTC()
	var req provider.VoiceCloneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	client, config, modelID, ok := h.providerHandler.LoadClientForModel(c, model.ModelCapabilityAudio, req.TargetModel)
	if !ok {
		return
	}
	if strings.TrimSpace(req.TargetModel) != "" {
		_, bareTarget := decodeProviderModel(req.TargetModel)
		if bareTarget != "" {
			modelID = bareTarget
		}
	}
	if modelID == "" {
		modelID = provider.DefaultCosyVoiceModel
	}
	secrets, err := h.providerHandler.DecryptSecrets(config)
	if err != nil {
		writeVoiceCloneFailure(c, fmt.Errorf("decrypt provider secrets: %w", err))
		return
	}
	// 即克隆即删模式：CosyVoice 音色不在服务商侧常驻——参考音频存入资产库，
	// 每次合成时临时克隆、用完即删，阿里云音色配额占用趋近于零。MiniMax 保持原路径。
	if provider.IsCosyVoiceModel(modelID) && h.clonedVoices != nil && h.assets != nil {
		h.createLocalClonedVoice(c, client, config, secrets, req, modelID, startedAt)
		return
	}
	source := firstNonEmptyString(req.AudioURL, req.DataURL)
	if strings.TrimSpace(source) == "" && strings.TrimSpace(req.AssetID) == "" {
		response.Error(c, http.StatusBadRequest, "请先选择参考音频")
		return
	}
	resolvedURL, err := h.resolveUpscaleInputURL(
		c,
		client,
		secrets,
		source,
		req.AssetID,
		req.Scope,
		".mp3",
	)
	if err != nil {
		if strings.Contains(err.Error(), "data_url") {
			response.Error(c, http.StatusBadRequest, voiceCloneAudioUnreadable)
			return
		}
		writeVoiceCloneFailure(c, fmt.Errorf("resolve reference audio: %w", err))
		return
	}
	lowerURL := strings.ToLower(strings.TrimSpace(resolvedURL))
	if !strings.HasPrefix(lowerURL, "http://") && !strings.HasPrefix(lowerURL, "https://") && !strings.HasPrefix(lowerURL, "oss://") {
		// Local files need Aliyun AK/SK for the temporary upload: an admin setting.
		writeVoiceCloneFailure(c, errors.New("reference audio has no public URL; configure Aliyun AK/SK for local uploads"))
		return
	}
	req.TargetModel = modelID
	req.AudioURL = resolvedURL
	record, err := client.CreateClonedVoice(c.Request.Context(), req, secrets)
	if err != nil {
		h.recordAIRequestAsync(c, aiRequestLogInput{
			StartedAt:   startedAt,
			Config:      config,
			Operation:   "audio_voice_clone",
			Model:       modelID,
			InputCount:  1,
			OutputCount: 0,
			Err:         err,
		})
		if message := voiceCloneAudioRejected(err); message != "" {
			logProviderError(c, err)
			response.Error(c, http.StatusBadRequest, message)
			return
		}
		writeVoiceCloneFailure(c, err)
		return
	}
	h.recordAIRequestAsync(c, aiRequestLogInput{
		StartedAt:   startedAt,
		Config:      config,
		Operation:   "audio_voice_clone",
		Model:       modelID,
		InputCount:  1,
		OutputCount: 1,
	})
	alias := normalizeVoiceAlias(req.Alias)
	if h.clonedVoices != nil {
		var ownerID, ownerName string
		if user, ok := auth.CurrentUser(c); ok {
			ownerID = user.ID
			ownerName = firstNonEmptyString(user.DisplayName, user.Username)
		}
		// 元数据保存失败不影响克隆结果：音色已在服务商侧创建成功。
		if _, err := h.clonedVoices.Upsert(model.ClonedVoiceMeta{
			VoiceID:     record.VoiceID,
			Alias:       alias,
			OwnerID:     ownerID,
			OwnerName:   ownerName,
			TargetModel: record.TargetModel,
		}); err != nil {
			log.Printf("save cloned voice meta %s: %v", record.VoiceID, err)
		}
	}
	response.OK(c, gin.H{
		"voice_id":     record.VoiceID,
		"target_model": record.TargetModel,
		"status":       record.Status,
		"demo_audio":   record.DemoAudio,
		"request_id":   record.RequestID,
		"model":        encodeProviderModel(config.ID, modelID),
		"alias":        alias,
	})
}

// normalizeVoiceAlias 限制别名长度（按字符数），内容不限（支持中文）。
func normalizeVoiceAlias(alias string) string {
	trimmed := strings.TrimSpace(alias)
	runes := []rune(trimmed)
	if len(runes) > 30 {
		return string(runes[:30])
	}
	return trimmed
}

// localClonedVoicePrefix 本地音色 ID 前缀：音色本体不存服务商，
// 只有元数据 + 参考音频资产，合成时临时克隆。
const localClonedVoicePrefix = "cvoice-"

func newLocalClonedVoiceID() string {
	return localClonedVoicePrefix + randomHexString(6)
}

// errLocalVoiceUnavailable 音色元数据不存在或无权使用：对用户统一报"已被删除"。
var errLocalVoiceUnavailable = errors.New("local cloned voice unavailable")

// errVoiceReferenceMissing 音色的参考音频资产已被删除/不可读，音色无法再临时克隆。
var errVoiceReferenceMissing = errors.New("voice reference audio missing")

// tempClonedVoiceTTL 临时音色在服务商侧的保留时间：连续生成在这段时间内复用同一个
// 临时音色，省去重复克隆；到期后自动删除，阿里云账户不长期占用配额。
const tempClonedVoiceTTL = 20 * time.Second

type tempClonedVoiceEntry struct {
	voiceID   string
	expiresAt time.Time
}

// materializeLocalClonedVoice 将本地音色（仅存参考音频）临时注册到服务商；
// 20 秒内的重复调用直接复用未过期的临时音色，到期由定时器删除。
func (h *AIHandler) materializeLocalClonedVoice(c *gin.Context, voiceID string, client *provider.OpenAICompatibleClient, secrets map[string]string) (string, error) {
	meta, err := h.clonedVoices.Get(voiceID)
	if err != nil {
		return "", errLocalVoiceUnavailable
	}
	user, _ := auth.CurrentUser(c)
	// 他人音色一律报"不存在"，不暴露音色是否存在。
	if meta.OwnerID != user.ID && user.Role != model.UserRoleSuperAdmin {
		return "", errLocalVoiceUnavailable
	}
	if cached, ok := h.tempClonedVoices.Load(voiceID); ok {
		if entry, ok := cached.(tempClonedVoiceEntry); ok && time.Now().Before(entry.expiresAt) {
			return entry.voiceID, nil
		}
	}
	audioURL, err := h.resolveUpscaleInputURL(c, client, secrets, "", meta.ReferenceAssetID, strings.TrimSpace(c.Query("scope")), ".mp3")
	if err != nil {
		return "", fmt.Errorf("%w: %v", errVoiceReferenceMissing, err)
	}
	lower := strings.ToLower(strings.TrimSpace(audioURL))
	if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") && !strings.HasPrefix(lower, "oss://") {
		return "", errors.New("reference audio has no public URL; configure Aliyun AK/SK for local uploads")
	}
	record, err := client.CreateClonedVoice(c.Request.Context(), provider.VoiceCloneRequest{
		TargetModel: meta.TargetModel,
		Prefix:      "tmp" + randomHexString(3),
		AudioURL:    audioURL,
	}, secrets)
	if err != nil {
		return "", err
	}
	entry := tempClonedVoiceEntry{voiceID: record.VoiceID, expiresAt: time.Now().Add(tempClonedVoiceTTL)}
	h.tempClonedVoices.Store(voiceID, entry)
	time.AfterFunc(time.Until(entry.expiresAt), func() {
		h.tempClonedVoices.Delete(voiceID)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if derr := client.DeleteClonedVoice(ctx, record.VoiceID, secrets); derr != nil {
			log.Printf("cleanup temp cloned voice %s: %v", record.VoiceID, derr)
		}
	})
	return record.VoiceID, nil
}

// createLocalClonedVoice 即克隆即删模式下的"克隆"：参考音频存为资产，音色只登记元数据。
// 保存前先在服务商侧临时克隆一次做质检（不合格当场报错），通过即删除临时音色。
func (h *AIHandler) createLocalClonedVoice(c *gin.Context, client *provider.OpenAICompatibleClient, config model.ModelProviderConfig, secrets map[string]string, req provider.VoiceCloneRequest, modelID string, startedAt time.Time) {
	user, _ := auth.CurrentUser(c)
	alias := normalizeVoiceAlias(req.Alias)
	if alias == "" {
		response.Error(c, http.StatusBadRequest, "请填写音色名称")
		return
	}
	scope := firstNonEmptyString(strings.TrimSpace(req.Scope), requestWorkspaceScope(c))
	audioBytes, ext, err := h.resolveVoiceCloneReferenceBytes(c, client, req, user.ID, scope)
	if err != nil {
		log.Printf("voice clone reference read failed: %v", err)
		response.Error(c, http.StatusBadRequest, voiceCloneAudioUnreadable)
		return
	}
	assetInput := service.AssetUploadInput{
		ID:          "voice_ref_" + randomHexString(8),
		UserID:      user.ID,
		Scope:       scope,
		Type:        "audio",
		Name:        alias + "（音色参考音频）",
		Extension:   ext,
		ContentType: audioAssetContentType(ext),
		Reader:      bytes.NewReader(audioBytes),
		Registration: service.AssetRegistrationContext{
			Category:   "reference",
			SourceType: model.AssetSourceManualUpload,
		},
	}
	// 参考音频统一归档到"音色参考音频"系统文件夹，不随画布项目散落。
	if h.assetFolders != nil {
		if defaults, folderErr := h.assetFolders.EnsureDefaults(user.ID, scope); folderErr == nil {
			assetInput.Registration.FolderID = defaults.VoiceClone.ID
		}
	}
	asset, err := h.assets.Upload(c.Request.Context(), assetInput)
	if err != nil {
		writeVoiceCloneFailure(c, fmt.Errorf("save reference audio asset: %w", err))
		return
	}
	// 质检：临时克隆一次并立即删除，参考音频不合格（无人声/噪音/过短等）当场拦截。
	if err := h.validateVoiceCloneAudio(c, client, secrets, modelID, asset.ID, scope); err != nil {
		if _, trashErr := h.assets.BulkTrash([]string{asset.ID}, user.ID, scope); trashErr != nil {
			log.Printf("trash rejected voice reference asset %s: %v", asset.ID, trashErr)
		}
		h.recordAIRequestAsync(c, aiRequestLogInput{
			StartedAt: startedAt,
			Config:    config,
			Operation: "audio_voice_clone",
			Model:     modelID,
			InputCount: 1,
			Err:       err,
		})
		if message := voiceCloneAudioRejected(err); message != "" {
			logProviderError(c, err)
			response.Error(c, http.StatusBadRequest, message)
			return
		}
		writeVoiceCloneFailure(c, err)
		return
	}
	voiceID := newLocalClonedVoiceID()
	if _, err := h.clonedVoices.Upsert(model.ClonedVoiceMeta{
		VoiceID:          voiceID,
		Alias:            alias,
		OwnerID:          user.ID,
		OwnerName:        firstNonEmptyString(user.DisplayName, user.Username),
		TargetModel:      modelID,
		ReferenceAssetID: asset.ID,
	}); err != nil {
		writeVoiceCloneFailure(c, fmt.Errorf("save cloned voice meta: %w", err))
		return
	}
	h.recordAIRequestAsync(c, aiRequestLogInput{
		StartedAt:   startedAt,
		Config:      config,
		Operation:   "audio_voice_clone",
		Model:       modelID,
		InputCount:  1,
		OutputCount: 1,
	})
	response.OK(c, gin.H{
		"voice_id":     voiceID,
		"target_model": modelID,
		"status":       "OK",
		"model":        encodeProviderModel(config.ID, modelID),
		"alias":        alias,
	})
}

// validateVoiceCloneAudio 把参考音频临时克隆到服务商做质检，成功后立即删除临时音色。
func (h *AIHandler) validateVoiceCloneAudio(c *gin.Context, client *provider.OpenAICompatibleClient, secrets map[string]string, modelID string, assetID string, scope string) error {
	audioURL, err := h.resolveUpscaleInputURL(c, client, secrets, "", assetID, scope, ".mp3")
	if err != nil {
		return fmt.Errorf("resolve reference audio: %w", err)
	}
	record, err := client.CreateClonedVoice(c.Request.Context(), provider.VoiceCloneRequest{
		TargetModel: modelID,
		Prefix:      "chk" + randomHexString(3),
		AudioURL:    audioURL,
	}, secrets)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if derr := client.DeleteClonedVoice(ctx, record.VoiceID, secrets); derr != nil {
		log.Printf("cleanup validation voice %s: %v", record.VoiceID, derr)
	}
	return nil
}

// resolveVoiceCloneReferenceBytes 读取参考音频的原始字节：data_url 解码 / 资产库读取 / 公网 URL 下载。
func (h *AIHandler) resolveVoiceCloneReferenceBytes(c *gin.Context, client *provider.OpenAICompatibleClient, req provider.VoiceCloneRequest, userID string, scope string) ([]byte, string, error) {
	if dataURL := strings.TrimSpace(req.DataURL); strings.HasPrefix(dataURL, "data:") {
		comma := strings.Index(dataURL, ",")
		if comma < 0 {
			return nil, "", errors.New("invalid data_url format")
		}
		decoded, err := base64.StdEncoding.DecodeString(dataURL[comma+1:])
		if err != nil {
			return nil, "", fmt.Errorf("invalid base64 data_url: %w", err)
		}
		return decoded, audioExtFromMime(dataURL[:comma]), nil
	}
	if assetID := strings.TrimSpace(req.AssetID); assetID != "" && h.assets != nil {
		content, err := h.assets.DescribeContent(c.Request.Context(), assetID, userID, scope)
		if err != nil {
			return nil, "", err
		}
		opened, err := h.assets.OpenResolvedContent(c.Request.Context(), content)
		if err != nil {
			return nil, "", err
		}
		defer opened.Reader.Close()
		data, err := io.ReadAll(opened.Reader)
		if err != nil {
			return nil, "", err
		}
		ext := filepath.Ext(opened.Object.Key)
		if ext == "" {
			ext = ".mp3"
		}
		return data, ext, nil
	}
	if rawURL := strings.TrimSpace(req.AudioURL); rawURL != "" {
		data, contentType, err := client.DownloadMediaBytes(c.Request.Context(), rawURL)
		if err != nil {
			return nil, "", err
		}
		return data, audioExtFromMime(contentType), nil
	}
	return nil, "", errors.New("reference audio missing")
}

func audioExtFromMime(header string) string {
	lower := strings.ToLower(header)
	switch {
	case strings.Contains(lower, "wav"):
		return ".wav"
	case strings.Contains(lower, "m4a"), strings.Contains(lower, "mp4"):
		return ".m4a"
	default:
		return ".mp3"
	}
}

func audioAssetContentType(ext string) string {
	switch strings.ToLower(ext) {
	case ".wav":
		return "audio/wav"
	case ".m4a":
		return "audio/mp4"
	default:
		return "audio/mpeg"
	}
}

const (
	voiceCloneAudioUnreadable = "参考音频读取失败：请重新选择本地文件；如填写链接，请确认链接可公开访问"
	voiceCloneRetryLater      = "音色克隆暂时失败，请稍后重试"
)

// writeVoiceCloneFailure handles failures the user cannot fix: the details go to the
// server log for admins and the user only sees a retry message.
func writeVoiceCloneFailure(c *gin.Context, err error) {
	logProviderError(c, err)
	if providerRateLimited(err) {
		response.Error(c, http.StatusTooManyRequests, errGenerationRateLimited.Error())
		return
	}
	response.Error(c, http.StatusBadGateway, voiceCloneRetryLater)
}

// voiceCloneAudioRejected turns a supplier rejection of the reference audio into advice the
// user can act on; the supplier text stays in the request log for admins.
func voiceCloneAudioRejected(err error) string {
	var response *provider.ProviderHTTPError
	if !errors.As(err, &response) || response.StatusCode >= http.StatusInternalServerError || response.StatusCode == http.StatusTooManyRequests {
		return ""
	}
	body := strings.ToLower(response.Body)
	has := func(words ...string) bool {
		for _, word := range words {
			if strings.Contains(body, word) {
				return true
			}
		}
		return false
	}
	switch {
	// Account limits (voice quota, balance, permissions) are for admins, not the user.
	case has("quota", "voice limit", "voice count", "arrearage", "balance", "access denied", "accessdenied", "unauthorized", "invalidapikey", "invalid api key", "permission"):
		return ""
	case has("too short"):
		return "参考音频中可识别的人声太短：需要至少一段超过 5 秒的单人连续说话，且无背景音乐（推荐 10–20 秒）"
	case has("too long"):
		return "参考音频太长（最长 60 秒）：请截取 10–20 秒单人清晰说话的片段后重试"
	case has("file size", "file too large", "too large", "size exceed", "exceeds the maximum size"):
		return "参考音频文件太大（最大 10 MB）：请截取 10–20 秒的片段或压缩后重试"
	case has("sample rate", "samplerate", "sampling rate"):
		return "参考音频采样率太低：请使用 16 kHz 及以上采样率的录音"
	case has("format", "decode", "unsupported", "codec", "corrupt"):
		return "参考音频格式不支持：请使用 WAV（16 位）、MP3 或 M4A 文件"
	case has("noise", "multiple speaker", "multi-speaker", "background music", "no valid", "no speech", "no human voice", "quality", "snr"):
		return "参考音频不够清晰：请使用单人说话、无背景音乐和杂音的录音（推荐 10–20 秒）"
	case has("download audio failed", "download failed"):
		return voiceCloneAudioUnreadable
	}
	return ""
}

func (h *AIHandler) AudioVoiceCloneList(c *gin.Context) {
	requestedModel := strings.TrimSpace(c.Query("model"))
	prefix := strings.TrimSpace(c.Query("prefix"))
	// 用户隔离：本地元数据表是音色列表的唯一来源，普通用户只看到自己的，
	// 超级管理员可见全部。阿里云账户的全量列表不再直接暴露给前端。
	if h.clonedVoices != nil {
		user, _ := auth.CurrentUser(c)
		metas, err := h.clonedVoices.ListVisible(user.ID, user.Role == model.UserRoleSuperAdmin)
		if err != nil {
			response.Error(c, http.StatusInternalServerError, "读取音色列表失败")
			return
		}
		items := make([]clonedVoiceListItem, 0, len(metas))
		for _, meta := range metas {
			items = append(items, clonedVoiceListItem{
				VoiceCloneRecord: provider.VoiceCloneRecord{
					VoiceID:     meta.VoiceID,
					TargetModel: meta.TargetModel,
					Status:      "OK",
					CreatedAt:   meta.CreatedAt.UTC().Format(time.RFC3339),
				},
				Alias:     meta.Alias,
				OwnerName: meta.OwnerName,
			})
		}
		response.OK(c, gin.H{"voices": items})
		return
	}
	// 兜底：未装配元数据仓储时保持旧行为（直接代理服务商列表）。
	client, config, _, ok := h.providerHandler.LoadClientForModel(c, model.ModelCapabilityAudio, requestedModel)
	if !ok {
		return
	}
	secrets, err := h.providerHandler.DecryptSecrets(config)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, "model provider secrets cannot be decrypted")
		return
	}
	voices, err := client.ListClonedVoices(c.Request.Context(), prefix, secrets)
	if err != nil {
		// Non-fatal if provider does not support list_voice (e.g. MiniMax or OpenAI); return empty list.
		response.OK(c, gin.H{"voices": []provider.VoiceCloneRecord{}, "notice": err.Error()})
		return
	}
	response.OK(c, gin.H{"voices": h.attachVoiceAliases(voices)})
}

// AudioVoiceCloneDelete removes a cloned voice from the provider account and the
// local alias metadata. Already-generated audio assets are unaffected; canvas
// nodes that still reference the voice will fail on their next synthesis.
func (h *AIHandler) AudioVoiceCloneDelete(c *gin.Context) {
	startedAt := time.Now().UTC()
	voiceID := strings.TrimSpace(c.Param("voice_id"))
	if voiceID == "" {
		response.Error(c, http.StatusBadRequest, "voice_id is required")
		return
	}
	// 本地音色（cvoice-）：服务商侧没有本体，只删元数据；仅属主或超管可删。
	if strings.HasPrefix(voiceID, localClonedVoicePrefix) {
		if h.clonedVoices == nil {
			response.Error(c, http.StatusNotFound, "该音色不存在或已被删除")
			return
		}
		meta, err := h.clonedVoices.Get(voiceID)
		if err != nil {
			response.Error(c, http.StatusNotFound, "该音色不存在或已被删除")
			return
		}
		user, _ := auth.CurrentUser(c)
		if meta.OwnerID != user.ID && user.Role != model.UserRoleSuperAdmin {
			response.Error(c, http.StatusForbidden, "只能删除自己的音色")
			return
		}
		if err := h.clonedVoices.DeleteByVoiceID(voiceID); err != nil {
			response.Error(c, http.StatusInternalServerError, "音色删除失败，请稍后重试")
			return
		}
		response.OK(c, gin.H{"voice_id": voiceID, "deleted": true})
		return
	}
	client, config, _, ok := h.providerHandler.LoadClientForModel(c, model.ModelCapabilityAudio, "")
	if !ok {
		return
	}
	secrets, err := h.providerHandler.DecryptSecrets(config)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, "model provider secrets cannot be decrypted")
		return
	}
	if err := client.DeleteClonedVoice(c.Request.Context(), voiceID, secrets); err != nil {
		h.recordAIRequestAsync(c, aiRequestLogInput{
			StartedAt: startedAt,
			Config:    config,
			Operation: "audio_voice_clone_delete",
			Model:     voiceID,
			Err:       err,
		})
		logProviderError(c, err)
		response.Error(c, http.StatusBadGateway, "音色删除失败，请稍后重试；也可到服务商控制台删除")
		return
	}
	if h.clonedVoices != nil {
		if err := h.clonedVoices.DeleteByVoiceID(voiceID); err != nil {
			log.Printf("delete cloned voice meta %s: %v", voiceID, err)
		}
	}
	h.recordAIRequestAsync(c, aiRequestLogInput{
		StartedAt:   startedAt,
		Config:      config,
		Operation:   "audio_voice_clone_delete",
		Model:       voiceID,
		InputCount:  1,
		OutputCount: 1,
	})
	response.OK(c, gin.H{"voice_id": voiceID, "deleted": true})
}

// clonedVoiceListItem 在服务商返回的音色记录上叠加应用侧别名/属主信息。
type clonedVoiceListItem struct {
	provider.VoiceCloneRecord
	Alias     string `json:"alias,omitempty"`
	OwnerName string `json:"owner_name,omitempty"`
}

func (h *AIHandler) attachVoiceAliases(voices []provider.VoiceCloneRecord) []clonedVoiceListItem {
	items := make([]clonedVoiceListItem, 0, len(voices))
	var metas map[string]model.ClonedVoiceMeta
	if h.clonedVoices != nil && len(voices) > 0 {
		ids := make([]string, 0, len(voices))
		for _, voice := range voices {
			ids = append(ids, voice.VoiceID)
		}
		if found, err := h.clonedVoices.ListByVoiceIDs(ids); err == nil {
			metas = found
		} else {
			log.Printf("list cloned voice metas: %v", err)
		}
	}
	for _, voice := range voices {
		item := clonedVoiceListItem{VoiceCloneRecord: voice}
		if meta, ok := metas[voice.VoiceID]; ok {
			item.Alias = meta.Alias
			item.OwnerName = meta.OwnerName
		}
		items = append(items, item)
	}
	return items
}
