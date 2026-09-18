/** Versioned documents edit the host's live fields; no second configuration store. */
export const CONFIG_VERSION = 1;
export const MAX_CONFIG_BYTES = 64 * 1024;
export const capabilities = ["text", "image", "video", "audio"] as const;
export type Capability = (typeof capabilities)[number];
export const capabilityLabels: Record<Capability, string> = {
  text: "文本 / LLM",
  image: "图像",
  video: "视频",
  audio: "音频",
};
export const imageProtocols = [
  "auto",
  "openai_images",
  "openai_responses",
  "openai_chat_completions",
  "gemini_generate_content",
  "dashscope_multimodal",
  "stability_image",
] as const;
export type ProviderRecord = {
  id?: string;
  name?: string;
  capabilities?: Capability[];
  enabled: boolean;
  base_url: string;
  models_by_capability?: Partial<Record<Capability, string[]>>;
  text_model?: string;
  image_model?: string;
  video_model?: string;
  audio_model?: string;
  sdvideo_models?: Array<{
    key: string;
    name: string;
    model_id: string;
    enabled: boolean;
    concurrency_limit: number;
    version: number;
    upstream_provider?: string;
    credentials_configured?: boolean;
  }>;
};
export type ConfigDocument = {
  schema_version: 1;
  adapter: "studio" | "sdvideo";
  config: Record<string, unknown>;
};
export type ParseResult =
  { ok: true; document: ConfigDocument } | { ok: false; error: string };
export const studioFields = [
  "name",
  "preset_id",
  "provider_type",
  "mode",
  "base_url",
  "auth_type",
  "custom_auth_header",
  "auth_query_param",
  "text_model",
  "image_model",
  "video_model",
  "audio_model",
  "capabilities",
  "models_by_capability",
  "model_aliases",
  "model_protocols",
  "default_for",
  "endpoint_overrides",
  "extra_headers",
  "timeout_ms",
  "max_concurrency",
  "enabled",
] as const;
const stringFields = new Set<string>(studioFields.slice(0, 12));
const stringMaps = new Set([
  "model_aliases",
  "model_protocols",
  "endpoint_overrides",
  "extra_headers",
]);
// Adapted from CC Switch's object-only JSON validation and forbidden merge keys.
// Copyright (c) 2025 Jason Young. See THIRD_PARTY_NOTICES.md and licenses/cc-switch.MIT.
const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
export const isSensitiveKey = (key: string) =>
  /^(authorization|proxyauthorization|cookie|setcookie|apikey|xapikey|xgoogapikey|token|accesstoken|refreshtoken|secret|clientsecret|password|privatekey|accesskey|secretkey|accesskeyid|secretaccesskey)$/i.test(
    key.replace(/[-_\s]/g, ""),
  );
