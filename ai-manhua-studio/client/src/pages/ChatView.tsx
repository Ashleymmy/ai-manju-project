import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { User, LogIn, LogOut, Sparkles, Video, Image, FileText, Plus, Home, ChevronDown, Mic, ArrowUp, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { createProject } from "@/services/api/projects";
import { setCanvasBootstrap } from "@/lib/canvas-bootstrap";

const OPEN_MENU_ATTR = "data-chat-open-menu";

// 果冻悬浮玻璃卡片共享样式
const glassCard: React.CSSProperties = {
  background: "rgba(26, 32, 34, 0.55)",
  backdropFilter: "blur(20px) saturate(160%)",
  WebkitBackdropFilter: "blur(20px) saturate(160%)",
  border: "1px solid rgba(239, 235, 222, 0.1)",
  borderRadius: "20px",
  boxShadow:
    "inset 0 1px 0 rgba(239, 235, 222, 0.08), 0 12px 32px rgba(0, 0, 0, 0.35)",
  transition: "transform .28s cubic-bezier(.34,1.4,.5,1), box-shadow .28s ease, border-color .28s ease",
};
const glassCardHover: React.CSSProperties = {
  transform: "translateY(-3px)",
  borderColor: "rgba(233, 81, 62, 0.3)",
  boxShadow:
    "inset 0 1px 0 rgba(239, 235, 222, 0.12), 0 20px 44px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(233, 81, 62, 0.12)",
};
const glassMenu: React.CSSProperties = {
  background: "rgba(26, 32, 34, 0.72)",
  backdropFilter: "blur(24px) saturate(170%)",
  WebkitBackdropFilter: "blur(24px) saturate(170%)",
  border: "1px solid rgba(239, 235, 222, 0.12)",
  borderRadius: "14px",
  boxShadow: "0 12px 32px rgba(0, 0, 0, 0.5)",
};

export default function ChatView() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const [activeMode, setActiveMode] = useState<"video" | "image" | "script">("script");
  const [selectedModel, setSelectedModel] = useState("GPT-4");
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [input, setInput] = useState("");
  // 步骤 2 的加载覆盖层开关：发送后一直覆盖到画布页接力
  const [isLoading, setIsLoading] = useState(false);

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

  const handleLogout = () => {
    logout();
    toast.success("已退出登录");
  };

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
      // 步骤 1：静默新建画布（对用户透明，只由覆盖层传达「正在准备」）
      // 节点结构遵循画布既有规范（见 CanvasWorkspaceView.buildCanvasNodeCandidate），
      // 不夹带任何自动执行标记——步骤 6/7 由 Agent 面板与用户确认后驱动。
      const textNodeId = crypto.randomUUID();
      const imageNodeId = crypto.randomUUID();
      const initialCanvasData = {
        nodes: [
          {
            id: textNodeId,
            kind: "text",
            title: "创作指令",
            content: text,
            x: 160,
            y: 160,
            width: 300,
            height: 170,
            metadata: {
              content: text,
              status: "idle",
              size: "auto",
              quality: "auto",
              count: 1,
            },
          },
          {
            id: imageNodeId,
            kind: "image",
            title: "生成图片",
            content: text,
            x: 540,
            y: 160,
            width: 300,
            height: 220,
            metadata: {
              content: text,
              generationMode: "image",
              status: "idle",
              size: "auto",
              quality: "auto",
              count: 1,
            },
          },
        ],
        edges: [
          {
            id: crypto.randomUUID(),
            from: textNodeId,
            to: imageNodeId,
          },
        ],
        viewport: {
          x: 0,
          y: 0,
          zoom: 1,
        },
      };

      const newProject = await createProject({
        title: text.slice(0, 50),
        scope: "personal",
        data: initialCanvasData,
      });

      // 步骤 2 后半程：写入引导信息（步骤 4/5 所需）并跳转到画布；
      // 覆盖层保持显示，由画布页的引导覆盖层无缝接力，直到画布加载完成。
      setCanvasBootstrap(newProject.id, text);
      navigate(`/canvas/${encodeURIComponent(newProject.id)}?scope=personal`);
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

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-hidden" style={{ background: "var(--background)" }}>
      {/* 背景环境光晕：给毛玻璃提供可折射的内容 */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ zIndex: 0 }}>
        <div style={{
          position: "absolute", top: "-20%", left: "-12%", width: "55vw", height: "55vw", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(233,81,62,0.14) 0%, transparent 62%)", filter: "blur(48px)"
        }} />
        <div style={{
          position: "absolute", bottom: "-25%", right: "-10%", width: "50vw", height: "50vw", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(74,124,180,0.12) 0%, transparent 62%)", filter: "blur(56px)"
        }} />
        <div style={{
          position: "absolute", top: "30%", left: "48%", width: "30vw", height: "30vw", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(239,235,222,0.04) 0%, transparent 60%)", filter: "blur(60px)"
        }} />
      </div>

      {/* Top Navigation Bar */}
      <div className="fixed left-0 right-0 top-0 z-20 border-b" style={{
        background: "var(--rail)",
        borderColor: "var(--line)"
      }}>
        <div className="flex h-16 items-center justify-between px-6">
          {/* Left: Logo */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: "var(--primary)" }}>
              <Sparkles className="h-5 w-5" style={{ color: "var(--primary-foreground)" }} />
            </div>
            <div>
              <h1 className="text-base font-bold" style={{ color: "var(--foreground)" }}>AI 漫工坊</h1>
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>创作工作台</p>
            </div>
          </div>

          {/* Center: Navigation Tabs */}
          <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2">
            <button
              onClick={() => navigate("/projects")}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all hover:opacity-80"
              style={{
                background: "var(--secondary)",
                color: "var(--foreground)"
              }}
            >
              <Home className="h-4 w-4" />
              主页
            </button>
            <button
              onClick={() => setActiveMode("video")}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                activeMode === "video" ? "" : "hover:opacity-80"
              }`}
              style={{
                background: activeMode === "video" ? "rgba(233,81,62,.14)" : "transparent",
                color: activeMode === "video" ? "var(--foreground)" : "var(--muted-foreground)"
              }}
            >
              <Video className="h-4 w-4" />
              视频创作
            </button>
            <button
              onClick={() => setActiveMode("image")}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                activeMode === "image" ? "" : "hover:opacity-80"
              }`}
              style={{
                background: activeMode === "image" ? "rgba(233,81,62,.14)" : "transparent",
                color: activeMode === "image" ? "var(--foreground)" : "var(--muted-foreground)"
              }}
            >
              <Image className="h-4 w-4" />
              图片创作
            </button>
            <button
              onClick={() => setActiveMode("script")}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                activeMode === "script" ? "" : "hover:opacity-80"
              }`}
              style={{
                background: activeMode === "script" ? "rgba(233,81,62,.14)" : "transparent",
                color: activeMode === "script" ? "var(--foreground)" : "var(--muted-foreground)"
              }}
            >
              <FileText className="h-4 w-4" />
              剧本创作
            </button>
          </div>

          {/* Right: User Info */}
          <div className="flex items-center gap-4">
            {user ? (
              <div className="relative" {...{ [OPEN_MENU_ATTR]: "user" }}>
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 transition-all hover:bg-[var(--accent)]"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full" style={{
                    background: "var(--primary)"
                  }}>
                    <User className="h-4 w-4" style={{ color: "var(--primary-foreground)" }} />
                  </div>
                  <span className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                    {user.username}
                  </span>
                  <ChevronDown className="h-4 w-4" style={{ color: "var(--muted-foreground)" }} />
                </button>

                {/* User Dropdown Menu */}
                {showUserMenu && (
                  <div
                    className="absolute right-0 top-full mt-2 w-48 overflow-hidden"
                    style={{ ...glassMenu, zIndex: 50 }}
                  >
                    <button
                      onClick={() => {
                        logout();
                        setShowUserMenu(false);
                        toast.success("已退出登录");
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-4 py-3 text-left text-sm transition-all hover:bg-[var(--accent)]"
                      style={{ color: "var(--foreground)" }}
                    >
                      <LogOut className="h-4 w-4" />
                      退出登录
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Button
                size="sm"
                onClick={handleLoginClick}
                style={{
                  background: "var(--primary)",
                  color: "var(--primary-foreground)"
                }}
                className="hover:opacity-90"
              >
                <LogIn className="mr-2 h-4 w-4" />
                登录
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="relative z-10 flex min-h-screen items-center justify-center pt-16">
        <div className="w-full max-w-6xl px-6 py-6">
          {/* Title */}
          <h2 className="mb-6 flex items-center gap-2 text-xl font-bold" style={{ color: "var(--foreground)" }}>
            <Sparkles className="h-6 w-6" style={{ color: "var(--red)" }} />
            今天要做点什么？
          </h2>

          {/* Welcome Message */}
          <p className="mb-6 text-sm leading-relaxed" style={{ color: "var(--foreground)" }}>
            你好！我是 AI 漫剧助手，很高兴为你服务。你想创作什么样的漫剧故事？
          </p>

          {/* Input Area */}
          <div className="mb-6 p-4" style={{ ...glassCard }}>
            <div className="relative">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入你的创作想法... (Enter 发送, Shift+Enter 换行)"
                className="min-h-[80px] resize-none border-0 bg-transparent dark:bg-transparent pr-24 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus-visible:ring-0 shadow-none"
                disabled={isLoading}
              />

              {/* Bottom Controls */}
              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2">
                  {/* Placeholder for left side controls */}
                </div>

                <div className="relative flex items-center gap-2">
                  {/* Model Selector */}
                  <div className="relative" {...{ [OPEN_MENU_ATTR]: "model" }}>
                    <button
                      onClick={() => setShowModelDropdown(!showModelDropdown)}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all hover:bg-[var(--accent)]"
                      style={{
                        color: "var(--foreground)"
                      }}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {selectedModel}
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>

                    {/* Dropdown Menu */}
                    {showModelDropdown && (
                      <div
                        className="absolute bottom-full right-0 mb-2 w-48 overflow-hidden"
                        style={{ ...glassMenu }}
                      >
                        {availableModels.map((model) => (
                          <button
                            key={model}
                            onClick={() => {
                              setSelectedModel(model);
                              setShowModelDropdown(false);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-all hover:bg-[var(--accent)] first:rounded-t-lg last:rounded-b-lg"
                            style={{
                              color: selectedModel === model ? "var(--primary)" : "var(--foreground)"
                            }}
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                            {model}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Microphone Button */}
                  <button
                    onClick={handleVoiceInput}
                    className="flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-[var(--accent)]"
                    style={{
                      color: isListening ? "var(--primary)" : "var(--muted-foreground)",
                      background: isListening ? "rgba(233,81,62,.14)" : "transparent"
                    }}
                  >
                    <Mic className="h-4 w-4" />
                  </button>

                  {/* Send Button */}
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading}
                    className="flex h-8 w-8 items-center justify-center rounded-lg transition-all"
                    style={{
                      background: input.trim() && !isLoading ? "var(--primary)" : "var(--muted)",
                      color: input.trim() && !isLoading ? "var(--primary-foreground)" : "var(--muted-foreground)"
                    }}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Projects Section */}
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-medium" style={{ color: "var(--muted-foreground)" }}>
                最近使用的项目
              </h3>
              <button
                onClick={() => navigate("/projects")}
                className="text-xs hover:opacity-80"
                style={{ color: "var(--blue)" }}
              >
                所有项目 →
              </button>
            </div>
            <div className="grid grid-cols-4 gap-4">
              <button
                className="flex flex-col items-center justify-center gap-3 p-6"
                style={{ ...glassCard, borderStyle: "dashed", borderColor: "rgba(239,235,222,0.16)" }}
                onMouseEnter={(e) => Object.assign(e.currentTarget.style, glassCardHover, { borderStyle: "dashed" })}
                onMouseLeave={(e) => Object.assign(e.currentTarget.style, { transform: "", borderColor: "rgba(239,235,222,0.16)", boxShadow: glassCard.boxShadow })}
              >
                <Plus className="h-8 w-8" style={{ color: "var(--muted-foreground)" }} />
                <span className="text-sm" style={{ color: "var(--muted-foreground)" }}>新建项目</span>
              </button>
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="cursor-pointer p-4"
                  style={{ ...glassCard }}
                  onMouseEnter={(e) => Object.assign(e.currentTarget.style, glassCardHover)}
                  onMouseLeave={(e) => Object.assign(e.currentTarget.style, { transform: "", borderColor: glassCard.border ? "rgba(239,235,222,0.1)" : "", boxShadow: glassCard.boxShadow })}
                >
                  <div className="mb-3 aspect-video rounded-xl" style={{
                    background: "linear-gradient(135deg, rgba(233,81,62,0.16), rgba(74,124,180,0.12)), rgba(239,235,222,0.04)"
                  }}></div>
                  <p className="text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>项目 {i}</p>
                  <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>编辑于 {i} 天前</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 步骤 2：全屏加载覆盖层 —— 从发送起覆盖，直到画布页完成加载后由画布侧接力关闭 */}
      {isLoading && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4"
          style={{
            background: "rgba(10, 12, 13, 0.82)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
          }}
        >
          <Loader2 className="h-10 w-10 animate-spin" style={{ color: "var(--primary)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>正在为你准备画布…</p>
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>创建项目并打开创作工作台</p>
        </div>
      )}
    </div>
  );
}
