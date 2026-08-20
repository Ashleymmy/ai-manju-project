/**
 * Style reminder: 影印分镜室 — system surfaces remain sparse and operational, while authentication is a focused editorial entry point.
 */
import {
  Bell,
  Check,
  ChevronRight,
  CloudUpload,
  Eye,
  Keyboard,
  PanelTop,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { toast } from "sonner";
import {
  audioFormatOptions,
  audioVoiceOptions,
  fetchAiModels,
  getHealth,
  getPreferences,
  getStoredAuthAccount,
  imageModelLabel,
  login,
  publicApiError,
  register,
  updatePreferences,
  type PromptPreset,
} from "@/services/api";
import {
  CANVAS_SHORTCUT_LABELS,
  DEFAULT_CANVAS_SHORTCUTS,
  findShortcutConflicts,
  normalizeShortcutList,
  resolveCanvasShortcuts,
  shortcutActionOrder,
  shortcutComboFromEvent,
  shortcutDisplay,
  type CanvasShortcutAction,
  type CanvasShortcutBindings,
} from "@/lib/canvas-hotkeys";
import { useAuth } from "@/contexts/AuthContext";
import { defaultAuthPathForRole } from "@/components/AuthGuard";
import {
  defaultWebdavSyncConfig,
  loadWebdavConfig,
  saveWebdavConfig,
  webdavConfigReady,
  type WebdavSyncConfig,
} from "@/lib/webdav-config";
import { testWebdavConnection } from "@/services/webdav-sync";
import {
  APP_SYNC_DOMAIN_LABELS,
  backupAppDataToWebdav,
  type AppSyncDomainKey,
  type AppSyncProgressEvent,
  type AppSyncResult,
} from "@/services/app-sync";

function SurfaceTitle({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="feature-title">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions}
    </div>
  );
}

const settingsTabs: Array<[string, typeof WandSparkles]> = [
  ["生成参数", WandSparkles],
  ["快捷键", Keyboard],
  ["画布操作", PanelTop],
  ["提示词预设", Sparkles],
  ["同步备份", CloudUpload],
  ["通知", Bell],
];

type AiModelsCatalog = Awaited<ReturnType<typeof fetchAiModels>>;

function phaseLabel(phase: AppSyncProgressEvent["phase"]) {
  return ({
    reading: "读取数据",
    "uploading-files": "上传文件",
    "uploading-manifest": "写入清单",
    done: "完成",
    failed: "失败",
  } as Record<AppSyncProgressEvent["phase"], string>)[phase] || phase;
}