function safeTree(value: unknown, depth = 0): void {
  if (depth > 12) throw new Error("配置嵌套过深");
  if (value === null) throw new Error("配置字段不能为 null");
  if (Array.isArray(value)) {
    value.forEach((item) => safeTree(item, depth + 1));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) throw new Error("配置包含不允许的对象字段");
    safeTree(item, depth + 1);
  }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function checkURL(value: string): void {
  const url = new URL(value);
  assert(
    ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password,
    "地址必须为不含凭据的 HTTP(S) URL",
  );
  for (const key of url.searchParams.keys())
    assert(!isSensitiveKey(key) && key !== "key", "地址中的凭据请移至密钥表单");
}
function checkStringMap(value: unknown, field: string): void {
  assert(
    isRecord(value) &&
      Object.values(value).every((item) => typeof item === "string"),
    `${field} 必须是字符串映射`,
  );
  if (field === "extra_headers")
    for (const key of Object.keys(value))
      assert(!isSensitiveKey(key), "鉴权 Header 请通过密钥表单配置");
  if (field === "model_protocols")
    for (const item of Object.values(value))
      assert(
        imageProtocols.includes(item as (typeof imageProtocols)[number]),
        "不支持的图像协议",
      );
  if (field === "endpoint_overrides")
    for (const [key, item] of Object.entries(value)) {
      assert(!isSensitiveKey(key), "端点中的凭据请移至密钥表单");
      if (typeof item === "string" && /^https?:/i.test(item)) checkURL(item);
      else if (typeof item === "string" && item.includes("?")) {
        for (const key of new URLSearchParams(item.split("?")[1]).keys())
          assert(
            !isSensitiveKey(key) && key !== "key",
            "端点中的凭据请移至密钥表单",
          );
      }
    }
}
function checkSDVideo(config: Record<string, unknown>): void {
  assert(
    Object.keys(config).every((key) => key === "sdvideo_models"),
    "SD-video 仅支持编辑模型配置，通道与密钥由服务管理",
  );
  const models = config.sdvideo_models;
  assert(
    Array.isArray(models) && models.length > 0,
    "sdvideo_models 必须是非空数组",
  );
  const seen = new Set<string>();
  for (const model of models) {
    assert(isRecord(model), "模型必须是对象");
    assert(
      Object.keys(model).every((key) =>
        [
          "key",
          "name",
          "model_id",
          "enabled",
          "concurrency_limit",
          "version",
        ].includes(key),
      ),
      "SD-video 模型包含不支持的字段",
    );
    for (const key of ["key", "name", "model_id"])
      assert(
        typeof model[key] === "string" && (model[key] as string).trim(),
        "模型标识与名称不能为空",
      );
    assert(!seen.has(model.key as string), "模型 key 不能重复");
    seen.add(model.key as string);
    assert(typeof model.enabled === "boolean", "enabled 必须是布尔值");
    assert(
      Number.isInteger(model.version) && Number(model.version) >= 1,
      "version 必须保留服务返回的版本号",
    );
    assert(
      Number.isInteger(model.concurrency_limit) &&
        Number(model.concurrency_limit) >= 1 &&
        Number(model.concurrency_limit) <= 16,
      "SD-video 并发范围为 1–16",
    );
  }
}
export function parseConfigDocument(
  text: string,
  expectedAdapter?: ConfigDocument["adapter"],
): ParseResult {
  try {
    assert(
      new TextEncoder().encode(text).length <= MAX_CONFIG_BYTES,
      "配置不能超过 64 KiB",
    );
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("JSON 语法错误，请检查引号、逗号和括号");
    }
    assert(isRecord(value), "配置必须是 JSON 对象");
    safeTree(value);
    assert(
      Object.keys(value).every((key) =>
        ["schema_version", "adapter", "config"].includes(key),
      ),
      "文档包含不支持的字段",
    );
    assert(value.schema_version === CONFIG_VERSION, "不支持的 schema_version");
    assert(
      value.adapter === "studio" || value.adapter === "sdvideo",
      "不支持的 adapter",
    );
    assert(
      !expectedAdapter || expectedAdapter === value.adapter,
      "不能将不同适配器的配置互相导入",
    );
    assert(isRecord(value.config), "config 必须是对象");
    if (value.adapter === "sdvideo") checkSDVideo(value.config);
    else {
      for (const [key, item] of Object.entries(value.config)) {
        assert(
          studioFields.includes(key as (typeof studioFields)[number]),
          "config 包含不支持的字段；密钥请在表单中填写",
        );
        if (stringFields.has(key))
          assert(typeof item === "string", `${key} 必须是字符串`);
        if (stringMaps.has(key)) checkStringMap(item, key);
        if (key === "capabilities" || key === "default_for")
          assert(
            Array.isArray(item) &&
              item.every((entry) => capabilities.includes(entry)),
            `${key} 仅支持 text/image/video/audio`,
          );
        if (key === "models_by_capability") {
          assert(isRecord(item), "models_by_capability 必须是对象");
          for (const [cap, models] of Object.entries(item))
            assert(
              capabilities.includes(cap as Capability) &&
                Array.isArray(models) &&
                models.every((model) => typeof model === "string"),
              "模型列表必须按能力分类且为字符串数组",
            );
        }
        if (key === "enabled")
          assert(typeof item === "boolean", "enabled 必须是布尔值");
        if (key === "timeout_ms")
          assert(
            Number.isInteger(item) &&
              Number(item) >= 30_000 &&
              Number(item) <= 600_000,
            "超时范围为 30000–600000 ms",
          );
        if (key === "max_concurrency")
          assert(
            Number.isInteger(item) && Number(item) >= 1 && Number(item) <= 8,
            "并发范围为 1–8",
          );
      }
      assert(
        typeof value.config.name === "string" && value.config.name.trim(),
        "请填写 name",
      );
      assert(typeof value.config.base_url === "string", "请填写 base_url");
      checkURL(value.config.base_url);
      const enums: Record<string, readonly string[]> = {
        mode: ["local_openai", "openai_compatible"],
        provider_type: [
          "openai_compatible",
          "volcengine_ark",
          "gemini_media",
          "kling_video",
          "minimax_hailuo",
          "fal_happyhorse",
          "xai_imagine",
          "aliyun_yike",
        ],
        auth_type: [
          "none",
          "bearer",
          "x_api_key",
          "x_goog_api_key",
          "auto_api_key",
          "custom_header",
          "query_param",
        ],
      };
      for (const [key, options] of Object.entries(enums))
        if (key in value.config)
          assert(
            options.includes(value.config[key] as string),
            `${key} 不支持此值`,
          );
    }
    return { ok: true, document: value as ConfigDocument };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message !== "Invalid URL"
          ? error.message
          : "URL 格式错误",
    };
  }
}
export function toConfigDocument(provider: ProviderRecord): ConfigDocument {
  if (provider.sdvideo_models)
    return {
      schema_version: CONFIG_VERSION,
      adapter: "sdvideo",
      config: {
        sdvideo_models: provider.sdvideo_models.map(
          ({ key, name, model_id, enabled, concurrency_limit, version }) => ({
            key,
            name,
            model_id,
            enabled,
            concurrency_limit,
            version,
          }),
        ),
      },
    };
  const source = provider as unknown as Record<string, unknown>;
  const config = Object.fromEntries(
    studioFields
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  );
  if (isRecord(config.extra_headers))
    config.extra_headers = Object.fromEntries(
      Object.entries(config.extra_headers).filter(
        ([key]) => !isSensitiveKey(key),
      ),
    );
  // Do not display URLs containing credentials from older configurations.
  for (const key of ["base_url"])
    if (typeof config[key] === "string") {
      try {
        checkURL(config[key]);
      } catch {
        config[key] = "";
      }
    }
  if (isRecord(config.endpoint_overrides))
    config.endpoint_overrides = Object.fromEntries(
      Object.entries(config.endpoint_overrides).filter(([key, value]) => {
        if (isSensitiveKey(key)) return false;
        try {
          checkStringMap({ [key]: value }, "endpoint_overrides");
          return true;
        } catch {
          return false;
        }
      }),
    );
  return { schema_version: CONFIG_VERSION, adapter: "studio", config };
}
export function mergeConfigDocument<T extends ProviderRecord>(
  current: T,
  document: ConfigDocument,
): T {
  if (document.adapter === "sdvideo") {
    const edits = document.config.sdvideo_models as NonNullable<
      ProviderRecord["sdvideo_models"]
    >;
    const existing = current.sdvideo_models || [];
    assert(
      edits.length === existing.length &&
        edits.every((edit) =>
          existing.some(
            (item) => item.key === edit.key && item.version === edit.version,
          ),
        ),
      "模型或版本已变化，请刷新配置后重试",
    );
    return {
      ...current,
      sdvideo_models: existing.map((item) => ({
        ...item,
        ...edits.find((edit) => edit.key === item.key)!,
      })),
    };
  }
  return { ...current, ...document.config };
}
