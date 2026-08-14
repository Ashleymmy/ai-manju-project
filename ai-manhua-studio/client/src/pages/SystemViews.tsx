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
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { login, register } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";

function SurfaceTitle({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <div className="feature-title"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{actions}</div>;
}

export function SettingsView() {
  const [tab, setTab] = useState("生成参数");
  const [dots, setDots] = useState(true);
  const [ctrlZoom, setCtrlZoom] = useState(false);
  const settingsTabs = [["生成参数", WandSparkles], ["画布操作", PanelTop], ["提示词预设", Sparkles], ["通知", Bell]];
  return <div className="feature-page settings-page"><SurfaceTitle eyebrow="PREFERENCES / YOU" title="偏好设置" description="让默认模型、画布手感和可复用表达方式服从于你的工作节奏。" actions={<button className="vermilion-button" onClick={() => toast.success("个人偏好已保存") }><Save size={16} /> 保存偏好</button>} /><div className="settings-workspace"><aside className="settings-nav">{settingsTabs.map(([label, Icon]) => <button className={tab === label ? "selected" : ""} onClick={() => setTab(label as string)} key={label as string}><Icon size={17} /><span>{label as string}</span><ChevronRight size={14} /></button>)}</aside><section className="settings-panel">{tab === "生成参数" && <><div className="settings-panel-head"><div><p className="eyebrow">GENERATION DEFAULTS</p><h2>默认生成参数</h2></div><span className="status-chip blue">已同步</span></div><div className="settings-fields"><label>默认图像模型<div className="setting-select">G-IMAGE / HIGH <ChevronRight size={15} /></div></label><label>默认视频模型<div className="setting-select">Seedance / V2 <ChevronRight size={15} /></div></label><label>默认画幅<div className="setting-select">1:1 · 1024 × 1024 <ChevronRight size={15} /></div></label><label>图像数量<div className="stepper"><button>−</button><b>04</b><button>+</button></div></label></div><section className="quality-note"><ShieldCheck size={20} /><div><b>高质量模式已启用</b><span>关键帧生成默认使用较高推理规格，减少后续重绘成本。</span></div><button onClick={() => toast.info("质量策略将在执行时按队列负载调整")}>了解策略</button></section></>}{tab === "画布操作" && <><div className="settings-panel-head"><div><p className="eyebrow">CANVAS BEHAVIOR</p><h2>画布操作</h2></div></div><div className="canvas-pref-preview"><div className={dots ? "dot-preview dots" : "dot-preview lines"}><span>拖拽节点</span><i /></div><div><label>背景参考<div className="seg-switch"><button className={dots ? "active" : ""} onClick={() => setDots(true)}>点阵</button><button className={!dots ? "active" : ""} onClick={() => setDots(false)}>线网</button><button>留白</button></div></label><label className="toggle-line"><span><b>滚轮缩放需要 Ctrl</b><small>降低误触缩放画布的概率</small></span><button className={ctrlZoom ? "switch on" : "switch"} onClick={() => setCtrlZoom(!ctrlZoom)}><i /></button></label><label className="toggle-line"><span><b>中键锁定提示</b><small>首次进入画布时显示操作提示</small></span><button className="switch on"><i /></button></label></div></div></>}{tab === "提示词预设" && <><div className="settings-panel-head"><div><p className="eyebrow">PROMPT PRESETS</p><h2>个人提示词预设</h2></div><button className="outline-button small" onClick={() => toast.success("已新增预设草稿") }><Plus size={15} /> 新建预设</button></div><div className="preset-settings-list">{[["雨幕调色", "低饱和蓝灰 / 朱砂红焦点"], ["叙事镜头", "低机位 / 35mm / 手持推近"], ["角色定场", "环境留白 / 轮廓光 / 情绪标签"]].map(([name, detail]) => <button onClick={() => toast.info(`已展开预设：${name}`)} key={name}><span><b>{name}</b><small>{detail}</small></span><ChevronRight size={15} /></button>)}</div></>}{tab === "通知" && <><div className="settings-panel-head"><div><p className="eyebrow">NOTIFICATION CHANNELS</p><h2>通知与任务提醒</h2></div></div><div className="notification-list">{["任务完成提醒", "任务失败提醒", "团队项目更新", "系统公告"].map((item, index) => <div key={item}><span><b>{item}</b><small>{index === 0 ? "生成任务结束时推送" : "在工作台内显示最新状态"}</small></span><button className="switch on"><i /></button></div>)}</div></>}</section><aside className="preferences-side"><p className="eyebrow">LAST SAVED</p><b>今天 14:26</b><span>偏好会应用到新的工作台会话，不影响已有项目快照。</span><hr /><p className="eyebrow">WORKSPACE</p><button onClick={() => toast.info("当前工作区：个人")}>个人工作区 <ChevronRight size={14} /></button><button onClick={() => toast.info("团队工作区将在协作版开放")}>切换团队空间 <ChevronRight size={14} /></button></aside></div></div>;
}

const adminRows = [
  { name: "林叙", role: "super_admin", status: "active", last: "刚刚" },
  { name: "沈阑", role: "member", status: "active", last: "15 分钟前" },
  { name: "章霁", role: "member", status: "suspended", last: "昨天" },
];

export function AdminView() {
  const [tab, setTab] = useState("用户");
  return <div className="feature-page admin-page"><SurfaceTitle eyebrow="SYSTEM / SUPER ADMIN" title="管理后台" description="管理成员访问、模型提供商、系统公告与任务基础设施。" actions={<span className="admin-health"><i />系统运行正常</span>} /><div className="admin-workspace"><aside className="admin-nav">{[["用户", Users], ["模型提供商", ServerCog], ["系统公告", Bell], ["运行监控", Activity], ["Seedance 素材", Database]].map(([label, Icon]) => <button className={tab === label ? "selected" : ""} onClick={() => setTab(label as string)} key={label as string}><Icon size={17} />{label as string}</button>)}</aside><section className="admin-panel">{tab === "用户" && <><div className="admin-panel-head"><div><p className="eyebrow">IDENTITY / 24</p><h2>用户与权限</h2></div><button className="vermilion-button" onClick={() => toast.success("已打开创建用户表单") }><Plus size={16} /> 创建用户</button></div><div className="admin-table"><div className="admin-table-head"><span>用户</span><span>角色</span><span>状态</span><span>最近活动</span><span /></div>{adminRows.map((user) => <div className="admin-table-row" key={user.name}><span><i>{user.name.slice(0, 1)}</i><b>{user.name}</b></span><span><code>{user.role}</code></span><span><em className={user.status}>{user.status === "active" ? "正常" : "已停用"}</em></span><span>{user.last}</span><button onClick={() => toast.info(`编辑 ${user.name} 的权限`)}><UserCog size={15} /></button></div>)}</div></>}{tab === "模型提供商" && <><div className="admin-panel-head"><div><p className="eyebrow">PROVIDERS / 03</p><h2>模型提供商</h2></div><button className="vermilion-button" onClick={() => toast.success("已打开提供商创建表单") }><Plus size={16} /> 新建提供商</button></div><div className="provider-list">{[["G-IMAGE 主实例", "openai_compatible", "图像 · 文本", "已启用"], ["Seedance 视频节点", "volcengine_ark", "视频 · 音频", "已启用"], ["Archive Fallback", "openai_compatible", "图像", "待测试"]].map(([name, type, capability, status]) => <article key={name}><div><ServerCog size={20} /><span><b>{name}</b><small>{type}</small></span></div><span>{capability}</span><em className={status === "已启用" ? "active" : "pending"}>{status}</em><button onClick={() => toast.info(`已启动 ${name} 的连接测试`)}>测试连接</button></article>)}</div></>}{tab === "系统公告" && <><div className="admin-panel-head"><div><p className="eyebrow">ANNOUNCEMENTS / LIVE</p><h2>系统公告</h2></div><button className="vermilion-button" onClick={() => toast.success("已创建公告草稿") }><Plus size={16} /> 发布公告</button></div><div className="announcement-card"><div><span className="status-chip running">LIVE</span><b>Seedance 视频模型维护窗口</b><p>今晚 23:00–23:30 视频生成请求将自动切换到排队模式。</p></div><aside><small>发布于 今天 11:20</small><button onClick={() => toast.info("公告已撤销")}>撤销</button></aside></div></>}{tab === "运行监控" && <><div className="admin-panel-head"><div><p className="eyebrow">MONITORING / LIVE</p><h2>系统运行监控</h2></div></div><div className="monitor-grid">{[["API Server", "24 ms", "healthy"], ["Redis Queue", "18 waiting", "healthy"], ["Celery Worker", "04 active", "healthy"], ["Storage", "71% used", "watch"]].map(([name, value, state]) => <div key={name}><span>{name}</span><b>{value}</b><em className={state}>{state === "healthy" ? "正常" : "注意容量"}</em></div>)}</div><div className="monitor-log"><p className="eyebrow">RECENT EVENTS</p>{["JOB-8F13 entered rendering phase", "Worker 04 completed asset batch B-2408", "Provider g-image connection refreshed"].map((item) => <div key={item}><i />{item}<small>刚刚</small></div>)}</div></>}{tab === "Seedance 素材" && <><div className="admin-panel-head"><div><p className="eyebrow">SEEDANCE / ASSETS</p><h2>Seedance 视频素材</h2></div><button className="vermilion-button" onClick={() => toast.success("素材上传队列已打开") }><Plus size={16} /> 上传素材</button></div><div className="seedance-board">{["雨幕街道素材包", "人物轮廓动作库", "室内光照参考"].map((name, index) => <article key={name}><span className="seedance-index">0{index + 1}</span><div><b>{name}</b><small>12 clips · 4K source · synced</small></div><span className="status-chip succeeded">就绪</span><button onClick={() => toast.info(`${name} 已开始同步`) }>同步</button></article>)}</div></>}</section><aside className="admin-side-status"><p className="eyebrow">ACCESS LEVEL</p><ShieldCheck size={24} /><h3>super_admin</h3><p>当前会话可修改全局配置。所有管理操作将在审计日志中记录。</p><hr /><p className="eyebrow">QUICK ACTIONS</p><button onClick={() => toast.info("健康检查结果：全部服务响应") }><Activity size={15} /> 执行健康检查</button><button onClick={() => toast.info("已导出今日审计日志") }><LockKeyhole size={15} /> 导出审计日志</button></aside></div></div>;
}

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