export function SettingsView() {
  const [tab, setTab] = useState(settingsTabs[0][0]);
  const [backgroundMode, setBackgroundMode] = useState<"dots" | "lines" | "blank">("dots");
  const [ctrlZoom, setCtrlZoom] = useState(false);
  const [middleButtonHint, setMiddleButtonHint] = useState(true);
  const [imageModel, setImageModel] = useState("");
  const [imageSize, setImageSize] = useState("auto");
  const [imageQuality, setImageQuality] = useState("auto");
  const [imageCount, setImageCount] = useState(1);
  const [videoModel, setVideoModel] = useState("");
  const [videoSeconds, setVideoSeconds] = useState("6");
  const [videoQuality, setVideoQuality] = useState("720");
  const [videoGenerateAudio, setVideoGenerateAudio] = useState(true);
  const [videoWatermark, setVideoWatermark] = useState(false);
  const [audioModel, setAudioModel] = useState("");
  const [audioVoice, setAudioVoice] = useState("alloy");
  const [audioFormat, setAudioFormat] = useState("mp3");
  const [audioSpeed, setAudioSpeed] = useState("1");
  const [audioInstructions, setAudioInstructions] = useState("");
  const [textModel, setTextModel] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [canvasImageCount, setCanvasImageCount] = useState(3);
  const [shortcuts, setShortcuts] = useState<CanvasShortcutBindings>({ ...DEFAULT_CANVAS_SHORTCUTS });
  const [recordingAction, setRecordingAction] = useState<CanvasShortcutAction | "">("");
  const [aiCatalog, setAiCatalog] = useState<AiModelsCatalog | null>(null);
  const [promptPresets, setPromptPresets] = useState<PromptPreset[]>([]);
  const [webdav, setWebdav] = useState<WebdavSyncConfig>(() => loadWebdavConfig());
  const [webdavDomains, setWebdavDomains] = useState<AppSyncDomainKey[]>(["canvas", "assets", "video-workbench"]);
  const [webdavTesting, setWebdavTesting] = useState(false);
  const [webdavBusy, setWebdavBusy] = useState(false);
  const [webdavProgress, setWebdavProgress] = useState<AppSyncProgressEvent | null>(null);
  const [webdavResult, setWebdavResult] = useState<AppSyncResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const shortcutConflicts = findShortcutConflicts(shortcuts);

  const patchWebdav = (patch: Partial<WebdavSyncConfig>) => {
    setWebdav((current) => ({ ...current, ...patch }));
  };

  const persistWebdav = (patch: Partial<WebdavSyncConfig> = {}) => {
    const next = saveWebdavConfig({ ...webdav, ...patch });
    setWebdav(next);
    return next;
  };

  const testWebdav = async () => {
    if (webdavTesting) return;
    const config = persistWebdav();
    if (!webdavConfigReady(config)) return toast.error("请先填写 WebDAV 地址");
    setWebdavTesting(true);
    try {
      await testWebdavConnection(config);
      toast.success("WebDAV 连接正常");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "WebDAV 连接测试失败");
    } finally {
      setWebdavTesting(false);
    }
  };

  const runWebdavBackup = async () => {
    if (webdavBusy) return;
    const config = persistWebdav();
    if (!webdavConfigReady(config)) return toast.error("请先填写 WebDAV 地址");
    if (!webdavDomains.length) return toast.error("请至少选择一个备份内容");
    setWebdavBusy(true);
    setWebdavResult(null);
    setWebdavProgress(null);
    try {
      const result = await backupAppDataToWebdav(config, {
        domains: webdavDomains,
        onProgress: (event) => setWebdavProgress(event),
      });
      setWebdavResult(result);
      persistWebdav({ lastSyncedAt: result.finishedAt });
      if (result.ok) toast.success("备份完成");
      else toast.warning("备份完成，但部分内容失败");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "备份失败");
    } finally {
      setWebdavBusy(false);
      setWebdavProgress(null);
    }
  };

  const toggleWebdavDomain = (domain: AppSyncDomainKey) => {
    setWebdavDomains((current) => current.includes(domain) ? current.filter((item) => item !== domain) : [...current, domain]);
  };

  useEffect(() => {
    Promise.all([getPreferences(), fetchAiModels()])
      .then(([preferences, catalog]) => {
        setAiCatalog(catalog);
        const generation = preferences.generation || {};
        setImageModel(generation.imageModel || catalog.defaultImageModel);
        setImageSize(generation.size || "1:1");
        setImageQuality(generation.quality || "auto");
        setImageCount(Math.max(1, Number(generation.count || 1)));
        setCanvasImageCount(Math.max(1, Number(generation.canvasImageCount || 3)));
        setVideoModel(generation.videoModel || catalog.defaultVideoModel);
        setVideoSeconds(generation.videoSeconds || "6");
        setVideoQuality(generation.vquality || "720");
        setVideoGenerateAudio(generation.videoGenerateAudio !== "false");
        setVideoWatermark(generation.videoWatermark === "true");
        setAudioModel(generation.audioModel || catalog.defaultAudioModel);
        setAudioVoice(generation.audioVoice || "alloy");
        setAudioFormat(generation.audioFormat || "mp3");
        setAudioSpeed(generation.audioSpeed || "1");
        setAudioInstructions(generation.audioInstructions || "");
        setTextModel(generation.textModel || catalog.defaultTextModel);
        setSystemPrompt(generation.systemPrompt || "");
        setBackgroundMode(preferences.canvas?.backgroundMode || "lines");
        setCtrlZoom(preferences.canvas?.wheelZoomRequiresCtrl !== false);
        setMiddleButtonHint(preferences.canvas?.middleButtonLockHint !== false);
        setShortcuts(resolveCanvasShortcuts(preferences.shortcuts));
        setPromptPresets(preferences.canvas?.promptPresets || []);
      })
      .catch((error) => toast.error(publicApiError(error, "读取偏好设置失败")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!recordingAction) return;
    const handleKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecordingAction("");
        return;
      }
      const combo = shortcutComboFromEvent(event);
      if (!combo) return;
      setShortcuts((current) => ({
        ...current,
        [recordingAction]: normalizeShortcutList([...(current[recordingAction] || []), combo]),
      }));
      setRecordingAction("");
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [recordingAction]);

  const removeShortcutCombo = (action: CanvasShortcutAction, combo: string) => {
    setShortcuts((current) => ({ ...current, [action]: (current[action] || []).filter((item) => item !== combo) }));
  };

  const save = async () => {
    if (saving) return;
    if (shortcutConflicts.size) {
      toast.error("存在冲突的快捷键绑定，请先调整");
      setTab("快捷键");
      return;
    }
    const emptyAction = shortcutActionOrder.find((action) => !(shortcuts[action] || []).length);
    if (emptyAction) {
      toast.error(`「${CANVAS_SHORTCUT_LABELS[emptyAction]}」至少需要一个绑定`);
      setTab("快捷键");
      return;
    }
    setSaving(true);
    try {
      await updatePreferences({
        generation: {
          imageModel,
          size: imageSize,
          quality: imageQuality,
          count: String(imageCount),
          canvasImageCount: String(canvasImageCount),
          videoModel,
          videoSeconds,
          vquality: videoQuality,
          videoGenerateAudio: String(videoGenerateAudio),
          videoWatermark: String(videoWatermark),
          audioModel,
          audioVoice,
          audioFormat,
          audioSpeed,
          audioInstructions,
          textModel,
          systemPrompt,
        },
        shortcuts,
        canvas: {
          backgroundMode,
          wheelZoomRequiresCtrl: ctrlZoom,
          middleButtonLockHint: middleButtonHint,
        },
      });
      toast.success("个人偏好已保存");
    } catch (error) {
      toast.error(publicApiError(error, "保存偏好设置失败"));
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = () => {
    if (!window.confirm("恢复全部偏好为默认值？点击保存后生效。")) return;
    setImageModel(aiCatalog?.defaultImageModel || "");
    setImageSize("1:1");
    setImageQuality("auto");
    setImageCount(1);
    setCanvasImageCount(3);
    setVideoModel(aiCatalog?.defaultVideoModel || "");
    setVideoSeconds("6");
    setVideoQuality("720");
    setVideoGenerateAudio(true);
    setVideoWatermark(false);
    setAudioModel(aiCatalog?.defaultAudioModel || "");
    setAudioVoice("alloy");
    setAudioFormat("mp3");
    setAudioSpeed("1");
    setAudioInstructions("");
    setTextModel(aiCatalog?.defaultTextModel || "");
    setSystemPrompt("");
    setBackgroundMode("lines");
    setCtrlZoom(true);
    setMiddleButtonHint(true);
    setShortcuts({ ...DEFAULT_CANVAS_SHORTCUTS });
    toast.info("已恢复默认值，点击保存后生效");
  };

  const modelCatalogAdapter = aiCatalog ? { labels: aiCatalog.modelLabels, providerNames: aiCatalog.modelProviderNames } : undefined;

  return (
    <div className="feature-page settings-page">
      <SurfaceTitle
        eyebrow="PREFERENCES / YOU"
        title="偏好设置"
        description="让默认模型、画布手感和可复用表达方式服从于你的工作节奏。"
        actions={
          <div className="scope-switch">
            <button className="outline-button small" disabled={loading || saving} onClick={resetDefaults}>
              <RotateCcw size={14} /> 恢复默认
            </button>
            <button className="vermilion-button" disabled={loading || saving} onClick={() => void save()}>
              <Save size={16} /> {saving ? "保存中…" : "保存偏好"}
            </button>
          </div>
        }
      />
      <div className="settings-workspace">
        <aside className="settings-nav">
          {settingsTabs.map(([label, Icon]) => (
            <button
              className={tab === label ? "selected" : ""}
              onClick={() => setTab(label)}
              key={label}
            >
              <Icon size={17} />
              <span>{label}</span>
              <ChevronRight size={14} />
            </button>
          ))}
        </aside>
        <section className="settings-panel">
          {tab === "生成参数" && (
            <>
              <div className="settings-panel-head">
                <div>
                  <p className="eyebrow">GENERATION DEFAULTS</p>
                  <h2>默认生成参数</h2>
                </div>
                <span className="status-chip blue">{loading ? "读取中" : "已同步"}</span>
              </div>
              <p className="settings-group-label">图像</p>
              <div className="settings-fields">
                <label>
                  默认图像模型
                  <select value={imageModel} onChange={(event) => setImageModel(event.target.value)}>
                    {(aiCatalog?.imageModels || []).map((item) => (
                      <option key={item} value={item}>{imageModelLabel(item, modelCatalogAdapter)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  默认画幅
                  <select value={imageSize} onChange={(event) => setImageSize(event.target.value)}>
                    <option value="auto">AUTO 自适应</option>
                    <option value="1:1">1:1</option>
                    <option value="16:9">16:9</option>
                    <option value="9:16">9:16</option>
                  </select>
                </label>
                <label>
                  默认质量
                  <select value={imageQuality} onChange={(event) => setImageQuality(event.target.value)}>
                    <option value="auto">AUTO</option>
                    <option value="low">低</option>
                    <option value="medium">中</option>
                    <option value="high">高</option>
                  </select>
                </label>
                <label>
                  图像数量
                  <div className="stepper">
                    <button onClick={() => setImageCount((value) => Math.max(1, value - 1))}>−</button>
                    <b>{String(imageCount).padStart(2, "0")}</b>
                    <button onClick={() => setImageCount((value) => Math.min(15, value + 1))}>+</button>
                  </div>
                </label>
                <label>
                  画布默认张数
                  <div className="stepper">
                    <button onClick={() => setCanvasImageCount((value) => Math.max(1, value - 1))}>−</button>
                    <b>{String(canvasImageCount).padStart(2, "0")}</b>
                    <button onClick={() => setCanvasImageCount((value) => Math.min(15, value + 1))}>+</button>
                  </div>
                </label>
              </div>
              <p className="settings-group-label">视频</p>
              <div className="settings-fields">
                <label>
                  默认视频模型
                  <select value={videoModel} onChange={(event) => setVideoModel(event.target.value)}>
                    <option value="">未设置</option>
                    {(aiCatalog?.videoModels || []).map((item) => (
                      <option key={item} value={item}>{imageModelLabel(item, modelCatalogAdapter)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  时长（秒）
                  <select value={videoSeconds} onChange={(event) => setVideoSeconds(event.target.value)}>
                    {["3", "5", "6", "8", "10", "12", "15"].map((item) => <option key={item} value={item}>{item}s</option>)}
                  </select>
                </label>
                <label>
                  清晰度
                  <select value={videoQuality} onChange={(event) => setVideoQuality(event.target.value)}>
                    <option value="480">480P</option>
                    <option value="720">720P</option>
                    <option value="1080">1080P</option>
                  </select>
                </label>
                <label className="toggle-line">
                  <span><b>生成声音</b><small>默认带背景声与配音</small></span>
                  <button className={videoGenerateAudio ? "switch on" : "switch"} onClick={() => setVideoGenerateAudio(!videoGenerateAudio)}><i /></button>
                </label>
                <label className="toggle-line">
                  <span><b>水印</b><small>由模型服务能力决定是否生效</small></span>
                  <button className={videoWatermark ? "switch on" : "switch"} onClick={() => setVideoWatermark(!videoWatermark)}><i /></button>
                </label>
              </div>
              <p className="settings-group-label">音频</p>
              <div className="settings-fields">
                <label>
                  默认音频模型
                  <select value={audioModel} onChange={(event) => setAudioModel(event.target.value)}>
                    <option value="">未设置</option>
                    {(aiCatalog?.audioModels || []).map((item) => (
                      <option key={item} value={item}>{imageModelLabel(item, modelCatalogAdapter)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  音色
                  <select value={audioVoice} onChange={(event) => setAudioVoice(event.target.value)}>
                    {audioVoiceOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label>
                  格式
                  <select value={audioFormat} onChange={(event) => setAudioFormat(event.target.value)}>
                    {audioFormatOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label>
                  语速
                  <select value={audioSpeed} onChange={(event) => setAudioSpeed(event.target.value)}>
                    {["0.5", "0.75", "1", "1.25", "1.5", "2"].map((item) => <option key={item} value={item}>{item}x</option>)}
                  </select>
                </label>
                <label className="settings-fields-wide">
                  声音指令
                  <textarea value={audioInstructions} onChange={(event) => setAudioInstructions(event.target.value)} placeholder="例如：低沉平缓的旁白语气" />
                </label>
              </div>
              <p className="settings-group-label">文本</p>
              <div className="settings-fields">
                <label>
                  默认文本模型
                  <select value={textModel} onChange={(event) => setTextModel(event.target.value)}>
                    <option value="">未设置</option>
                    {(aiCatalog?.textModels || []).map((item) => (
                      <option key={item} value={item}>{imageModelLabel(item, modelCatalogAdapter)}</option>
                    ))}
                  </select>
                </label>
                <label className="settings-fields-wide">
                  系统提示词
                  <textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} placeholder="AI 助手和文本生成默认携带的系统提示词" />
                </label>
              </div>
              <section className="quality-note">
                <ShieldCheck size={20} />
                <div>
                  <b>Provider 路由由完整模型选择器决定</b>
                  <span>保存后会保留 providerId::modelId，不会丢失模型提供商。</span>
                </div>
              </section>
            </>
          )}

          {tab === "快捷键" && (
            <>
              <div className="settings-panel-head">
                <div>
                  <p className="eyebrow">CANVAS SHORTCUTS</p>
                  <h2>画布快捷键</h2>
                </div>
                {shortcutConflicts.size > 0 && <span className="status-chip sand">存在冲突</span>}
              </div>
              <div className="shortcut-list">
                {shortcutActionOrder.map((action) => {
                  const combos = shortcuts[action] || [];
                  const conflicted = [...shortcutConflicts.values()].some((actions) => actions.includes(action));
                  return (
                    <div className={conflicted ? "shortcut-row conflicted" : "shortcut-row"} key={action}>
                      <span>
                        <b>{CANVAS_SHORTCUT_LABELS[action]}</b>
                        {conflicted && <small>与其他动作冲突</small>}
                      </span>
                      <div className="shortcut-combos">
                        {combos.map((combo) => (
                          <span className="shortcut-binding" key={combo}>
                            {shortcutDisplay(combo)}
                            <button
                              title="移除该组合键"
                              disabled={combos.length <= 1}
                              onClick={() => removeShortcutCombo(action, combo)}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <button
                          className={recordingAction === action ? "shortcut-add recording" : "shortcut-add"}
                          onClick={() => setRecordingAction(recordingAction === action ? "" : action)}
                        >
                          {recordingAction === action ? "按下组合键… (Esc 取消)" : "+ 添加"}
                        </button>
                        <button className="icon-button subtle" title="恢复默认" onClick={() => setShortcuts((current) => ({ ...current, [action]: [...DEFAULT_CANVAS_SHORTCUTS[action]] }))}>
                          <RotateCcw size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="shortcut-hint">每个动作可绑定多个组合键（如 Ctrl+Z 与 Cmd+Z 并存）。快捷键仅作用于画布工作区，输入框聚焦时不触发；保存后在画布中生效。</p>
            </>
          )}

          {tab === "画布操作" && (
            <>
              <div className="settings-panel-head">
                <div>
                  <p className="eyebrow">CANVAS BEHAVIOR</p>
                  <h2>画布操作</h2>
                </div>
              </div>
              <div className="canvas-pref-preview">
                <div className={backgroundMode === "dots" ? "dot-preview dots" : backgroundMode === "lines" ? "dot-preview lines" : "dot-preview blank"}>
                  <span>拖拽节点</span>
                  <i />
                </div>
                <div>
                  <label>
                    背景参考
                    <div className="seg-switch">
                      <button className={backgroundMode === "dots" ? "active" : ""} onClick={() => setBackgroundMode("dots")}>
                        点阵
                      </button>
                      <button className={backgroundMode === "lines" ? "active" : ""} onClick={() => setBackgroundMode("lines")}>
                        线网
                      </button>
                      <button className={backgroundMode === "blank" ? "active" : ""} onClick={() => setBackgroundMode("blank")}>
                        空白
                      </button>
                    </div>
                  </label>
                  <label className="toggle-line">
                    <span>
                      <b>滚轮缩放需要 Ctrl</b>
                      <small>降低误触缩放画布的概率</small>
                    </span>
                    <button className={ctrlZoom ? "switch on" : "switch"} onClick={() => setCtrlZoom(!ctrlZoom)}>
                      <i />
                    </button>
                  </label>
                  <label className="toggle-line">
                    <span>
                      <b>中键锁定提示</b>
                      <small>首次进入画布时显示操作提示</small>
                    </span>
                    <button
                      className={middleButtonHint ? "switch on" : "switch"}
                      onClick={() => setMiddleButtonHint(!middleButtonHint)}
                    >
                      <i />
                    </button>
                  </label>
                </div>
              </div>
            </>
          )}

          {tab === "提示词预设" && (
            <>
              <div className="settings-panel-head">
                <div>
                  <p className="eyebrow">PROMPT PRESETS</p>
                  <h2>个人提示词预设</h2>
                </div>
                <button className="outline-button small" onClick={() => window.location.assign("/prompts")}>
                  <Plus size={15} /> 管理预设
                </button>
              </div>
              <div className="preset-settings-list">
                {promptPresets.length ? (
                  promptPresets.map((preset) => (
                    <button onClick={() => window.location.assign("/prompts")} key={preset.id}>
                      <span>
                        <b>{preset.title}</b>
                        <small>{preset.tags.join(" / ") || preset.prompt.slice(0, 40)}</small>
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  ))
                ) : (
                  <div className="empty-output">
                    <p>暂无个人提示词预设</p>
                  </div>
                )}
              </div>
            </>
          )}

          {tab === "同步备份" && (
            <>
              <div className="settings-panel-head">
                <div>
                  <p className="eyebrow">WEBDAV BACKUP</p>
                  <h2>同步备份</h2>
                </div>
                {webdav.lastSyncedAt && <span className="status-chip blue">上次备份 {new Date(webdav.lastSyncedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>}
              </div>
              <section className="quality-note">
                <ShieldCheck size={20} />
                <div>
                  <b>画布与资产已由服务端持久化</b>
                  <span>换设备登录即可见。此处是把工作区数据额外备份到你自有的 WebDAV 存储；视频生成历史仅存于本设备浏览器，只能通过备份带走。</span>
                </div>
              </section>
              <div className="settings-fields">
                <label className="settings-fields-wide">
                  WebDAV 地址
                  <input value={webdav.url} onChange={(event) => patchWebdav({ url: event.target.value })} onBlur={() => persistWebdav()} placeholder="https://dav.example.com/dav" />
                </label>
                <label>
                  用户名
                  <input value={webdav.username} onChange={(event) => patchWebdav({ username: event.target.value })} onBlur={() => persistWebdav()} autoComplete="off" />
                </label>
                <label>
                  密码 / 应用密码
                  <input type="password" value={webdav.password} onChange={(event) => patchWebdav({ password: event.target.value })} onBlur={() => persistWebdav()} autoComplete="new-password" />
                </label>
                <label>
                  远程目录
                  <input value={webdav.directory} onChange={(event) => patchWebdav({ directory: event.target.value })} onBlur={() => persistWebdav()} placeholder={defaultWebdavSyncConfig.directory} />
                </label>
                <label>
                  连接方式
                  <select value={webdav.proxyMode} onChange={(event) => persistWebdav({ proxyMode: event.target.value === "direct" ? "direct" : "server" })}>
                    <option value="server">经本站转发（推荐）</option>
                    <option value="direct">浏览器直连（需远端允许 CORS）</option>
                  </select>
                </label>
              </div>
              <p className="settings-group-label">备份内容</p>
              <div className="sync-domain-row">
                {(Object.keys(APP_SYNC_DOMAIN_LABELS) as AppSyncDomainKey[]).map((domain) => (
                  <label className="comic-check-line" key={domain}>
                    <input type="checkbox" checked={webdavDomains.includes(domain)} onChange={() => toggleWebdavDomain(domain)} />
                    {APP_SYNC_DOMAIN_LABELS[domain]}
                  </label>
                ))}
              </div>
              <div className="sync-actions">
                <button className="outline-button small" disabled={webdavTesting || webdavBusy} onClick={() => void testWebdav()}>
                  {webdavTesting ? "测试中…" : "连接测试"}
                </button>
                <button className="vermilion-button" disabled={webdavBusy} onClick={() => void runWebdavBackup()}>
                  <CloudUpload size={16} /> {webdavBusy ? "备份中…" : "立即备份"}
                </button>
              </div>
              {webdavProgress && (
                <div className="sync-progress">
                  <div className="job-progress"><i style={{ width: `${webdavProgress.total ? Math.round((webdavProgress.completed / webdavProgress.total) * 100) : 8}%` }} /></div>
                  <small>{APP_SYNC_DOMAIN_LABELS[webdavProgress.domain]} · {phaseLabel(webdavProgress.phase)}{webdavProgress.message ? ` · ${webdavProgress.message}` : ""}</small>
                </div>
              )}
              {webdavResult && (
                <div className="sync-result">
                  {webdavResult.domains.map((item) => (
                    <div key={item.domain}>
                      <span className={`status-chip ${item.error ? "sand" : "succeeded"}`}>{item.error ? "失败" : "完成"}</span>
                      <b>{APP_SYNC_DOMAIN_LABELS[item.domain]}</b>
                      <small>{item.error || `${item.records} 条记录 · ${item.files} 个文件${item.skipped ? ` · 跳过 ${item.skipped}` : ""}`}</small>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === "通知" && (
            <>
              <div className="settings-panel-head">
                <div>
                  <p className="eyebrow">NOTIFICATION CHANNELS</p>
                  <h2>通知与任务提醒</h2>
                </div>
              </div>
              <div className="notification-list">
                {["任务完成提醒", "任务失败提醒", "团队项目更新", "系统公告"].map((item, index) => (
                  <div key={item}>
                    <span>
                      <b>{item}</b>
                      <small>{index === 0 ? "生成任务结束时推送" : "在工作台内显示最新状态"}</small>
                    </span>
                    <span className="status-chip blue">站内</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
        <aside className="preferences-side">
          <p className="eyebrow">SYNC STATUS</p>
          <b>{loading ? "正在读取" : "服务端偏好"}</b>
          <span>偏好会应用到新的工作台会话，不影响已有项目快照。</span>
          <hr />
          <p className="eyebrow">WORKSPACE</p>
          <button onClick={() => toast.info("当前工作区：个人")}>个人工作区 <ChevronRight size={14} /></button>
        </aside>
      </div>
    </div>
  );
}

export function AuthView() {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const [locationPath] = location.split("?");
  const nextPath = safeAuthNext(new URLSearchParams(search || window.location.search).get("next"));
  const nextQuery = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
  const isRegister = locationPath === "/register";
  const isV2 = locationPath === "/v2-login";
  const [remember, setRemember] = useState(true);
  const [username, setUsername] = useState(() => getStoredAuthAccount());
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [signupEnabled, setSignupEnabled] = useState(true);
  const { user, loading, refreshUser } = useAuth();

  useEffect(() => {
    getHealth().then((health) => {
      if (typeof health.public_signup === "boolean") setSignupEnabled(health.public_signup);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (loading || !user) return;
    navigate(nextPath || defaultAuthPathForRole(user.role), { replace: true });
  }, [loading, navigate, nextPath, user]);

  useEffect(() => {
    if (isRegister && !signupEnabled) {
      toast.info("当前未开放公开注册，请联系管理员开通账号");
      navigate(`/login${nextQuery}`, { replace: true });
    }
  }, [isRegister, navigate, nextQuery, signupEnabled]);

  async function handleSubmit() {
    if (formLoading) return;
    if (!username.trim()) {
      toast.error("请输入用户名");
      return;
    }
    if (!password) {
      toast.error("请输入密码");
      return;
    }
    setFormLoading(true);
    try {
      if (isRegister) {
        if (password !== confirmPassword) {
          toast.error("两次输入的密码不一致");
          return;
        }
        await register({ username: username.trim(), password, displayName: displayName.trim() || undefined });
        toast.success("注册成功，请登录");
        navigate(`/login${nextQuery}`);
      } else {
        const result = await login(username.trim(), password, remember);
        await refreshUser();
        navigate(nextPath || defaultAuthPathForRole(result.user.role), { replace: true });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败，请重试");
    } finally {
      setFormLoading(false);
    }
  }

  return (
    <main className={`auth-page ${isV2 ? "v2" : ""}`}>
      <section className="auth-story">
        <div className="auth-brand">
          <i>
            <Sparkles size={20} />
          </i>
          <span>
            <b>AI 漫工坊</b>
            <small>{isV2 ? "GLACIER ACCESS" : "MANHUA STUDIO"}</small>
          </span>
        </div>
        <div className="auth-story-copy">
          <p className="eyebrow">{isV2 ? "GLACIER / COLLABORATIVE CANVAS" : "A DIRECTOR'S DESK FOR AI COMICS"}</p>
          <h1>{isV2 ? <>连接你的<br />无限创作画布。</> : <>让每一张关键帧<br />都有下一镜。</>}</h1>
          <p>{isV2 ? "在共享工作面里同步画布、构图和导出任务。" : "在同一张工作桌上组织剧本、资产、镜头和等待落地的生成任务。"}</p>
        </div>
        <div className="auth-scene">
          <span className="auth-card first" />
          <span className="auth-card second" />
          <i />
        </div>
        <footer>系统公告：渲染队列目前运行稳定 · 14:20</footer>
      </section>
      <section className="auth-form-wrap">
        <div className="auth-form">
          <p className="eyebrow">{isRegister ? "CREATE ACCOUNT" : isV2 ? "GLACIER SESSION" : "WELCOME BACK"}</p>
          <h2>{isRegister ? "建立你的工作桌" : isV2 ? "进入共享画布" : "回到分镜室"}</h2>
          <p className="auth-subline">
            {isRegister
              ? "创建账户后即可开始组织个人创作空间。"
              : isV2
                ? "确认身份后继续上一段协作会话。"
                : "输入账户信息，继续上一次的创作现场。"}
          </p>
          {isRegister && (
            <label>
              显示名称
              <input placeholder="例如：林叙" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </label>
          )}
          <label>
            用户名
            <input placeholder="输入用户名" value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label>
            密码
            <div className="password-field">
              <input
                type="password"
                placeholder="输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Eye size={16} />
            </div>
          </label>
          {isRegister && (
            <label>
              确认密码
              <div className="password-field">
                <input
                  type="password"
                  placeholder="再次输入密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
                <Eye size={16} />
              </div>
            </label>
          )}
          {!isRegister && (
            <div className="remember-line">
              <button className={remember ? "check-box checked" : "check-box"} onClick={() => setRemember(!remember)}>
                {remember && <Check size={13} />}
              </button>
              <span>记住本次登录</span>
              <button onClick={() => toast.info("密码重置将在正式系统中发送邮件")}>忘记密码？</button>
            </div>
          )}
          <button className="auth-submit" disabled={formLoading} onClick={handleSubmit}>
            {isRegister ? "创建账户" : isV2 ? "连接工作面" : "进入工作台"} <ChevronRight size={17} />
          </button>
          <div className="auth-switch">
            {isRegister ? "已有账户？" : signupEnabled ? "首次使用？" : "注册由管理员开通。"}
            {(isRegister || signupEnabled) && <button onClick={() => navigate(isRegister ? `/login${nextQuery}` : `/register${nextQuery}`)}>
              {isRegister ? "去登录" : "创建账户"}
            </button>}
          </div>
        </div>
      </section>
    </main>
  );
}

function safeAuthNext(value: string | null) {
  if (!value) return "";
  if (!value.startsWith("/") || value.startsWith("//")) return "";
  if (value.startsWith("/login") || value.startsWith("/register") || value.startsWith("/v2-login")) return "";
  return value;
}
