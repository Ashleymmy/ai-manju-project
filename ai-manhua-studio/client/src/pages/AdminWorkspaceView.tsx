import {
  Activity,
  Bell,
  Check,
  Database,
  Hash,
  KeyRound,
  Loader2,
  Plus,
  RefreshCcw,
  Save,
  ServerCog,
  ShieldCheck,
  TestTube2,
  UserCog,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import {
  createAdminAnnouncement,
  createAdminUser,
  createModelProvider,
  fetchAdminMonitoring,
  fetchModelProviderModelsById,
  listAdminAnnouncements,
  listAdminSeedanceAssets,
  listAdminUsers,
  listModelProviderPresets,
  listModelProviders,
  pollSeedanceAssets,
  publicApiError,
  revokeAdminAnnouncement,
  syncSeedanceAssets,
  testModelProviderById,
  updateAdminUser,
  updateModelProvider,
  type AdminMonitoringData,
  type AdminUser,
  type ImageGenerationProtocol,
  type ModelCapability,
  type ModelProviderConfig,
  type ModelProviderPayload,
  type ModelProviderPreset,
  type SeedanceAsset,
  type SystemAnnouncement,
} from "@/services/api";

type AdminTab = "users" | "providers" | "announcements" | "monitoring" | "seedance";

const capabilityOptions: Array<{ value: ModelCapability; label: string }> = [
  { value: "text", label: "文本" },
  { value: "image", label: "图像" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
];

const imageProtocolOptions: Array<{ value: ImageGenerationProtocol; label: string }> = [
  { value: "auto", label: "自动识别" },
  { value: "openai_images", label: "OpenAI Images" },
  { value: "openai_responses", label: "OpenAI Responses" },
  { value: "openai_chat_completions", label: "OpenAI Chat Completions" },
  { value: "gemini_generate_content", label: "Gemini generateContent" },
  { value: "dashscope_multimodal", label: "DashScope Multimodal" },
  { value: "stability_image", label: "Stability Image" },
];

const emptyProvider: ModelProviderConfig = {
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

function splitModels(value: string) {
  return value
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinModels(values: string[] = []) {
  return values.join("\n");
}

function normalizeAliasMap(value: Record<string, string> = {}) {
  return Object.fromEntries(
    Object.entries(value)
      .map(([model, alias]) => [model.trim(), alias.trim()])
      .filter(([model, alias]) => model && alias),
  );
}

function allConfiguredModelIds(config: ModelProviderConfig) {
  return Array.from(new Set([
    ...Object.values(config.models_by_capability || {}).flatMap((models) => models || []),
    config.text_model || "",
    config.image_model || "",
    config.video_model || "",
    config.audio_model || "",
    ...Object.keys(config.model_aliases || {}),
    ...Object.keys(config.model_protocols || {}),
  ].map((item) => item.trim()).filter(Boolean)));
}

function imageProtocolModelIds(config: ModelProviderConfig) {
  return Array.from(new Set([
    ...(config.models_by_capability?.image || []),
    config.image_model || "",
    ...Object.keys(config.model_protocols || {}),
  ].map((item) => item.trim()).filter(Boolean)));
}

export default function AdminWorkspaceView() {
  const [tab, setTab] = useState<AdminTab>("users");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [providers, setProviders] = useState<ModelProviderConfig[]>([]);
  const [presets, setPresets] = useState<ModelProviderPreset[]>([]);
  const [providerDraft, setProviderDraft] = useState<ModelProviderConfig>(emptyProvider);
  const [apiKey, setApiKey] = useState("");
  const [announcements, setAnnouncements] = useState<SystemAnnouncement[]>([]);
  const [monitoring, setMonitoring] = useState<AdminMonitoringData | null>(null);
  const [seedanceAssets, setSeedanceAssets] = useState<SeedanceAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const activeProvider = useMemo(() => providers.find((provider) => provider.id === providerDraft.id), [providerDraft.id, providers]);
  const configuredModelIds = useMemo(() => allConfiguredModelIds(providerDraft), [providerDraft]);
  const protocolModelIds = useMemo(() => imageProtocolModelIds(providerDraft), [providerDraft]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [userList, providerList, presetList, announcementList, monitoringData, seedanceList] = await Promise.allSettled([
        listAdminUsers(),
        listModelProviders(),
        listModelProviderPresets(),
        listAdminAnnouncements(),
        fetchAdminMonitoring(24),
        listAdminSeedanceAssets({ limit: 30 }),
      ]);
      if (userList.status === "fulfilled") setUsers(userList.value);
      if (providerList.status === "fulfilled") {
        setProviders(providerList.value);
        setProviderDraft((current) => providerList.value.find((item) => item.id === current.id) || providerList.value[0] || emptyProvider);
      }
      if (presetList.status === "fulfilled") setPresets(presetList.value);
      if (announcementList.status === "fulfilled") setAnnouncements(announcementList.value);
      if (monitoringData.status === "fulfilled") setMonitoring(monitoringData.value);
      if (seedanceList.status === "fulfilled") setSeedanceAssets(seedanceList.value.items || []);
    } catch (error) {
      toast.error(publicApiError(error, "读取管理后台数据失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const saveProvider = async () => {
    if (!(providerDraft.name || "").trim()) return toast.error("请填写 Provider 名称");
    if (!(providerDraft.base_url || "").trim()) return toast.error("请填写 Base URL");
    setBusy("provider-save");
    try {
      const payload = toProviderPayload(providerDraft, apiKey.trim() || undefined);
      const saved = providerDraft.id ? await updateModelProvider(providerDraft.id, payload) : await createModelProvider(payload);
      setApiKey("");
      toast.success("Provider 已保存");
      setProviders((items) => {
        const exists = items.some((item) => item.id === saved.id);
        return exists ? items.map((item) => item.id === saved.id ? saved : item) : [saved, ...items];
      });
      setProviderDraft(saved);
    } catch (error) {
      toast.error(publicApiError(error, "保存 Provider 失败"));
    } finally {
      setBusy("");
    }
  };

  const testProvider = async () => {
    if (!providerDraft.id) return toast.warning("请先保存 Provider");
    setBusy("provider-test");
    try {
      const result = await testModelProviderById(providerDraft.id, toProviderPayload(providerDraft, apiKey.trim() || undefined));
      if (result.ok) toast.success(result.text || result.message || "连接测试通过");
      else toast.error(result.error || result.message || "连接测试未通过");
    } catch (error) {
      toast.error(publicApiError(error, "Provider 测试失败"));
    } finally {
      setBusy("");
    }
  };

  const fetchModels = async () => {
    if (!providerDraft.id) return toast.warning("请先保存 Provider");
    setBusy("provider-models");
    try {
      const result = await fetchModelProviderModelsById(providerDraft.id, toProviderPayload(providerDraft, apiKey.trim() || undefined));
      const textModel = typeof result.default_text_model === "string" ? result.default_text_model : result.text_models?.[0];
      const imageModel = typeof result.default_image_model === "string" ? result.default_image_model : result.image_models?.[0];
      const videoModel = typeof result.default_video_model === "string" ? result.default_video_model : result.video_models?.[0];
      setProviderDraft((draft) => ({
        ...draft,
        text_model: String(textModel || draft.text_model || ""),
        image_model: String(imageModel || draft.image_model || ""),
        video_model: String(videoModel || draft.video_model || ""),
        models_by_capability: {
          ...draft.models_by_capability,
          text: Array.from(new Set([...(draft.models_by_capability?.text || []), ...(result.text_models || []).map(String)])),
          image: Array.from(new Set([...(draft.models_by_capability?.image || []), ...(result.image_models || []).map(String)])),
          video: Array.from(new Set([...(draft.models_by_capability?.video || []), ...(result.video_models || []).map(String)])),
          audio: Array.from(new Set([...(draft.models_by_capability?.audio || []), ...(result.audio_models || []).map(String)])),
        },
      }));
      toast.success("模型列表已拉取");
    } catch (error) {
      toast.error(publicApiError(error, "拉取模型列表失败"));
    } finally {
      setBusy("");
    }
  };

  const addUser = async () => {
    const username = window.prompt("用户名")?.trim();
    if (!username) return;
    const password = window.prompt("初始密码") || "";
    if (!password) return;
    setBusy("user-create");
    try {
      const created = await createAdminUser({ username, password, role: "member", status: "active" });
      setUsers((items) => [created, ...items]);
      toast.success("用户已创建");
    } catch (error) {
      toast.error(publicApiError(error, "创建用户失败"));
    } finally {
      setBusy("");
    }
  };

  const toggleUserStatus = async (user: AdminUser) => {
    setBusy(`user-${user.id}`);
    try {
      const status = user.status === "active" ? "disabled" : "active";
      const saved = await updateAdminUser(user.id, { status });
      setUsers((items) => items.map((item) => item.id === user.id ? saved : item));
    } catch (error) {
      toast.error(publicApiError(error, "更新用户状态失败"));
    } finally {
      setBusy("");
    }
  };

  const createAnnouncement = async () => {
    const title = window.prompt("公告标题")?.trim();
    if (!title) return;
    const content = window.prompt("公告内容")?.trim();
    if (!content) return;
    setBusy("announcement-create");
    try {
      const created = await createAdminAnnouncement({ title, content, kind: "notice" });
      setAnnouncements((items) => [created, ...items]);
      toast.success("公告已发布");
    } catch (error) {
      toast.error(publicApiError(error, "发布公告失败"));
    } finally {
      setBusy("");
    }
  };

  const revokeAnnouncement = async (id: string) => {
    setBusy(`announcement-${id}`);
    try {
      const saved = await revokeAdminAnnouncement(id);
      setAnnouncements((items) => items.map((item) => item.id === id ? saved : item));
    } catch (error) {
      toast.error(publicApiError(error, "撤销公告失败"));
    } finally {
      setBusy("");
    }
  };

  const syncSeedance = async (mode: "sync" | "poll") => {
    setBusy(`seedance-${mode}`);
    try {
      if (mode === "sync") await syncSeedanceAssets();
      else await pollSeedanceAssets();
      const result = await listAdminSeedanceAssets({ limit: 30 });
      setSeedanceAssets(result.items || []);
      toast.success("Seedance 素材状态已同步");
    } catch (error) {
      toast.error(publicApiError(error, "同步 Seedance 素材失败"));
    } finally {
      setBusy("");
    }
  };

  const tabs: Array<[AdminTab, string, typeof Users]> = [
    ["users", "用户", Users],
    ["providers", "模型提供商", ServerCog],
    ["announcements", "系统公告", Bell],
    ["monitoring", "运行监控", Activity],
    ["seedance", "Seedance 素材", Database],
  ];

  return (
    <div className="feature-page admin-page real-admin-page">
      <div className="feature-title">
        <div><p className="eyebrow">SYSTEM / SUPER ADMIN</p><h1>管理后台</h1><p>用户、Provider、公告、监控和素材库均连接真实后端。</p></div>
        <button className="outline-button small" onClick={() => void reload()} disabled={loading}><RefreshCcw size={15} /> 刷新</button>
      </div>
      <div className="admin-workspace">
        <aside className="admin-nav">
          {tabs.map(([key, label, Icon]) => <button key={key} className={tab === key ? "selected" : ""} onClick={() => setTab(key)}><Icon size={17} />{label}</button>)}
        </aside>
        <section className="admin-panel">
          {loading ? <div className="empty-output"><Loader2 className="spin" size={26} /><p>正在读取管理数据…</p></div> : null}

          {tab === "users" && <section className="real-admin-section">
            <div className="admin-panel-head"><div><p className="eyebrow">IDENTITY / {users.length}</p><h2>用户与权限</h2></div><button className="vermilion-button" onClick={() => void addUser()} disabled={busy === "user-create"}><Plus size={16} /> 创建用户</button></div>
            <div className="admin-table">
              <div className="admin-table-head"><span>用户</span><span>角色</span><span>状态</span><span>更新时间</span><span /></div>
              {users.map((user) => <div className="admin-table-row" key={user.id}><span><i>{user.username.slice(0, 1).toUpperCase()}</i><b>{user.display_name || user.username}</b></span><span><code>{user.role}</code></span><span><em className={user.status === "active" ? "active" : "suspended"}>{user.status}</em></span><span>{formatTime(user.updated_at || user.created_at)}</span><button onClick={() => void toggleUserStatus(user)} disabled={busy === `user-${user.id}`}><UserCog size={15} /></button></div>)}
            </div>
          </section>}

          {tab === "providers" && <section className="real-admin-section provider-editor">
            <div className="admin-panel-head"><div><p className="eyebrow">PROVIDERS / {providers.length}</p><h2>模型提供商</h2></div><button className="vermilion-button" onClick={() => { setProviderDraft(emptyProvider); setApiKey(""); }}><Plus size={16} /> 新建 Provider</button></div>
            <div className="provider-editor-layout">
              <aside className="provider-list compact">
                {providers.map((provider) => <button className={provider.id === providerDraft.id ? "selected" : ""} key={provider.id} onClick={() => { setProviderDraft(provider); setApiKey(""); }}><ServerCog size={17} /><span><b>{provider.name}</b><small>{provider.provider_type} · {provider.capabilities?.join("/")}</small></span><em className={provider.enabled ? "active" : "pending"}>{provider.enabled ? "启用" : "停用"}</em></button>)}
              </aside>
              <section className="provider-form">
                <label>预设<select value={providerDraft.preset_id || ""} onChange={(event) => applyPreset(event.target.value, presets, setProviderDraft)}><option value="">不使用预设</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
                <label>名称<input value={providerDraft.name || ""} onChange={(event) => setProviderDraft((draft) => ({ ...draft, name: event.target.value }))} /></label>
                <label>Base URL<input value={providerDraft.base_url || ""} onChange={(event) => setProviderDraft((draft) => ({ ...draft, base_url: event.target.value }))} /></label>
                <label>模式<select value={providerDraft.mode} onChange={(event) => setProviderDraft((draft) => ({ ...draft, mode: event.target.value as ModelProviderConfig["mode"] }))}><option value="openai_compatible">OpenAI Compatible</option><option value="local_openai">Local OpenAI</option></select></label>
                <label>Provider 类型<select value={providerDraft.provider_type || "openai_compatible"} onChange={(event) => setProviderDraft((draft) => ({ ...draft, provider_type: event.target.value as NonNullable<ModelProviderConfig["provider_type"]> }))}><option value="openai_compatible">openai_compatible</option><option value="volcengine_ark">volcengine_ark</option><option value="gemini_media">gemini_media</option><option value="kling_video">kling_video</option><option value="minimax_hailuo">minimax_hailuo</option><option value="fal_happyhorse">fal_happyhorse</option><option value="xai_imagine">xai_imagine</option></select></label>
                <label>鉴权方式<select value={providerDraft.auth_type} onChange={(event) => setProviderDraft((draft) => ({ ...draft, auth_type: event.target.value as ModelProviderConfig["auth_type"] }))}><option value="bearer">Bearer</option><option value="x_api_key">X-API-Key</option><option value="x_goog_api_key">Google API Key</option><option value="custom_header">自定义 Header</option><option value="query_param">Query 参数</option><option value="none">None</option></select></label>
                {providerDraft.auth_type === "custom_header" && <label>自定义 Header<input value={providerDraft.custom_auth_header || ""} onChange={(event) => setProviderDraft((draft) => ({ ...draft, custom_auth_header: event.target.value }))} placeholder="X-API-Key" /></label>}
                {providerDraft.auth_type === "query_param" && <label>Query 参数<input value={providerDraft.auth_query_param || ""} onChange={(event) => setProviderDraft((draft) => ({ ...draft, auth_query_param: event.target.value }))} placeholder="key" /></label>}
                <label>API Key<KeyRound size={13} /><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={activeProvider?.api_key_configured ? "留空则保留已有密钥" : "保存或测试时可填入"} /></label>
                <label>文本模型<input value={providerDraft.text_model || ""} onChange={(event) => setProviderDraft((draft) => ({ ...draft, text_model: event.target.value }))} /></label>
                <label>图像模型<input value={providerDraft.image_model || ""} onChange={(event) => setProviderDraft((draft) => ({ ...draft, image_model: event.target.value }))} /></label>
                <label>视频模型<input value={providerDraft.video_model || ""} onChange={(event) => setProviderDraft((draft) => ({ ...draft, video_model: event.target.value }))} /></label>
                <label>音频模型<input value={providerDraft.audio_model || ""} onChange={(event) => setProviderDraft((draft) => ({ ...draft, audio_model: event.target.value }))} /></label>
                <label>并发上限<input type="number" min={1} max={8} value={providerDraft.max_concurrency || 1} onChange={(event) => setProviderDraft((draft) => ({ ...draft, max_concurrency: Number(event.target.value) || 1 }))} /></label>
                <div className="provider-form-full provider-chip-section">
                  <span>启用能力</span>
                  {capabilityOptions.map((item) => {
                    const checked = (providerDraft.capabilities || []).includes(item.value);
                    return <button key={item.value} type="button" className={checked ? "active" : ""} onClick={() => setProviderDraft((draft) => ({ ...draft, capabilities: checked ? (draft.capabilities || []).filter((value) => value !== item.value) : [...(draft.capabilities || []), item.value] }))}>{item.label}</button>;
                  })}
                  <span>默认入口</span>
                  {capabilityOptions.map((item) => {
                    const checked = (providerDraft.default_for || []).includes(item.value);
                    return <button key={`default-${item.value}`} type="button" className={checked ? "active" : ""} onClick={() => setProviderDraft((draft) => ({ ...draft, default_for: checked ? (draft.default_for || []).filter((value) => value !== item.value) : [...(draft.default_for || []), item.value] }))}>{item.label}</button>;
                  })}
                </div>
                <div className="provider-form-full">
                  <div className="provider-section-head">
                    <div><b>能力模型列表</b><small>可手动输入模型 ID；逗号、分号或换行分隔。拉取模型不会覆盖手填项。</small></div>
                    <span className="status-chip blue">{configuredModelIds.length} 个模型</span>
                  </div>
                  <div className="provider-capability-grid">
                    {capabilityOptions.map((item) => (
                      <label key={item.value}>
                        {item.label}模型列表
                        <textarea
                          value={joinModels(providerDraft.models_by_capability?.[item.value] || [])}
                          onChange={(event) => setProviderDraft((draft) => ({
                            ...draft,
                            models_by_capability: {
                              ...(draft.models_by_capability || {}),
                              [item.value]: splitModels(event.target.value),
                            },
                          }))}
                          placeholder={`每行一个 ${item.label} 模型 ID`}
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <div className="provider-form-full">
                  <div className="provider-section-head">
                    <div><b>模型显示名称映射</b><small>格式：真实模型 ID = 显示名称。只影响下拉展示，不改变请求模型。</small></div>
                    <Hash size={15} />
                  </div>
                  <textarea
                    className="provider-map-textarea"
                    value={Object.entries(providerDraft.model_aliases || {}).map(([model, alias]) => `${model} = ${alias}`).join("\n")}
                    onChange={(event) => setProviderDraft((draft) => ({
                      ...draft,
                      model_aliases: normalizeAliasMap(Object.fromEntries(splitLines(event.target.value).map((line) => {
                        const index = line.indexOf("=");
                        if (index < 0) return [line, line];
                        return [line.slice(0, index), line.slice(index + 1)];
                      }))),
                    }))}
                    placeholder={"wan3.0 = Wan 3.0\nbanana-pro = Banana Pro"}
                  />
                </div>
                <div className="provider-form-full">
                  <div className="provider-section-head">
                    <div><b>图片模型调用协议</b><small>按真实模型 ID 指定协议；中转站 Gemini / Banana 通常选择 OpenAI Chat Completions。</small></div>
                    <span className="status-chip blue">{protocolModelIds.length} 个图片模型</span>
                  </div>
                  {protocolModelIds.length ? <div className="provider-protocol-grid">{protocolModelIds.map((modelID) => <label key={modelID}><span>{modelID}</span><select value={providerDraft.model_protocols?.[modelID] || "auto"} onChange={(event) => setProviderDraft((draft) => ({ ...draft, model_protocols: { ...(draft.model_protocols || {}), [modelID]: event.target.value as ImageGenerationProtocol } }))}>{imageProtocolOptions.map((protocol) => <option key={protocol.value} value={protocol.value}>{protocol.label}</option>)}</select></label>)}</div> : <div className="empty-output"><p>请先拉取模型或填写图像模型。</p></div>}
                </div>
                <div className="provider-form-actions">
                  <button className="outline-button small" onClick={() => void fetchModels()} disabled={busy === "provider-models"}><RefreshCcw size={15} /> 拉取模型</button>
                  <button className="outline-button small" onClick={() => void testProvider()} disabled={busy === "provider-test"}><TestTube2 size={15} /> 测试连接</button>
                  <button className="vermilion-button" onClick={() => void saveProvider()} disabled={busy === "provider-save"}><Save size={16} /> 保存 Provider</button>
                </div>
              </section>
            </div>
          </section>}

          {tab === "announcements" && <section className="real-admin-section">
            <div className="admin-panel-head"><div><p className="eyebrow">ANNOUNCEMENTS / {announcements.length}</p><h2>系统公告</h2></div><button className="vermilion-button" onClick={() => void createAnnouncement()}><Plus size={16} /> 发布公告</button></div>
            {announcements.map((item) => <article className="announcement-card" key={item.id}><div><span className={`status-chip ${item.status === "active" ? "running" : "canceled"}`}>{item.status}</span><b>{item.title}</b><p>{item.content}</p></div><aside><small>{formatTime(item.published_at || item.created_at)}</small><button onClick={() => void revokeAnnouncement(item.id)} disabled={item.status !== "active" || busy === `announcement-${item.id}`}>撤销</button></aside></article>)}
          </section>}

          {tab === "monitoring" && <section className="real-admin-section">
            <div className="admin-panel-head"><div><p className="eyebrow">MONITORING / LIVE</p><h2>系统运行监控</h2></div></div>
            <div className="monitor-grid">
              <div><span>DB</span><b>{monitoring?.health.db || "-"}</b><em className={monitoring?.health.db_ok ? "healthy" : "watch"}>{monitoring?.health.db_ok ? "正常" : "异常"}</em></div>
              <div><span>资产</span><b>{monitoring?.storage_stats.assets || 0}</b><em className="healthy">assets</em></div>
              <div><span>AI 请求</span><b>{monitoring?.summary.total_requests || 0}</b><em className="healthy">24h</em></div>
              <div><span>错误</span><b>{monitoring?.summary.error_requests || 0}</b><em className={(monitoring?.summary.error_requests || 0) ? "watch" : "healthy"}>errors</em></div>
            </div>
            <div className="monitor-log"><p className="eyebrow">RECENT REQUESTS</p>{monitoring?.recent.slice(0, 8).map((item) => <div key={item.id}><i />{item.operation} · {item.model}<small>{item.status}</small></div>)}</div>
          </section>}

          {tab === "seedance" && <section className="real-admin-section">
            <div className="admin-panel-head"><div><p className="eyebrow">SEEDANCE / {seedanceAssets.length}</p><h2>Seedance 素材</h2></div><div><button className="outline-button small" onClick={() => void syncSeedance("poll")}><RefreshCcw size={15} /> 轮询</button><button className="vermilion-button" onClick={() => void syncSeedance("sync")}><Database size={16} /> 同步</button></div></div>
            <div className="seedance-board">{seedanceAssets.map((asset, index) => <article key={asset.id}><span className="seedance-index">{String(index + 1).padStart(2, "0")}</span><div><b>{asset.name}</b><small>{asset.asset_type} · {asset.volcano_asset_id}</small></div><span className={`status-chip ${asset.status === "active" ? "succeeded" : "running"}`}>{asset.status}</span></article>)}</div>
          </section>}
        </section>
        <aside className="admin-side-status"><p className="eyebrow">ACCESS LEVEL</p><ShieldCheck size={24} /><h3>super_admin</h3><p>此页所有数据都来自后端管理接口，修改会写入正式配置。</p><hr /><p className="eyebrow">QUICK STATUS</p><button><Activity size={15} /> {monitoring?.generated_at ? `监控更新 ${formatTime(monitoring.generated_at)}` : "监控待加载"}</button><button><Check size={15} /> {providers.length} 个 Provider</button></aside>
      </div>
    </div>
  );
}

function toProviderPayload(config: ModelProviderConfig, apiKey?: string): ModelProviderPayload {
  const {
    api_key_configured: _apiKeyConfigured,
    api_key_set: _apiKeySet,
    secrets_set: _secretsSet,
    configured: _configured,
    created_at: _createdAt,
    updated_at: _updatedAt,
    ...payload
  } = config;
  return {
    ...payload,
    models_by_capability: payload.models_by_capability || {},
    model_aliases: normalizeAliasMap(payload.model_aliases || {}),
    model_protocols: Object.fromEntries(
      Object.entries(payload.model_protocols || {})
        .map(([model, protocol]) => [model.trim(), String(protocol || "").trim().toLowerCase()])
        .filter(([model, protocol]) => model && protocol && protocol !== "auto"),
    ) as Record<string, ImageGenerationProtocol>,
    ...(apiKey ? { api_key: apiKey } : {}),
  };
}

function applyPreset(id: string, presets: ModelProviderPreset[], setProviderDraft: Dispatch<SetStateAction<ModelProviderConfig>>) {
  const preset = presets.find((item) => item.id === id);
  if (!preset) {
    setProviderDraft((draft) => ({ ...draft, preset_id: "" }));
    return;
  }
  setProviderDraft((draft) => ({
    ...draft,
    preset_id: preset.id,
    name: draft.id ? draft.name : preset.name,
    provider_type: preset.provider_type,
    mode: preset.mode,
    base_url: preset.base_url,
    auth_type: preset.auth_type,
    custom_auth_header: preset.custom_auth_header,
    auth_query_param: preset.auth_query_param,
    capabilities: preset.capabilities,
    models_by_capability: preset.models_by_capability,
    text_model: preset.defaults.text || draft.text_model,
    image_model: preset.defaults.image || draft.image_model,
    video_model: preset.defaults.video || draft.video_model,
    audio_model: preset.defaults.audio || draft.audio_model,
    endpoint_overrides: preset.endpoint_overrides || {},
    extra_headers: preset.extra_headers || {},
  }));
}

function formatTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
