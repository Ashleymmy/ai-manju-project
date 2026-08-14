/**
 * Style reminder: 影印分镜室 — editorial desktop, technical index labels, vermilion action color, and asymmetrical working surfaces.
 */
import { apiContract, type JobState } from "@/lib/api-contract";
import {
  Aperture,
  Archive,
  ArrowDownToLine,
  ArrowUpRight,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Clapperboard,
  Clock3,
  Command,
  Compass,
  Film,
  FolderKanban,
  Grid2X2,
  Image as ImageIcon,
  Layers3,
  Library,
  Maximize2,
  Menu,
  MoreHorizontal,
  MousePointer2,
  PanelRight,
  Pause,
  Play,
  Plus,
  RadioTower,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Terminal,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { AssetLibraryView, ComicAssetsView, DirectorView, ImageWorkbenchView, PromptLibraryView, TagLibraryView } from "./FeatureViews";
import { AdminView, SettingsView } from "./SystemViews";

const logoUrl = "/logo.png";
const heroUrl = "";
const cityUrl = "";
const desertUrl = "";
const roomUrl = "";

type Icon = typeof Grid2X2;
type NavItem = { label: string; href: string; icon: Icon; shortcut?: string };

const creationNav: NavItem[] = [
  { label: "工作台", href: "/", icon: Grid2X2, shortcut: "G D" },
  { label: "全部项目", href: "/projects", icon: FolderKanban, shortcut: "G P" },
  { label: "画布工坊", href: "/canvas", icon: Compass, shortcut: "G C" },
  { label: "3D 导演台", href: "/director", icon: Box },
  { label: "漫剧资产助手", href: "/comic-assets", icon: Clapperboard },
];

const libraryNav: NavItem[] = [
  { label: "关键帧生成", href: "/image", icon: WandSparkles },
  { label: "资产库", href: "/assets", icon: Library },
  { label: "标签库", href: "/tags", icon: Tag },
  { label: "提示词库", href: "/prompts", icon: Terminal },
];

const systemNav: NavItem[] = [
  { label: "渲染队列", href: "/queue", icon: RadioTower },
  { label: "偏好设置", href: "/settings", icon: Settings2 },
];

const projectCards = [
  {
    title: "《雨幕收容所》",
    code: "PRJ-034",
    chapter: "EP.01 · 场景 08",
    image: cityUrl,
    state: "正在铺镜",
    color: "blue",
    time: "10 分钟前",
  },
  {
    title: "《白沙之眼》",
    code: "PRJ-031",
    chapter: "EP.03 · 场景 02",
    image: desertUrl,
    state: "等待审片",
    color: "red",
    time: "昨天",
  },
  {
    title: "《未寄出的夏天》",
    code: "PRJ-026",
    chapter: "角色 · 情绪探索",
    image: roomUrl,
    state: "素材归档",
    color: "sand",
    time: "8 月 10 日",
  },
];

const jobs: Array<{
  id: string;
  name: string;
  type: string;
  state: JobState;
  progress: number;
  updated: string;
}> = [
  { id: "JOB-8F12", name: "雨夜巷口 · 第 04 帧", type: "IMAGE / 4K", state: "running", progress: 72, updated: "00:26" },
  { id: "JOB-8F0C", name: "白沙遗迹 · 广角", type: "IMAGE / HD", state: "queued", progress: 0, updated: "排队第 2 位" },
  { id: "JOB-8EC3", name: "潮汐声场 · 环境音", type: "AUDIO / WAV", state: "succeeded", progress: 100, updated: "已完成" },
  { id: "JOB-8EBB", name: "避雨亭 · 推镜", type: "VIDEO / 6S", state: "failed", progress: 38, updated: "需要重试" },
];

const pageTitles: Record<string, { code: string; title: string; subtitle: string }> = {
  "/": { code: "DESK / 01", title: "今日片场", subtitle: "在同一张工作桌上收拢灵感、镜头和等待落地的任务。" },
  "/projects": { code: "ARCHIVE / 12", title: "全部项目", subtitle: "画布、角色与分镜在这里留下持续可回看的版本。" },
  "/canvas": { code: "CANVAS / PRJ-034", title: "雨幕收容所", subtitle: "EP.01 · 场景 08 · 所有改动将以 500ms 节流保存。" },
  "/director": { code: "DIRECTOR / BETA", title: "3D 导演台", subtitle: "用可控机位先排布构图，再将镜头交还给生成流程。" },
  "/comic-assets": { code: "ASSET ASSIST / 05", title: "漫剧资产助手", subtitle: "从剧本中提取角色、场景和关键道具，并一次性组织批量生成。" },
  "/image": { code: "KEYFRAME / NEW", title: "关键帧生成", subtitle: "把描述、参考图和模型参数收束为一帧可继续工作的画面。" },
  "/assets": { code: "LIBRARY / 248", title: "资产库", subtitle: "角色、环境、道具与参考素材都能追溯来处和使用位置。" },
  "/tags": { code: "TAXONOMY / 36", title: "标签库", subtitle: "用语义层级把镜头语言、情绪和视觉资产编织到一起。" },
  "/prompts": { code: "PROMPTS / 18", title: "提示词库", subtitle: "把反复有效的表达方式变成下一次创作的可调用片段。" },
  "/queue": { code: "RENDER / LIVE", title: "渲染队列", subtitle: "所有图像、视频与批量生成任务在这一处显示即时状态。" },
  "/settings": { code: "PREFERENCES / YOU", title: "偏好设置", subtitle: "调整默认模型、图像规格和画布操作方式，让工作台更像你的习惯。" },
  "/admin": { code: "SYSTEM / SUPER ADMIN", title: "管理后台", subtitle: "管理成员访问、模型提供商、系统公告与任务基础设施。" },
};

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-lockup">
      <span className="brand-symbol"><img className="brand-mark" src={logoUrl} alt="AI 漫工坊" /><i /></span>
      {!compact && (
        <div className="brand-type">
          <strong>AI 漫工坊</strong>
          <span>MANHUA STUDIO</span>
        </div>
      )}
    </div>
  );
}

