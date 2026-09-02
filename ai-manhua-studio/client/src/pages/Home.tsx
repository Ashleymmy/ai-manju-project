/**
 * Style reminder: 影印分镜室 — editorial desktop, technical index labels, vermilion action color, and asymmetrical working surfaces.
 */
import { type JobState } from "@/lib/api-contract";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Box,
  Check,
  ChevronRight,
  CircleDashed,
  Clapperboard,
  Compass,
  Film,
  FolderKanban,
  Grid2X2,
  Library,
  Menu,
  MoreHorizontal,
  MousePointer2,
  PanelRight,
  Pause,
  Pencil,
  Plus,
  RadioTower,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Tag,
  Terminal,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  announcementStreamUrl,
  cancelJob,
  createProject,
  deleteProject,
  fetchCurrentAnnouncement,
  getJobs,
  getProjects,
  getProjectSnapshot,
  listComicBatches,
  listComicProjects,
  markAnnouncementRead,
  publicApiError,
  updateProject,
  type CanvasProject,
  type Job,
  type SystemAnnouncement,
  type WorkspaceScope,
} from "@/services/api";
import { useWorkspaceDashboardData, type WorkspaceData } from "@/hooks/useWorkspaceDashboardData";
import { createZip } from "@/lib/zip";
import { AssetLibraryView, ComicAssetsView, ImageWorkbenchView, ProfileView, PromptLibraryView, TagLibraryView } from "./RealFeatureViews";
import { SettingsView } from "./SystemViews";
import CanvasWorkspaceView from "./CanvasWorkspaceView";
import DirectorDeskView from "./DirectorDeskView";
import AdminWorkspaceView from "./AdminWorkspaceView";
import VideoWorkspaceView from "./VideoWorkspaceView";
import AgentPanel from "@/components/AgentPanel";
import ReleaseNotesDialog from "@/components/ReleaseNotesDialog";

const logoUrl = "/logo.png";
const heroUrl = "";

type Icon = typeof Grid2X2;
type NavItem = { label: string; href: string; icon: Icon; shortcut?: string };

const creationNav: NavItem[] = [
  { label: "工作台", href: "/dashboard", icon: Grid2X2, shortcut: "G D" },
  { label: "全部项目", href: "/projects", icon: FolderKanban, shortcut: "G P" },
  { label: "画布工坊", href: "/canvas", icon: Compass, shortcut: "G C" },
  { label: "3D 导演台", href: "/director", icon: Box },
  { label: "漫剧资产助手", href: "/comic-assets", icon: Clapperboard },
];

const libraryNav: NavItem[] = [
  { label: "关键帧生成", href: "/image", icon: WandSparkles },
  { label: "视频生成", href: "/video", icon: Film },
  { label: "资产库", href: "/assets", icon: Library },
  { label: "标签库", href: "/tags", icon: Tag },
  { label: "提示词库", href: "/prompts", icon: Terminal },
];

const systemNav: NavItem[] = [
  { label: "个人主页", href: "/profile", icon: PanelRight },
  { label: "渲染队列", href: "/queue", icon: RadioTower },
  { label: "偏好设置", href: "/settings", icon: Settings2 },
];

// 仅超级管理员可见的后台入口（侧边栏「系统」分组末尾）
const adminNavItem: NavItem = { label: "管理后台", href: "/admin", icon: ShieldCheck };

type ProjectCardData = {
  id?: string;
  title: string;
  code: string;
  chapter: string;
  image: string;
  state: string;
  color: "blue" | "red" | "sand";
  time: string;
};

function projectToCard(project: CanvasProject, index: number): ProjectCardData {
  return {
    id: project.id,
    title: project.title,
    code: `PRJ-${project.id.slice(-4).toUpperCase()}`,
    chapter: new Date(project.updated_at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) + " 更新",
    image: "",
    state: "进行中",
    color: (["blue", "red", "sand"] as const)[index % 3],
    time: new Date(project.updated_at).toLocaleDateString("zh-CN", { month: "long", day: "numeric" }),
  };
}

async function createAndOpenProject(navigate: (path: string) => void) {
  const title = window.prompt("请输入画布项目名称", "未命名画布")?.trim();
  if (!title) return;
  try {
    const project = await createProject({ title, data: { nodes: [], edges: [] } });
    navigate(`/canvas/${encodeURIComponent(project.id)}`);
    toast.success("画布项目已创建");
  } catch (error) {
    toast.error(publicApiError(error, "创建画布项目失败"));
  }
}

