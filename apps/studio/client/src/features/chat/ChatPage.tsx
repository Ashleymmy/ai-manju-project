import {
  ChevronDown,
  FileText,
  Home,
  Image as ImageIcon,
  LogIn,
  LogOut,
  Plus,
  Sparkles,
  User,
  Video,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { getProjects, type CanvasProject } from "@/entities/project";
import { ProjectCard, projectToCard, useProjectCoverUrls } from "@/features/projects";

import ChatComposer, { CHAT_OPEN_MENU_ATTR } from "./ChatComposer";
import "./styles.css";

/* 顶栏模式 Tab：主页进工作台，视频/图片进对应工作台，剧本留在 /chat */
const MODE_TABS = [
  { id: "video", label: "视频创作", icon: Video, href: "/video" },
  { id: "image", label: "图片创作", icon: ImageIcon, href: "/image" },
  { id: "script", label: "剧本创作", icon: FileText, href: "/chat" },
] as const;

/* 首页最近项目卡片的数量上限 */
const RECENT_PROJECT_LIMIT = 3;

/**
 * 聊天台主页（现已从路由表隐藏，代码完整保留，随时可恢复）。
 * 打招呼 + 创作输入框抽到了 ChatComposer，当前同时嵌在工作台（今日片场）顶部；
 * 本页保留顶栏与最近项目区。
 */
export default function ChatPage() {
  const { user, logout } = useAuth();
  const [location, navigate] = useLocation();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [recentProjects, setRecentProjects] = useState<CanvasProject[]>([]);
  const recentCoverUrls = useProjectCoverUrls(recentProjects, "personal");

  // 最近项目：登录用户读真实个人工作区，未登录静默置空（只保留新建入口）
  useEffect(() => {
    if (!user) {
      setRecentProjects([]);
      return;
    }
    getProjects("personal")
      .then((result) => setRecentProjects(Array.isArray(result) ? result : result.items || []))
      .catch(() => setRecentProjects([]));
  }, [user]);

  // 点击页面任意空白处 / 按 Esc 时关闭用户菜单（模型下拉由 ChatComposer 自己处理）
  useEffect(() => {
    if (!showUserMenu) return;
    const closeMenu = () => setShowUserMenu(false);
    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest(`[${CHAT_OPEN_MENU_ATTR}="user"]`)) return;
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showUserMenu]);

  const handleLoginClick = () => {
    navigate(`/login?next=${encodeURIComponent(location || "/chat")}`);
  };

  const recentCards = recentProjects.slice(0, RECENT_PROJECT_LIMIT).map(projectToCard);

  return (
    <div className="chat-page">
      {/* Top Navigation Bar：与 studio 外壳一致的 rail 底 + 细线分隔 */}
      <header className="chat-topbar">
        <div className="chat-topbar-brand">
          <span className="chat-brand-mark"><Sparkles size={17} /></span>
          <div>
            <h1>AI 漫工坊</h1>
            <p>创作工作台</p>
          </div>
        </div>

        <nav className="chat-mode-tabs">
          <button onClick={() => navigate("/dashboard")}>
            <Home size={14} /> 主页
          </button>
          {MODE_TABS.map((tab) => (
            <button
              key={tab.id}
              className={tab.id === "script" ? "active" : ""}
              onClick={() => { if (tab.href) navigate(tab.href); }}
            >
              <tab.icon size={14} /> {tab.label}
            </button>
          ))}
        </nav>

        <div className="chat-topbar-user">
          {user ? (
            <div className="chat-user" {...{ [CHAT_OPEN_MENU_ATTR]: "user" }}>
              <button className="chat-user-trigger" onClick={() => setShowUserMenu(!showUserMenu)}>
                <span className="chat-user-avatar"><User size={14} /></span>
                <span>{user.username}</span>
                <ChevronDown size={13} className={showUserMenu ? "rotated" : ""} />
              </button>
              {showUserMenu && (
                <div className="chat-menu chat-user-menu">
                  <button
                    onClick={() => {
                      logout();
                      setShowUserMenu(false);
                      toast.success("已退出登录");
                    }}
                  >
                    <LogOut size={13} /> 退出登录
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="vermilion-button chat-login" onClick={handleLoginClick}>
              <LogIn size={13} /> 登录
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="chat-main">
        {/* 打招呼 + 创作输入对话框（同时嵌在工作台顶部） */}
        <ChatComposer />

        {/* 最近项目：复用全站统一的 project-card，封面缺失时保持默认抽象占位 */}
        <section className="chat-recent">
          <div className="section-line">
            <span className="eyebrow">最近使用的项目</span>
            <button onClick={() => navigate("/projects")}>所有项目 →</button>
          </div>
          <div className="project-row">
            <button className="project-card chat-new-card" onClick={() => navigate("/projects")}>
              <Plus size={22} />
              <span>新建项目</span>
            </button>
            {recentCards.map((project) => (
              <ProjectCard key={project.id} {...project} image={(project.id && recentCoverUrls[project.id]) || project.image} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