function NavGroup({ title, items, currentPath }: { title: string; items: NavItem[]; currentPath: string }) {
  return (
    <div className="nav-group">
      <div className="nav-label">{title}</div>
      {items.map(({ href, icon: IconComponent, label, shortcut }) => {
        const active = href === currentPath;
        return (
          <Link key={href} href={href} title={label} className={`side-link ${active ? "is-active" : ""}`}>
            <IconComponent size={17} strokeWidth={active ? 2.4 : 1.8} />
            <span>{label}</span>
            {shortcut && <kbd>{shortcut}</kbd>}
          </Link>
        );
      })}
    </div>
  );
}

function SideRail({ currentPath, collapsed, onCollapse }: { currentPath: string; collapsed: boolean; onCollapse: () => void }) {
  const [, navigate] = useLocation();
  const { user, logout } = useAuth();
  return (
    <aside className={`side-rail ${collapsed ? "is-collapsed" : ""}`}>
      <div className="side-head">
        <BrandMark compact={collapsed} />
        <button className="icon-button subtle collapse-button" onClick={onCollapse} aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"} title={collapsed ? "展开侧边栏" : "收起侧边栏"}>
          {collapsed ? <ChevronRight size={18} /> : <Menu size={18} />}
        </button>
      </div>
      <div className="side-nav">
        <NavGroup title="制作桌" items={creationNav} currentPath={currentPath} />
        <NavGroup title="素材与语言" items={libraryNav} currentPath={currentPath} />
        <NavGroup title="系统" items={systemNav} currentPath={currentPath} />
      </div>
      <div className="side-foot">
        <div className="side-meter">
          <div className="side-meter-top"><span>本月生成额度</span><b>61%</b></div>
          <div className="meter"><span style={{ width: "61%" }} /></div>
          <small>217 / 360 次图像任务</small>
        </div>
        <button className="user-card" onClick={() => logout().then(() => navigate("/login"))}>
          <span className="avatar">{(user?.display_name ?? user?.username ?? "?").at(0)?.toUpperCase() ?? "?"}</span>
          <span className="user-meta"><b>{user?.display_name ?? user?.username ?? "—"}</b><small>{user?.role === "super_admin" ? "超级管理员" : "创作成员"}</small></span>
          <MoreHorizontal size={16} />
        </button>
      </div>
    </aside>
  );
}

