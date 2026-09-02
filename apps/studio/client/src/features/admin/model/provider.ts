import type { Dispatch, SetStateAction } from "react";

import type {
  ImageGenerationProtocol,
  ModelCapability,
  ModelProviderConfig,
  ModelProviderPreset,
  ModelProviderTestResult,
} from "../services/adminApi";

export const capabilityOptions: Array<{
  value: ModelCapability;
  label: string;
}> = [
  { value: "text", label: "文本" },
  { value: "image", label: "图像" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
];

export const imageProtocolOptions: Array<{
  value: ImageGenerationProtocol;
  label: string;
}> = [
  { value: "auto", label: "自动识别" },
  { value: "openai_images", label: "OpenAI Images" },
  { value: "openai_responses", label: "OpenAI Responses" },
  { value: "openai_chat_completions", label: "OpenAI Chat Completions" },
  { value: "gemini_generate_content", label: "Gemini generateContent" },
  { value: "dashscope_multimodal", label: "DashScope Multimodal" },
  { value: "stability_image", label: "Stability Image" },
];

export const emptyProvider: ModelProviderConfig = {
  id: "",
  name: "新 Provider",
  preset_id: "",
  provider_type: "openai_compatible",
  mode: "openai_compatible",
  base_url: "",
  auth_type: "bearer",
  text_model: "",
  image_model: "",
  video_model: "",
  audio_model: "",
  capabilities: ["text", "image"],
  models_by_capability: {},
  model_aliases: {},
  model_protocols: {},
  default_for: [],
  endpoint_overrides: {},
  extra_headers: {},
  timeout_ms: 120_000,
  max_concurrency: 3,
  enabled: true,
};

export function clearProviderSensitiveInputState(
  setApiKey: Dispatch<SetStateAction<string>>,
  setProviderSecrets: Dispatch<SetStateAction<Record<string, string>>>,
  setProviderTestResult: Dispatch<
    SetStateAction<ModelProviderTestResult | null>
  >
) {
  setApiKey("");
  setProviderSecrets({});
  setProviderTestResult(null);
}

export function applyProviderPreset(
  id: string,
  presets: ModelProviderPreset[],
  draft: ModelProviderConfig
): ModelProviderConfig {
  const preset = presets.find(item => item.id === id);
  if (!preset) return { ...draft, preset_id: "" };
  return {
    ...draft,
    preset_id: preset.id,
    name: draft.id ? draft.name : preset.name,
    provider_type: preset.provider_type,
    mode: preset.mode,
    base_url: preset.base_url,
    auth_type: preset.auth_type,
    custom_auth_header: preset.custom_auth_header,
    auth_query_param: preset.auth_query_param,
    capabilities: [...preset.capabilities],
    models_by_capability: Object.fromEntries(
      Object.entries(preset.models_by_capability).map(([capability, models]) => [
        capability,
        [...(models || [])],
      ])
    ),
    text_model: preset.defaults.text || draft.text_model,
    image_model: preset.defaults.image || draft.image_model,
    video_model: preset.defaults.video || draft.video_model,
    audio_model: preset.defaults.audio || draft.audio_model,
    endpoint_overrides: { ...(preset.endpoint_overrides || {}) },
    extra_headers: { ...(preset.extra_headers || {}) },
  };
}

export function splitModels(value: string) {
  return value
    .split(/[\n,，;；]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

export function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean);
}

export function joinModels(values: string[] = []) {
  return values.join("\n");
}

export function normalizeAliasMap(value: Record<string, string> = {}) {
  return Object.fromEntries(
    Object.entries(value)
      .map(([model, alias]) => [model.trim(), alias.trim()])
      .filter(([model, alias]) => model && alias)
  );
}

export function allConfiguredModelIds(config: ModelProviderConfig) {
  return Array.from(
    new Set(
      [
        ...Object.values(config.models_by_capability || {}).flatMap(
          models => models || []
        ),
        config.text_model || "",
        config.image_model || "",
        config.video_model || "",
        config.audio_model || "",
        ...Object.keys(config.model_aliases || {}),
        ...Object.keys(config.model_protocols || {}),
      ]
        .map(item => item.trim())
        .filter(Boolean)
    )
  );
}

export function imageProtocolModelIds(config: ModelProviderConfig) {
  return Array.from(
    new Set(
      [
        ...(config.models_by_capability?.image || []),
        config.image_model || "",
        ...Object.keys(config.model_protocols || {}),
      ]
        .map(item => item.trim())
        .filter(Boolean)
    )
  );
}
