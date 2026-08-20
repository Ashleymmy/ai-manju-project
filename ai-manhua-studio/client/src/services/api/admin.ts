import { ApiError, request } from "./request";
import { normalizeModelList } from "./ai";

export const DEFAULT_PROVIDER_MAX_CONCURRENCY = 3;
export const MIN_PROVIDER_MAX_CONCURRENCY = 1;
export const MAX_PROVIDER_MAX_CONCURRENCY = 8;

export type AdminUser = {
  id: string;
  username: string;
  display_name?: string;
  role: "super_admin" | "member";
  status: "active" | "disabled" | "suspended";
  created_at?: string;
  updated_at?: string;
};

export type AdminUserPayload = {
  username: string;
  display_name?: string;
  role: AdminUser["role"];
  status: "active" | "disabled";
  password?: string;
};

export type ModelCapability = "text" | "image" | "video" | "audio";
export type ImageGenerationProtocol =
  | "auto"
  | "openai_images"
  | "openai_responses"
  | "openai_chat_completions"
  | "gemini_generate_content"
  | "dashscope_multimodal"
  | "stability_image";

export type ModelProviderConfig = {
  configured?: boolean;
  id?: string;
  name?: string;
  preset_id?: string;
  provider_type?: "openai_compatible" | "volcengine_ark" | "gemini_media" | "kling_video" | "minimax_hailuo" | "fal_happyhorse" | "xai_imagine" | "aliyun_yike";
  mode: "local_openai" | "openai_compatible";
  base_url: string;
  auth_type: "none" | "bearer" | "x_api_key" | "x_goog_api_key" | "auto_api_key" | "custom_header" | "query_param";
  custom_auth_header?: string;
  auth_query_param?: string;
  api_key_configured?: boolean;
  api_key_set?: boolean;
  secrets_set?: Record<string, boolean>;
  text_model: string;
  image_model?: string;
  video_model?: string;
  audio_model?: string;
  capabilities?: ModelCapability[];
  models_by_capability?: Partial<Record<ModelCapability, string[]>>;
  model_aliases?: Record<string, string>;
  model_protocols?: Record<string, ImageGenerationProtocol>;
  default_for?: ModelCapability[];
  endpoint_overrides?: Record<string, string>;
  extra_headers?: Record<string, string>;
  timeout_ms: number;
  max_concurrency: number;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
};

export type ModelProviderPayload = Omit<ModelProviderConfig, "api_key_configured" | "api_key_set" | "secrets_set" | "configured" | "created_at" | "updated_at"> & {
  api_key?: string;
  secrets?: Record<string, string>;
};

export type ProviderSecretSpec = {
  key: string;
  label: string;
  required?: boolean;
  placeholder?: string;
};

export type ModelProviderPreset = {
  id: string;
  name: string;
  description: string;
  provider_type: NonNullable<ModelProviderConfig["provider_type"]>;
  mode: ModelProviderConfig["mode"];
  base_url: string;
  auth_type: ModelProviderConfig["auth_type"];
  custom_auth_header?: string;
  auth_query_param?: string;
  capabilities: ModelCapability[];
  models_by_capability: Partial<Record<ModelCapability, string[]>>;
  defaults: Partial<Record<ModelCapability, string>>;
  endpoint_overrides?: Record<string, string>;
  extra_headers?: Record<string, string>;
  secrets?: ProviderSecretSpec[];
  notes?: string[];
};

export type ModelProviderTestResult = {
  ok?: boolean;
  models?: Array<string | { id?: string; name?: string }>;
  models_ok?: boolean;
  text_ok?: boolean;
  text?: string;
  model?: string;
  message?: string;
  error?: string;
  docker_hint?: string;
  models_error?: string;
  text_error?: string;
  provider_config?: {
    mode?: string;
    auth_type?: string;
    auth_header?: string;
    text_model?: string;
    image_model?: string;
    timeout_ms?: number;
    enabled?: boolean;
    api_key_set?: boolean;
  };
};

export type ModelProviderModelsResult = {
  models?: Array<string | { id?: string; name?: string }>;
  text_models?: Array<string | { id?: string; name?: string }>;
  image_models?: Array<string | { id?: string; name?: string }>;
  video_models?: Array<string | { id?: string; name?: string }>;
  audio_models?: Array<string | { id?: string; name?: string }>;
  default_text_model?: string | { id?: string; name?: string };
  default_image_model?: string | { id?: string; name?: string };
  default_video_model?: string | { id?: string; name?: string };
  default_audio_model?: string | { id?: string; name?: string };
  docker_hint?: string;
};