function TopBar({ path }: { path: string }) {
  const [, navigate] = useLocation();
  return (
    <header className="topbar">
      <div className="top-brand-area"><BrandMark /><div className="crumbs"><span>DESK</span><ChevronRight size={15} /><b>{pageTitles[path]?.title ?? "工作台"}</b></div></div>
      <div className="top-actions">
        <button className="command-search" onClick={() => toast.message("命令面板：搜索项目、资产、提示词…")}><Search size={17} /><span>检索工作桌</span><kbd>⌘ K</kbd></button>
        <span className="live-dot"><i />2 个任务执行中</span>
        <button className="icon-button subtle" aria-label="打开通知" onClick={() => toast.info("没有新的制作通知")}><CircleDashed size={18} /></button>
        <button className="create-button" onClick={() => navigate("/canvas")}><Plus size={17} /> 新建画布</button>
      </div>
    </header>
  );
}

function PageIntro({ path, action }: { path: string; action?: React.ReactNode }) {
  const copy = pageTitles[path] ?? pageTitles["/"];
  return <div className="page-intro"><div><p className="eyebrow">{copy.code}</p><h1>{copy.title}</h1><p>{copy.subtitle}</p></div>{action}</div>;
}

function StatStrip() {
  return (
    <section className="stat-strip">
      <div><span>进行中任务</span><strong>02</strong><small>1 图像 · 1 批量生成</small></div>
      <div><span>本周关键帧</span><strong>48</strong><small className="positive">+12 较上周</small></div>
      <div><span>可调用资产</span><strong>248</strong><small>16 个新归档</small></div>
      <div><span>当前项目</span><strong>06</strong><small>2 个等待审片</small></div>
    </section>
  );
}

function Timeline() {
  return (
    <div className="timeline-card">
      <div className="section-line"><span className="eyebrow">现场切片</span><button onClick={() => toast.info("将跳转至完整任务队列")}>查看队列 <ArrowUpRight size={15} /></button></div>
      <div className="timeline-flow">
        <div className="timeline-time"><b>14:00</b><span>现在</span></div>
        <div className="timeline-entry active"><i /><div><b>《雨幕收容所》</b><span>关键帧生成 · 第 04 帧</span></div><span className="status-chip blue">72%</span></div>
        <div className="timeline-entry"><i /><div><b>《白沙之眼》</b><span>场景草图批量生成</span></div><span className="status-chip">等待资源</span></div>
        <div className="timeline-entry"><i /><div><b>《未寄出的夏天》</b><span>资产整理 · 人物情绪表</span></div><span className="status-chip sand">待校对</span></div>
      </div>
    </div>
  );
}

function Dashboard() {
  const [, navigate] = useLocation();
  return (
    <div className="page-content dashboard-page">
      <PageIntro path="/" action={<button className="outline-button" onClick={() => navigate("/projects")}>打开项目归档 <ArrowUpRight size={16} /></button>} />
      <StatStrip />
      <div className="desk-layout">
        <section className="spotlight-card">
          <img src={heroUrl} alt="抽象的分镜创作桌面" />
          <div className="spotlight-overlay" />
          <div className="spotlight-copy"><p className="eyebrow light">CONTINUE MAKING</p><h2>把这一格推向<br />下一镜。</h2><p>“雨幕收容所”正在等待你决定雨落下的速度。</p><button className="vermilion-button" onClick={() => navigate("/canvas")}><MousePointer2 size={16} /> 回到无限画布</button></div>
          <div className="spotlight-meta"><span>PRJ-034 / EP.01</span><span>最近保存 14:26</span></div>
        </section>
        <Timeline />
      </div>
      <section className="section-head"><div><p className="eyebrow">RECENT SURFACES</p><h2>最近展开的工作面</h2></div><button className="text-button" onClick={() => navigate("/projects")}>全部项目 <ChevronRight size={16} /></button></section>
      <div className="project-row">{projectCards.map((project) => <ProjectCard key={project.code} {...project} />)}</div>
    </div>
  );
}

function ProjectCard({ title, code, chapter, image, state, color, time }: (typeof projectCards)[number]) {
  const [, navigate] = useLocation();
  return <button className="project-card" onClick={() => navigate("/canvas")}><div className="project-visual"><img src={image} alt="" /><span className={`state-ribbon ${color}`}>{state}</span><span className="project-code">{code}</span></div><div className="project-info"><div><h3>{title}</h3><p>{chapter}</p></div><span>{time}</span></div></button>;
}

