/**
 * Style reminder: 影印分镜室 — system surfaces remain sparse and operational, while authentication is a focused editorial entry point.
 */
import {
  Activity,
  Bell,
  Check,
  ChevronRight,
  CircleAlert,
  Database,
  Eye,
  KeyRound,
  LockKeyhole,
  MonitorCog,
  PanelTop,
  Plus,
  Save,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserCog,
  Users,
  WandSparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { fetchImageModels, getPreferences, imageModelLabel, login, publicApiError, register, updatePreferences, type ImageModelCatalog, type PromptPreset } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";

function SurfaceTitle({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <div className="feature-title"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{actions}</div>;
}

export function SettingsView() {
  const [tab, setTab] = useState("生成参数");
  const [dots, setDots] = useState(true);
  const [ctrlZoom, setCtrlZoom] = useState(false);
  const [middleButtonHint, setMiddleButtonHint] = useState(true);
  const [imageModel, setImageModel] = useState("");
  const [imageSize, setImageSize] = useState("auto");
  const [imageCount, setImageCount] = useState(1);
  const [modelCatalog, setModelCatalog] = useState<ImageModelCatalog | null>(null);
  const [promptPresets, setPromptPresets] = useState<PromptPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const settingsTabs = [["生成参数", WandSparkles], ["画布操作", PanelTop], ["提示词预设", Sparkles], ["通知", Bell]];

  useEffect(() => {
    Promise.all([getPreferences(), fetchImageModels()]).then(([preferences, catalog]) => {
      setModelCatalog(catalog);
      setImageModel(preferences.generation?.imageModel || catalog.defaultModel);
      setImageSize(preferences.generation?.size || "auto");
      setImageCount(Math.max(1, Number(preferences.generation?.count || 1)));
      setDots((preferences.canvas?.backgroundMode || "dots") === "dots");
      setCtrlZoom(Boolean(preferences.canvas?.wheelZoomRequiresCtrl));
      setMiddleButtonHint(preferences.canvas?.middleButtonLockHint !== false);
      setPromptPresets(preferences.canvas?.promptPresets || []);
    }).catch((error) => toast.error(publicApiError(error, "读取偏好设置失败"))).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await updatePreferences({
        generation: { imageModel, size: imageSize, count: String(imageCount) },
        canvas: { backgroundMode: dots ? "dots" : "lines", wheelZoomRequiresCtrl: ctrlZoom, middleButtonLockHint: middleButtonHint },
      });
      toast.success("个人偏好已保存");
    } catch (error) {
      toast.error(publicApiError(error, "保存偏好设置失败"));
    } finally {
      setSaving(false);
    }
  };

  return <div className="feature-page settings-page"><SurfaceTitle eyebrow="PREFERENCES / YOU" title="偏好设置" description="让默认模型、画布手感和可复用表达方式服从于你的工作节奏。" actions={<button className="vermilion-button" disabled={loading || saving} onClick={() => void save()}><Save size={16} /> {saving ? "保存中…" : "保存偏好"}</button>} /><div className="settings-workspace"><aside className="settings-nav">{settingsTabs.map(([label, Icon]) => <button className={tab === label ? "selected" : ""} onClick={() => setTab(label as string)} key={label as string}><Icon size={17} /><span>{label as string}</span><ChevronRight size={14} /></button>)}</aside><section className="settings-panel">{tab === "生成参数" && <><div className="settings-panel-head"><div><p className="eyebrow">GENERATION DEFAULTS</p><h2>默认生成参数</h2></div><span className="status-chip blue">{loading ? "读取中" : "已同步"}</span></div><div className="settings-fields"><label>默认图像模型<select value={imageModel} onChange={(event) => setImageModel(event.target.value)}>{modelCatalog?.models.map((item) => <option key={item} value={item}>{imageModelLabel(item, modelCatalog)}</option>)}</select></label><label>默认画幅<select value={imageSize} onChange={(event) => setImageSize(event.target.value)}><option value="auto">AUTO 自适应</option><option value="1:1">1:1</option><option value="16:9">16:9</option><option value="9:16">9:16</option></select></label><label>图像数量<div className="stepper"><button onClick={() => setImageCount((value) => Math.max(1, value - 1))}>−</button><b>{String(imageCount).padStart(2, "0")}</b><button onClick={() => setImageCount((value) => Math.min(15, value + 1))}>+</button></div></label></div><section className="quality-note"><ShieldCheck size={20} /><div><b>Provider 路由由完整模型选择器决定</b><span>保存后会保留 providerId::modelId，不会丢失模型提供商。</span></div></section></>}{tab === "画布操作" && <><div className="settings-panel-head"><div><p className="eyebrow">CANVAS BEHAVIOR</p><h2>画布操作</h2></div></div><div className="canvas-pref-preview"><div className={dots ? "dot-preview dots" : "dot-preview lines"}><span>拖拽节点</span><i /></div><div><label>背景参考<div className="seg-switch"><button className={dots ? "active" : ""} onClick={() => setDots(true)}>点阵</button><button className={!dots ? "active" : ""} onClick={() => setDots(false)}>线网</button></div></label><label className="toggle-line"><span><b>滚轮缩放需要 Ctrl</b><small>降低误触缩放画布的概率</small></span><button className={ctrlZoom ? "switch on" : "switch"} onClick={() => setCtrlZoom(!ctrlZoom)}><i /></button></label><label className="toggle-line"><span><b>中键锁定提示</b><small>首次进入画布时显示操作提示</small></span><button className={middleButtonHint ? "switch on" : "switch"} onClick={() => setMiddleButtonHint(!middleButtonHint)}><i /></button></label></div></div></>}{tab === "提示词预设" && <><div className="settings-panel-head"><div><p className="eyebrow">PROMPT PRESETS</p><h2>个人提示词预设</h2></div><button className="outline-button small" onClick={() => window.location.assign("/prompts")}><Plus size={15} /> 管理预设</button></div><div className="preset-settings-list">{promptPresets.length ? promptPresets.map((preset) => <button onClick={() => window.location.assign("/prompts")} key={preset.id}><span><b>{preset.title}</b><small>{preset.tags.join(" / ") || preset.prompt.slice(0, 40)}</small></span><ChevronRight size={15} /></button>) : <div className="empty-output"><p>暂无个人提示词预设</p></div>}</div></>}{tab === "通知" && <><div className="settings-panel-head"><div><p className="eyebrow">NOTIFICATION CHANNELS</p><h2>通知与任务提醒</h2></div></div><div className="notification-list">{["任务完成提醒", "任务失败提醒", "团队项目更新", "系统公告"].map((item, index) => <div key={item}><span><b>{item}</b><small>{index === 0 ? "生成任务结束时推送" : "在工作台内显示最新状态"}</small></span><span className="status-chip blue">站内</span></div>)}</div></>}</section><aside className="preferences-side"><p className="eyebrow">SYNC STATUS</p><b>{loading ? "正在读取" : "服务端偏好"}</b><span>偏好会应用到新的工作台会话，不影响已有项目快照。</span><hr /><p className="eyebrow">WORKSPACE</p><button onClick={() => toast.info("当前工作区：个人")}>个人工作区 <ChevronRight size={14} /></button></aside></div></div>;
}

const adminRows = [
  { name: "林叙", role: "super_admin", status: "active", last: "刚刚" },
  { name: "沈阑", role: "member", status: "active", last: "15 分钟前" },
  { name: "章霁", role: "member", status: "suspended", last: "昨天" },
];

export function AuthView() {
  const [location, navigate] = useLocation();
  const isRegister = location === "/register";
  const isV2 = location === "/v2-login";
  const [remember, setRemember] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const { refreshUser } = useAuth();
  async function handleSubmit() {
    if (formLoading) return;
    if (!username.trim()) { toast.error("请输入用户名"); return; }
    if (!password) { toast.error("请输入密码"); return; }
    setFormLoading(true);
    try {
      if (isRegister) {
        if (password !== confirmPassword) { toast.error("两次输入的密码不一致"); setFormLoading(false); return; }
        await register({ username: username.trim(), password, displayName: displayName.trim() || undefined });
        toast.success("注册成功，请登录");
        navigate("/login");
      } else {
        await login(username.trim(), password, remember);
        await refreshUser();
        navigate("/");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败，请重试");
    } finally {
      setFormLoading(false);
    }
  }
  return <main className={`auth-page ${isV2 ? "v2" : ""}`}><section className="auth-story"><div className="auth-brand"><i><Sparkles size={20} /></i><span><b>AI 漫工坊</b><small>{isV2 ? "GLACIER ACCESS" : "MANHUA STUDIO"}</small></span></div><div className="auth-story-copy"><p className="eyebrow">{isV2 ? "GLACIER / COLLABORATIVE CANVAS" : "A DIRECTOR'S DESK FOR AI COMICS"}</p><h1>{isV2 ? <>连接你的<br />无限创作画布。</> : <>让每一张关键帧<br />都有下一镜。</>}</h1><p>{isV2 ? "在共享工作面里同步画布、构图和导出任务。" : "在同一张工作桌上组织剧本、资产、镜头和等待落地的生成任务。"}</p></div><div className="auth-scene"><span className="auth-card first" /><span className="auth-card second" /><i /></div><footer>系统公告：渲染队列目前运行稳定 · 14:20</footer></section><section className="auth-form-wrap"><div className="auth-form"><p className="eyebrow">{isRegister ? "CREATE ACCOUNT" : isV2 ? "GLACIER SESSION" : "WELCOME BACK"}</p><h2>{isRegister ? "建立你的工作桌" : isV2 ? "进入共享画布" : "回到分镜室"}</h2><p className="auth-subline">{isRegister ? "创建账户后即可开始组织个人创作空间。" : isV2 ? "确认身份后继续上一段协作会话。" : "输入账户信息，继续上一次的创作现场。"}</p>{isRegister && <label>显示名称<input placeholder="例如：林叙" value={displayName} onChange={e => setDisplayName(e.target.value)} /></label>}<label>用户名<input placeholder="输入用户名" value={username} onChange={e => setUsername(e.target.value)} /></label><label>密码<div className="password-field"><input type="password" placeholder="输入密码" value={password} onChange={e => setPassword(e.target.value)} /><Eye size={16} /></div></label>{isRegister && <label>确认密码<div className="password-field"><input type="password" placeholder="再次输入密码" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /><Eye size={16} /></div></label>}{!isRegister && <div className="remember-line"><button className={remember ? "check-box checked" : "check-box"} onClick={() => setRemember(!remember)}>{remember && <Check size={13} />}</button><span>记住本次登录</span><button onClick={() => toast.info("密码重置将在正式系统中发送邮件")}>忘记密码？</button></div>}<button className="auth-submit" disabled={formLoading} onClick={handleSubmit}>{isRegister ? "创建账户" : isV2 ? "连接工作面" : "进入工作台"} <ChevronRight size={17} /></button><div className="auth-switch">{isRegister ? "已有账户？" : "首次使用？"}<button onClick={() => navigate(isRegister ? "/login" : "/register")}>{isRegister ? "去登录" : "创建账户"}</button></div></div></section></main>;
}
