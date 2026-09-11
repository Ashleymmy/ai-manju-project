import {
  ArrowUp,
  ChevronDown,
  FileText,
  Home,
  Image as ImageIcon,
  Loader2,
  LogIn,
  LogOut,
  Mic,
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

import { createChatProjectFlow } from "./createChatProjectFlow";
import "./styles.css";

const OPEN_MENU_ATTR = "data-chat-open-menu";

/* 顶栏模式 Tab：主页进工作台，视频/图片进对应工作台，剧本留在 /chat */
const MODE_TABS = [
  { id: "video", label: "视频创作", icon: Video, href: "/video" },
  { id: "image", label: "图片创作", icon: ImageIcon, href: "/image" },
  { id: "script", label: "剧本创作", icon: FileText, href: "/chat" },
] as const;

/* 首页最近项目卡片的数量上限 */
const RECENT_PROJECT_LIMIT = 3;

export default function ChatPage() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const [selectedModel, setSelectedModel] = useState("GPT-4");
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [input, setInput] = useState("");
  const [recentProjects, setRecentProjects] = useState<CanvasProject[]>([]);
  // 步骤 2 的加载覆盖层开关：发送后一直覆盖到画布页接力
  const [isLoading, setIsLoading] = useState(false);
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

  // 点击页面任意空白处 / 按 Esc 时关闭已打开的下拉（用户菜单、模型选择器）
  useEffect(() => {
    if (!showUserMenu && !showModelDropdown) return;
    const closeMenus = () => {
      setShowUserMenu(false);
      setShowModelDropdown(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest(`[${OPEN_MENU_ATTR}]`)) return;
      closeMenus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenus();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showUserMenu, showModelDropdown]);

  const availableModels = [
    "GPT-4",
    "GPT-3.5 Turbo",
    "Claude 3 Opus",
    "Claude 3 Sonnet",
    "Gemini Pro",
    "Gemini 3.7 Flash"
  ];

  const handleLoginClick = () => {
    navigate("/login?next=%2Fchat");
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    // 检查用户是否已登录
    if (!user) {
      toast.error("请先登录后再创建项目");
      navigate("/login?next=%2Fchat");
      return;
    }

    setInput("");
    // 步骤 2 开始：加载动画覆盖后续全部过渡（步骤 1 在覆盖层下静默进行）
    setIsLoading(true);

    try {
      await createChatProjectFlow({ navigate })(text);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建项目失败，请重试");
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleVoiceInput = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast.error("您的浏览器不支持语音识别功能");
      return;
    }

    if (isListening) {
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsListening(true);
      toast.success("开始语音识别...");
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(prev => prev + transcript);
      setIsListening(false);
    };

    recognition.onerror = (event: any) => {
      console.error('语音识别错误:', event.error);
      setIsListening(false);
      toast.error("语音识别失败，请重试");
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
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
            <div className="chat-user" {...{ [OPEN_MENU_ATTR]: "user" }}>
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
        <section className="chat-hero">
          <p className="eyebrow">SCRIPT / DESK</p>
          <h2>今天要做点什么？</h2>
          <p className="chat-hero-sub">你好！我是 AI 漫剧助手，很高兴为你服务。你想创作什么样的漫剧故事？</p>
        </section>

        {/* 创作输入区：与 studio 输入表面同一质感 */}
        <section className="chat-composer">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入你的创作想法…（Enter 发送，Shift+Enter 换行）"
            disabled={isLoading}
          />
          <div className="chat-composer-bar">
            <span className="chat-composer-hint">{input.length ? `${input.length} 字符` : ""}</span>
            <div className="chat-composer-actions">
              <div className="chat-model" {...{ [OPEN_MENU_ATTR]: "model" }}>
                <button className="chat-tool-btn" onClick={() => setShowModelDropdown(!showModelDropdown)}>
                  <Sparkles size={12} />
                  {selectedModel}
                  <ChevronDown size={12} className={showModelDropdown ? "rotated" : ""} />
                </button>
                {showModelDropdown && (
                  <div className="chat-menu chat-model-menu">
                    {availableModels.map((model) => (
                      <button
                        key={model}
                        className={selectedModel === model ? "active" : ""}
                        onClick={() => {
                          setSelectedModel(model);
                          setShowModelDropdown(false);
                        }}
                      >
                        <Sparkles size={12} />
                        {model}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                className={isListening ? "chat-tool-btn chat-mic listening" : "chat-tool-btn chat-mic"}
                title={isListening ? "停止语音识别" : "语音输入"}
                onClick={handleVoiceInput}
              >
                <Mic size={14} />
              </button>

              <button
                className="vermilion-button chat-send"
                title="发送并创建项目"
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
              >
                <ArrowUp size={15} />
              </button>
            </div>
          </div>
        </section>

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

      {/* 步骤 2：全屏加载覆盖层 —— 从发送起覆盖，直到画布页完成加载后由画布侧接力关闭 */}
      {isLoading && (
        <div className="chat-loading">
          <Loader2 className="spin" size={38} />
          <p>正在为你准备画布…</p>
          <small>创建项目并打开创作工作台</small>
          <div className="chat-loading-bar"><i /></div>
        </div>
      )}
    </div>
  );
}