function Projects() {
  return <div className="page-content"><PageIntro path="/projects" action={<button className="create-button" onClick={() => toast.success("已建立一个空白项目草稿") }><Plus size={17} /> 新建项目</button>} /><div className="filter-line"><div className="segmented"><button className="selected">最近修改</button><button>进行中</button><button>已归档</button></div><button className="outline-button small"><SlidersHorizontal size={16} /> 筛选与排序</button></div><div className="project-grid">{[...projectCards, ...projectCards].map((project, index) => <ProjectCard key={`${project.code}-${index}`} {...project} />)}</div></div>;
}

function CanvasNode({ id, label, title, image, selected, onSelect, className }: { id: string; label: string; title: string; image?: string; selected: boolean; onSelect: () => void; className: string }) {
  return <button className={`canvas-node ${className} ${selected ? "selected" : ""}`} onClick={onSelect}><span className="node-pin" /><div className="node-bar"><span>{label}</span><MoreHorizontal size={14} /></div>{image ? <img src={image} alt="" /> : <div className="prompt-body"><Sparkles size={18} /><p>{title}</p></div>}<div className="node-foot"><span>{image ? "1024 × 1024" : "PROMPT"}</span><span>{id}</span></div></button>;
}

function Canvas() {
  const [selected, setSelected] = useState("frame");
  const [zoom, setZoom] = useState(82);
  const [mode, setMode] = useState("选择");
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth > 760);
  const nodes = useMemo(() => [
    { id: "N-01", label: "提示词", title: "雨夜，狭长街道，手持镜头…", className: "node-prompt", image: undefined },
    { id: "N-02", label: "参考构图", title: "", className: "node-ref", image: cityUrl },
    { id: "N-03", label: "关键帧", title: "", className: "node-frame", image: roomUrl },
  ], []);
  return <div className="canvas-page"><div className="canvas-heading"><PageIntro path="/canvas" /><div className="canvas-head-actions"><button className="outline-button small" onClick={() => toast.success("快照已记录：14:26:38") }><Check size={15} /> 已保存</button><button className={`outline-button small inspector-trigger ${inspectorOpen ? "is-active" : ""}`} onClick={() => setInspectorOpen((value) => !value)}><PanelRight size={15} /> 检查器</button><button className="vermilion-button" onClick={() => toast.message("已提交图像生成任务：JOB-8F13") }><WandSparkles size={16} /> 生成关键帧</button></div></div><div className={`canvas-workspace ${inspectorOpen ? "inspector-open" : ""}`}><section className="canvas-stage"><div className="canvas-top-tools"><div className="tool-cluster"><button className={mode === "选择" ? "active" : ""} onClick={() => setMode("选择")}><MousePointer2 size={16} /></button><button className={mode === "添加" ? "active" : ""} onClick={() => setMode("添加")}><Plus size={16} /></button><button className={mode === "连接" ? "active" : ""} onClick={() => setMode("连接")}><Aperture size={16} /></button></div><span>{mode}模式</span><div className="canvas-title-chip"><i /> 场景 08 · 雨夜巷口</div></div><div className="canvas-grid"><div className="registration-cross cross-one" /><div className="registration-cross cross-two" />{nodes.map((node) => <CanvasNode key={node.id} {...node} selected={selected === node.id || (node.id === "N-03" && selected === "frame")} onSelect={() => setSelected(node.id)} />)}<svg className="node-lines" viewBox="0 0 1000 580" preserveAspectRatio="none" aria-hidden="true"><path d="M265 245 C 370 245, 370 190, 455 190" /><path d="M630 190 C 735 190, 720 285, 785 285" /></svg></div><div className="canvas-bottom-tools"><button onClick={() => setZoom(Math.max(40, zoom - 10))}>−</button><b>{zoom}%</b><button onClick={() => setZoom(Math.min(150, zoom + 10))}>+</button><span /><button onClick={() => setZoom(82)}><Maximize2 size={15} /> 适配</button></div></section><aside className="inspector-panel"><div className="inspector-head"><div><p className="eyebrow">INSPECTOR</p><h3>{selected === "N-01" ? "提示词节点" : selected === "N-02" ? "参考构图" : "关键帧 · 04"}</h3></div><button className="icon-button subtle" onClick={() => setInspectorOpen(false)} aria-label="关闭检查器"><X size={16} /></button></div><div className="mini-preview"><img src={selected === "N-02" ? cityUrl : roomUrl} alt="" /><span className="status-chip blue">已连接</span></div><div className="inspector-block"><span className="field-label">画面描述</span><p className="prompt-copy">狭长、潮湿的城市巷道，一名人物站在红色招牌下，镜头缓慢推近，雨水形成细密的前景层。</p></div><div className="inspector-block"><span className="field-label">生成参数</span><div className="parameter-row"><span>模型</span><b>G-IMAGE / HIGH</b></div><div className="parameter-row"><span>画幅</span><b>1:1 · 1024</b></div><div className="parameter-row"><span>参考图</span><b>01 份</b></div></div><button className="full-outline" onClick={() => toast.info("参数编辑面板为原型占位，实际将调用 POST /api/jobs") }>编辑参数 <ChevronRight size={16} /></button></aside></div></div>;
}

