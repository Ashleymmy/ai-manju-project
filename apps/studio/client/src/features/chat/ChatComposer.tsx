import {
  ArrowUp,
  ChevronDown,
  Loader2,
  Mic,
  Plus,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { fetchModelCatalog, modelQueryKeys } from "@/entities/model";
import { agentModelName, agentModelOptions, pickAgentDefaultModel, resolveAgentModel } from "@/features/canvas";
import { createAndOpenProject } from "@/features/projects";

import { createChatProjectFlow } from "./createChatProjectFlow";
import "./styles.css";

/* 点击空白处 / Esc 关闭下拉的“自己人”标记：model 在本组件，user 在 ChatPage 顶栏 */
export const CHAT_OPEN_MENU_ATTR = "data-chat-open-menu";

/**
 * 打招呼 + 创作输入对话框：原聊天台主页的核心交互。
 * 聊天台页面暂时隐藏后，该对话框嵌在工作台（今日片场）顶部继续使用；
 * 发送后创建项目并把创作想法接力给画布助手。
 */
export default function ChatComposer() {
  const { user } = useAuth();
  const [location, navigate] = useLocation();
  const [requestedModel, setSelectedModel] = useState("");
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [input, setInput] = useState("");
  // 步骤 2 的加载覆盖层开关：发送后一直覆盖到画布页接力
  const [isLoading, setIsLoading] = useState(false);
  const modelsQuery = useQuery({
    queryKey: modelQueryKeys.catalog(),
    queryFn: fetchModelCatalog,
    enabled: Boolean(user),
    refetchOnWindowFocus: true,
  });
  const catalog = user && !modelsQuery.isError ? modelsQuery.data : undefined;
  // 创作想法会交给画布助手，只展示接口返回的支持工具调用的文本模型。
  const availableModels = catalog?.agentTextModels || [];
  const selectedModel = resolveAgentModel(availableModels, requestedModel)
    || pickAgentDefaultModel(availableModels, catalog?.modelLabels, catalog?.defaultTextModel);
  const modelOptions = agentModelOptions(availableModels, selectedModel);
  const modelStatus = !user ? "登录后查看模型"
    : modelsQuery.isFetching ? "正在获取模型…"
      : modelsQuery.isError ? "模型获取失败，请重试"
        : !selectedModel ? "暂无可用的创作模型，请联系管理员配置"
          : "";
  const selectedModelLabel = selectedModel ? agentModelName(selectedModel) : modelStatus;
  const sendButtonTitle = isLoading ? "正在创建项目…"
    : !input.trim() ? "输入创作想法后发送"
      : user && (!selectedModel || modelsQuery.isFetching) ? modelStatus
        : "发送并创建项目（Enter）";
  // 未登录时去登录页，登录后回到当前所在页面
  const loginPath = `/login?next=${encodeURIComponent(location || "/dashboard")}`;

  // 点击页面任意空白处 / 按 Esc 时关闭模型下拉（用户菜单在 ChatPage 顶栏独立处理）
  useEffect(() => {
    if (!showModelDropdown) return;
    const closeMenu = () => setShowModelDropdown(false);
    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest(`[${CHAT_OPEN_MENU_ATTR}="model"]`)) return;
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
  }, [showModelDropdown]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    // 检查用户是否已登录
    if (!user) {
      toast.error("请先登录后再创建项目");
      navigate(loginPath);
      return;
    }

    if (!selectedModel || modelsQuery.isFetching) {
      toast.error(modelStatus);
      return;
    }

    setInput("");
    // 步骤 2 开始：加载动画覆盖后续全部过渡（步骤 1 在覆盖层下静默进行）
    setIsLoading(true);

    try {
      await createChatProjectFlow({ navigate, model: selectedModel })(text);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建项目失败，请重试");
      setInput(text);
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
    <>
      <section className="chat-hero">
        <div className="chat-hero-text">
          <p className="eyebrow">SCRIPT / DESK</p>
          <h2>今天要做点什么？</h2>
          <p className="chat-hero-sub">你好！我是 AI 漫剧助手，很高兴为你服务。你想创作什么样的漫剧故事？</p>
        </div>
        {/* 新建画布：从顶栏右上角移到打招呼一行的右侧（参考设计） */}
        <button
          type="button"
          className="create-button chat-hero-create"
          onClick={() => void createAndOpenProject(navigate)}
        >
          <Plus size={17} /> 新建画布
        </button>
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
            <div className="chat-model" {...{ [CHAT_OPEN_MENU_ATTR]: "model" }}>
              <button
                className="chat-tool-btn chat-model-trigger"
                aria-label="选择创作模型"
                aria-expanded={showModelDropdown}
                title={selectedModelLabel}
                disabled={isLoading}
                onClick={() => {
                  setShowModelDropdown(!showModelDropdown);
                  if (!showModelDropdown && user && !modelsQuery.isFetching) void modelsQuery.refetch();
                }}
              >
                <Sparkles size={12} />
                <span>{selectedModelLabel}</span>
                <ChevronDown size={12} className={showModelDropdown ? "rotated" : ""} />
              </button>
              {showModelDropdown && (
                <div className="chat-menu chat-model-menu">
                  {modelStatus && <p className="chat-model-status" role="status">{modelStatus}</p>}
                  {modelOptions.map(({ value: model, label }) => (
                    <button
                      key={model}
                      className={selectedModel === model ? "active" : ""}
                      aria-pressed={selectedModel === model}
                      disabled={modelsQuery.isFetching}
                      title={label}
                      onClick={() => {
                        setSelectedModel(model);
                        setShowModelDropdown(false);
                      }}
                    >
                      <Sparkles size={12} />
                      <span>{label}</span>
                    </button>
                  ))}
                  {user && !modelsQuery.isFetching && (modelsQuery.isError || !availableModels.length) && (
                    <button onClick={() => void modelsQuery.refetch()}>重新获取模型</button>
                  )}
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
              className="chat-send"
              type="button"
              title={sendButtonTitle}
              aria-label={isLoading ? "正在创建项目" : "发送并创建项目"}
              aria-busy={isLoading}
              onClick={handleSend}
              disabled={!input.trim() || isLoading || Boolean(user && (!selectedModel || modelsQuery.isFetching))}
            >
              {isLoading
                ? <Loader2 size={18} className="spin" aria-hidden="true" />
                : <ArrowUp size={18} strokeWidth={2.25} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </section>

      {/* 步骤 2：全屏加载覆盖层 —— 从发送起覆盖，直到画布页完成加载后由画布侧接力关闭 */}
      {isLoading && (
        <div className="chat-loading">
          <Loader2 className="spin" size={38} />
          <p>正在为你准备画布…</p>
          <small>创建项目并打开创作工作台</small>
          <div className="chat-loading-bar"><i /></div>
        </div>
      )}
    </>
  );
}