const pageTitles: Record<string, { code: string; title: string; subtitle: string }> = {
  // "/" 现在是聊天入口页；工作台首页（今日片场）挂在 "/dashboard"。保留 "/" 键作为 PageIntro 兜底。
  "/": { code: "DESK / 01", title: "今日片场", subtitle: "在同一张工作桌上收拢灵感、镜头和等待落地的任务。" },
  "/dashboard": { code: "DESK / 01", title: "今日片场", subtitle: "在同一张工作桌上收拢灵感、镜头和等待落地的任务。" },
  "/projects": { code: "ARCHIVE / 12", title: "全部项目", subtitle: "画布、角色与分镜在这里留下持续可回看的版本。" },
  "/canvas": { code: "CANVAS / WS", title: "无限画布", subtitle: "节点、连线和生成结果都会保存到服务端快照。" },
  "/director": { code: "DIRECTOR / BETA", title: "3D 导演台", subtitle: "用可控机位先排布构图，再将镜头交还给生成流程。" },
  "/comic-assets": { code: "ASSET ASSIST / 05", title: "漫剧资产助手", subtitle: "从剧本中提取角色、场景和关键道具，并一次性组织批量生成。" },
  "/image": { code: "KEYFRAME / NEW", title: "关键帧生成", subtitle: "把描述、参考图和模型参数收束为一帧可继续工作的画面。" },
  "/video": { code: "VIDEO / MOTION", title: "视频生成", subtitle: "连接真实视频模型、任务轮询与结果下载，不再回退到占位工作面。" },
  "/assets": { code: "LIBRARY / 248", title: "资产库", subtitle: "角色、环境、道具与参考素材都能追溯来处和使用位置。" },
  "/tags": { code: "TAXONOMY / 36", title: "标签库", subtitle: "用语义层级把镜头语言、情绪和视觉资产编织到一起。" },
  "/prompts": { code: "PROMPTS / 18", title: "提示词库", subtitle: "把反复有效的表达方式变成下一次创作的可调用片段。" },
  "/profile": { code: "PROFILE / YOU", title: "个人主页", subtitle: "把个人提示词、常用模型和工作区状态集中放到一处。" },
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

function SideRail({ currentPath, collapsed, onCollapse, data }: { currentPath: string; collapsed: boolean; onCollapse: () => void; data: WorkspaceData }) {
  const [, navigate] = useLocation();
  const { user, logout } = useAuth();
  const projectCount = data.projects.total ?? 0;
  const assetCount = data.assets.total ?? 0;
  const runningCount = data.jobs.total ?? 0;
  const systemItems = user?.role === "super_admin" ? [...systemNav, adminNavItem] : systemNav;
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
        <NavGroup title="系统" items={systemItems} currentPath={currentPath} />
      </div>
      <div className="side-foot">
        <div className="side-meter">
          <div className="side-meter-top"><span>工作区同步</span><b>{runningCount}</b></div>
          <div className="meter"><span style={{ width: `${Math.min(100, Math.max(8, assetCount ? 100 : projectCount ? 48 : 18))}%` }} /></div>
          <small>{projectCount} 项目 · {assetCount} 资产 · {runningCount} 运行中</small>
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

function TopBar({ path, runningJobs }: { path: string; runningJobs?: number }) {
  const [, navigate] = useLocation();
  return (
    <header className="topbar">
      <div className="top-brand-area"><BrandMark /><div className="crumbs"><span>DESK</span><ChevronRight size={15} /><b>{pageTitles[path]?.title ?? "工作台"}</b></div></div>
      <div className="top-actions">
        <button className="command-search" onClick={() => toast.message("命令面板：搜索项目、资产、提示词…")}><Search size={17} /><span>检索工作桌</span><kbd>⌘ K</kbd></button>
        <span className="live-dot"><i />{runningJobs ?? "—"} 个任务执行中</span>
        <button className="icon-button subtle" aria-label="打开通知" onClick={() => toast.info("没有新的制作通知")}><CircleDashed size={18} /></button>
        <button className="create-button" onClick={() => void createAndOpenProject(navigate)}><Plus size={17} /> 新建画布</button>
      </div>
    </header>
  );
}

function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<SystemAnnouncement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamState, setStreamState] = useState<"connecting" | "connected" | "reconnecting">("connecting");
  const streamRef = useRef<EventSource | null>(null);
  const retryTimerRef = useRef<number | null>(null);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const closeStream = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
  }, []);

  const loadCurrentAnnouncement = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const current = await fetchCurrentAnnouncement();
      setAnnouncement(current);
      setError("");
      return current;
    } catch (error_) {
      setError(publicApiError(error_, "读取系统公告失败"));
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const connectStream = useCallback(() => {
    clearRetryTimer();
    closeStream();
    setStreamState("connecting");
    const source = new EventSource(announcementStreamUrl());
    streamRef.current = source;

    const refresh = () => {
      void loadCurrentAnnouncement(true);
    };

    source.onopen = () => {
      setStreamState("connected");
      setError("");
      refresh();
    };
    source.addEventListener("announcement.published", refresh);
    source.addEventListener("announcement.revoked", refresh);
    source.addEventListener("heartbeat", () => undefined);
    source.onerror = () => {
      setStreamState("reconnecting");
      setError("系统公告流已断开，正在重连…");
      closeStream();
      clearRetryTimer();
      refresh();
      retryTimerRef.current = window.setTimeout(connectStream, 3500);
    };
  }, [clearRetryTimer, closeStream, loadCurrentAnnouncement]);

  useEffect(() => {
    void loadCurrentAnnouncement(false);
    connectStream();
    return () => {
      clearRetryTimer();
      closeStream();
    };
  }, [clearRetryTimer, closeStream, connectStream, loadCurrentAnnouncement]);

  const markRead = async () => {
    if (!announcement || busy) return;
    setBusy(true);
    try {
      await markAnnouncementRead(announcement.id);
      setAnnouncement(null);
      setError("");
      toast.success("公告已标记为已读");
    } catch (error_) {
      toast.error(publicApiError(error_, "标记公告已读失败"));
    } finally {
      setBusy(false);
    }
  };

  const retry = () => {
    void loadCurrentAnnouncement(false);
    connectStream();
  };

  if (!loading && !error && !announcement) return null;

  return (
    <section
      style={{
        maxWidth: 1480,
        margin: "18px auto 0",
        padding: "0 clamp(16px, 2.5vw, 38px)",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 14,
          justifyContent: "space-between",
          alignItems: "flex-start",
          padding: "14px 16px",
          border: "1px solid var(--line)",
          background: "rgba(25,31,32,.92)",
          boxShadow: "0 16px 30px rgba(0,0,0,.12)",
          backdropFilter: "blur(12px)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0, flex: "1 1 360px" }}>
          <p className="eyebrow">SYSTEM ANNOUNCEMENT</p>
          <h3 style={{ margin: 0, color: "#f2efe5", fontSize: 15, letterSpacing: "-.04em" }}>
            {loading ? "正在读取系统公告…" : announcement?.title || "系统公告暂时不可用"}
          </h3>
          <p style={{ margin: "8px 0 0", color: "#919a96", fontSize: 12, lineHeight: 1.65 }}>
            {loading
              ? "正在同步当前未读公告与实时发布流。"
              : announcement
                ? announcement.content
                : error || "当前没有未读公告。"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {announcement && (
            <span className={`status-chip ${announcement.kind === "maintenance" ? "sand" : "blue"}`}>
              {announcement.kind}
            </span>
          )}
          <span className={`status-chip ${streamState === "connected" ? "running" : streamState === "reconnecting" ? "sand" : "blue"}`}>
            {loading ? "loading" : streamState}
          </span>
          {announcement && (
            <button className="outline-button small" onClick={() => void markRead()} disabled={busy}>
              已读
            </button>
          )}
          {!announcement && error && (
            <button className="outline-button small" onClick={retry} disabled={busy}>
              重试
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function PageIntro({
  path,
  action,
  overrides,
}: {
  path: string;
  action?: React.ReactNode;
  overrides?: Partial<{ code: string; title: string; subtitle: string }>;
}) {
  const copy = { ...(pageTitles[path] ?? pageTitles["/"]), ...overrides };
  return <div className="page-intro"><div><p className="eyebrow">{copy.code}</p><h1>{copy.title}</h1><p>{copy.subtitle}</p></div>{action}</div>;
}

function StatStrip({ data }: { data?: WorkspaceData }) {
  const jobCount = data?.jobs.total;
  const assetCount = data?.assets.total;
  const projectCount = data?.projects.total;
  const comicCount = data?.comicProjects.total;
  return (
    <section className="stat-strip">
      <div><span>进行中任务</span><strong>{jobCount != null ? String(jobCount).padStart(2, "0") : "—"}</strong><small>图像与批量生成</small></div>
      <div><span>漫剧项目</span><strong>{comicCount != null ? String(comicCount).padStart(2, "0") : "—"}</strong><small>剧本与批量资产</small></div>
      <div><span>可调用资产</span><strong>{assetCount ?? "—"}</strong><small>来自真实资产库</small></div>
      <div><span>画布项目</span><strong>{projectCount != null ? String(projectCount).padStart(2, "0") : "—"}</strong><small>服务端快照</small></div>
    </section>
  );
}

function LiveTimeline() {
  const [items, setItems] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    void getJobs({ limit: 4 })
      .then((result) => setItems(Array.isArray(result) ? result : result.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <div className="timeline-card">
      <div className="section-line"><span className="eyebrow">现场切片</span><button onClick={() => window.location.assign("/queue")}>查看队列 <ArrowUpRight size={15} /></button></div>
      <div className="timeline-flow">
        <div className="timeline-time"><b>{new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</b><span>现在</span></div>
        {!loaded && <div className="timeline-entry active"><i /><div><b>正在读取任务队列</b><span>GET /api/jobs</span></div><span className="status-chip blue">SYNC</span></div>}
        {loaded && !items.length && <div className="timeline-entry"><i /><div><b>暂无活跃任务</b><span>生成任务提交后会同步到这里</span></div><span className="status-chip">空闲</span></div>}
        {items.map((job) => (
          <div className={`timeline-entry ${job.status === "running" ? "active" : ""}`} key={job.id}>
            <i />
            <div><b>{job.name || job.type}</b><span>{job.type} · {job.id.slice(-8)}</span></div>
            <span className={`status-chip ${job.status === "running" ? "blue" : job.status === "failed" ? "sand" : ""}`}>{job.status === "running" ? `${job.progress || 0}%` : job.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Dashboard() {
  const [, navigate] = useLocation();
  const { data } = useWorkspaceDashboardData();
  const [recentProjects, setRecentProjects] = useState<CanvasProject[]>([]);

  useEffect(() => {
    getProjects("personal")
      .then((result) => setRecentProjects(Array.isArray(result) ? result : result.items || []))
      .catch(() => setRecentProjects([]));
  }, []);

  const recentCards = recentProjects.slice(0, 3).map(projectToCard);
  const latestProject = recentProjects[0];
  const openLatest = () => latestProject
    ? navigate(`/canvas/${encodeURIComponent(latestProject.id)}`)
    : void createAndOpenProject(navigate);

  return (
    <div className="page-content dashboard-page">
      <PageIntro path="/dashboard" action={<button className="outline-button" onClick={() => navigate("/projects")}>打开项目归档 <ArrowUpRight size={16} /></button>} />
      <StatStrip data={data} />
      <div className="desk-layout">
        <section className="spotlight-card">
          {heroUrl && <img src={heroUrl} alt="抽象的分镜创作桌面" />}
          <div className="spotlight-overlay" />
          <div className="spotlight-copy"><p className="eyebrow light">CONTINUE MAKING</p><h2>把这一格推向<br />下一镜。</h2><p>{latestProject ? `“${latestProject.title}”正在等待继续编辑。` : "创建第一张画布，开始新的镜头。"}</p><button className="vermilion-button" onClick={openLatest}><MousePointer2 size={16} /> {latestProject ? "回到无限画布" : "新建画布"}</button></div>
          <div className="spotlight-meta"><span>{latestProject ? `PRJ-${latestProject.id.slice(-4).toUpperCase()}` : "NEW PROJECT"}</span><span>{latestProject ? `最近保存 ${new Date(latestProject.updated_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "尚无项目"}</span></div>
        </section>
        <LiveTimeline />
      </div>
      <section className="section-head"><div><p className="eyebrow">RECENT SURFACES</p><h2>最近展开的工作面</h2></div><button className="text-button" onClick={() => navigate("/projects")}>全部项目 <ChevronRight size={16} /></button></section>
      <div className="project-row">{recentCards.length ? recentCards.map((project) => <ProjectCard key={project.id} {...project} />) : <button className="project-card" onClick={() => void createAndOpenProject(navigate)}><div className="project-info"><div><h3>创建第一张画布</h3><p>项目会真实保存到当前个人工作区</p></div><Plus size={18} /></div></button>}</div>
    </div>
  );
}

function ProjectCard({ id, title, code, chapter, image, state, color, time, scope }: ProjectCardData & { scope?: WorkspaceScope }) {
  const [, navigate] = useLocation();
  const href = id ? `/canvas/${encodeURIComponent(id)}${scope && scope !== "personal" ? `?scope=${encodeURIComponent(scope)}` : ""}` : "/projects";
  return <button className="project-card" onClick={() => navigate(href)}><div className="project-visual">{image ? <img src={image} alt="" /> : <div className="abstract-canvas" aria-hidden="true"><span className="abstract-card one" /><span className="abstract-card two" /></div>}<span className={`state-ribbon ${color}`}>{state}</span><span className="project-code">{code}</span></div><div className="project-info"><div><h3>{title}</h3><p>{chapter}</p></div><span>{time}</span></div></button>;
}

function Projects() {
  const [, navigate] = useLocation();
  const [scope, setScope] = useState<WorkspaceScope>("personal");
  const [apiProjects, setApiProjects] = useState<CanvasProject[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    getProjects(scope).then((res) => {
      const raw: CanvasProject[] = Array.isArray(res) ? res : (res as { items: CanvasProject[] }).items;
      setApiProjects(raw || []);
      setSelectedIds((ids) => ids.filter((id) => (raw || []).some((project) => project.id === id)));
    }).catch((error) => {
      setApiProjects([]);
      toast.error(publicApiError(error, "读取项目列表失败"));
    }).finally(() => setLoading(false));
  }, [refreshKey, scope]);

  const refresh = () => setRefreshKey((value) => value + 1);
  const toggleSelected = (id: string) => setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);

  const renameProject = async (project: CanvasProject) => {
    const title = window.prompt("项目名称", project.title)?.trim();
    if (!title || title === project.title) return;
    try {
      await updateProject(project.id, { title, scope });
      toast.success("项目已重命名");
      refresh();
    } catch (error) {
      toast.error(publicApiError(error, "重命名项目失败"));
    }
  };

  const deleteProjects = async (ids: string[]) => {
    if (!ids.length) return;
    if (!window.confirm(`删除 ${ids.length} 个画布项目及其快照？此操作不可恢复。`)) return;
    let failed = 0;
    for (const id of ids) {
      try {
        await deleteProject(id, scope);
      } catch {
        failed += 1;
      }
    }
    setSelectedIds([]);
    toast[failed ? "warning" : "success"](failed ? `删除完成，${failed} 个失败` : `已删除 ${ids.length} 个项目`);
    refresh();
  };

  const exportProjects = async (ids: string[]) => {
    if (!ids.length || exporting) return;
    setExporting(true);
    try {
      const files: Array<{ name: string; data: BlobPart }> = [];
      for (const id of ids) {
        const project = apiProjects.find((item) => item.id === id);
        if (!project) continue;
        const snapshot = await getProjectSnapshot(id, scope).catch(() => null);
        files.push({
          name: `${project.title.replace(/[^\w一-龥.-]/g, "_") || id}.json`,
          data: JSON.stringify({ project, snapshot: snapshot?.data ?? null, exportedAt: new Date().toISOString() }, null, 2),
        });
      }
      if (!files.length) throw new Error("没有可导出的项目");
      const zip = await createZip(files);
      const url = URL.createObjectURL(zip);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `画布项目-${new Date().toISOString().slice(0, 10)}.zip`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      toast.success(`已导出 ${files.length} 个项目`);
    } catch (error) {
      toast.error(publicApiError(error, "导出项目失败"));
    } finally {
      setExporting(false);
    }
  };

  const displayProjects: ProjectCardData[] = apiProjects.map(projectToCard);

  return <div className="page-content"><PageIntro path="/projects" action={<button className="create-button" onClick={() => void createAndOpenProject(navigate)}><Plus size={17} /> 新建项目</button>} />
    <div className="filter-line">
      <div className="segmented">{(["personal", "team"] as const).map((item) => <button key={item} className={scope === item ? "selected" : ""} onClick={() => { setScope(item); setSelectedIds([]); }}>{item === "personal" ? "个人空间" : "团队空间"}</button>)}</div>
      <div className="project-bulk-bar">
        <span>已选 {selectedIds.length} 项</span>
        <button className="outline-button small" disabled={!selectedIds.length} onClick={() => void deleteProjects(selectedIds)}><Trash2 size={14} /> 删除选中</button>
        <button className="outline-button small" disabled={!selectedIds.length || exporting} onClick={() => void exportProjects(selectedIds)}><ArrowDownToLine size={14} /> {exporting ? "导出中…" : "导出选中"}</button>
        <button className="outline-button small" disabled={!apiProjects.length} onClick={() => void deleteProjects(apiProjects.map((project) => project.id))}>删除全部</button>
      </div>
    </div>
    <div className="project-grid">{loading ? <div className="empty-output"><FolderKanban size={27} /><p>正在读取项目…</p></div> : displayProjects.length ? displayProjects.map((project, index) => <div className="project-card-wrap" key={`${project.id || project.code}-${index}`}><label className="project-check" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={project.id ? selectedIds.includes(project.id) : false} onChange={() => project.id && toggleSelected(project.id)} /></label><div className="project-card-tools"><button title="重命名" onClick={() => { const source = apiProjects.find((item) => item.id === project.id); if (source) void renameProject(source); }}><Pencil size={13} /></button><button title="删除" onClick={() => project.id && void deleteProjects([project.id])}><Trash2 size={13} /></button></div><ProjectCard {...project} scope={scope} /></div>) : <div className="empty-output"><FolderKanban size={27} /><p>还没有画布项目<br />点击“新建项目”开始。</p></div>}</div></div>;
}



type QueueJobRow = { id: string; name: string; type: string; state: JobState; scope: string; progress: number; updated: string; kind: "job" | "comic" };

const comicBatchStateMap: Record<string, JobState> = {
  queued: "queued",
  running: "running",
  paused: "queued",
  stopping: "running",
  succeeded: "succeeded",
  partial_failed: "failed",
  canceled: "canceled",
};

function Queue() {
  const [, navigate] = useLocation();
  const [scope, setScope] = useState<WorkspaceScope>("personal");
  const [filter, setFilter] = useState<JobState | "all">("all");
  const [apiJobs, setApiJobs] = useState<QueueJobRow[] | null>(null);
  const [comicRows, setComicRows] = useState<QueueJobRow[]>([]);

  const refresh = useCallback(() => {
    void getJobs({ limit: 50, scope }).then((res) => {
      const raw: Job[] = Array.isArray(res) ? res : res.items;
      setApiJobs(raw.map((j) => ({
        id: j.id,
        name: j.name ?? j.type,
        type: j.type.toUpperCase().replace(/\./g, " / ").replace(/_/g, " "),
        state: j.status,
        scope: (j as { scope?: string }).scope ?? scope,
        progress: j.progress ?? 0,
        updated: j.updated_at
          ? new Date(j.updated_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
          : "—",
        kind: "job" as const,
      })));
    }).catch(() => setApiJobs([]));
  }, [scope]);

  const refreshComicBatches = useCallback(() => {
    void listComicProjects(scope).then(async (projects) => {
      const batchLists = await Promise.allSettled(projects.slice(0, 12).map(async (project) => {
        const batches = await listComicBatches(project.id, scope);
        return batches.map((batch) => ({ project, batch }));
      }));
      const rows = batchLists
        .flatMap((result) => result.status === "fulfilled" ? result.value : [])
        .sort((a, b) => new Date(b.batch.updated_at || b.batch.created_at).getTime() - new Date(a.batch.updated_at || a.batch.created_at).getTime())
        .slice(0, 20)
        .map(({ project, batch }): QueueJobRow => ({
          id: batch.id,
          name: `${project.title} · 漫剧批量`,
          type: "COMIC / BATCH",
          state: comicBatchStateMap[batch.status] || "queued",
          scope,
          progress: batch.total ? Math.round(((batch.succeeded + batch.failed + batch.canceled) / batch.total) * 100) : 0,
          updated: batch.updated_at
            ? new Date(batch.updated_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
            : "—",
          kind: "comic",
        }));
      setComicRows(rows);
    }).catch(() => setComicRows([]));
  }, [scope]);

  useEffect(() => {
    setApiJobs(null);
    setComicRows([]);
    refresh();
    refreshComicBatches();
    const timer = window.setInterval(refresh, 3_000);
    const comicTimer = window.setInterval(refreshComicBatches, 10_000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(comicTimer);
    };
  }, [refresh, refreshComicBatches]);

  const displayJobs = [...(apiJobs ?? []), ...comicRows];
  const visible = displayJobs.filter((job) => filter === "all" || job.state === filter);
  const count = (state: JobState) => displayJobs.filter((j) => j.state === state).length;
  const tabs: Array<[JobState | "all", string]> = [
    ["all", `全部 ${String(displayJobs.length).padStart(2, "0")}`],
    ["running", `执行中 ${String(count("running")).padStart(2, "0")}`],
    ["queued", `等待 ${String(count("queued")).padStart(2, "0")}`],
    ["succeeded", `完成 ${String(count("succeeded")).padStart(2, "0")}`],
    ["failed", `异常 ${String(count("failed")).padStart(2, "0")}`],
  ];
  return (
    <div className="page-content">
      <PageIntro
        path="/queue"
        action={
          <div className="queue-actions">
            <div className="scope-switch">
              {(["personal", "team"] as const).map((item) => (
                <button
                  key={item}
                  className={scope === item ? "active" : ""}
                  onClick={() => setScope(item)}
                >
                  {item === "personal" ? "个人空间" : "团队空间"}
                </button>
              ))}
            </div>
            <div className="queue-nav-buttons">
              <button className="queue-nav-button" onClick={() => navigate("/image")}>图片生成</button>
              <button className="queue-nav-button" onClick={() => navigate("/video")}>视频生成</button>
              <button className="queue-nav-button active" onClick={() => navigate("/canvas")}>回到画布</button>
            </div>
          </div>
        }
      />

      <div className="queue-status-overview">
        <div className="status-item">
          <span className="status-count">{String(count("running")).padStart(2, "0")}</span>
          <span className="status-text">运行中</span>
        </div>
        <div className="status-item">
          <span className="status-count">{String(count("queued")).padStart(2, "0")}</span>
          <span className="status-text">等待 / 暂停</span>
        </div>
        <div className="status-item">
          <span className="status-count">{String(count("succeeded")).padStart(2, "0")}</span>
          <span className="status-text">已完成</span>
        </div>
        <div className="status-item">
          <span className="status-count">{String(count("failed")).padStart(2, "0")}</span>
          <span className="status-text">异常 / 失败</span>
        </div>
      </div>

      <div className="queue-layout">
        <section className="queue-card">
          <div className="queue-tabs">
            {tabs.map(([key, label]) => (
              <button
                className={filter === key ? "active" : ""}
                key={key}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="job-list">
            {visible.map((job) => (
              <div className="job-row" key={`${job.kind}-${job.id}`}>
                <div className={`job-icon ${job.state}`}>
                  {job.kind === "comic" ? <Clapperboard size={18} /> : <Film size={18} />}
                </div>
                <div className="job-copy">
                  <div>
                    <b>{job.name}</b>
                    <span>{job.type} · {job.id}</span>
                  </div>
                  {(job.state === "running" || job.state === "queued") && (
                    <div className="job-progress">
                      <i style={{ width: `${job.progress}%` }} />
                    </div>
                  )}
                </div>
                <div className="job-state">
                  <span className={`status-chip ${job.state}`}>
                    {job.state === "running" ? "生成中" :
                     job.state === "queued" ? "队列中" :
                     job.state === "succeeded" ? "已完成" :
                     job.state === "canceled" ? "已取消" : "异常"}
                  </span>
                  <small>{job.updated}</small>
                </div>
                {job.kind === "comic" ? (
                  <button
                    className="icon-button subtle"
                    title="打开漫剧资产助手"
                    onClick={() => navigate("/comic-assets")}
                  >
                    <ArrowUpRight size={16} />
                  </button>
                ) : (job.state === "running" || job.state === "queued") ? (
                  <button
                    className="icon-button subtle"
                    title="取消任务"
                    onClick={() => void cancelQueueJob(job.id, job.scope, refresh)}
                  >
                    <Pause size={16} />
                  </button>
                ) : (
                  <button className="icon-button subtle" disabled>
                    <MoreHorizontal size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {!visible.length && (
            <div className="empty-output">
              <RadioTower size={27} />
              <p>当前筛选没有任务。</p>
            </div>
          )}
        </section>
        <aside className="queue-aside">
          <p className="eyebrow">STATUS MACHINE</p>
          <h3>让每次等待<br />都看得见。</h3>
          <div className="state-machine">
            <span className="done">queued</span>
            <i />
            <span className="active">running</span>
            <i />
            <span>succeeded</span>
          </div>
          <p>队列状态来自服务端 Job 与漫剧批次，随个人 / 团队空间切换；页面刷新后会重新读取，不依赖本地假数据。</p>
          <code>GET /api/jobs?limit=50&scope={scope}</code>
        </aside>
      </div>
    </div>
  );
}

async function cancelQueueJob(id: string, scope: string, refresh: () => void) {
  try {
    await cancelJob(id, scope as "personal" | "team");
    toast.success("任务已取消");
    refresh();
  } catch (error) {
    toast.error(publicApiError(error, "取消任务失败"));
  }
}


function GenericTool({ path }: { path: string }) {
  return (
    <div className="page-content">
      <PageIntro path={path} />
      <div className="tool-surface">
        <section>
          <p className="eyebrow">IN DEVELOPMENT</p>
          <h2>此工作面正在接入真实后端接口，暂以结构预留。</h2>
          <p>功能将在后续版本中逐步上线。</p>
        </section>
        <aside>
          <div className="abstract-canvas">
            <span className="abstract-card one" />
            <span className="abstract-card two" />
            <span className="abstract-card three" />
            <i className="abstract-origin" />
          </div>
          <p className="eyebrow">PATH</p>
          <code>{path}</code>
        </aside>
      </div>
    </div>
  );
}

function normalizeShellPath(locationPath: string) {
  if (locationPath.startsWith("/canvas/")) return "/canvas";
  if (locationPath === "/admin" || locationPath.startsWith("/admin/")) return "/admin";
  return pageTitles[locationPath] ? locationPath : locationPath;
}

export default function Home() {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(() => new URLSearchParams(window.location.search).get("rail") === "collapsed");
  const { data: shellData } = useWorkspaceDashboardData();
  const locationPath = location.split("?")[0];
  const isCanvasRoute = locationPath === "/canvas" || locationPath.startsWith("/canvas/");
  const path = normalizeShellPath(locationPath);
  const renderPage = () => {
    if (path === "/" || path === "/dashboard") return <Dashboard />;
    if (path === "/projects") return <Projects />;
    if (path === "/canvas") return <CanvasWorkspaceView />;
    if (path === "/director") return <DirectorDeskView />;
    if (path === "/comic-assets") return <ComicAssetsView />;
    if (path === "/image") return <ImageWorkbenchView />;
    if (path === "/video") return <VideoWorkspaceView />;
    if (path === "/queue") return <Queue />;
    if (path === "/assets") return <AssetLibraryView />;
    if (path === "/tags") return <TagLibraryView />;
    if (path === "/prompts") return <PromptLibraryView />;
    if (path === "/profile") return <ProfileView />;
    if (path === "/settings") return <SettingsView />;
    if (path === "/admin") return <AdminWorkspaceView />;
    return <GenericTool path={path} />;
  };
  if (isCanvasRoute) {
    return <div className="studio-app canvas-focus canvas-focus-direct"><main className="main-stage"><CanvasWorkspaceView /></main></div>;
  }
  return <div className={`studio-app ${collapsed ? "rail-collapsed" : ""}`}><SideRail currentPath={path} collapsed={collapsed} onCollapse={() => setCollapsed((value) => !value)} data={shellData} /><main className="main-stage"><TopBar path={path} runningJobs={shellData.jobs.total} /><AnnouncementBanner />{renderPage()}</main><ReleaseNotesDialog /></div>;
}
