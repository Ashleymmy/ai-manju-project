import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  AudioLines,
  Check,
  Code2,
  Copy,
  Download,
  Image,
  LayoutGrid,
  Loader2,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  Server,
  SlidersHorizontal,
  Trash2,
  Video,
  MessageSquare,
} from "lucide-react";
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
  onCreate: (capability?: Capability) => void;
  onReload: () => void;
  onSaveJSON: (draft: T, document: ConfigDocument) => Promise<boolean>;
  onSaveForm?: () => Promise<boolean>;
  onDraftChange?: (draft: T) => void;
  onToggle?: (provider: T) => Promise<boolean>;
  onDuplicate?: (provider: T) => void;
  onRemove?: (provider: T) => Promise<boolean>;
  onDismiss?: () => void;
  credentialsDirty?: boolean;
  navigation?: ReactNode;
  renderForm: () => ReactNode;
};
const capabilityIcons = {
  text: MessageSquare,
  image: Image,
  video: Video,
  audio: AudioLines,
};
function providerModels(provider: ProviderRecord): string[] {
  return (
    provider.sdvideo_models?.map((model) => model.name) || [
      ...new Set(
        [
          ...Object.values(provider.models_by_capability || {}).flat(),
          provider.text_model,
          provider.image_model,
          provider.video_model,
          provider.audio_model,
        ].filter((value): value is string => Boolean(value)),
      ),
    ]
  );
}
function publicAddress(provider: ProviderRecord) {
  if (provider.sdvideo_models) return "视频生成与素材注册";
  try {
    const url = new URL(provider.base_url);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "尚未填写 API 地址";
  }
}
/** CC Switch's category switcher, provider cards and dedicated editing panel, adapted for a Web host. */
export function ProviderHub<T extends ProviderRecord>(
  props: ProviderHubProps<T>,
) {
  const {
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
  } = props;
  const [capability, setCapability] = useState<Capability | "all">("all");
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"form" | "json">("form");
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<string | null>(null);
  const [json, setJSON] = useState("");
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [confirmation, setConfirmation] = useState<"discard" | "delete" | null>(
    null,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const canonical = useMemo(
    () => JSON.stringify(toConfigDocument(draft), null, 2),
    [draft],
  );
  const dirty =
    initial !== null &&
    (canonical !== initial ||
      Boolean(props.credentialsDirty) ||
      (mode === "json" && json !== canonical));
  const locked = Boolean(busy || pending);
  const validation = useMemo(
    () =>
      parseConfigDocument(json, draft.sdvideo_models ? "sdvideo" : "studio"),
    [json, draft.sdvideo_models],
  );
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = previous;
    };
  }, [open]);
  useEffect(() => {
    if (open && initial === null) {
      setInitial(canonical);
      setJSON(canonical);
    }
  }, [open, initial, canonical]);
  useEffect(() => {
    const element = confirmDialog.current;
    if (confirmation) element?.showModal();
    return () => element?.close();
  }, [confirmation]);
  useEffect(() => {
    if (!open || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open, dirty]);
  const begin = (provider?: T, duplicate = false) => {
    if (provider) {
      duplicate ? props.onDuplicate?.(provider) : onSelect(provider);
    } else onCreate(capability === "all" ? undefined : capability);
    setInitial(null);
    setSaveError("");
    setMode("form");
    setOpen(true);
  };
  const close = () => {
    setConfirmation(null);
    setOpen(false);
    setInitial(null);
    props.onDismiss?.();
  };
  const requestClose = () => {
    if (!locked) dirty ? setConfirmation("discard") : close();
  };
  const changeMode = (next: "form" | "json") => {
    if (next === mode) return;
    if (next === "json") setJSON(canonical);
    else {
      if (!validation.ok) return;
      props.onDraftChange?.(mergeConfigDocument(draft, validation.document));
    }
    setSaveError("");
    setMode(next);
  };
  const save = async () => {
    if (locked || (mode === "json" && !validation.ok)) return;
    setPending(true);
    setSaveError("");
    try {
      const ok =
        mode === "json" && validation.ok
          ? await onSaveJSON(
              mergeConfigDocument(draft, validation.document),
              validation.document,
            )
          : await props.onSaveForm?.();
      if (ok) close();
      else setSaveError("保存未完成，请检查配置后重试。");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败，请重试");
    } finally {
      setPending(false);
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
  const visible = providers.filter(
    (provider) =>
      (capability === "all" || provider.capabilities?.includes(capability)) &&
      `${provider.name} ${publicAddress(provider)} ${providerModels(provider).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const toggle = async (provider: T) => {
    setPending(true);
    setSaveError("");
    try {
      if (!(await props.onToggle?.(provider)))
        setSaveError("状态更新失败，请重试。");
    } catch {
      setSaveError("状态更新失败，请重试。");
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="provider-hub">
      <header className="hub-header">
        <div className="hub-brand">
          <Server size={24} />
          <h1>Provider Hub</h1>
          {props.navigation}
        </div>
        <nav className="hub-capabilities" aria-label="模型能力分类">
          {(["all", ...capabilities] as const).map((cap) => {
            const Icon = cap === "all" ? LayoutGrid : capabilityIcons[cap];
            return (
              <button
                type="button"
                key={cap}
                aria-pressed={capability === cap}
                onClick={() => setCapability(cap)}
              >
                <Icon size={18} />
                {cap === "all" ? "全部" : capabilityLabels[cap]}
              </button>
            );
          })}
        </nav>
        <div className="hub-header-actions">
          <button
            type="button"
            className="hub-icon-button"
            title="刷新配置"
            aria-label="刷新配置"
            disabled={locked || loading}
            onClick={onReload}
          >
            <RefreshCw size={18} className={loading ? "hub-spin" : ""} />
          </button>
          <button
            type="button"
            className="hub-add"
            aria-label="添加供应商"
            title="添加供应商"
            disabled={locked || loading}
            onClick={() => begin()}
          >
            <Plus size={23} />
          </button>
        </div>
      </header>
      <main className="hub-main">
        <div className="hub-toolbar">
          <div>
            <h2>
              {capability === "all"
                ? "全部供应商"
                : `${capabilityLabels[capability]}供应商`}
            </h2>
            <span>{visible.length} 个供应商</span>
          </div>
          <label className="hub-search">
            <Search size={16} />
            <input
              type="search"
              aria-label="搜索供应商或模型"
              placeholder="搜索供应商或模型…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        {(error || (!open && saveError)) && (
          <p role="alert" className="hub-error">
            {error || saveError}
          </p>
        )}
        {loading && !providers.length && (
          <div className="hub-empty" role="status">
            <Loader2 className="hub-spin" />
            正在读取配置…
          </div>
        )}
        <div className="hub-provider-list">
          {visible.map((provider) => {
            const models = providerModels(provider);
            const partial =
              provider.sdvideo_models &&
              provider.enabled &&
              provider.sdvideo_models.some((model) => !model.enabled);
            const Icon = provider.sdvideo_models
              ? Video
              : capabilityIcons[provider.capabilities?.[0] || "text"];
            return (
              <article
                key={provider.id}
                className={`hub-provider-card${provider.enabled ? " is-enabled" : ""}`}
              >
                <div className="hub-provider-identity">
                  <div className="hub-provider-icon">
                    <Icon size={24} />
                  </div>
                  <div className="hub-provider-info">
                    <div className="hub-provider-title">
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => begin(provider)}
                      >
                        {provider.name || "未命名供应商"}
                      </button>
                      <span
                        className={`hub-status ${provider.enabled ? "is-active" : ""}`}
                      >
                        {partial
                          ? "部分启用"
                          : provider.enabled
                            ? "已启用"
                            : "已停用"}
                      </span>
                    </div>
                    <p className="hub-address">{publicAddress(provider)}</p>
                    <div className="hub-model-preview">
                      <span>{models.length} 个模型</span>
                      {models.slice(0, 3).map((model) => (
                        <span
                          key={model}
                          className="hub-model-tag"
                          title={model}
                        >
                          {model}
                        </span>
                      ))}
                      {models.length > 3 && <span>+{models.length - 3}</span>}
                    </div>
                  </div>
                </div>
                <div className="hub-card-actions">
                  <button
                    type="button"
                    className="hub-icon-button"
                    aria-label={`编辑 ${provider.name}`}
                    title="编辑配置"
                    disabled={locked}
                    onClick={() => begin(provider)}
                  >
                    <Pencil size={17} />
                  </button>
                  {props.onDuplicate && !provider.sdvideo_models && (
                    <button
                      type="button"
                      className="hub-icon-button"
                      aria-label={`复制 ${provider.name}`}
                      title="复制配置"
                      disabled={locked}
                      onClick={() => begin(provider, true)}
                    >
                      <Copy size={17} />
                    </button>
                  )}
                  {props.onToggle && (
                    <button
                      type="button"
                      className={`hub-toggle ${provider.enabled ? "is-on" : ""}`}
                      aria-label={`${provider.enabled ? "停用" : "启用"} ${provider.name}`}
                      disabled={locked}
                      onClick={() => void toggle(provider)}
                    >
                      <Power size={15} />
                      {provider.enabled ? "停用" : "启用"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {!visible.length && !loading && (
          <div className="hub-empty">
            <Server size={34} />
            <h3>{search ? "没有找到匹配的供应商" : "还没有供应商"}</h3>
            <p>
              {search
                ? "试试其他名称或模型 ID。"
                : "添加一个供应商，选择预设即可开始配置。"}
            </p>
            <button
              type="button"
              className="hub-primary"
              onClick={() => (search ? setSearch("") : begin())}
            >
              {search ? "清除搜索" : "添加供应商"}
            </button>
          </div>
        )}
      </main>
      {open && (
        <dialog
          ref={dialog}
          className="hub-editor"
          aria-labelledby="hub-editor-title"
          onCancel={(event) => {
            event.preventDefault();
            requestClose();
          }}
        >
          <header className="hub-editor-header">
            <button
              type="button"
              className="hub-icon-button"
              aria-label="返回供应商列表"
              onClick={requestClose}
              disabled={locked}
            >
              <ArrowLeft size={20} />
            </button>
            <h2 id="hub-editor-title">
              {draft.id ? `编辑 ${draft.name || "供应商"}` : "添加供应商"}
            </h2>
            <div className="hub-mode" aria-label="编辑方式">
              <button
                type="button"
                aria-pressed={mode === "form"}
                disabled={locked || (mode === "json" && !validation.ok)}
                onClick={() => changeMode("form")}
              >
                <SlidersHorizontal size={16} />
                表单
              </button>
              <button
                type="button"
                aria-pressed={mode === "json"}
                disabled={locked}
                onClick={() => changeMode("json")}
              >
                <Code2 size={16} />
                JSON
              </button>
            </div>
          </header>
          <div className="hub-editor-scroll">
            <div
              className={`hub-editor-content${mode === "json" ? " hub-editor-code" : ""}`}
            >
              {mode === "form" ? (
                renderForm()
              ) : (
                <section className="hub-json-panel" aria-label="JSON 编辑器">
                  <div className="hub-section-heading">
                    <div>
                      <h3>配置 JSON</h3>
                      <p>与表单同步。API Key 在表单中填写，导出不包含密钥。</p>
                    </div>
                    <div className="hub-actions">
                      <button
                        type="button"
                        disabled={!validation.ok || locked}
                        onClick={() =>
                          validation.ok &&
                          setJSON(JSON.stringify(validation.document, null, 2))
                        }
                      >
                        <Code2 size={15} />
                        格式化
                      </button>
                      <button
                        type="button"
                        disabled={!validation.ok || locked}
                        onClick={exportDocument}
                      >
                        <Download size={15} />
                        导出
                      </button>
                    </div>
                  </div>
                  <div className="hub-code-editor">
                    <div className="hub-code-title">
                      <Code2 size={16} />
                      provider.json
                    </div>
                    <textarea
                      aria-label="Provider JSON 配置"
                      aria-invalid={!validation.ok}
                      aria-describedby="hub-json-status"
                      spellCheck={false}
                      value={json}
                      onChange={(event) => setJSON(event.target.value)}
                      disabled={locked}
                    />
                  </div>
                  <p
                    id="hub-json-status"
                    role={validation.ok ? "status" : "alert"}
                    className={validation.ok ? "hub-valid" : "hub-error"}
                  >
                    {validation.ok ? (
                      <>
                        <Check size={15} />
                        JSON 格式有效
                      </>
                    ) : (
                      validation.error
                    )}
                  </p>
                </section>
              )}
            </div>
          </div>
          <footer className="hub-editor-footer">
            <div>
              {props.onRemove &&
                draft.id &&
                draft.id !== "default" &&
                !draft.sdvideo_models && (
                  <button
                    type="button"
                    className="hub-danger-quiet"
                    disabled={locked}
                    onClick={() => setConfirmation("delete")}
                  >
                    <Trash2 size={16} />
                    删除供应商
                  </button>
                )}
              {saveError && (
                <p role="alert" className="hub-error">
                  {saveError}
                </p>
              )}
            </div>
            <div className="hub-actions">
              {dirty && <span className="hub-dirty">有未保存的修改</span>}
              <button type="button" onClick={requestClose} disabled={locked}>
                取消
              </button>
              <button
                type="button"
                className="hub-primary"
                disabled={locked || (mode === "json" && !validation.ok)}
                onClick={() => void save()}
              >
                {locked ? (
                  <Loader2 size={16} className="hub-spin" />
                ) : (
                  <Check size={16} />
                )}
                {locked ? "保存中…" : draft.id ? "保存配置" : "添加供应商"}
              </button>
            </div>
          </footer>
        </dialog>
      )}
      {confirmation && (
        <dialog
          ref={confirmDialog}
          className="hub-confirm"
          aria-labelledby="hub-confirm-title"
          onCancel={(event) => {
            event.preventDefault();
            setConfirmation(null);
          }}
        >
          <h2 id="hub-confirm-title">
            {confirmation === "delete"
              ? "删除这个供应商？"
              : "放弃未保存的修改？"}
          </h2>
          <p>
            {confirmation === "delete"
              ? "删除后，该供应商将不再出现在模型列表中。"
              : "返回后，本次编辑的内容不会保存。"}
          </p>
          <div className="hub-actions">
            <button
              type="button"
              autoFocus
              disabled={locked}
              onClick={() => setConfirmation(null)}
            >
              继续编辑
            </button>
            <button
              type="button"
              className="hub-danger"
              disabled={locked}
              onClick={async () => {
                if (confirmation === "discard") {
                  close();
                  return;
                }
                setPending(true);
                try {
                  if (await props.onRemove?.(draft)) close();
                  else {
                    setConfirmation(null);
                    setSaveError("删除失败，请重试。");
                  }
                } catch {
                  setConfirmation(null);
                  setSaveError("删除失败，请重试。");
                } finally {
                  setPending(false);
                }
              }}
            >
              {confirmation === "delete" ? "确认删除" : "放弃修改"}
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