export type AdminMonitoringUser = {
  user_id: string;
  username: string;
  user_display_name?: string;
  requests: number;
  successes: number;
  errors: number;
  outputs: number;
  units: number;
  last_request_at?: string;
};

export type AdminMonitoringModel = {
  model: string;
  operation: string;
  requests: number;
  successes: number;
  errors: number;
  outputs: number;
  units: number;
  avg_duration_ms: number;
};

export type AdminMonitoringRequestLog = {
  id: string;
  request_id: string;
  username: string;
  operation: string;
  model: string;
  status: string;
  http_status: number;
  error_message?: string;
  created_at: string;
};

export type AdminMonitoringData = {
  generated_at: string;
  window: { hours: number; since: string; bucket_size: string };
  health: { storage: string; db: string; db_ok: boolean; db_error?: string; request_id?: string };
  storage_stats: { users: number; projects: number; snapshots: number; assets: number; ai_requests: number };
  summary: {
    total_requests: number;
    success_requests: number;
    error_requests: number;
    total_duration_ms: number;
    total_output_count: number;
    total_units: number;
    latest_request_time?: string;
  };
  users: AdminMonitoringUser[];
  models: AdminMonitoringModel[];
  operations: Array<{ operation: string; requests: number; errors: number; units: number }>;
  buckets: Array<{ bucket: string; requests: number; errors: number; avg_duration: number }>;
  recent: AdminMonitoringRequestLog[];
  logs: Array<{ source: string; line: string }>;
};

export async function listAdminUsers() {
  return request<AdminUser[]>("/api/admin/users");
}

export async function createAdminUser(payload: AdminUserPayload) {
  return request<AdminUser>("/api/admin/users", { method: "POST", body: payload });
}

