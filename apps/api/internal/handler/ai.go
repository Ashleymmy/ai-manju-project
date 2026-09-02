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
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
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
	providerHandler *ModelProviderHandler
	monitoringRepo  repository.MonitoringRepository
	ai              *service.AIService
	jobs            *service.JobService
	jobInputs       *service.JobInputService
	materials       *service.SeedanceMaterialService
	seedanceAssets  *service.SeedanceAssetService
	assetFolders    *service.AssetFolderService
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
	req.Prompt = prompt
	parallelToolCalls := false
	req.ParallelToolCalls = &parallelToolCalls
	inputCount := len(req.Messages)
	if inputCount == 0 {
		inputCount = 1
	}

	client, config, modelID, ok := h.providerHandler.LoadClientForModel(c, model.ModelCapabilityText, req.Model)
	if !ok {
		return
	}

	req.Model = modelID
	text, err := client.GenerateTextRequest(c.Request.Context(), req)
	if err != nil {
		h.recordAIRequestAsync(c, aiRequestLogInput{StartedAt: startedAt, Config: config, Operation: "text", Model: modelID, InputCount: inputCount, OutputCount: 0, Err: err})
		writeProviderError(c, config.BaseURL, err)
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

	config, apiKey, modelID, ok := h.providerHandler.LoadConfigForModel(c, model.ModelCapabilityImage, imageRequest.Model)
	if !ok {
		return
	}
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
	jobResult, err := h.enqueueAIJob(c, model.JobTypeImageGenerate, payload, imageProviderJobKwargs(config, apiKey, modelID, "generate", h.providerHandler.gateSecret))
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

	config, apiKey, modelID, ok := h.providerHandler.LoadConfigForModel(c, model.ModelCapabilityImage, editRequest.Model)
	if !ok {
		return
	}
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
	jobResult, err := h.enqueueAIJob(c, model.JobTypeImageEdit, payload, imageProviderJobKwargs(config, apiKey, modelID, "edit", h.providerHandler.gateSecret), fingerprintPayload)
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
	config, apiKey, modelID, ok := h.providerHandler.LoadConfigForModel(c, model.ModelCapabilityVideo, requestedModel)
	if !ok {
		h.cleanupStagedInputs(c, workspaceID, stagedInputs)
		return
	}
	if modelID == "" {
		h.cleanupStagedInputs(c, workspaceID, stagedInputs)
		writeProviderError(c, config.BaseURL, errors.New("video model is not configured"))
		return
	}
	payloadMap["model"] = modelID
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
	jobResult, err := h.enqueueAIJob(c, model.JobTypeVideoGenerate, payload, providerJobKwargs(config, apiKey, modelID, "/videos", h.providerHandler.gateSecret), fingerprintPayload)
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
	var stablePayload model.JSONB
	if len(idempotencyPayload) > 0 {
		stablePayload = idempotencyPayload[0]
	}
	result, err := h.jobs.Enqueue(c.Request.Context(), service.EnqueueJobInput{
		UserID:             user.ID,
		Scope:              requestWorkspaceScope(c),
		Type:               jobType,
		Payload:            payload,
		IdempotencyPayload: stablePayload,
		TaskKwargs:         kwargs,
		IdempotencyKey:     c.GetHeader("Idempotency-Key"),
	})
	if err != nil {
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
	h.proxyProviderJSON(c, http.MethodGet, "/videos/"+url.PathEscape(c.Param("id")), nil, false, model.ModelCapabilityVideo, c.Query("model"))
}

func (h *AIHandler) VideoTaskContent(c *gin.Context) {
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
	if err := h.ensureSeedanceAssetsActive(c.Request.Context(), body); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	requestedModel := stringFromAny(body["model"])
	if requestedModel == "" {
		requestedModel = c.Query("model")
	}
	config, configOK := h.providerConfigForVideoModel(c, requestedModel)
	if !configOK {
		return
	}
	if config.ProviderType == model.ModelProviderTypeAliyunYike {
		client, loadedConfig, modelID, loaded := h.providerHandler.LoadClientForModel(c, model.ModelCapabilityVideo, requestedModel)
		if !loaded {
			return
		}
		payload, err := yikeVideoRequest(body, modelID)
		if err != nil {
			response.Error(c, http.StatusBadRequest, err.Error())
			return
		}
		raw, err := client.ProxyJSON(c.Request.Context(), http.MethodPost, providerProxyPath(loadedConfig, "/contents/generations/tasks"), payload, true)
		if err != nil {
			writeProviderError(c, loadedConfig.BaseURL, err)
			return
		}
		response.OK(c, yikeTaskResponse(raw, modelID))
		return
	}
	h.proxyProviderJSON(c, http.MethodPost, "/contents/generations/tasks", body, true, model.ModelCapabilityVideo, requestedModel)
}

func (h *AIHandler) ensureSeedanceAssetsActive(ctx context.Context, payload map[string]any) error {
	assetIDs := seedanceAssetIDsFromPayload(payload)
	if len(assetIDs) == 0 {
		return nil
	}
	if h.seedanceAssets != nil {
		err := h.seedanceAssets.EnsureAssetsActive(ctx, assetIDs)
		if err == nil {
			return nil
		}
		if h.materials == nil || !strings.Contains(err.Error(), "status=missing") {
			return err
		}
	}
	if h.materials != nil {
		return h.materials.EnsureAssetsActive(ctx, assetIDs)
	}
	return nil
}

func (h *AIHandler) SeedanceTaskGet(c *gin.Context) {
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
		"ratio":      firstNonEmpty(stringFromAny(body["ratio"]), "adaptive"),
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
	body, contentType, err := downloadSeedanceVideoContent(c.Request.Context(), videoURL)
	if err != nil {
		response.Error(c, http.StatusBadGateway, err.Error())
		return
	}
	c.Data(http.StatusOK, firstNonEmpty(contentType, "video/mp4"), body)
}

func (h *AIHandler) AudioSpeech(c *gin.Context) {
	client, config, modelID, ok := h.providerHandler.LoadClientForModel(c, model.ModelCapabilityAudio, "")
	if !ok {
		return
	}
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if modelID != "" {
		body["model"] = modelID
	}
	content, contentType, err := client.ProxyBlob(c.Request.Context(), http.MethodPost, providerProxyPath(config, "/audio/speech"), body, true)
	if err != nil {
		writeProviderError(c, config.BaseURL, err)
		return
	}
	if strings.TrimSpace(contentType) == "" {
		contentType = "application/octet-stream"
	}
	c.Data(http.StatusOK, contentType, content)
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

func downloadSeedanceVideoContent(ctx context.Context, rawURL string) ([]byte, string, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Host == "" || parsed.User != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, "", errors.New("Seedance returned an invalid video URL")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Accept", "video/*,application/octet-stream;q=0.9,*/*;q=0.1")
	client := &http.Client{Timeout: 10 * time.Minute}
	res, err := client.Do(req)
	if err != nil {
		return nil, "", err
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
		log.Printf("request_id=%s operation=%s monitoring_log_error=%v", requestID, operation, err)
	}
}

func (h *AIHandler) recordAIRequestAsync(c *gin.Context, input aiRequestLogInput) {
	if h.monitoringRepo == nil {
		return
	}
	logEntry, operation, requestID := buildAIRequestLog(c, input)
	go func() {
		if err := h.monitoringRepo.CreateAIRequestLog(logEntry); err != nil {
			log.Printf("request_id=%s operation=%s monitoring_log_error=%v", requestID, operation, err)
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
	if input.Err != nil {
		status = model.AIRequestStatusError
		errorInfo := describeProviderError(input.Config.BaseURL, input.Err)
		httpStatus = errorInfo.HTTPStatus
		providerStatus = errorInfo.ProviderStatus
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
		ErrorMessage:    errorMessage,
		ErrorReason:     errorReason,
		ErrorSuggestion: errorSuggestion,
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
		Reason:     strings.TrimSpace(err.Error()),
		Suggestion: "请稍后重试；如果持续失败，请联系管理员检查模型服务配置。",
	}
	if err == nil {
		return info
	}
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
