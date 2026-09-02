import {
  Box,
  ChevronRight,
  CircleDashed,
  Clapperboard,
  Compass,
  Film,
  FolderKanban,
  Grid2X2,
  Library,
  MoreHorizontal,
  PanelRight,
  Plus,
  Puzzle,
  RadioTower,
  Search,
  Settings2,
  ShieldCheck,
  Tag,
  Terminal,
  WandSparkles,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";

import ReleaseNotesDialog from "@/components/ReleaseNotesDialog";
import { useAuth } from "@/contexts/AuthContext";
import AnnouncementBanner from "@/features/announcements";
import {
  useWorkspaceDashboardData,
  type WorkspaceData,
} from "@/features/dashboard";
import { createAndOpenProject } from "@/features/projects";

import "../styles/shell.css";

const logoUrl = "/logo.png";
const railGroupsStorageKey = "ai-manju:rail-open-groups";

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
  { label: "技能库", href: "/skills", icon: Puzzle },
];

const systemNav: NavItem[] = [
  { label: "个人主页", href: "/profile", icon: PanelRight },
  { label: "渲染队列", href: "/queue", icon: RadioTower },
  { label: "偏好设置", href: "/settings", icon: Settings2 },
];

const adminNavItem: NavItem = {
  label: "管理后台",
  href: "/admin",
  icon: ShieldCheck,
};

export const studioPageTitles: Record<
  string,
  { code: string; title: string; subtitle: string }
> = {
  "/dashboard": {
    code: "DESK / 01",
    title: "今日片场",
    subtitle: "在同一张工作桌上收拢灵感、镜头和等待落地的任务。",
  },
  "/projects": {
    code: "ARCHIVE / 12",
    title: "全部项目",
    subtitle: "画布、角色与分镜在这里留下持续可回看的版本。",
  },
  "/canvas": {
    code: "CANVAS / WS",
    title: "无限画布",
    subtitle: "节点、连线和生成结果都会保存到服务端快照。",
  },
  "/director": {
    code: "DIRECTOR / BETA",
    title: "3D 导演台",
    subtitle: "用可控机位先排布构图，再将镜头交还给生成流程。",
  },
  "/comic-assets": {
    code: "ASSET ASSIST / 05",
    title: "漫剧资产助手",
    subtitle: "从剧本中提取角色、场景和关键道具，并一次性组织批量生成。",
  },
  "/image": {
    code: "KEYFRAME / NEW",
    title: "关键帧生成",
    subtitle: "把描述、参考图和模型参数收束为一帧可继续工作的画面。",
  },
  "/video": {
    code: "VIDEO / MOTION",
    title: "视频生成",
    subtitle: "连接真实视频模型、任务轮询与结果下载，不再回退到占位工作面。",
  },
  "/assets": {
    code: "LIBRARY / 248",
    title: "资产库",
    subtitle: "角色、环境、道具与参考素材都能追溯来处和使用位置。",
  },
  "/tags": {
    code: "TAXONOMY / 36",
    title: "标签库",
    subtitle: "用语义层级把镜头语言、情绪和视觉资产编织到一起。",
  },
  "/prompts": {
    code: "PROMPTS / 18",
    title: "提示词库",
    subtitle: "把反复有效的表达方式变成下一次创作的可调用片段。",
  },
  "/skills": {
    code: "SKILLS / LIVE",
    title: "技能库",
    subtitle: "提示词优化技能与画布节点实时联动，启停即生效。",
  },
  "/profile": {
    code: "PROFILE / YOU",
    title: "个人主页",
    subtitle: "把个人提示词、常用模型和工作区状态集中放到一处。",
  },
  "/queue": {
    code: "RENDER / LIVE",
    title: "渲染队列",
    subtitle: "所有图像、视频与批量生成任务在这一处显示即时状态。",
  },
  "/settings": {
    code: "PREFERENCES / YOU",
    title: "偏好设置",
    subtitle: "调整默认模型、图像规格和画布操作方式，让工作台更像你的习惯。",
  },
  "/admin": {
    code: "SYSTEM / SUPER ADMIN",
    title: "管理后台",
    subtitle: "管理成员访问、模型提供商、系统公告与任务基础设施。",
  },
};

function normalizeShellPath(locationPath: string) {
  if (locationPath.startsWith("/canvas/")) return "/canvas";
  if (locationPath === "/admin" || locationPath.startsWith("/admin/"))
    return "/admin";
  return locationPath;
}