export async function updateAdminUser(id: string, payload: Partial<AdminUserPayload>) {
  return request<AdminUser>(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PUT", body: payload });
}

export async function listModelProviderPresets() {
  const result = await request<{ presets?: ModelProviderPreset[] }>("/api/admin/model-provider-presets");
  return result.presets || [];
}

export async function listModelProviders() {
  const result = await request<{ providers?: ModelProviderConfig[] }>("/api/admin/model-providers");
  return (result.providers || []).map(normalizeModelProviderConfig);
}

export async function createModelProvider(payload: ModelProviderPayload) {
  return normalizeModelProviderConfig(await request<ModelProviderConfig>("/api/admin/model-providers", { method: "POST", body: payload }));
}

export async function updateModelProvider(id: string, payload: ModelProviderPayload) {
  return normalizeModelProviderConfig(await request<ModelProviderConfig>(`/api/admin/model-providers/${encodeURIComponent(id)}`, { method: "PUT", body: payload }));
}

export async function deleteModelProvider(id: string) {
  return request<{ deleted: boolean; id: string }>(`/api/admin/model-providers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function testModelProvider(payload: ModelProviderPayload) {
  try {
    return normalizeModelProviderTestResult(await request<ModelProviderTestResult>("/api/admin/model-provider/test", { method: "POST", body: payload }));
  } catch (error) {
    if (error instanceof ApiError && isRecord(error.details)) {
      return normalizeModelProviderTestResult({ ok: false, error: error.message, ...error.details } as ModelProviderTestResult);
    }
    throw error;
  }
}

export async function testModelProviderById(id: string, payload: ModelProviderPayload) {
  try {
    return normalizeModelProviderTestResult(await request<ModelProviderTestResult>(`/api/admin/model-providers/${encodeURIComponent(id)}/test`, { method: "POST", body: payload }));
  } catch (error) {
    if (error instanceof ApiError && isRecord(error.details)) {
      return normalizeModelProviderTestResult({ ok: false, error: error.message, ...error.details } as ModelProviderTestResult);
    }
    throw error;
  }
}

export async function fetchModelProviderModelsById(id: string, payload: ModelProviderPayload) {
  const result = await request<ModelProviderModelsResult>(`/api/admin/model-providers/${encodeURIComponent(id)}/models`, { method: "POST", body: payload });
  return normalizeProviderModelsResult(result);
}

export async function fetchModelProviderModels(payload: ModelProviderPayload) {
  const result = await request<ModelProviderModelsResult>("/api/admin/model-provider/models", { method: "POST", body: payload });
  return normalizeProviderModelsResult(result);
}

export async function fetchAdminMonitoring(hours = 24) {
  const result = await request<Partial<AdminMonitoringData> | null>("/api/admin/monitoring", { query: { hours } });
  return normalizeAdminMonitoringData(result, hours);
}

function normalizeModelProviderConfig(config: ModelProviderConfig): ModelProviderConfig {
  return {
    ...config,
    id: config.id || "default",
    name: config.name || (config.id === "default" || !config.id ? "默认兼容 Provider" : config.id),
    provider_type: config.provider_type || "openai_compatible",
    capabilities: config.capabilities || ["text", "image"],
    models_by_capability: config.models_by_capability || {},
    model_aliases: config.model_aliases || {},
    model_protocols: config.model_protocols || {},
    default_for: config.default_for || [],
    endpoint_overrides: config.endpoint_overrides || {},
    extra_headers: config.extra_headers || {},
    timeout_ms: Math.min(600_000, Math.max(30_000, Number(config.timeout_ms) || 300_000)),
    max_concurrency: Math.min(
      MAX_PROVIDER_MAX_CONCURRENCY,
      Math.max(MIN_PROVIDER_MAX_CONCURRENCY, Number(config.max_concurrency) || DEFAULT_PROVIDER_MAX_CONCURRENCY),
    ),
    api_key_configured: Boolean(config.api_key_configured ?? config.api_key_set),
    enabled: config.enabled !== false,
  };
}

export function normalizeProviderStringMap(value: Record<string, unknown> | undefined) {
  return Object.fromEntries(
    Object.entries(value || {})
      .map(([key, item]) => [key.trim(), typeof item === "string" ? item.trim() : ""])
      .filter(([key, item]) => key && item),
  );
}

export function buildModelProviderPayload(
  config: ModelProviderConfig,
  credentials: { apiKey?: string; secrets?: Record<string, string> } = {},
): ModelProviderPayload {
  const {
    api_key_configured: _apiKeyConfigured,
    api_key_set: _apiKeySet,
    secrets_set: _secretsSet,
    configured: _configured,
    created_at: _createdAt,
    updated_at: _updatedAt,
    ...source
  } = config;
  const capabilities = Array.from(new Set(source.capabilities || []));
  const defaults: Record<ModelCapability, string> = {
    text: source.text_model?.trim() || "",
    image: source.image_model?.trim() || "",
    video: source.video_model?.trim() || "",
    audio: source.audio_model?.trim() || "",
  };
  const modelsByCapability = Object.fromEntries(
    capabilities.map((capability) => [
      capability,
      Array.from(new Set([defaults[capability], ...(source.models_by_capability?.[capability] || [])].map((item) => item.trim()).filter(Boolean))),
    ]),
  ) as Partial<Record<ModelCapability, string[]>>;
  const cleanSecrets = normalizeProviderStringMap(credentials.secrets);
  const apiKey = credentials.apiKey?.trim();

  return {
    ...source,
    id: source.id?.trim() || undefined,
    name: source.name?.trim() || "",
    base_url: source.base_url.trim(),
    capabilities,
    models_by_capability: modelsByCapability,
    default_for: Array.from(new Set(source.default_for || [])).filter((capability) => capabilities.includes(capability) && Boolean(defaults[capability])),
    text_model: capabilities.includes("text") ? defaults.text : "",
    image_model: capabilities.includes("image") ? defaults.image : "",
    video_model: capabilities.includes("video") ? defaults.video : "",
    audio_model: capabilities.includes("audio") ? defaults.audio : "",
    model_aliases: normalizeProviderStringMap(source.model_aliases),
    model_protocols: Object.fromEntries(
      Object.entries(source.model_protocols || {})
        .map(([model, protocol]) => [model.trim(), String(protocol || "").trim().toLowerCase()])
        .filter(([model, protocol]) => model && protocol && protocol !== "auto"),
    ) as Record<string, ImageGenerationProtocol>,
    endpoint_overrides: normalizeProviderStringMap(source.endpoint_overrides),
    extra_headers: normalizeProviderStringMap(source.extra_headers),
    timeout_ms: Math.min(600_000, Math.max(30_000, Number(source.timeout_ms) || 300_000)),
    max_concurrency: Math.min(MAX_PROVIDER_MAX_CONCURRENCY, Math.max(MIN_PROVIDER_MAX_CONCURRENCY, Number(source.max_concurrency) || DEFAULT_PROVIDER_MAX_CONCURRENCY)),
    enabled: source.enabled !== false,
    ...(apiKey ? { api_key: apiKey } : {}),
    ...(Object.keys(cleanSecrets).length ? { secrets: cleanSecrets } : {}),
  };
}

export function mergeProviderModels(config: ModelProviderConfig, result: ModelProviderModelsResult): ModelProviderConfig {
  const normalized = normalizeProviderModelsResult(result);
  const capabilities = config.capabilities || [];
  const defaults: Partial<Record<ModelCapability, string>> = {
    text: modelId(normalized.default_text_model) || normalizeModelList(normalized.text_models)[0],
    image: modelId(normalized.default_image_model) || normalizeModelList(normalized.image_models)[0],
    video: modelId(normalized.default_video_model) || normalizeModelList(normalized.video_models)[0],
    audio: modelId(normalized.default_audio_model) || normalizeModelList(normalized.audio_models)[0],
  };
  const pulled: Partial<Record<ModelCapability, string[]>> = {
    text: normalizeModelList(normalized.text_models),
    image: normalizeModelList(normalized.image_models),
    video: normalizeModelList(normalized.video_models),
    audio: normalizeModelList(normalized.audio_models),
  };
  const next = { ...config, models_by_capability: { ...(config.models_by_capability || {}) } };
  for (const capability of ["text", "image", "video", "audio"] as const) {
    next.models_by_capability![capability] = Array.from(new Set([...(config.models_by_capability?.[capability] || []), ...(pulled[capability] || [])]));
    const field = `${capability}_model` as const;
    if (capabilities.includes(capability) && !next[field] && defaults[capability]) next[field] = defaults[capability];
  }
  return next;
}

export function normalizeProviderModelsResult(result: ModelProviderModelsResult): ModelProviderModelsResult {
  return {
    ...result,
    models: normalizeModelList(result.models),
    text_models: normalizeModelList(result.text_models === undefined ? result.models : result.text_models),
    image_models: normalizeModelList(result.image_models || []),
    video_models: normalizeModelList(result.video_models || []),
    audio_models: normalizeModelList(result.audio_models || []),
  };
}

function normalizeModelProviderTestResult(result: ModelProviderTestResult): ModelProviderTestResult {
  return {
    ...result,
    ok: result.ok ?? (result.models_ok !== false && result.text_ok !== false),
    models: normalizeModelList(result.models),
    message: result.message || result.error,
  };
}

function normalizeAdminMonitoringData(data: Partial<AdminMonitoringData> | null, fallbackHours: number): AdminMonitoringData {
  return {
    generated_at: stringValue(data?.generated_at, new Date().toISOString()),
    window: {
      hours: numberValue(data?.window?.hours, fallbackHours),
      since: stringValue(data?.window?.since, ""),
      bucket_size: stringValue(data?.window?.bucket_size, ""),
    },
    health: {
      storage: stringValue(data?.health?.storage, "-"),
      db: stringValue(data?.health?.db, "-"),
      db_ok: Boolean(data?.health?.db_ok),
      db_error: stringValue(data?.health?.db_error, ""),
      request_id: stringValue(data?.health?.request_id, ""),
    },
    storage_stats: {
      users: numberValue(data?.storage_stats?.users, 0),
      projects: numberValue(data?.storage_stats?.projects, 0),
      snapshots: numberValue(data?.storage_stats?.snapshots, 0),
      assets: numberValue(data?.storage_stats?.assets, 0),
      ai_requests: numberValue(data?.storage_stats?.ai_requests, 0),
    },
    summary: {
      total_requests: numberValue(data?.summary?.total_requests, 0),
      success_requests: numberValue(data?.summary?.success_requests, 0),
      error_requests: numberValue(data?.summary?.error_requests, 0),
      total_duration_ms: numberValue(data?.summary?.total_duration_ms, 0),
      total_output_count: numberValue(data?.summary?.total_output_count, 0),
      total_units: numberValue(data?.summary?.total_units, 0),
      latest_request_time: stringValue(data?.summary?.latest_request_time, ""),
    },
    users: Array.isArray(data?.users) ? data.users : [],
    models: Array.isArray(data?.models) ? data.models : [],
    operations: Array.isArray(data?.operations) ? data.operations : [],
    buckets: Array.isArray(data?.buckets) ? data.buckets : [],
    recent: Array.isArray(data?.recent) ? data.recent : [],
    logs: Array.isArray(data?.logs) ? data.logs : [],
  };
}

function numberValue(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value ? value : fallback;
}

function modelId(value: string | { id?: string; name?: string } | undefined) {
  if (typeof value === "string") return value.trim();
  return String(value?.id || value?.name || "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