function Queue() {
  const [filter, setFilter] = useState<JobState | "all">("all");
  const [paused, setPaused] = useState<string[]>([]);
  const visible = jobs.filter((job) => filter === "all" || job.state === filter);
  const tabs: Array<[JobState | "all", string]> = [["all", "全部 04"], ["running", "执行中 01"], ["queued", "等待 01"], ["succeeded", "完成 01"], ["failed", "异常 01"]];
  return <div className="page-content"><PageIntro path="/queue" action={<div className="queue-health"><i />SSE 流已连接</div>} /><div className="queue-layout"><section className="queue-card"><div className="queue-tabs">{tabs.map(([key, label]) => <button className={filter === key ? "active" : ""} key={key} onClick={() => setFilter(key)}>{label}</button>)}</div><div className="job-list">{visible.map((job) => <div className="job-row" key={job.id}><div className={`job-icon ${job.state}`}><Film size={18} /></div><div className="job-copy"><div><b>{job.name}</b><span>{job.type} · {job.id}</span></div>{job.state === "running" && <div className="job-progress"><i style={{ width: `${job.progress}%` }} /></div>}</div><div className="job-state"><span className={`status-chip ${job.state}`}>{job.state === "running" ? "生成中" : job.state === "queued" ? "队列中" : job.state === "succeeded" ? "已完成" : "异常"}</span><small>{job.updated}</small></div><button className="icon-button subtle" onClick={() => { if (job.state === "running") { setPaused((now) => now.includes(job.id) ? now.filter((id) => id !== job.id) : [...now, job.id]); toast.message(paused.includes(job.id) ? "已恢复本任务" : "已暂停本任务"); } else toast.info("任务操作将在服务接入后启用"); }}>{paused.includes(job.id) ? <Play size={16} /> : job.state === "running" ? <Pause size={16} /> : <MoreHorizontal size={16} />}</button></div>)}</div></section><aside className="queue-aside"><p className="eyebrow">STATUS MACHINE</p><h3>让每次等待<br />都看得见。</h3><div className="state-machine"><span className="done">queued</span><i /><span className="active">running</span><i /><span>succeeded</span></div><p>当前队列先尝试 SSE 推送；8 秒未响应时自动降级为 3 秒轮询。</p><code>{apiContract.queue.list}</code></aside></div></div>;
}

function Assets() {
  const assetItems = [
    ["雨夜巷口", cityUrl, "environment"], ["旅人轮廓", desertUrl, "character"], ["旧屋桌面", roomUrl, "prop"], ["密度参考", cityUrl, "reference"], ["白沙光比", desertUrl, "environment"], ["蓝调室内", roomUrl, "environment"],
  ];
  return <div className="page-content"><PageIntro path="/assets" action={<button className="create-button" onClick={() => toast.success("上传队列已打开") }><ArrowDownToLine size={17} /> 导入资产</button>} /><div className="asset-layout"><aside className="asset-filter"><span className="field-label">智能视图</span><button className="selected"><Sparkles size={15} /> 全部资产 <b>248</b></button><button><Check size={15} /> 已收藏 <b>32</b></button><button><Archive size={15} /> 未使用 <b>17</b></button><hr /><span className="field-label">分类</span>{["角色 · character", "环境 · environment", "道具 · prop", "参考 · reference"].map((item) => <button key={item}>{item}<ChevronRight size={14} /></button>)}</aside><section><div className="asset-toolbar"><div className="segmented"><button className="selected">图组</button><button>列表</button></div><button className="outline-button small"><SlidersHorizontal size={16} /> 最近使用</button></div><div className="asset-grid">{assetItems.map(([name, image, type], i) => <button className="asset-card" key={`${name}-${i}`} onClick={() => toast.info(`已选择资产：${name}`)}><div><img src={image} alt="" /><span>{type}</span></div><b>{name}</b><small>使用于 {i + 1} 个项目</small></button>)}</div></section></div></div>;
}