function BrandMark() {
  return (
    <div className="brand-lockup">
      <span className="brand-symbol">
        <img className="brand-mark" src={logoUrl} alt="AI 漫工坊" />
        <i />
      </span>
      <div className="brand-type">
        <strong>AI 漫工坊</strong>
        <span>MANHUA STUDIO</span>
      </div>
    </div>
  );
}

function LineNav({
  groups,
  currentPath,
}: {
  groups: Array<{ id: string; title: string; items: NavItem[] }>;
  currentPath: string;
}) {
  const [openGroups, setOpenGroups] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(railGroupsStorageKey) || "null"
      );
      if (Array.isArray(saved))
        return saved.filter(item => typeof item === "string");
    } catch {
      undefined;
    }
    return groups.map(group => group.id);
  });
  const listRef = useRef<HTMLUListElement | null>(null);
  const rowRefs = useRef<Array<HTMLElement | null>>([]);
  const targetsRef = useRef<number[]>([]);
  const currentsRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);

  const runFrame = useCallback((now: number) => {
    const dt = Math.min((now - lastRef.current) / 1000, 0.05);
    lastRef.current = now;
    const smoothing = 1 - Math.exp(-dt / 0.1);
    let moving = false;
    rowRefs.current.forEach((element, index) => {
      if (!element) return;
      const target = Math.max(
        targetsRef.current[index] || 0,
        element.dataset.active === "1" ? 1 : 0
      );
      const current = currentsRef.current[index] || 0;
      const next = current + (target - current) * smoothing;
      const settled = Math.abs(target - next) < 0.0015;
      const value = settled ? target : next;
      currentsRef.current[index] = value;
      element.style.setProperty("--effect", value.toFixed(4));
      if (!settled) moving = true;
    });
    rafRef.current = moving ? requestAnimationFrame(runFrame) : null;
  }, []);

  const startLoop = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    lastRef.current = performance.now();
    rafRef.current = requestAnimationFrame(runFrame);
  }, [runFrame]);

  useEffect(() => {
    startLoop();
  }, [currentPath, startLoop]);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  useEffect(() => {
    const owner = groups.find(group =>
      group.items.some(item => item.href === currentPath)
    );
    if (owner && !openGroups.includes(owner.id)) {
      setOpenGroups(current => {
        const next = [...current, owner.id];
        try {
          localStorage.setItem(railGroupsStorageKey, JSON.stringify(next));
        } catch {
          undefined;
        }
        return next;
      });
    }
  }, [currentPath, groups, openGroups]);

  const handlePointerMove = (event: ReactPointerEvent) => {
    const list = listRef.current;
    if (!list) return;
    const rect = list.getBoundingClientRect();
    const pointerY = event.clientY - rect.top;
    const radius = 100;
    rowRefs.current.forEach((element, index) => {
      if (!element) return;
      const center = element.offsetTop + element.offsetHeight / 2;
      const distance = Math.abs(pointerY - center);
      const proximity = Math.max(0, 1 - distance / radius);
      targetsRef.current[index] =
        proximity * proximity * (3 - 2 * proximity);
    });
    startLoop();
  };

  const handlePointerLeave = () => {
    targetsRef.current = targetsRef.current.map(() => 0);
    startLoop();
  };

  const toggleGroup = (groupId: string) => {
    setOpenGroups(current => {
      const next = current.includes(groupId)
        ? current.filter(id => id !== groupId)
        : [...current, groupId];
      try {
        localStorage.setItem(railGroupsStorageKey, JSON.stringify(next));
      } catch {
        undefined;
      }
      return next;
    });
  };

  let rowCounter = -1;
  return (
    <ul
      ref={listRef}
      className="line-nav"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {groups.map((group, groupIndex) => {
        const open = openGroups.includes(group.id);
        const parentRow = ++rowCounter;
        return (
          <li key={group.id} className="ln-group">
            <button
              type="button"
              className="ln-row ln-parent"
              data-active="0"
              ref={element => {
                rowRefs.current[parentRow] = element;
              }}
              onClick={() => toggleGroup(group.id)}
              aria-expanded={open}
            >
              <span className="ln-marker" aria-hidden="true" />
              <span className="ln-index">
                {String(groupIndex + 1).padStart(2, "0")}
              </span>
              <span className="ln-label">{group.title}</span>
              <ChevronRight
                size={13}
                className={`ln-chev ${open ? "open" : ""}`}
              />
            </button>
            <div className={`ln-children ${open ? "open" : ""}`}>
              <div className="ln-children-inner">
                {group.items.map((item, itemIndex) => {
                  const active = item.href === currentPath;
                  const itemRow = ++rowCounter;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={item.label}
                      className="ln-row ln-item"
                      data-active={active ? "1" : "0"}
                      ref={element => {
                        rowRefs.current[itemRow] = element;
                      }}
                      aria-current={active ? "page" : undefined}
                    >
                      <span className="ln-marker" aria-hidden="true" />
                      <span className="ln-index">
                        {String(groupIndex + 1).padStart(2, "0")}.
                        {String(itemIndex + 1).padStart(2, "0")}
                      </span>
                      <span className="ln-label">{item.label}</span>
                      {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function SideRail({
  currentPath,
  collapsed,
}: {
  currentPath: string;
  collapsed: boolean;
}) {
  const { user } = useAuth();
  const systemItems =
    user?.role === "super_admin" ? [...systemNav, adminNavItem] : systemNav;
  const groups = [
    { id: "creation", title: "制作桌", items: creationNav },
    { id: "library", title: "素材与语言", items: libraryNav },
    { id: "system", title: "系统", items: systemItems },
  ];
  return (
    <aside className={`side-rail ${collapsed ? "is-collapsed" : ""}`}>
      <LineNav groups={groups} currentPath={currentPath} />
    </aside>
  );
}

function SideFootCard({ data }: { data: WorkspaceData }) {
  const [, navigate] = useLocation();
  const { user, logout } = useAuth();
  const projectCount = data.projects.total ?? 0;
  const assetCount = data.assets.total ?? 0;
  const runningCount = data.jobs.total ?? 0;
  return (
    <div className="side-foot side-foot-float">
      <div className="side-meter">
        <div className="side-meter-top">
          <span>工作区同步</span>
          <b>{runningCount}</b>
        </div>
        <div className="meter">
          <span
            style={{
              width: `${Math.min(
                100,
                Math.max(8, assetCount ? 100 : projectCount ? 48 : 18)
              )}%`,
            }}
          />
        </div>
        <small>
          {projectCount} 项目 · {assetCount} 资产 · {runningCount} 运行中
        </small>
      </div>
      <button
        className="user-card"
        onClick={() => logout().then(() => navigate("/login"))}
      >
        <span className="avatar">
          {(user?.display_name ?? user?.username ?? "?")
            .at(0)
            ?.toUpperCase() ?? "?"}
        </span>
        <span className="user-meta">
          <b>{user?.display_name ?? user?.username ?? "—"}</b>
          <small>
            {user?.role === "super_admin" ? "超级管理员" : "创作成员"}
          </small>
        </span>
        <MoreHorizontal size={16} />
      </button>
    </div>
  );
}

function TopBar({ path, runningJobs }: { path: string; runningJobs?: number }) {
  const [, navigate] = useLocation();
  return (
    <header className="topbar">
      <div className="top-brand-area">
        <BrandMark />
        <div className="crumbs">
          <span>DESK</span>
          <ChevronRight size={15} />
          <b>{studioPageTitles[path]?.title ?? "工作台"}</b>
        </div>
      </div>
      <div className="top-actions">
        <button
          className="command-search"
          onClick={() => toast.message("命令面板：搜索项目、资产、提示词…")}
        >
          <Search size={17} />
          <span>检索工作桌</span>
          <kbd>⌘ K</kbd>
        </button>
        <span className="live-dot">
          <i />
          {runningJobs ?? "—"} 个任务执行中
        </span>
        <button
          className="icon-button subtle"
          aria-label="打开通知"
          onClick={() => toast.info("没有新的制作通知")}
        >
          <CircleDashed size={18} />
        </button>
        <button
          className="create-button"
          onClick={() => void createAndOpenProject(navigate)}
        >
          <Plus size={17} /> 新建画布
        </button>
      </div>
    </header>
  );
}

export default function StudioLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [collapsed] = useState(
    () =>
      new URLSearchParams(window.location.search).get("rail") === "collapsed"
  );
  const { data: shellData } = useWorkspaceDashboardData();
  const path = normalizeShellPath(location.split("?")[0]);
  return (
    <div className={`studio-app ${collapsed ? "rail-collapsed" : ""}`}>
      <SideRail currentPath={path} collapsed={collapsed} />
      <SideFootCard data={shellData} />
      <main className="main-stage">
        <TopBar path={path} runningJobs={shellData.jobs.total} />
        <AnnouncementBanner />
        {children}
      </main>
      <ReleaseNotesDialog />
    </div>
  );
}
