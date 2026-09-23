import { CreditBalance } from "@/features/member";
import {
  Box,
  ChevronRight,
  Clapperboard,
  Compass,
  Crown,
  FileText,
  Film,
  FolderKanban,
  Gift,
  Grid2X2,
  Home,
  Image as ImageIcon,
  Library,
  LogOut,
  MoreHorizontal,
  Pencil,
  Puzzle,
  RadioTower,
  Settings2,
  ShieldCheck,
  Tag,
  Terminal,
  UserRound,
  Video,
  Wallet,
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
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

import ReleaseNotesDialog from "@/components/ReleaseNotesDialog";
import StudioAgentFab from "@/components/StudioAgentFab";
import { useAuth } from "@/contexts/AuthContext";
import { isAdminTierRole, updateMyDisplayName } from "@/entities/auth";
import AnnouncementBanner from "@/features/announcements";
import {
  daysUntil,
  formatCredits,
  useMemberOverviewQuery,
} from "@/features/member";
import { useOutsidePress } from "@/shared/lib/useOutsidePress";
import {
  useWorkspaceDashboardData,
  type WorkspaceData,
} from "@/features/dashboard";

import {
  clampSidebarEffect,
  nextSidebarEffect,
  SIDEBAR_POINTER_RADIUS_PX,
} from "./sidebarMotion";
import "../styles/shell.css";
/* [暂时隐藏] 顶栏检索入口/命令面板/通知按钮/新建画布 —— 代码保留，恢复时连同 TopBar 中被注释的 JSX 一起还原：
import { toast } from "sonner";（注意：toast 已因账号 popover 的"修改昵称"正式引入，恢复时跳过本行）
import { CircleDashed, Plus, Search } from "lucide-react";
import { StudioCommandPalette } from "./StudioCommandPalette";
import { createAndOpenProject } from "@/features/projects";
*/

// 站内标识已切换到 cloudto 云格资产包（/public/cloudto/），不再引用旧 /logo.png。
const railGroupsStorageKey = "ai-manju:rail-open-groups";

type Icon = typeof Grid2X2;
type NavItem = {
  label: string;
  href: string;
  icon: Icon;
  shortcut?: string;
  disabled?: boolean;
  newTab?: boolean;
};

const creationNav: NavItem[] = [
  { label: "工作台", href: "/dashboard", icon: Grid2X2, shortcut: "G D" },
  // 剧本创作：目标路由待定，暂且保留入口但点击无反应（disabled 渲染为纯文本行，不跳转）
  {
    label: "剧本创作",
    href: "/chat",
    icon: FileText,
    shortcut: "G S",
    disabled: true,
  },
  { label: "全部项目", href: "/projects", icon: FolderKanban, shortcut: "G P" },
  { label: "当前任务", href: "/canvas?resume=recent", icon: Compass, shortcut: "G C" },
  // 暂时从导航直接独立打开导演台；嵌入式入口代码保留，待后续恢复。
  { label: "3D 导演台", href: "/director", icon: Box, newTab: true },
  { label: "资产助手", href: "/comic-assets", icon: Clapperboard },
];

export const creationModeTabs = [
  { id: "home", label: "主页", href: "/dashboard", icon: Home },
  { id: "video", label: "视频创作", href: "/video", icon: Video },
  { id: "image", label: "图片创作", href: "/image", icon: ImageIcon },
  { id: "script", label: "剧本创作", href: "/chat", icon: FileText },
] as const;

export function creationModeTabActive(href: string, path: string) {
  if (href === "/chat") return path === "/chat" || path === "/";
  return path === href;
}

const libraryNav: NavItem[] = [
  { label: "图片生成", href: "/image", icon: WandSparkles },
  { label: "视频生成", href: "/video", icon: Film },
  { label: "资产库", href: "/assets", icon: Library },
  { label: "标签库", href: "/tags", icon: Tag },
  { label: "提示词库", href: "/prompts", icon: Terminal },
  { label: "技能库", href: "/skills", icon: Puzzle },
];

const systemNav: NavItem[] = [
  // 个人主页与会员中心均从右上角用户卡 popover 进入（账号中心弹窗），不放侧边导航。
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
  "/chat": {
    code: "SCRIPT / DESK",
    title: "剧本创作",
    subtitle: "用一句话开始故事，再把项目落到画布上继续制作。",
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
    title: "资产助手",
    subtitle: "从剧本中提取角色、场景和关键道具，并一次性组织批量生成。",
  },
  "/image": {
    code: "KEYFRAME / NEW",
    title: "图片生成",
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
  "/member": {
    code: "MEMBER / CREDITS",
    title: "会员中心",
    subtitle: "会员状态、双余额、消耗明细、套餐购买与邀请有礼。",
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
  if (locationPath === "/member" || locationPath.startsWith("/member/"))
    return "/member";
  return locationPath;
}

function BrandMark() {
  return (
    <div className="brand-lockup">
      {/* cloudto 云格横版标识（云形 + 字标一体，深底版） */}
      <img
        className="brand-logo-full"
        src="/cloudto/logos/svg/logo-horizontal-on-dark.svg"
        alt="cloudto 云格"
      />
    </div>
  );
}

export function LineNav({
  groups,
  currentPath,
}: {
  groups: Array<{ id: string; title: string; icon?: string; items: NavItem[] }>;
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
  const lastRef = useRef<number | null>(null);

  const runFrame = useCallback((now: number) => {
    const elapsedMs = lastRef.current === null ? 0 : now - lastRef.current;
    lastRef.current = now;
    let moving = false;
    rowRefs.current.forEach((element, index) => {
      if (!element) return;
      const target = Math.max(
        clampSidebarEffect(targetsRef.current[index] || 0),
        element.dataset.active === "1" ? 1 : 0
      );
      const value = nextSidebarEffect(
        currentsRef.current[index] || 0,
        target,
        elapsedMs
      );
      currentsRef.current[index] = value;
      element.style.setProperty("--effect", value.toFixed(4));
      if (value !== target) moving = true;
    });
    rafRef.current = moving ? requestAnimationFrame(runFrame) : null;
  }, []);

  const startLoop = useCallback(() => {
    // Keep one loop and use only RAF timestamps; pointer events must not reset its clock.
    if (rafRef.current != null) return;
    lastRef.current = null;
    rafRef.current = requestAnimationFrame(runFrame);
  }, [runFrame]);

  const resetMotion = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    lastRef.current = null;
    targetsRef.current = [];
    currentsRef.current = [];
    rowRefs.current.forEach((element, index) => {
      if (!element) return;
      const value = element.dataset.active === "1" ? 1 : 0;
      currentsRef.current[index] = value;
      element.style.setProperty("--effect", String(value));
    });
  }, []);

  useEffect(() => {
    resetMotion();
  }, [currentPath, openGroups, resetMotion]);

  useEffect(() => {
    window.addEventListener("blur", resetMotion);
    document.addEventListener("visibilitychange", resetMotion);
    return () => {
      window.removeEventListener("blur", resetMotion);
      document.removeEventListener("visibilitychange", resetMotion);
    };
  }, [resetMotion]);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  useEffect(() => {
    const owner = groups.find(group =>
      group.items.some(item => item.href.split("?")[0] === currentPath)
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
    rowRefs.current.forEach((element, index) => {
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      const distance = Math.abs(event.clientY - center);
      const proximity =
        rect.height > 0
          ? clampSidebarEffect(1 - distance / SIDEBAR_POINTER_RADIUS_PX)
          : 0;
      targetsRef.current[index] = proximity * proximity * (3 - 2 * proximity);
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
      onScroll={resetMotion}
    >
      {groups.map(group => {
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
              {group.icon ? (
                <svg
                  className="ln-group-icon"
                  width="15"
                  height="15"
                  aria-hidden="true"
                >
                  <use href={`/cloudto/icons/sprite.svg#${group.icon}`} />
                </svg>
              ) : null}
              <span className="ln-label">{group.title}</span>
              <ChevronRight
                size={13}
                className={`ln-chev ${open ? "open" : ""}`}
              />
            </button>
            <div className={`ln-children ${open ? "open" : ""}`}>
              <div className="ln-children-inner">
                {group.items.map((item, itemIndex) => {
                  const active = item.href.split("?")[0] === currentPath;
                  const itemRow = ++rowCounter;
                  // 禁用项（路由待定）渲染为纯文本行：保留位置与编号，点击无反应
                  if (item.disabled) {
                    return (
                      <span
                        key={item.href}
                        title={item.label}
                        className="ln-row ln-item is-disabled"
                        data-active="0"
                        ref={element => {
                          rowRefs.current[itemRow] = element;
                        }}
                        aria-disabled="true"
                      >
                        <span className="ln-marker" aria-hidden="true" />
                        <span className="ln-index">
                          {String(itemIndex + 1).padStart(2, "0")}
                        </span>
                        <span className="ln-label">{item.label}</span>
                        {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
                      </span>
                    );
                  }
                  // Wouter intercepts ordinary clicks even with target="_blank".
                  const ItemLink = item.newTab ? "a" : Link;
                  return (
                    <ItemLink
                      key={item.href}
                      href={item.href}
                      title={item.label}
                      target={item.newTab ? "_blank" : undefined}
                      rel={item.newTab ? "noopener" : undefined}
                      className="ln-row ln-item"
                      data-active={active ? "1" : "0"}
                      ref={element => {
                        rowRefs.current[itemRow] = element;
                      }}
                      aria-current={active ? "page" : undefined}
                    >
                      <span className="ln-marker" aria-hidden="true" />
                      <span className="ln-index">
                        {String(itemIndex + 1).padStart(2, "0")}
                      </span>
                      <span className="ln-label">{item.label}</span>
                      {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
                    </ItemLink>
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
  const systemItems = isAdminTierRole(user?.role)
    ? [...systemNav, adminNavItem]
    : systemNav;
  const groups = [
    { id: "creation", title: "制作桌", icon: "ct-canvas", items: creationNav },
    { id: "library", title: "素材与语言", icon: "ct-library", items: libraryNav },
    { id: "system", title: "系统", icon: "ct-settings", items: systemItems },
  ];
  return (
    <aside className={`side-rail ${collapsed ? "is-collapsed" : ""}`}>
      <LineNav groups={groups} currentPath={currentPath} />
    </aside>
  );
}

/** 账号区角色文案（后台三级权限 + 普通成员）。 */
function sideRoleLabel(role?: string) {
  switch (role) {
    case "super_admin":
      return "超级管理员";
    case "ops_admin":
      return "运营管理员";
    case "auditor":
      return "只读审计";
    default:
      return "创作成员";
  }
}

function SideFootCard({ data }: { data: WorkspaceData }) {
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
    </div>
  );
}

/** 顶栏右上角账号卡（从侧栏底部迁入）：头像 + 姓名/角色，点击展开会员与余额 popover。 */
function TopUserCard() {
  const [, navigate] = useLocation();
  const { user, logout, refreshUser } = useAuth();

  /* ---- 账号 popover（会员徽标 + 双余额 + 会员入口；数据 GET /api/member/overview） ---- */
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const overviewQuery = useMemberOverviewQuery(popoverOpen);
  const overview = overviewQuery.data;
  const membership = overview?.membership ?? null;
  const expiryDays = daysUntil(overview?.next_expiry_at);

  /* ---- 修改昵称（内联编辑：PATCH /api/auth/me 落库后 refreshUser 刷新全局用户态） ---- */
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState("");

  // popover 关闭即退出改名状态，下次打开回到默认视图。
  useEffect(() => {
    if (popoverOpen) return;
    setRenaming(false);
    setRenameError("");
  }, [popoverOpen]);

  useOutsidePress(
    popoverOpen,
    event => Boolean(popoverRef.current?.contains(event.target as Node)),
    () => setPopoverOpen(false)
  );

  useEffect(() => {
    if (!popoverOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPopoverOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [popoverOpen]);

  const goMember = (path: string) => {
    setPopoverOpen(false);
    navigate(path);
  };

  const startRename = () => {
    setNameDraft(user?.display_name ?? user?.username ?? "");
    setRenameError("");
    setRenaming(true);
  };

  const cancelRename = () => {
    setRenaming(false);
    setRenameError("");
  };

  const submitRename = async () => {
    const nextName = nameDraft.trim();
    if (!nextName) {
      setRenameError("昵称不能为空");
      return;
    }
    // 与后端 maxDisplayNameRunes 对齐：按字符数（而非 UTF-16 码元）计，中文/emoji 均按 1 字。
    if (Array.from(nextName).length > 32) {
      setRenameError("昵称最长 32 个字符");
      return;
    }
    if (nextName === (user?.display_name ?? "")) {
      setRenaming(false);
      return;
    }
    setRenameSaving(true);
    setRenameError("");
    try {
      await updateMyDisplayName(nextName);
      await refreshUser();
      setRenaming(false);
      toast.success("昵称已更新");
    } catch (error) {
      setRenameError(
        error instanceof Error ? error.message : "改名失败，请稍后重试"
      );
    } finally {
      setRenameSaving(false);
    }
  };

  /** 登出行为与改版前一致：logout() 后回登录页。 */
  const handleLogout = () => {
    setPopoverOpen(false);
    void logout().then(() => navigate("/login"));
  };

  return (
    <div className="user-card-anchor user-card-topbar" ref={popoverRef}>
      {popoverOpen ? (
        <div className="user-pop" role="dialog" aria-label="账号与余额">
          <div className="user-pop-head">
            <span className="avatar">
              {(user?.display_name ?? user?.username ?? "?")
                .at(0)
                ?.toUpperCase() ?? "?"}
            </span>
            <div className="user-pop-head-meta">
              <b>{user?.display_name ?? user?.username ?? "—"}</b>
              <span
                className={`user-pop-badge ${membership ? "is-member" : ""}`}
              >
                <Crown size={11} />
                {membership ? membership.plan_name : "免费版"}
              </span>
            </div>
          </div>
          {renaming ? (
            <form
              className="user-pop-rename"
              onSubmit={event => {
                event.preventDefault();
                void submitRename();
              }}
            >
              <label htmlFor="user-rename-input">新昵称</label>
              <input
                id="user-rename-input"
                value={nameDraft}
                onChange={event => setNameDraft(event.target.value)}
                onKeyDown={event => {
                  // Esc 只退出改名，不把整个 popover 一起关掉。
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    cancelRename();
                  }
                }}
                placeholder="输入新昵称"
                autoFocus
                disabled={renameSaving}
              />
              {renameError ? (
                <p className="user-pop-rename-error">{renameError}</p>
              ) : null}
              <div className="user-pop-rename-actions">
                <button
                  type="submit"
                  className="user-pop-rename-save"
                  disabled={renameSaving}
                >
                  {renameSaving ? "保存中…" : "保存"}
                </button>
                <button
                  type="button"
                  className="user-pop-rename-cancel"
                  onClick={cancelRename}
                  disabled={renameSaving}
                >
                  取消
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="user-pop-balances">
                {overviewQuery.isPending ? (
                  <p className="user-pop-state">正在读取余额…</p>
                ) : overviewQuery.isError ? (
                  <p className="user-pop-state">余额加载失败，请稍后重试</p>
                ) : (
                  <>
                    <div className="user-pop-balance-row">
                      <span>限时积分</span>
                      <b>{formatCredits(overview?.limited_available)}</b>
                      <small>
                        {overview?.next_expiry_at
                          ? `${expiryDays} 天后清零`
                          : "暂无将到期积分"}
                      </small>
                    </div>
                    <div className="user-pop-balance-row">
                      <span>永久积分</span>
                      <b>{formatCredits(overview?.permanent_available)}</b>
                      <small>永久有效</small>
                    </div>
                  </>
                )}
              </div>
              <nav className="user-pop-links">
                <button type="button" onClick={startRename}>
                  <Pencil size={13} /> 修改昵称
                </button>
                <button type="button" onClick={() => goMember("/profile")}>
                  <UserRound size={13} /> 个人主页
                </button>
                <button type="button" onClick={() => goMember("/member")}>
                  <Crown size={13} /> 会员中心
                </button>
                <button type="button" onClick={() => goMember("/member/plans")}>
                  <Wallet size={13} /> 套餐购买
                </button>
                <button type="button" onClick={() => goMember("/member/invite")}>
                  <Gift size={13} /> 邀请有礼
                </button>
              </nav>
              <button
                type="button"
                className="user-pop-logout"
                onClick={handleLogout}
              >
                <LogOut size={13} /> 登出
              </button>
            </>
          )}
        </div>
      ) : null}
      <button
        className="user-card"
        onClick={() => setPopoverOpen(open => !open)}
        aria-expanded={popoverOpen}
        aria-haspopup="dialog"
        title="账号与余额"
      >
        <span className="avatar">
          {(user?.display_name ?? user?.username ?? "?").at(0)?.toUpperCase() ??
            "?"}
        </span>
        <span className="user-meta">
          <b>{user?.display_name ?? user?.username ?? "—"}</b>
          <small>{sideRoleLabel(user?.role)}</small>
        </span>
        <MoreHorizontal size={16} />
      </button>
    </div>
  );
}

// runningJobs 仍在调用处传入（顶栏任务指示暂时隐藏，恢复时重新解构即可）
function TopBar({ path }: { path: string; runningJobs?: number }) {
  const [, navigate] = useLocation();
  /* [暂时隐藏] 命令面板开关，与下方检索按钮/命令面板 JSX 一起恢复：
  const [commandOpen, setCommandOpen] = useState(false); */
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
      {/* [暂时隐藏] 顶部中央创作导航（主页/视频创作/图片创作/剧本创作）——代码保留：
      <nav className="top-mode-tabs" aria-label="创作入口">
        {creationModeTabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={creationModeTabActive(tab.href, path) ? "is-active" : undefined}
            >
              <Icon size={14} />
              {tab.label}
            </Link>
          );
        })}
      </nav>
      */}
      <div className="top-actions">
        {/* [暂时隐藏] 检索入口 / 命令面板 / 任务指示 / 通知 —— 代码保留：
        <button
          type="button"
          className="command-search"
          aria-label="检索工作桌"
          aria-expanded={commandOpen}
          onClick={() => setCommandOpen(true)}
        >
          <Search size={17} />
          <span>检索工作桌</span>
        </button>
        <StudioCommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
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
        */}
        {/* [暂时隐藏] “新建画布”已移到工作台打招呼一行的右侧（ChatComposer 的 .chat-hero-create）；顶栏原位代码保留：
        <button
          className="create-button"
          onClick={() => void createAndOpenProject(navigate)}
        >
          <Plus size={17} /> 新建画布
        </button>
        */}
        <CreditBalance />
        <TopUserCard />
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
      {/* 全站右下角 Agent 小球（画布同款 MetaBallOrb） */}
      <StudioAgentFab />
    </div>
  );
}