function GenericTool({ path }: { path: string }) {
  const copy = pageTitles[path] ?? pageTitles["/"];
  const toolMap: Record<string, { accent: string; steps: string[]; cta: string }> = {
    "/director": { accent: "二维图像先搭建镜头关系，再进入可控机位。", steps: ["导入场景参考", "放置镜头和角色", "导出构图提示"], cta: "打开导演桌" },
    "/comic-assets": { accent: "从剧本中提炼可批量生产的视觉资产。", steps: ["上传剧本文本", "审核候选资产", "创建生成批次"], cta: "新建分析会话" },
    "/image": { accent: "先落下关键帧，再决定世界怎么动。", steps: ["写下镜头描述", "挂接参考图", "提交图像任务"], cta: "开始生成" },
    "/tags": { accent: "标签不只是分类，它让构图、情绪和资产能够彼此找到。", steps: ["建立主题父级", "补充别名", "关联资产与提示词"], cta: "建立标签" },
    "/prompts": { accent: "把有效的视觉语言归档成可重复调用的短语。", steps: ["选择表达模板", "组合情绪标签", "送入画布节点"], cta: "检索提示词" },
    "/settings": { accent: "默认参数应该服从于你的工作节奏，而不是反过来。", steps: ["选择默认模型", "设置画布操作", "保存个人偏好"], cta: "保存偏好" },
  };
  const config = toolMap[path] ?? toolMap["/image"];
  return <div className="page-content"><PageIntro path={path} /><div className="tool-surface"><section><p className="eyebrow">READY FOR BACKEND</p><h2>{config.accent}</h2><p>这个工作面已按结构文档预留交互与数据承载位置；当前以本地原型数据演示流程，后续可直接接入对应接口。</p><div className="tool-steps">{config.steps.map((step, index) => <div key={step}><span>0{index + 1}</span><b>{step}</b><ChevronRight size={16} /></div>)}</div><button className="vermilion-button" onClick={() => toast.message(`${config.cta}：原型操作已记录`) }>{config.cta} <ArrowUpRight size={16} /></button></section><aside><div className="abstract-canvas"><span className="abstract-card one" /><span className="abstract-card two" /><span className="abstract-card three" /><i className="abstract-origin" /></div><p className="eyebrow">ENDPOINT READY</p><code>{path === "/settings" ? apiContract.preferences : path === "/image" ? apiContract.canvas.createImageJob : "GET /api/comic-asset-projects"}</code></aside></div></div>;
}

export default function Home() {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(() => new URLSearchParams(window.location.search).get("rail") === "collapsed");
  const path = location.startsWith("/canvas/") ? "/canvas" : pageTitles[location] ? location : "/";
  const renderPage = () => {
    if (path === "/") return <Dashboard />;
    if (path === "/projects") return <Projects />;
    if (path === "/canvas") return <Canvas />;
    if (path === "/director") return <DirectorView />;
    if (path === "/comic-assets") return <ComicAssetsView />;
    if (path === "/image") return <ImageWorkbenchView />;
    if (path === "/queue") return <Queue />;
    if (path === "/assets") return <AssetLibraryView />;
    if (path === "/tags") return <TagLibraryView />;
    if (path === "/prompts") return <PromptLibraryView />;
    if (path === "/settings") return <SettingsView />;
    if (path === "/admin") return <AdminView />;
    return <GenericTool path={path} />;
  };
  return <div className={`studio-app ${collapsed ? "rail-collapsed" : ""} ${path === "/canvas" ? "canvas-focus" : ""}`}><SideRail currentPath={path} collapsed={collapsed} onCollapse={() => setCollapsed((value) => !value)} /><main className="main-stage"><TopBar path={path} />{renderPage()}</main></div>;
}
