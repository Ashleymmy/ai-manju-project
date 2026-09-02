package handler

import (
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

type providerPreset struct {
	ID                 string               `json:"id"`
	Name               string               `json:"name"`
	Description        string               `json:"description"`
	ProviderType       string               `json:"provider_type"`
	Mode               string               `json:"mode"`
	BaseURL            string               `json:"base_url"`
	AuthType           string               `json:"auth_type"`
	CustomAuthHeader   string               `json:"custom_auth_header,omitempty"`
	AuthQueryParam     string               `json:"auth_query_param,omitempty"`
	Capabilities       []string             `json:"capabilities"`
	ModelsByCapability map[string][]string  `json:"models_by_capability"`
	Defaults           map[string]string    `json:"defaults"`
	EndpointOverrides  map[string]string    `json:"endpoint_overrides,omitempty"`
	ExtraHeaders       map[string]string    `json:"extra_headers,omitempty"`
	Secrets            []providerSecretSpec `json:"secrets,omitempty"`
	Notes              []string             `json:"notes,omitempty"`
}

type providerSecretSpec struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Required    bool   `json:"required"`
	Placeholder string `json:"placeholder,omitempty"`
}

func modelProviderPresets() []providerPreset {
	openAICompatibleModels := map[string][]string{
		model.ModelCapabilityText:  {"gpt-5.4"},
		model.ModelCapabilityImage: {"gpt-image-2", "gpt-image-1"},
	}
	return []providerPreset{
		{
			ID:                 "openai_compatible_custom",
			Name:               "自定义 OpenAI-compatible",
			Description:        "用于中转站、本地模型服务、MJ 中转和兼容 OpenAI /v1 协议的图片或文本服务。",
			ProviderType:       model.ModelProviderTypeOpenAICompatible,
			Mode:               model.ModelProviderModeOpenAICompatible,
			BaseURL:            "https://api.openai.com",
			AuthType:           model.ModelProviderAuthTypeBearer,
			Capabilities:       []string{model.ModelCapabilityText, model.ModelCapabilityImage},
			ModelsByCapability: openAICompatibleModels,
			Defaults: map[string]string{
				model.ModelCapabilityText:  "gpt-5.4",
				model.ModelCapabilityImage: "gpt-image-2",
			},
			Notes: []string{"自定义配置统一按 OpenAI-compatible 发送。"},
		},
		{
			ID:                 "openai_image",
			Name:               "OpenAI image 系列",
			Description:        "保留当前 image 系列模型配置，按 OpenAI-compatible 图片接口使用。",
			ProviderType:       model.ModelProviderTypeOpenAICompatible,
			Mode:               model.ModelProviderModeOpenAICompatible,
			BaseURL:            "https://api.openai.com",
			AuthType:           model.ModelProviderAuthTypeBearer,
			Capabilities:       []string{model.ModelCapabilityText, model.ModelCapabilityImage},
			ModelsByCapability: openAICompatibleModels,
			Defaults: map[string]string{
				model.ModelCapabilityText:  "gpt-5.4",
				model.ModelCapabilityImage: "gpt-image-2",
			},
		},
		{
			ID:           "volcengine_seedream",
			Name:         "火山 Seedream 图片",
			Description:  "火山方舟 Seedream 图片生成/编辑，兼容方舟 OpenAI 风格网关。",
			ProviderType: model.ModelProviderTypeVolcengineArk,
			Mode:         model.ModelProviderModeOpenAICompatible,
			BaseURL:      "https://ark.cn-beijing.volces.com/api/v3",
			AuthType:     model.ModelProviderAuthTypeBearer,
			Capabilities: []string{model.ModelCapabilityImage},
			ModelsByCapability: map[string][]string{
				model.ModelCapabilityImage: {"seedream-4-0", "seedream-3-0-t2i", "doubao-seedream-3-0-t2i"},
			},
			Defaults: map[string]string{model.ModelCapabilityImage: "seedream-4-0"},
		},
		{
			ID:           "volcengine_seedance",
			Name:         "火山 Seedance 视频",
			Description:  "火山方舟 Seedance 视频生成，支持现有 Seedance 任务路径。",
			ProviderType: model.ModelProviderTypeVolcengineArk,
			Mode:         model.ModelProviderModeOpenAICompatible,
			BaseURL:      "https://ark.cn-beijing.volces.com/api/v3",
			AuthType:     model.ModelProviderAuthTypeBearer,
			Capabilities: []string{model.ModelCapabilityVideo},
			ModelsByCapability: map[string][]string{
				model.ModelCapabilityVideo: {"seedance-1-0-pro", "seedance-1-0-lite", "seedance-2-0-pro", "doubao-seedance-2-5-260628"},
			},
			Defaults:          map[string]string{model.ModelCapabilityVideo: "seedance-1-0-pro"},
			EndpointOverrides: seedancePresetEndpointOverrides(),
			Secrets: []providerSecretSpec{
				{Key: service.VolcanoAssetSecretKey, Label: "兼容资产代理专用 API Key", Required: false, Placeholder: "默认沿用 Provider API Key"},
			},
			Notes: []string{
				"TokenSpace material_* 是拟真人与真人授权共用的统一素材库协议。",
				"拟真人直接 CreateAssetGroup；真人素材先完成视觉认证取得授权 GroupId，之后都使用 CreateAsset / GetAsset / DeleteAsset。",
				"TokenHub 文档不包含 /v1/asset/*；volcano_asset_* 仅作为部署方另行提供的可选兼容代理。",
				"生成时素材引用格式为 asset://{AssetID}；引用前建议确认 GetAsset 返回 Status=Active。",
				"终端用户首次使用 TokenSpace 素材库前需访问 /material/init，填写上级代理提供的 API 地址与 API Key。",
			},
		},
		{
			ID:           "gemini_media",
			Name:         "Gemini Nano Banana / Omni / Veo",
			Description:  "Google Gemini 原生媒体接口，覆盖 Nano Banana 图片、Gemini Omni 和 Veo 视频。",
			ProviderType: model.ModelProviderTypeGeminiMedia,
			Mode:         model.ModelProviderModeOpenAICompatible,
			BaseURL:      "https://generativelanguage.googleapis.com/v1beta",
			AuthType:     model.ModelProviderAuthTypeXGoogAPIKey,
			Capabilities: []string{model.ModelCapabilityText, model.ModelCapabilityImage, model.ModelCapabilityVideo},
			ModelsByCapability: map[string][]string{
				model.ModelCapabilityText:  {"gemini-2.5-flash", "gemini-2.5-pro"},
				model.ModelCapabilityImage: {"gemini-2.5-flash-image-preview", "nano-banana", "nano-banana-pro"},
				model.ModelCapabilityVideo: {"gemini-omni", "veo-3.1-generate-preview", "veo-3-generate-preview"},
			},
			Defaults: map[string]string{
				model.ModelCapabilityText:  "gemini-2.5-flash",
				model.ModelCapabilityImage: "gemini-2.5-flash-image-preview",
				model.ModelCapabilityVideo: "veo-3.1-generate-preview",
			},
		},
		{
			ID:           "kling_video",
			Name:         "Kling 视频",
			Description:  "Kling AI 视频生成。默认按 API Key 鉴权；AK/SK 可放入高级 secrets。",
			ProviderType: model.ModelProviderTypeKlingVideo,
			Mode:         model.ModelProviderModeOpenAICompatible,
			BaseURL:      "https://api.klingai.com",
			AuthType:     model.ModelProviderAuthTypeBearer,
			Capabilities: []string{model.ModelCapabilityVideo},
			ModelsByCapability: map[string][]string{
				model.ModelCapabilityVideo: {"kling-v2-1", "kling-v2", "kling-v1-6"},
			},
			Defaults: map[string]string{model.ModelCapabilityVideo: "kling-v2-1"},
			Secrets: []providerSecretSpec{
				{Key: "access_key", Label: "Access Key", Required: false},
				{Key: "secret_key", Label: "Secret Key", Required: false},
			},
		},
		{
			ID:           "minimax_hailuo",
			Name:         "Hailuo 视频",
			Description:  "MiniMax / Hailuo 视频生成。",
			ProviderType: model.ModelProviderTypeMinimaxHailuo,
			Mode:         model.ModelProviderModeOpenAICompatible,
			BaseURL:      "https://api.minimax.io/v1",
			AuthType:     model.ModelProviderAuthTypeBearer,
			Capabilities: []string{model.ModelCapabilityVideo},
			ModelsByCapability: map[string][]string{
				model.ModelCapabilityVideo: {"hailuo-02", "video-01", "video-01-live"},
			},
			Defaults: map[string]string{model.ModelCapabilityVideo: "hailuo-02"},
		},
		{
			ID:           "fal_happyhorse",
			Name:         "HappyHorse 视频",
			Description:  "HappyHorse 首版按 fal API Partner 预设接入。",
			ProviderType: model.ModelProviderTypeFalHappyHorse,
			Mode:         model.ModelProviderModeOpenAICompatible,
			BaseURL:      "https://queue.fal.run",
			AuthType:     model.ModelProviderAuthTypeBearer,
			Capabilities: []string{model.ModelCapabilityVideo},
			ModelsByCapability: map[string][]string{
				model.ModelCapabilityVideo: {"fal-ai/happy-horse"},
			},
			Defaults: map[string]string{model.ModelCapabilityVideo: "fal-ai/happy-horse"},
		},
		{
			ID:           "xai_grok",
			Name:         "Grok 图片/视频",
			Description:  "xAI Grok Imagine 图片与视频能力。",
			ProviderType: model.ModelProviderTypeXAIImagine,
			Mode:         model.ModelProviderModeOpenAICompatible,
			BaseURL:      "https://api.x.ai/v1",
			AuthType:     model.ModelProviderAuthTypeBearer,
			Capabilities: []string{model.ModelCapabilityImage, model.ModelCapabilityVideo},
			ModelsByCapability: map[string][]string{
				model.ModelCapabilityImage: {"grok-2-image", "grok-imagine-image"},
				model.ModelCapabilityVideo: {"grok-imagine-video"},
			},
			Defaults: map[string]string{
				model.ModelCapabilityImage: "grok-2-image",
				model.ModelCapabilityVideo: "grok-imagine-video",
			},
		},
		{
			ID:           "mj_openai_proxy",
			Name:         "MJ 中转",
			Description:  "Midjourney 没有稳定官方公开 REST API，本预设用于 OpenAI-compatible MJ 中转站。",
			ProviderType: model.ModelProviderTypeOpenAICompatible,
			Mode:         model.ModelProviderModeOpenAICompatible,
			BaseURL:      "",
			AuthType:     model.ModelProviderAuthTypeBearer,
			Capabilities: []string{model.ModelCapabilityImage},
			ModelsByCapability: map[string][]string{
				model.ModelCapabilityImage: {"mj", "midjourney", "midjourney-v6"},
			},
			Defaults: map[string]string{model.ModelCapabilityImage: "midjourney"},
			Notes:    []string{"填写你的 MJ 中转站 Base URL；请求格式按 OpenAI-compatible 处理。"},
		},
		{
			ID:           "aliyun_yike_wan",
			Name:         "阿里云 Yike / Wan 视频",
			Description:  "阿里云 Yike 工作空间异步视频接口。模型列表未返回 Wan 时，可在视频模型列表中手动添加模型 ID。",
			ProviderType: model.ModelProviderTypeAliyunYike,
			Mode:         model.ModelProviderModeOpenAICompatible,
			BaseURL:      "",
			AuthType:     model.ModelProviderAuthTypeBearer,
			Capabilities: []string{model.ModelCapabilityVideo},
			ModelsByCapability: map[string][]string{
				model.ModelCapabilityVideo: {"wan3.0-video"},
			},
			Defaults: map[string]string{model.ModelCapabilityVideo: "wan3.0-video"},
			EndpointOverrides: map[string]string{
				"video_create": "/api/v1/services/aigc/video-generation/video-synthesis",
				"video_get":    "/api/v1/tasks/{id}",
			},
			Notes: []string{
				"创建请求自动发送 X-DashScope-Async: enable，查询请求不会发送该 Header。",
				"上游 /models 未必列出 Wan 视频模型；可手动添加 wan3.0-video，拉取模型不会覆盖手动项。",
			},
		},
	}
}

func providerPresetsResponse() gin.H {
	return gin.H{"presets": modelProviderPresets()}
}

func seedancePresetEndpointOverrides() map[string]string {
	overrides := map[string]string{
		"video_create":      "/contents/generations/tasks",
		"video_get":         "/contents/generations/tasks/{id}",
		"material_base_url": "https://api.tokenspace.net.cn/api/material",
		"material_create_visual_validate_session": "?Action=CreateVisualValidateSession",
		"material_get_visual_validate_result":     "?Action=GetVisualValidateResult",
		"material_create_real_validate_h5":        "?Action=CreateRealValidateH5",
		"material_create_asset_group":             "?Action=CreateAssetGroup",
		"material_get_asset_group":                "?Action=GetAssetGroup",
		"material_delete_asset_group":             "?Action=DeleteAssetGroup",
		"material_create_asset":                   "?Action=CreateAsset",
		"material_get_asset":                      "?Action=GetAsset",
		"material_delete_asset":                   "?Action=DeleteAsset",
	}
	for key, value := range service.DefaultVolcanoAssetEndpointOverrides {
		overrides[key] = value
	}
	return overrides
}
