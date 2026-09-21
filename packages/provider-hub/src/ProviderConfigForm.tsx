import { useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Plus,
  RefreshCw,
  Search,
  Server,
  SlidersHorizontal,
  Star,
  Trash2,
  Video,
} from "lucide-react";
import {
  capabilities,
  capabilityLabels,
  imageProtocols,
  type Capability,
  type ConfigDocument,
  type ProviderRecord,
} from "./config";

export type ProviderPreset = {
  id: string;
  name: string;
  description?: string;
  config: Record<string, unknown>;
};
const providerTypes = {
  openai_compatible: "OpenAI Compatible",
  volcengine_ark: "火山方舟",
  gemini_media: "Gemini",
  kling_video: "可灵",
  minimax_hailuo: "MiniMax / 海螺",
  fal_happyhorse: "fal / HappyHorse",
  xai_imagine: "xAI Imagine",
  aliyun_yike: "阿里云 Wan",
};
const protocolLabels: Record<string, string> = {
  auto: "自动识别",
  openai_images: "OpenAI Images",
  openai_responses: "OpenAI Responses",
  openai_chat_completions: "OpenAI Chat Completions",
  gemini_generate_content: "Gemini generateContent",
  dashscope_multimodal: "DashScope Multimodal",
  stability_image: "Stability Image",
};
const authTypes = {
  bearer: "Bearer Token",
  x_api_key: "X-API-Key",
  x_goog_api_key: "Google API Key",
  auto_api_key: "自动兼容 API Key",
  custom_header: "自定义 Header",
  query_param: "Query 参数",
  none: "无需鉴权",
};
const channelLabels: Record<string, string> = {
  legacy_proxy: "公司通道",
  tokenspace: "TokenSpace",
  ark_official: "火山方舟",
};
const MIN_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_CONCURRENCY = 8;
const MAX_VIDEO_CONCURRENCY = 16;
/** Limit rendered rows only; every configured model stays in the saved document. */
const MODEL_PAGE_SIZE = 50;
/** One form shared by the Studio host and standalone package. Secrets remain host-owned. */
export function ProviderConfigForm({
  document,
  onChange,
  busy,
  presets = [],
  credentials,
  provider,
  onPresetChange,
  onFetchModels,
  onSave,
}: {
  document: ConfigDocument;
  onChange: (value: ConfigDocument) => void;
  busy?: boolean;
  presets?: ProviderPreset[];
  credentials?: ReactNode;
  provider?: ProviderRecord;
  onPresetChange?: (preset: ProviderPreset | undefined) => void;
  onFetchModels?: () => void;
  onSave?: () => void;
}) {
  const config = document.config;
  const update = (key: string, value: unknown) =>
    onChange({ ...document, config: { ...config, [key]: value } });
  const selected = (config.capabilities || []) as Capability[];
  const [modelCapability, setModelCapability] = useState<Capability>(
    selected[0] || "text",
  );
  const currentCapability = selected.includes(modelCapability)
    ? modelCapability
    : selected[0];
  const [newModel, setNewModel] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [modelPage, setModelPage] = useState(0);
  const [modelNotice, setModelNotice] = useState("");
  const [expandedModel, setExpandedModel] = useState("");
  const [presetSearch, setPresetSearch] = useState("");
  const modelsByCapability = (config.models_by_capability || {}) as Partial<
    Record<Capability, string[]>
  >;
  const aliases = (config.model_aliases || {}) as Record<string, string>;
  const protocols = (config.model_protocols || {}) as Record<string, string>;
  const defaultModel = String(config[`${currentCapability}_model`] || "");
  const modelIDs = [
    ...new Set(
      [...(modelsByCapability[currentCapability] || []), defaultModel].filter(
        Boolean,
      ),
    ),
  ];
  const modelQuery = modelSearch.trim().toLowerCase();
  const matchingModelIDs = modelIDs.filter((id) =>
    `${id} ${aliases[id] || ""}`.toLowerCase().includes(modelQuery),
  );
  const pageCount = Math.max(
    1,
    Math.ceil(matchingModelIDs.length / MODEL_PAGE_SIZE),
  );
  const currentPage = Math.min(modelPage, pageCount - 1);
  const pageStart = currentPage * MODEL_PAGE_SIZE;
  const visibleModelIDs = matchingModelIDs.slice(
    pageStart,
    pageStart + MODEL_PAGE_SIZE,
  );
  const setModelList = (models: string[]) =>
    onChange({
      ...document,
      config: {
        ...config,
        models_by_capability: {
          ...modelsByCapability,
          [currentCapability]: models,
        },
        [`${currentCapability}_model`]: models.includes(defaultModel)
          ? defaultModel
          : models[0] || "",
      },
    });
  const addModels = () => {
    const requested = [
      ...new Set(
        newModel
          .split(/[,，;；\n]+/)
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ];
    if (!requested.length) {
      setModelNotice("请输入有效的模型 ID。");
      return;
    }
    const existing = new Set(modelIDs);
    const added = requested.filter((id) => !existing.has(id));
    const repeated = requested.length - added.length;
    if (added.length) {
      setModelList([...modelIDs, ...added]);
      setModelSearch("");
      setModelPage(Math.floor(modelIDs.length / MODEL_PAGE_SIZE));
      setModelNotice(
        `已添加 ${added.length} 个${capabilityLabels[currentCapability]}模型${repeated ? `，${repeated} 个已存在` : ""}，保存配置后生效。`,
      );
    } else {
      // Show the existing row instead of silently clearing a duplicate ID.
      setModelSearch(requested[0]);
      setModelPage(0);
      setModelNotice("模型已在当前类别中，已定位到该模型，无需重复添加。");
    }
    setNewModel("");
  };
  if (document.adapter === "sdvideo") {
    const models = config.sdvideo_models as NonNullable<
      ProviderRecord["sdvideo_models"]
    >;
    const updateModel = (
      key: string,
      value: Partial<(typeof models)[number]>,
    ) =>
      update(
        "sdvideo_models",
        models.map((model) =>
          model.key === key ? { ...model, ...value } : model,
        ),
      );
    const visible = models.filter((model) =>
      `${model.name} ${model.model_id}`
        .toLowerCase()
        .includes(modelSearch.toLowerCase()),
    );
    return (
      <fieldset className="hub-form" disabled={busy}>
        <div className="hub-section-heading">
          <div>
            <h3>视频模型</h3>
            <p>
              {models.length} 个模型 ·{" "}
              {models.filter((model) => model.enabled).length} 个启用
            </p>
          </div>
          <div className="hub-actions">
            <button
              type="button"
              onClick={() =>
                update(
                  "sdvideo_models",
                  models.map((model) => ({ ...model, enabled: true })),
                )
              }
            >
              全部启用
            </button>
            <button
              type="button"
              onClick={() =>
                update(
                  "sdvideo_models",
                  models.map((model) => ({ ...model, enabled: false })),
                )
              }
            >
              全部停用
            </button>
          </div>
        </div>
        <label className="hub-search">
          <Search size={16} />
          <input
            type="search"
            aria-label="搜索视频模型"
            placeholder="搜索模型名称或 ID…"
            value={modelSearch}
            onChange={(event) => setModelSearch(event.target.value)}
          />
        </label>
        <div className="hub-managed-models">
          {visible.map((model) => {
            const metadata = provider?.sdvideo_models?.find(
              (item) => item.key === model.key,
            );
            const expanded = expandedModel === model.key;
            return (
              <div className="hub-managed-model" key={model.key}>
                <div className="hub-managed-summary">
                  <Video size={20} />
                  <button
                    type="button"
                    className="hub-model-expand"
                    aria-expanded={expanded}
                    onClick={() => setExpandedModel(expanded ? "" : model.key)}
                  >
                    <span>
                      <strong>{model.name}</strong>
                      <small>{model.model_id}</small>
                    </span>
                    <ChevronRight
                      size={16}
                      className={expanded ? "hub-rotate" : ""}
                    />
                  </button>
                  <span className="hub-channel">
                    {channelLabels[metadata?.upstream_provider || ""] ||
                      metadata?.upstream_provider ||
                      "视频服务"}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={model.enabled}
                    aria-label={`${model.name} 启用`}
                    className="hub-switch"
                    onClick={() =>
                      updateModel(model.key, { enabled: !model.enabled })
                    }
                  >
                    <span />
                  </button>
                </div>
                {expanded && (
                  <div className="hub-model-fields">
                    <label>
                      显示名称
                      <input
                        value={model.name}
                        onChange={(event) =>
                          updateModel(model.key, { name: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      模型 ID
                      <input
                        value={model.model_id}
                        onChange={(event) =>
                          updateModel(model.key, {
                            model_id: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      并发上限
                      <input
                        type="number"
                        min={1}
                        max={MAX_VIDEO_CONCURRENCY}
                        value={model.concurrency_limit}
                        onChange={(event) =>
                          updateModel(model.key, {
                            concurrency_limit: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    {metadata?.credentials_configured === false && (
                      <p className="hub-model-note">此通道尚未配置凭据。</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {!visible.length && <p className="hub-empty">没有匹配的模型</p>}
        </div>
        {onSave && (
          <button type="button" className="hub-primary" onClick={onSave}>
            保存配置
          </button>
        )}
      </fieldset>
    );
  }
  return (
    <fieldset className="hub-form" disabled={busy}>
      <section className="hub-form-section">
        <div className="hub-section-heading">
          <h3>预设供应商</h3>
          <label className="hub-search hub-search-small">
            <Search size={15} />
            <input
              type="search"
              aria-label="搜索预设"
              placeholder="搜索预设…"
              value={presetSearch}
              onChange={(event) => setPresetSearch(event.target.value)}
            />
          </label>
        </div>
        <div className="hub-presets">
          <button
            type="button"
            aria-pressed={!config.preset_id}
            onClick={() => {
              update("preset_id", "");
              onPresetChange?.(undefined);
            }}
          >
            <SlidersHorizontal size={16} />
            自定义配置
          </button>
          {presets
            .filter(
              (preset) =>
                (!selected.length ||
                  ((preset.config.capabilities || []) as Capability[]).some(
                    (cap) => selected.includes(cap),
                  )) &&
                preset.name.toLowerCase().includes(presetSearch.toLowerCase()),
            )
            .map((preset) => (
              <button
                type="button"
                key={preset.id}
                aria-pressed={config.preset_id === preset.id}
                onClick={() => {
                  onChange({
                    ...document,
                    config: {
                      ...config,
                      ...preset.config,
                      preset_id: preset.id,
                      name: provider?.id ? config.name : preset.name,
                    },
                  });
                  onPresetChange?.(preset);
                }}
              >
                <Server size={16} />
                {preset.name}
              </button>
            ))}
        </div>
        {presets.find((preset) => preset.id === config.preset_id)
          ?.description && (
          <p className="hub-help">
            {
              presets.find((preset) => preset.id === config.preset_id)
                ?.description
            }
          </p>
        )}
      </section>
      <section className="hub-form-section">
        <div className="hub-form-grid">
          <label>
            供应商名称
            <input
              required
              value={String(config.name || "")}
              placeholder="例如：公司模型服务"
              onChange={(event) => update("name", event.target.value)}
            />
          </label>
          <label>
            API 地址
            <input
              required
              type="url"
              value={String(config.base_url || "")}
              placeholder="https://api.example.com/v1"
              onChange={(event) => update("base_url", event.target.value)}
            />
          </label>
          {credentials}
        </div>
        <div className="hub-enabled-row">
          <div>
            <strong>启用供应商</strong>
            <p>启用后，已配置的模型会出现在生成页面。</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={config.enabled !== false}
            aria-label="启用供应商"
            className="hub-switch"
            onClick={() => update("enabled", config.enabled === false)}
          >
            <span />
          </button>
        </div>
      </section>
      <section className="hub-form-section">
        <div className="hub-section-heading">
          <div>
            <h3>模型</h3>
            <p>选择能力，添加模型 ID。星标为当前能力的默认模型。</p>
          </div>
          {onFetchModels && (
            <button type="button" onClick={onFetchModels}>
              <RefreshCw size={15} />
              拉取模型
            </button>
          )}
        </div>
        <div className="hub-capability-choices">
          {capabilities.map((cap) => (
            <label key={cap}>
              <input
                type="checkbox"
                checked={selected.includes(cap)}
                onChange={(event) =>
                  update(
                    "capabilities",
                    event.target.checked
                      ? [...selected, cap]
                      : selected.filter((item) => item !== cap),
                  )
                }
              />
              {capabilityLabels[cap]}
            </label>
          ))}
        </div>
        {!!selected.length && (
          <>
            <div className="hub-model-tabs" aria-label="编辑模型能力">
              {selected.map((cap) => (
                <button
                  type="button"
                  key={cap}
                  aria-pressed={currentCapability === cap}
                  onClick={() => {
                    setModelCapability(cap);
                    setNewModel("");
                    setModelSearch("");
                    setModelPage(0);
                    setModelNotice("");
                  }}
                >
                  {capabilityLabels[cap]}
                </button>
              ))}
            </div>
            <div className="hub-model-toolbar">
              <label className="hub-search">
                <Search size={16} />
                <input
                  type="search"
                  aria-label="搜索已配置模型"
                  placeholder="搜索模型名称或 ID…"
                  value={modelSearch}
                  onChange={(event) => {
                    setModelSearch(event.target.value);
                    setModelPage(0);
                  }}
                />
              </label>
              <span className="hub-help" role="status">
                共 {modelIDs.length} 个{capabilityLabels[currentCapability]}模型
                {modelQuery && ` · 匹配 ${matchingModelIDs.length} 个`}
              </span>
            </div>
            <div className="hub-model-table">
              {visibleModelIDs.map((id) => (
                <div
                  className="hub-model-entry"
                  key={`${currentCapability}/${id}`}
                >
                  <code title={id}>{id}</code>
                  <input
                    aria-label={`${id} 显示名称`}
                    placeholder="显示名称（可选）"
                    value={aliases[id] || ""}
                    onChange={(event) =>
                      update("model_aliases", {
                        ...aliases,
                        [id]: event.target.value,
                      })
                    }
                  />
                  {currentCapability === "image" && (
                    <select
                      aria-label={`${id} 图像协议`}
                      value={protocols[id] || "auto"}
                      onChange={(event) =>
                        update("model_protocols", {
                          ...protocols,
                          [id]: event.target.value,
                        })
                      }
                    >
                      {imageProtocols.map((protocol) => (
                        <option key={protocol} value={protocol}>
                          {protocolLabels[protocol]}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    className={`hub-icon-button${defaultModel === id ? " hub-starred" : ""}`}
                    aria-label={`${id} 设为默认模型`}
                    aria-pressed={defaultModel === id}
                    title="设为默认模型"
                    onClick={() => update(`${currentCapability}_model`, id)}
                  >
                    <Star size={16} />
                  </button>
                  <button
                    type="button"
                    className="hub-icon-button"
                    aria-label={`移除模型 ${id}`}
                    title="移除模型"
                    onClick={() =>
                      setModelList(modelIDs.filter((model) => model !== id))
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              {!modelIDs.length && (
                <p className="hub-help">
                  尚未添加{capabilityLabels[currentCapability]}模型。
                </p>
              )}
              {!!modelIDs.length && !matchingModelIDs.length && (
                <p className="hub-help">
                  当前类别没有匹配的模型，可切换能力类别查找或手动添加。
                </p>
              )}
            </div>
            {matchingModelIDs.length > MODEL_PAGE_SIZE && (
              <nav className="hub-model-pagination" aria-label="模型分页">
                <span className="hub-help">
                  显示 {pageStart + 1}–
                  {Math.min(
                    pageStart + MODEL_PAGE_SIZE,
                    matchingModelIDs.length,
                  )}{" "}
                  / {matchingModelIDs.length}
                </span>
                <div className="hub-actions">
                  <button
                    type="button"
                    disabled={currentPage === 0}
                    onClick={() => setModelPage(currentPage - 1)}
                  >
                    上一页
                  </button>
                  <span>
                    {currentPage + 1} / {pageCount}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage === pageCount - 1}
                    onClick={() => setModelPage(currentPage + 1)}
                  >
                    下一页
                  </button>
                </div>
              </nav>
            )}
            <div className="hub-add-model">
              <input
                aria-label="新模型 ID"
                placeholder="输入模型 ID，多个模型用逗号分隔"
                value={newModel}
                onChange={(event) => {
                  setNewModel(event.target.value);
                  setModelNotice("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (!event.nativeEvent.isComposing && newModel.trim())
                      addModels();
                  }
                }}
              />
              <button
                type="button"
                disabled={!newModel.trim()}
                onClick={addModels}
              >
                <Plus size={16} />
                添加
              </button>
            </div>
            {modelNotice && (
              <p className="hub-help" role="status">
                {modelNotice}
              </p>
            )}
            <label className="hub-checkbox-line">
              <input
                type="checkbox"
                checked={((config.default_for || []) as string[]).includes(
                  currentCapability,
                )}
                onChange={(event) =>
                  update(
                    "default_for",
                    event.target.checked
                      ? [
                          ...new Set([
                            ...((config.default_for as string[]) || []),
                            currentCapability,
                          ]),
                        ]
                      : ((config.default_for as string[]) || []).filter(
                          (cap) => cap !== currentCapability,
                        ),
                  )
                }
              />
              将此供应商设为{capabilityLabels[currentCapability]}的默认服务
            </label>
          </>
        )}
      </section>
      <details className="hub-advanced">
        <summary>
          <SlidersHorizontal size={17} />
          <span>
            高级设置<small>鉴权方式、调用协议、端点与并发</small>
          </span>
          <ChevronDown size={16} />
        </summary>
        <div className="hub-advanced-content">
          <div className="hub-form-grid">
            <label>
              调用协议
              <select
                value={String(config.provider_type || "openai_compatible")}
                onChange={(event) =>
                  update("provider_type", event.target.value)
                }
              >
                {Object.entries(providerTypes).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              运行模式
              <select
                value={String(config.mode || "openai_compatible")}
                onChange={(event) => update("mode", event.target.value)}
              >
                <option value="openai_compatible">OpenAI Compatible</option>
                <option value="local_openai">Local OpenAI</option>
              </select>
            </label>
            <label>
              鉴权方式
              <select
                value={String(config.auth_type || "bearer")}
                onChange={(event) => update("auth_type", event.target.value)}
              >
                {Object.entries(authTypes).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {config.auth_type === "custom_header" && (
              <label>
                Header 名称
                <input
                  value={String(config.custom_auth_header || "")}
                  onChange={(event) =>
                    update("custom_auth_header", event.target.value)
                  }
                  placeholder="X-API-Key"
                />
              </label>
            )}
            {config.auth_type === "query_param" && (
              <label>
                Query 参数名称
                <input
                  value={String(config.auth_query_param || "")}
                  onChange={(event) =>
                    update("auth_query_param", event.target.value)
                  }
                  placeholder="key"
                />
              </label>
            )}
            <label>
              超时（秒）
              <input
                type="number"
                min={MIN_TIMEOUT_MS / 1000}
                max={MAX_TIMEOUT_MS / 1000}
                value={Number(config.timeout_ms || 120000) / 1000}
                onChange={(event) =>
                  update("timeout_ms", Number(event.target.value) * 1000)
                }
              />
            </label>
            <label>
              并发上限
              <input
                type="number"
                min={1}
                max={MAX_CONCURRENCY}
                value={Number(config.max_concurrency || 3)}
                onChange={(event) =>
                  update("max_concurrency", Number(event.target.value))
                }
              />
            </label>
          </div>
          <MapFields
            title="请求端点"
            keyLabel="操作名称"
            value={(config.endpoint_overrides || {}) as Record<string, string>}
            placeholder="例如 video_create"
            onChange={(value) => update("endpoint_overrides", value)}
          />
          <MapFields
            title="附加请求头"
            keyLabel="Header 名称"
            value={(config.extra_headers || {}) as Record<string, string>}
            placeholder="例如 X-Tenant"
            onChange={(value) => update("extra_headers", value)}
          />
        </div>
      </details>
      {onSave && (
        <button type="button" className="hub-primary" onClick={onSave}>
          <Check size={16} />
          保存配置
        </button>
      )}
    </fieldset>
  );
}
function MapFields({
  title,
  keyLabel,
  value,
  placeholder,
  onChange,
}: {
  title: string;
  keyLabel: string;
  value: Record<string, string>;
  placeholder: string;
  onChange: (value: Record<string, string>) => void;
}) {
  const [key, setKey] = useState("");
  const [entry, setEntry] = useState("");
  return (
    <section className="hub-map-fields">
      <h4>{title}</h4>
      {Object.entries(value).map(([name, text]) => (
        <div key={name}>
          <code>{name}</code>
          <input
            aria-label={`${title} ${name}`}
            value={text}
            onChange={(event) =>
              onChange({ ...value, [name]: event.target.value })
            }
          />
          <button
            type="button"
            className="hub-icon-button"
            aria-label={`移除${title} ${name}`}
            onClick={() =>
              onChange(
                Object.fromEntries(
                  Object.entries(value).filter(([item]) => item !== name),
                ),
              )
            }
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <div>
        <input
          aria-label={`${title} ${keyLabel}`}
          placeholder={placeholder}
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
        <input
          aria-label={`${title} 值`}
          placeholder="值"
          value={entry}
          onChange={(event) => setEntry(event.target.value)}
        />
        <button
          type="button"
          className="hub-icon-button"
          aria-label={`添加${title}`}
          disabled={!key.trim() || !entry.trim()}
          onClick={() => {
            onChange({ ...value, [key.trim()]: entry.trim() });
            setKey("");
            setEntry("");
          }}
        >
          <Plus size={16} />
        </button>
      </div>
    </section>
  );
}
