import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  capabilities,
  capabilityLabels,
  mergeConfigDocument,
  parseConfigDocument,
  toConfigDocument,
  type Capability,
  type ConfigDocument,
  type ProviderRecord,
} from "./config";

export type ProviderHubProps<T extends ProviderRecord> = {
  providers: T[];
  draft: T;
  busy?: boolean;
  loading?: boolean;
  error?: string;
  onSelect: (provider: T) => void;
  onCreate: () => void;
  onReload: () => void;
  onSaveJSON: (draft: T, document: ConfigDocument) => Promise<boolean>;
  renderForm: () => ReactNode;
};

/** Host owns persistence/authentication; this component never invokes a generation API. */
export function ProviderHub<T extends ProviderRecord>({
  providers,
  draft,
  busy,
  loading,
  error,
  onSelect,
  onCreate,
  onReload,
  onSaveJSON,
  renderForm,
}: ProviderHubProps<T>) {
  const [capability, setCapability] = useState<Capability | "all">("all");
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"form" | "json">("form");
  const canonical = useMemo(
    () => JSON.stringify(toConfigDocument(draft), null, 2),
    [draft],
  );
  const [json, setJSON] = useState(canonical);
  const [source, setSource] = useState(canonical);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = mode === "json" && json !== source;
  useEffect(() => {
    if (!dirty) {
      setJSON(canonical);
      setSource(canonical);
    }
  }, [canonical, dirty]);
  useEffect(() => {
    setSaveError("");
    setNotice("");
  }, [json, draft.id]);
  const validation = useMemo(
    () =>
      parseConfigDocument(json, draft.sdvideo_models ? "sdvideo" : "studio"),
    [json, draft.sdvideo_models],
  );
  const visible = providers.filter(
    (provider) =>
      (capability === "all" || provider.capabilities?.includes(capability)) &&
      `${provider.name} ${provider.id} ${provider.sdvideo_models?.map((model) => `${model.name} ${model.model_id} ${model.upstream_provider}`).join(" ") || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const locked = Boolean(busy || dirty);
  const save = async () => {
    if (!validation.ok) return;
    try {
      if (
        await onSaveJSON(
          mergeConfigDocument(draft, validation.document),
          validation.document,
        )
      ) {
        setSource(json);
        setNotice("配置已保存");
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败");
    }
  };
  const exportDocument = () => {
    if (!validation.ok) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(validation.document, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "provider-config.json";
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="provider-hub">
      <header className="hub-header">
        <div>
          <p className="hub-eyebrow">PROVIDER HUB</p>
          <h1>模型接入</h1>
          <p>按能力管理服务商、模型和调用配置。</p>
        </div>
        <div className="hub-actions">
          <button disabled={locked || loading} onClick={onReload}>
            刷新
          </button>
          <button className="hub-primary" disabled={locked} onClick={onCreate}>
            ＋ 新建 Provider
          </button>
        </div>
      </header>
      <nav className="hub-capabilities" aria-label="模型能力分类">
        {(["all", ...capabilities] as const).map((cap) => (
          <button
            key={cap}
            disabled={locked}
            aria-pressed={capability === cap}
            onClick={() => {
              setCapability(cap);
              if (cap !== "all" && !draft.capabilities?.includes(cap)) {
                const matching = providers.find((item) =>
                  item.capabilities?.includes(cap),
                );
                if (matching) {
                  setMode("form");
                  onSelect(matching);
                }
              }
            }}
          >
            {cap === "all" ? "全部" : capabilityLabels[cap]}
            <span>
              {
                providers.filter(
                  (item) => cap === "all" || item.capabilities?.includes(cap),
                ).length
              }
            </span>
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="hub-error">
          {error}
        </p>
      )}
      {loading && <p role="status">正在读取模型配置…</p>}
      <div className="hub-workspace">
        <aside className="hub-sidebar">
          <input
            type="search"
            aria-label="搜索 Provider 或模型"
            placeholder="搜索 Provider 或模型"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="hub-provider-list">
            {visible.map((provider) => (
              <button
                key={provider.id}
                disabled={locked}
                aria-pressed={draft.id === provider.id}
                onClick={() => {
                  setMode("form");
                  onSelect(provider);
                }}
              >
                <span className="hub-provider-title">
                  {provider.name || provider.id}
                  <i className={provider.enabled ? "hub-enabled" : ""}>
                    {provider.enabled ? "启用" : "停用"}
                  </i>
                </span>
                <small>
                  {provider.capabilities
                    ?.map((cap) => capabilityLabels[cap])
                    .join(" · ") || "尚未配置能力"}
                </small>
                {provider.sdvideo_models && (
                  <small>
                    {provider.sdvideo_models.length} 个模型 · 独立 SD-video 服务
                  </small>
                )}
              </button>
            ))}
            {!visible.length && !loading && (
              <p className="hub-empty">此分类暂无匹配的 Provider。</p>
            )}
          </div>
        </aside>
        <section className="hub-detail" aria-label="Provider 配置">
          <div className="hub-detail-heading">
            <div>
              <h2>{draft.name || "新 Provider"}</h2>
              <p>
                {draft.sdvideo_models
                  ? "SD-video 适配器 · 素材注册 → 视频提交 → 进度轮询 → 结果导入"
                  : "Studio 适配器 · 鉴权、模型与端点配置"}
              </p>
            </div>
            <div className="hub-mode" aria-label="编辑方式">
              <button
                disabled={locked}
                aria-pressed={mode === "form"}
                onClick={() => setMode("form")}
              >
                表单
              </button>
              <button
                disabled={Boolean(busy)}
                aria-pressed={mode === "json"}
                onClick={() => setMode("json")}
              >
                高级 JSON
              </button>
            </div>
          </div>
          {mode === "form" ? (
            renderForm()
          ) : (
            <div className="hub-json-panel">
              <p>
                JSON
                与表单使用同一份配置。密钥在表单中单独填写，留空保留已存凭据。未列出的字段不会改变。
              </p>
              {draft.sdvideo_models && (
                <p>
                  模型 key 和 version 用于核对已有模型；通道及素材注册归属由
                  SD-video 服务统一管理。
                </p>
              )}
              <textarea
                aria-label="Provider JSON 配置"
                aria-invalid={!validation.ok}
                aria-describedby="hub-json-status"
                spellCheck={false}
                value={json}
                onChange={(event) => setJSON(event.target.value)}
                disabled={Boolean(busy)}
              />
              <p
                id="hub-json-status"
                role={validation.ok ? "status" : "alert"}
                className={validation.ok ? "hub-valid" : "hub-error"}
              >
                {validation.ok
                  ? dirty
                    ? "格式有效 · 有未保存修改，请保存或放弃后切换 Provider。"
                    : "格式有效"
                  : validation.error}
              </p>
              {saveError && (
                <p role="alert" className="hub-error">
                  {saveError}
                </p>
              )}
              {notice && <p role="status">{notice}</p>}
              <div className="hub-actions">
                <button
                  disabled={!validation.ok || busy}
                  onClick={() =>
                    validation.ok &&
                    setJSON(JSON.stringify(validation.document, null, 2))
                  }
                >
                  格式化
                </button>
                <button
                  disabled={!validation.ok || busy}
                  onClick={exportDocument}
                >
                  导出 JSON
                </button>
                <button
                  disabled={!dirty || busy}
                  onClick={() => {
                    setJSON(canonical);
                    setSource(canonical);
                  }}
                >
                  放弃 JSON 修改
                </button>
                <button
                  className="hub-primary"
                  disabled={!validation.ok || busy}
                  onClick={() => void save()}
                >
                  {busy ? "保存中…" : "保存配置"}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
