import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUp, Bot, Brain, ChartColumn, Check, ChevronDown, ChevronRight, History, Image as ImageIcon, Info, KeyRound, LayoutGrid, Link2, MessageCircle, MessagesSquare, Paperclip, PlugZap, Plus, Puzzle, ScanSearch, Settings, ShieldCheck, Sparkles, Trash2, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  fetchAiModels,
  requestAiText,
  type ResponseFunctionTool,
  type ResponseInputMessage,
  type ResponseToolCall,
  type TextModelCatalog,
} from "@/services/api/ai";
import { publicApiError } from "@/shared/api/errors";
import {
  createLocalAgentSseClient,
  loadAgentConnectionSettings,
  loadAgentConversations,
  persistAgentConnectionSettings,
  persistAgentConversations,
  postLocalAgentResult,
  postLocalAgentState,
  sendLocalAgentTurn,
  upsertAgentConversation,
  type AgentConversation,
  type AgentMessage,
  type AgentToolResult,
  type NormalizedToolCall,
  type OnlineToolContext,
  type PendingAgentTool,
} from "@/features/canvas/agent";
import {
  CANVAS_AGENT_PROTOCOL_VERSION,
  CANVAS_AGENT_TOOLS,
  canvasAgentToolToOps,
  compactCanvasAgentSnapshot,
  isCanvasAgentReadTool,
  isCanvasAgentToolName,
  isCanvasAgentWorkspaceTool,
  summarizeCanvasAgentOps,
  type CanvasAgentExecutionResult,
  type CanvasAgentOp,
  type CanvasAgentSnapshot,
  type CanvasAgentToolRequest,
} from "@/lib/canvas-agent";

type AgentMenuKind = "threads" | "files" | "plus" | "confirm" | "models";
type PlusMenuView = "root" | "canvas" | "skills" | "apps";
// 技能预设与头脑风暴提示词：纯前端占位，后续由后端技能/应用体系适配
const SKILL_PRESETS = [
  { name: "剧本分析", prompt: "分析当前画布的剧本结构：指出主题、冲突和节奏问题。" },
  { name: "分镜规划", prompt: "基于画布内容规划分镜：列出每个镜头的画面内容和顺序。" },
  { name: "角色设定", prompt: "为画布中的角色补充设定：外貌、性格和动机。" },
];
const BRAINSTORM_PROMPT = "围绕当前画布做一次头脑风暴：给出 5 个不同方向的创意点子，并说明各自的画面潜力。";

const ONLINE_AGENT_MAX_STEPS = 4;
const ONLINE_AGENT_PROMPT = "你是 AI-Manju 的在线画布助手。首轮必须调用工具：只读问题调用 canvas_get_state，需要改动画布时调用对应画布工具。需要生成内容时调用 canvas_generate_text、canvas_generate_image、canvas_generate_video、canvas_generate_audio 或 canvas_create_generation_flow。不要输出伪造的 JSON ops，不要编造执行结果。涉及已有节点时只能使用当前画布快照中的真实 id；信息不足时先向用户说明。工具返回后必须依据真实结果回答。";
const ONLINE_AGENT_TOOLS: ResponseFunctionTool[] = CANVAS_AGENT_TOOLS.map((item) => ({
  type: "function",
  function: { ...item.function },
}));

export default function AgentPanel({
  projectId,
  open,
  onClose,
  snapshot,
  canUndoOps,
  onApplyOps,
  onExecuteWorkspaceTool,
  onUndoOps,
  initialPrompt,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  snapshot: CanvasAgentSnapshot;
  canUndoOps: boolean;
  onApplyOps: (ops: CanvasAgentOp[]) => Promise<CanvasAgentExecutionResult>;
  onExecuteWorkspaceTool: (name: string, input: Record<string, unknown>) => Promise<AgentToolResult>;
  onUndoOps: () => Promise<CanvasAgentSnapshot | null>;
  /** 聊天台引导流程交接的用户输入原文（步骤5：同步为一条用户消息并发送，仅一次） */
  initialPrompt?: string;
}) {
  const [tab, setTab] = useState<"connect" | "chat">("chat");
  const [channel, setChannel] = useState<"online" | "local">("online");
  const [url, setUrl] = useState(() => loadAgentConnectionSettings().url);
  const [token, setToken] = useState(() => loadAgentConnectionSettings().token);
  const [enabled, setEnabled] = useState(false);
  const [connected, setConnected] = useState(false);
  const [activity, setActivity] = useState("未连接");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [threadId, setThreadId] = useState<string | undefined>();
  const [modelCatalog, setModelCatalog] = useState<TextModelCatalog | null>(null);
  const [textModel, setTextModel] = useState("");
  const [modelLoadError, setModelLoadError] = useState("");
  const [confirmTools, setConfirmTools] = useState(true);
  const [pendingTool, setPendingTool] = useState<PendingAgentTool | null>(null);
  const [panelWidth, setPanelWidth] = useState(560); // 悬浮卡片初始宽度（可拖拽 250–600）
  const [conversationId, setConversationId] = useState<string>(() => crypto.randomUUID());
  const [conversations, setConversations] = useState<AgentConversation[]>(() => loadAgentConversations(projectId));
  const [openMenu, setOpenMenu] = useState<AgentMenuKind | null>(null);
  const [plusView, setPlusView] = useState<PlusMenuView>("root");
  const [autoModel, setAutoModel] = useState(false);
  const [moreModelsOpen, setMoreModelsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const clientId = useRef(crypto.randomUUID()).current;
  const snapshotRef = useRef(snapshot);
  const pendingToolRef = useRef<PendingAgentTool | null>(null);
  const confirmToolsRef = useRef(confirmTools);
  const onApplyOpsRef = useRef(onApplyOps);
  const onExecuteWorkspaceToolRef = useRef(onExecuteWorkspaceTool);
  const onUndoOpsRef = useRef(onUndoOps);
  const localToolHandlerRef = useRef<(request: CanvasAgentToolRequest) => void>(() => undefined);
  const resizingRef = useRef(false);

  const setPendingAgentTool = (value: PendingAgentTool | null) => {
    pendingToolRef.current = value;
    setPendingTool(value);
  };

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pendingTool, waiting]);

  // 切换项目时重载该项目的对话列表并开启新对话
  useEffect(() => {
    setConversations(loadAgentConversations(projectId));
    setMessages([]);
    setConversationId(crypto.randomUUID());
    setThreadId(undefined);
    setOpenMenu(null);
  }, [projectId]);

  // 消息变化时自动保存当前对话（标题取首条用户消息）
  useEffect(() => {
    if (!messages.length) return;
    setConversations((prev) => {
      const next = upsertAgentConversation(prev, conversationId, messages);
      persistAgentConversations(projectId, next);
      return next;
    });
  }, [messages, conversationId, projectId]);

  // 点击面板菜单外部时关闭弹层
  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as HTMLElement | null)?.closest?.("[data-agent-menu]")) setOpenMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openMenu]);

  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);
  useEffect(() => { confirmToolsRef.current = confirmTools; }, [confirmTools]);
  useEffect(() => { onApplyOpsRef.current = onApplyOps; }, [onApplyOps]);
  useEffect(() => { onExecuteWorkspaceToolRef.current = onExecuteWorkspaceTool; }, [onExecuteWorkspaceTool]);
  useEffect(() => { onUndoOpsRef.current = onUndoOps; }, [onUndoOps]);

  useEffect(() => {
    fetchAiModels()
      .then((result) => {
        const models = result.agentTextModels;
        const defaultModel = models.includes(result.defaultTextModel) ? result.defaultTextModel : models[0] || "";
        const catalog: TextModelCatalog = {
          models,
          defaultModel,
          labels: result.modelLabels,
          providerNames: result.modelProviderNames,
        };
        setModelCatalog(catalog);
        setTextModel((current) => models.includes(current) ? current : defaultModel);
        setModelLoadError(models.length ? "" : "没有支持 Agent 工具调用的文本模型");
        setActivity(models.length ? "在线 Agent 可用" : "Agent 模型未配置");
      })
      .catch((error) => {
        const message = publicApiError(error, "读取 Agent 模型失败");
        setModelCatalog(null);
        setTextModel("");
        setModelLoadError(message);
        setActivity("Agent 模型不可用");
        toast.error(message);
      });
  }, []);

  useEffect(() => {
    if (!enabled || !url.trim() || !token.trim()) return;
    const client = createLocalAgentSseClient({
      endpoint: url,
      token,
      clientId,
      callbacks: {
        getSnapshot: () => snapshotRef.current,
        onHello: () => {
          setConnected(true);
          setActivity("已连接");
          toast.success("本地Agent 已连接");
        },
        onToolCall: request => localToolHandlerRef.current(request),
        onAgentEvent: event => {
          if (event.thread_id) setThreadId(event.thread_id);
          if (event.type === "turn.started") {
            setActivity("思考中");
            setWaiting(true);
          }
          if (
            (event.type === "item.updated" || event.type === "item.completed")
            && event.item?.type === "agent_message"
            && event.item.text
          ) {
            const { id = String(Date.now()), text } = event.item;
            setMessages(prev => {
              const index = prev.findIndex(message => message.id === id);
              return index >= 0
                ? prev.map((message, itemIndex) => itemIndex === index ? { ...message, text } : message)
                : [...prev, { id, role: "assistant", text }];
            });
          }
        },
        onDone: () => {
          setActivity("完成");
          setWaiting(false);
        },
        onAgentError: message => {
          setMessages(prev => [
            ...prev,
            { id: `err-${Date.now()}`, role: "error", text: message },
          ]);
          setActivity("出错");
          setWaiting(false);
        },
        onConnectionError: wasConnected => {
          setConnected(false);
          setActivity(wasConnected ? "连接断开" : "连接失败");
          if (!wasConnected) setEnabled(false);
        },
        onDispose: () => setConnected(false),
      },
    });
    return () => client.close();
  }, [enabled, url, token, clientId]);

  useEffect(() => {
    if (!connected) return;
    const base = url.trim().replace(/\/$/, "");
    const timer = window.setTimeout(() => {
      void postLocalAgentState(base, token, clientId, snapshot);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [clientId, connected, snapshot, token, url]);

  const sendPrompt = async () => {
    const text = prompt.trim();
    if (pendingTool) return;
    if (channel === "online") {
      await sendOnlinePrompt(text);
      return;
    }
    if (!connected || !text || waiting) return;
    setWaiting(true);
    setActivity("发送中");
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text }]);
    setPrompt("");
    try {
      const data = await sendLocalAgentTurn(url, token, {
        prompt: text,
        canvasId: projectId,
        threadId,
      });
      if (data.threadId) setThreadId(data.threadId);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: "error", text: err instanceof Error ? err.message : "发送失败" },
      ]);
      setActivity("发送失败");
      setWaiting(false);
    }
  };

  const sendOnlinePrompt = async (text: string) => {
    if (!text || waiting) return;
    if (!effectiveModel) {
      const message = modelLoadError || "没有支持 Agent 工具调用的文本模型";
      setMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: "error", text: message }]);
      setActivity("Agent 模型未配置");
      return;
    }
    setWaiting(true);
    setActivity("在线模型思考中");
    const userMessage: AgentMessage = { id: `u-${Date.now()}`, role: "user", text };
    const history = messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-8)
      .map((message): ResponseInputMessage => ({ role: message.role as "user" | "assistant", content: message.text }));
    const requestMessages: ResponseInputMessage[] = [
      { role: "system", content: ONLINE_AGENT_PROMPT },
      ...history,
      {
        role: "user",
        content: `当前画布：${JSON.stringify(compactCanvasAgentSnapshot(snapshotRef.current))}\n\n用户需求：${text}`,
      },
    ];
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [...prev, userMessage]);
    setPrompt("");
    try {
      await runOnlineAgentStep(requestMessages, 1, assistantId, "required");
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: "error", text: publicApiError(error, "在线 Agent 请求失败") },
      ]);
      setActivity("在线请求失败");
      setWaiting(false);
    }
  };

  const runOnlineAgentStep = async (
    requestMessages: ResponseInputMessage[],
    step: number,
    assistantId: string,
    toolChoice: "required" | "auto" = "auto",
  ): Promise<void> => {
    const response = await requestAiText({
      model: effectiveModel,
      messages: requestMessages,
      tools: ONLINE_AGENT_TOOLS,
      tool_choice: toolChoice,
    });
    const calls = normalizeToolCalls(response.toolCalls);
    if (!calls.length) {
      upsertAssistantMessage(assistantId, response.content || "模型没有返回内容。");
      setActivity(response.model ? `完成 · ${response.model}` : "完成");
      setWaiting(false);
      return;
    }
    if (confirmToolsRef.current && calls.some((call) => !isCanvasAgentReadTool(call.name))) {
      const pending: OnlineToolContext = { source: "online", calls, messages: requestMessages, step, assistantId };
      setPendingAgentTool(pending);
      if (response.content.trim()) upsertAssistantMessage(assistantId, response.content.trim());
      setActivity("等待确认");
      setWaiting(false);
      return;
    }
    await continueOnlineToolLoop({ source: "online", calls, messages: requestMessages, step, assistantId });
  };

  const continueOnlineToolLoop = async (context: OnlineToolContext) => {
    setWaiting(true);
    setActivity("执行画布工具");
    const results = await executeToolCalls(context.calls);
    const failed = results.some((item) => !item.result.ok);
    setMessages((prev) => [...prev, {
      id: `tool-${Date.now()}`,
      role: "tool",
      text: results.map((item) => `${toolLabel(item.name)}：${item.result.message}`).join("\n"),
    }]);
    if (failed || context.step >= ONLINE_AGENT_MAX_STEPS) {
      upsertAssistantMessage(
        context.assistantId,
        failed ? "工具执行未完成，请根据上方真实错误调整操作。" : results.map((item) => item.result.message).join("\n") || "工具已执行。",
      );
      setActivity(failed ? "工具失败" : "完成");
      setWaiting(false);
      return;
    }
    const nextMessages: ResponseInputMessage[] = [
      ...context.messages,
      ...context.calls.map((call): ResponseInputMessage => ({
        type: "function_call",
        call_id: call.id,
        name: call.name,
        arguments: call.arguments,
      })),
      ...results.map((item): ResponseInputMessage => ({
        role: "tool",
        tool_call_id: item.toolCallId,
        content: JSON.stringify(item.result),
      })),
    ];
    await runOnlineAgentStep(nextMessages, context.step + 1, context.assistantId);
  };

  const executeToolCalls = async (calls: NormalizedToolCall[]) => {
    const results: Array<{ toolCallId: string; name: string; result: AgentToolResult }> = [];
    let stopped = false;
    for (const call of calls) {
      if (stopped) {
        results.push({ toolCallId: call.id, name: call.name, result: { ok: false, message: "前一个工具调用失败，后续工具未执行。" } });
        continue;
      }
      let result: AgentToolResult;
      try {
        result = await executeAgentTool(call.name, parseToolArguments(call.arguments));
      } catch (error) {
        result = { ok: false, message: error instanceof Error ? error.message : "工具执行失败" };
      }
      results.push({ toolCallId: call.id, name: call.name, result });
      if (!result.ok) stopped = true;
    }
    return results;
  };

  const executeAgentTool = async (name: string, input: Record<string, unknown>): Promise<AgentToolResult> => {
    if (!isCanvasAgentToolName(name)) return { ok: false, message: `不支持的工具：${name}` };
    if (isCanvasAgentWorkspaceTool(name)) return onExecuteWorkspaceToolRef.current(name, input);
    const current = snapshotRef.current;
    if (name === "canvas_get_state" || name === "canvas_export_snapshot") {
      return { ok: true, message: describeSnapshot(current), data: compactCanvasAgentSnapshot(current) };
    }
    if (name === "canvas_get_selection") {
      const selected = new Set(current.selectedNodeIds);
      const selection = { ...current, nodes: current.nodes.filter((node) => selected.has(node.id)) };
      return { ok: true, message: `当前选中 ${selection.nodes.length} 个节点。`, data: compactCanvasAgentSnapshot(selection) };
    }
    const ops = canvasAgentToolToOps(name, input, current);
    if (!ops.length) return { ok: false, message: `${toolLabel(name)}没有生成可执行操作。` };
    const before = JSON.stringify(compactCanvasAgentSnapshot(current));
    const execution = await onApplyOpsRef.current(ops);
    snapshotRef.current = execution.snapshot;
    const after = JSON.stringify(compactCanvasAgentSnapshot(execution.snapshot));
    const failedGeneration = execution.generationResults.find((item) => item.status !== "succeeded");
    const changed = before !== after || execution.generationResults.length > 0;
    const generationSummary = summarizeGenerationResults(execution.generationResults);
    return {
      ok: changed && !failedGeneration,
      message: changed
        ? [summarizeCanvasAgentOps(ops) || toolLabel(name), generationSummary].filter(Boolean).join("；")
        : "操作未生效，请核对节点 ID 和工具参数。",
      data: {
        snapshot: compactCanvasAgentSnapshot(execution.snapshot),
        generationResults: execution.generationResults,
      },
    };
  };

  const runLocalToolCall = async (request: CanvasAgentToolRequest) => {
    const base = url.trim().replace(/\/$/, "");
    setWaiting(true);
    setActivity(`执行${toolLabel(request.name)}`);
    try {
      const result = await executeAgentTool(request.name, request.input || {});
      await postLocalAgentResult(base, token, clientId, { requestId: request.requestId, result });
      setMessages((prev) => [...prev, { id: `tool-${Date.now()}`, role: "tool", text: `${toolLabel(request.name)}：${result.message}` }]);
      if (!isCanvasAgentReadTool(request.name)) void postLocalAgentState(base, token, clientId, snapshotRef.current);
      setActivity(result.ok ? "工具完成" : "工具失败");
    } catch (error) {
      const message = error instanceof Error ? error.message : "画布工具执行失败";
      await postLocalAgentResult(base, token, clientId, { requestId: request.requestId, error: message }).catch(() => undefined);
      setMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: "error", text: message }]);
      setActivity("工具失败");
    } finally {
      setWaiting(false);
    }
  };

  const handleLocalToolCall = async (request: CanvasAgentToolRequest) => {
    if (confirmToolsRef.current && !isCanvasAgentReadTool(request.name)) {
      if (pendingToolRef.current) {
        const base = url.trim().replace(/\/$/, "");
        await postLocalAgentResult(base, token, clientId, { requestId: request.requestId, error: "仍有待确认的画布工具调用" }).catch(() => undefined);
        return;
      }
      setPendingAgentTool({ source: "local", request });
      setActivity("等待确认");
      setWaiting(false);
      return;
    }
    await runLocalToolCall(request);
  };

  localToolHandlerRef.current = (request) => { void handleLocalToolCall(request); };

  const approvePendingTool = async () => {
    const pending = pendingToolRef.current;
    if (!pending) return;
    setPendingAgentTool(null);
    try {
      if (pending.source === "local") await runLocalToolCall(pending.request);
      else await continueOnlineToolLoop(pending);
    } catch (error) {
      setMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: "error", text: error instanceof Error ? error.message : "工具执行失败" }]);
      setActivity("工具失败");
      setWaiting(false);
    }
  };

  const rejectPendingTool = async () => {
    const pending = pendingToolRef.current;
    if (!pending) return;
    setPendingAgentTool(null);
    if (pending.source === "local") {
      const base = url.trim().replace(/\/$/, "");
      await postLocalAgentResult(base, token, clientId, { requestId: pending.request.requestId, error: "用户取消了画布工具调用" }).catch(() => undefined);
    }
    setMessages((prev) => [...prev, { id: `tool-${Date.now()}`, role: "tool", text: `已拒绝执行${pendingToolSummary(pending)}` }]);
    setActivity("已取消");
    setWaiting(false);
  };

  const undoLastTool = async () => {
    const restored = await onUndoOpsRef.current();
    if (!restored) return;
    snapshotRef.current = restored;
    setMessages((prev) => [...prev, { id: `tool-${Date.now()}`, role: "tool", text: "已撤销上一次画布工具操作。" }]);
    setActivity("已撤销");
    if (connected) {
      const base = url.trim().replace(/\/$/, "");
      void postLocalAgentState(base, token, clientId, restored);
    }
  };

  const upsertAssistantMessage = (id: string, text: string) => {
    setMessages((prev) => {
      const exists = prev.some((message) => message.id === id);
      return exists
        ? prev.map((message) => message.id === id ? { ...message, text } : message)
        : [...prev, { id, role: "assistant", text }];
    });
  };

  const connect = () => {
    if (!url.trim()) { toast.warning("请填写 Agent 地址"); return; }
    if (!token.trim()) { toast.warning("请填写 Agent token"); return; }
    persistAgentConnectionSettings(url, token);
    setEnabled(true);
    setActivity("连接中");
    setTab("chat");
  };

  const disconnect = () => {
    setEnabled(false);
    setConnected(false);
    setActivity("已断开");
    setMessages([]);
    setThreadId(undefined);
    setPendingAgentTool(null);
    setWaiting(false);
  };

  const currentTitle = conversations.find((c) => c.id === conversationId)?.title ?? "新建对话";

  const modelDisplay = (model: string) => modelCatalog?.labels?.[model] || model;
  // Auto 模式下使用模型目录默认模型，手动选择后退出 Auto
  const effectiveModel = autoModel ? (modelCatalog?.defaultModel ?? "") : textModel;

  const toggleMenu = (menu: AgentMenuKind) => {
    if (menu === "plus") setPlusView("root");
    setOpenMenu((prev) => (prev === menu ? null : menu));
  };

  const insertNodeReference = (node: { id: string; type: string; title?: string; content?: string }) => {
    const label = node.title?.trim() || node.content?.trim().slice(0, 12) || node.type;
    setPrompt((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}@${label}(${node.id}) `);
    setOpenMenu(null);
  };

  // 上传附件：前端占位，先把文件名作为引用插入输入框，待后端上传接口适配
  const handleAttachFile = (files: FileList | null) => {
    if (!files?.length) return;
    const names = Array.from(files).map((file) => file.name);
    setPrompt((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}${names.map((n) => `@[附件:${n}]`).join(" ")} `);
    toast.success(`已附加 ${names.join("、")}（待后端适配上传）`);
    setOpenMenu(null);
  };

  const applyPresetPrompt = (text: string) => {
    setPrompt(text);
    setOpenMenu(null);
  };

  // 文件面板：列出画布上的图片输出节点
  const outputNodes = snapshot.nodes.filter((node) => node.imageSrc || node.imageAssetId);

  const newConversation = () => {
    setMessages([]);
    setThreadId(undefined);
    setPendingAgentTool(null);
    setWaiting(false);
    setConversationId(crypto.randomUUID());
    setOpenMenu(null);
    setTab("chat");
  };

  const switchConversation = (conv: AgentConversation) => {
    setMessages(conv.messages);
    setConversationId(conv.id);
    setThreadId(undefined);
    setPendingAgentTool(null);
    setWaiting(false);
    setOpenMenu(null);
    setTab("chat");
  };

  const deleteConversation = (id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      persistAgentConversations(projectId, next);
      return next;
    });
    if (id === conversationId) newConversation();
  };

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    resizingRef.current = true;
    const startX = event.clientX;
    const startWidth = panelWidth;

    const onMove = (e: PointerEvent) => {
      if (!resizingRef.current) return;
      const delta = startX - e.clientX;
      const newWidth = Math.max(250, Math.min(600, startWidth + delta));
      setPanelWidth(newWidth);
    };

    const onUp = () => {
      resizingRef.current = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  // 关闭时延迟卸载 220ms，让出场动画播完再移除 DOM
  const [rendered, setRendered] = useState(open);
  useEffect(() => {
    if (open) {
      setRendered(true);
      return;
    }
    const timer = window.setTimeout(() => setRendered(false), 220);
    return () => window.clearTimeout(timer);
  }, [open]);

  // 步骤5：面板就绪后，把聊天台交接的用户输入同步为一条用户消息并自动发送（仅一次）。
  // 纯响应式条件（无定时器）：面板展开 + 有待同步输入 + 未发送过 + 空闲 + 当前会话无消息。
  const initialPromptSentRef = useRef(false);
  useEffect(() => {
    if (!open || !initialPrompt || initialPromptSentRef.current || waiting || messages.length > 0) return;
    if (channel !== "online") return;
    if (!effectiveModel) {
      // 模型目录加载失败：仍将用户输入同步进对话（步骤5），并展示真实错误
      if (modelLoadError) {
        initialPromptSentRef.current = true;
        setMessages((prev) => [
          ...prev,
          { id: `u-${Date.now()}`, role: "user", text: initialPrompt },
          { id: `err-${Date.now()}`, role: "error", text: modelLoadError },
        ]);
      }
      return; // 模型目录仍在加载：effectiveModel 就绪后本 effect 会再次触发
    }
    initialPromptSentRef.current = true;
    void sendOnlinePrompt(initialPrompt);
  }, [open, initialPrompt, waiting, messages.length, channel, effectiveModel, modelLoadError, sendOnlinePrompt]);

  if (!rendered) return null;

  return (
    <aside className={open ? "agent-panel" : "agent-panel closing"} style={{ width: panelWidth }}>
      <div className="agent-panel-resizer" onPointerDown={startResize} />

      {/* 顶部工具栏：左侧切换对话，右侧历史记录 / 文件 / 设置 / 关闭 */}
      <div className="agent-toolbar">
        <div className="agent-thread-switcher" data-agent-menu>
          <button
            className="agent-thread-trigger"
            title="切换对话"
            onClick={() => toggleMenu("threads")}
          >
            <MessagesSquare size={15} />
            <span>{currentTitle}</span>
            <ChevronDown size={13} />
          </button>
          {openMenu === "threads" && (
            <div className="agent-thread-menu">
              <button type="button" className="agent-thread-new" onClick={newConversation}>
                <Plus size={14} /> 新建对话
              </button>
              <div className="agent-thread-divider" />
              {conversations.length === 0 ? (
                <div className="agent-thread-empty">
                  <History size={22} />
                  <span>暂无历史记录</span>
                </div>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`agent-thread-item ${conv.id === conversationId ? "active" : ""}`}
                  >
                    <button
                      type="button"
                      className="agent-thread-item-main"
                      onClick={() => switchConversation(conv)}
                    >
                      <MessageCircle size={13} />
                      <span className="agent-thread-item-title">{conv.title}</span>
                    </button>
                    <button
                      type="button"
                      className="agent-thread-item-delete"
                      title="删除对话"
                      onClick={() => deleteConversation(conv.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <div className="agent-toolbar-spacer" />
        <button
          className={`agent-toolbar-btn ${openMenu === "threads" ? "is-active" : ""}`}
          title="历史记录"
          onClick={() => toggleMenu("threads")}
        >
          <History size={16} />
        </button>
        <div className="agent-toolbar-pop" data-agent-menu>
          <button
            className={`agent-toolbar-btn ${openMenu === "files" ? "is-active" : ""}`}
            title="文件"
            onClick={() => toggleMenu("files")}
          >
            <ImageIcon size={16} />
          </button>
          {openMenu === "files" && (
            <div className="agent-files-menu">
              <div className="agent-menu-title">文件</div>
              {outputNodes.length === 0 ? (
                <div className="agent-files-empty">
                  <ImageIcon size={22} />
                  <span>暂无输出</span>
                </div>
              ) : (
                outputNodes.map((node) => (
                  <div key={node.id} className="agent-file-item">
                    {node.imageSrc ? (
                      <img src={node.imageSrc} alt={node.title || node.type} />
                    ) : (
                      <span className="agent-file-thumb"><ImageIcon size={14} /></span>
                    )}
                    <span className="agent-file-name">{node.title?.trim() || node.id.slice(0, 8)}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <button className="agent-toolbar-btn" title="设置" onClick={() => setTab(tab === "connect" ? "chat" : "connect")}>
          <Settings size={16} />
        </button>
        <button className="agent-toolbar-btn" title="关闭对话" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      {tab === "connect" ? (
        <div className="agent-connect">
          <div className="agent-setup-note">
            <p>在本机启动 canvas-agent，将终端输出的地址和 token 填入：</p>
            <code className="agent-cmd">canvas-agent --port 17371</code>
          </div>
          <label className="agent-field">
            <span className="field-label"><Link2 size={12} /> 本地地址</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://127.0.0.1:17371"
              spellCheck={false}
            />
          </label>
          <label className="agent-field">
            <span className="field-label"><KeyRound size={12} /> Token</span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="终端显示的 connect token"
            />
          </label>
          {connected
            ? <button className="outline-button" onClick={disconnect}><PlugZap size={14} /> 断开连接</button>
            : <button className="vermilion-button" onClick={connect}><PlugZap size={14} /> 连接本地Agent</button>
          }
        </div>
      ) : (
        <div className="agent-chat">
          {/* 欢迎消息 */}
          {messages.length === 0 && (
            <div className="agent-welcome">
              <div className="agent-welcome-head">
                <div className="agent-welcome-avatar">
                  <Bot size={17} />
                </div>
                <span className="agent-welcome-hi">Hi {projectId.slice(0, 10)}!</span>
              </div>
              <h3>今天一起创作点什么？</h3>

              <div className="agent-quick-actions">
                <button
                  className="agent-quick-card"
                  onClick={() => setPrompt("讲清这个项目的创作思路：解释主题、画面选择和关键验证点。")}
                >
                  <span className="quick-card-top">
                    <ChartColumn size={14} />
                    <span className="quick-label">分析</span>
                    <ChevronRight size={13} className="quick-arrow" />
                  </span>
                  <strong>讲清这个项目的创作思路</strong>
                  <small>解释主题、画面选择和关键验证点。</small>
                </button>
                <button
                  className="agent-quick-card"
                  onClick={() => setPrompt("搭建可视化创作工作台：把世界观、人物和故事结构可视化。")}
                >
                  <span className="quick-card-top">
                    <ScanSearch size={14} />
                    <span className="quick-label">可视化</span>
                    <ChevronRight size={13} className="quick-arrow" />
                  </span>
                  <strong>搭建可视化创作工作台</strong>
                  <small>把世界观、人物和故事结构可视化。</small>
                </button>
              </div>
            </div>
          )}

          {/* 消息列表 */}
          <div ref={listRef} className="agent-messages">
            {messages.map((m) => (
              <div key={m.id} className={`agent-msg agent-msg-${m.role}`}>
                {m.role !== "user" && (
                  <div className="agent-msg-avatar">
                    <Bot size={16} />
                  </div>
                )}
                <div className="agent-msg-content">
                  <p>{m.text}</p>
                </div>
              </div>
            ))}
            {pendingTool && (
              <div className="agent-pending-tool">
                <div>
                  <span className="agent-msg-label">等待确认</span>
                  <strong>{pendingToolSummary(pendingTool)}</strong>
                  <p>{pendingToolDetail(pendingTool)}</p>
                </div>
                <div className="agent-pending-actions">
                  <button type="button" className="outline-button" onClick={() => void rejectPendingTool()}>
                    <XCircle size={13} /> 拒绝
                  </button>
                  <button type="button" className="vermilion-button" onClick={() => void approvePendingTool()}>
                    <Check size={13} /> 执行
                  </button>
                </div>
              </div>
            )}
            {waiting && !pendingTool && (
              <div className="agent-msg agent-msg-assistant">
                <div className="agent-msg-avatar">
                  <Bot size={16} />
                </div>
                <div className="agent-msg-content">
                  <p className="agent-working"><span /><span /><span /></p>
                </div>
              </div>
            )}
          </div>

          {/* 底部输入区：一体化圆角容器，上输入下工具行 */}
          <div className="agent-composer">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendPrompt(); }
              }}
              placeholder="描述创意或需求，/ 使用技能，@ 引用画布内容"
              disabled={(channel === "online" && !effectiveModel) || (channel === "local" && !connected) || waiting || Boolean(pendingTool)}
              rows={2}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => { handleAttachFile(e.target.files); e.target.value = ""; }}
            />

            <div className="agent-composer-footer">
              <div className="agent-composer-left">
                {/* 「+」菜单：从画布添加 / 上传附件 / 技能 / 头脑风暴 / 全部应用 */}
                <div className="agent-ref-picker" data-agent-menu>
                  <button
                    type="button"
                    className="agent-icon-btn"
                    title="上传文件或引用画布内节点"
                    onClick={() => toggleMenu("plus")}
                  >
                    <Plus size={15} />
                  </button>
                  {openMenu === "plus" && (
                    <div className="agent-plus-menu">
                      {plusView !== "root" && (
                        <button type="button" className="agent-menu-back" onClick={() => setPlusView("root")}>
                          <ArrowLeft size={13} />
                          <span>{plusView === "canvas" ? "从画布添加" : plusView === "skills" ? "技能" : "全部应用"}</span>
                        </button>
                      )}
                      {plusView === "root" && (
                        <>
                          <button type="button" className="agent-plus-item" onClick={() => setPlusView("canvas")}>
                            <ImageIcon size={14} /> <span>从画布添加</span> <ChevronRight size={13} />
                          </button>
                          <button type="button" className="agent-plus-item" onClick={() => fileInputRef.current?.click()}>
                            <Paperclip size={14} /> <span>上传附件</span>
                          </button>
                          <button type="button" className="agent-plus-item" onClick={() => setPlusView("skills")}>
                            <Puzzle size={14} /> <span>技能</span> <ChevronRight size={13} />
                          </button>
                          <button type="button" className="agent-plus-item" onClick={() => applyPresetPrompt(BRAINSTORM_PROMPT)}>
                            <Brain size={14} /> <span>头脑风暴</span>
                          </button>
                          <button type="button" className="agent-plus-item" onClick={() => setPlusView("apps")}>
                            <LayoutGrid size={14} /> <span>全部应用</span> <ChevronRight size={13} />
                          </button>
                        </>
                      )}
                      {plusView === "canvas" && (
                        snapshot.nodes.length === 0 ? (
                          <div className="agent-ref-empty">画布暂无节点</div>
                        ) : (
                          snapshot.nodes.slice(0, 30).map((node) => (
                            <button
                              key={node.id}
                              type="button"
                              className="agent-ref-item"
                              onClick={() => insertNodeReference(node)}
                            >
                              <span className="agent-ref-item-type">{node.type}</span>
                              <span className="agent-ref-item-title">
                                {node.title?.trim() || node.content?.trim().slice(0, 16) || node.id.slice(0, 8)}
                              </span>
                            </button>
                          ))
                        )
                      )}
                      {plusView === "skills" && (
                        SKILL_PRESETS.map((skill) => (
                          <button
                            key={skill.name}
                            type="button"
                            className="agent-plus-item"
                            onClick={() => applyPresetPrompt(skill.prompt)}
                          >
                            <Puzzle size={14} /> <span>{skill.name}</span>
                          </button>
                        ))
                      )}
                      {plusView === "apps" && (
                        <div className="agent-ref-empty">暂无可用应用</div>
                      )}
                    </div>
                  )}
                </div>
                {/* 手动确认 / 自动生成 下拉 */}
                <div className="agent-confirm-picker" data-agent-menu>
                  <button
                    type="button"
                    className="agent-confirm-toggle"
                    title="工具确认方式"
                    onClick={() => toggleMenu("confirm")}
                  >
                    <ShieldCheck size={13} />
                    <span>{confirmTools ? "手动确认" : "自动生成"}</span>
                    <ChevronDown size={11} />
                  </button>
                  {openMenu === "confirm" && (
                    <div className="agent-confirm-menu">
                      <button
                        type="button"
                        className="agent-confirm-option"
                        onClick={() => { setConfirmTools(true); setOpenMenu(null); }}
                      >
                        <strong>手动确认 {confirmTools && <Check size={13} />}</strong>
                        <small>Agent 在执行生成前都会寻求您的确认</small>
                      </button>
                      <button
                        type="button"
                        className="agent-confirm-option"
                        onClick={() => { setConfirmTools(false); setOpenMenu(null); }}
                      >
                        <strong>自动生成 {!confirmTools && <Check size={13} />}</strong>
                        <small>Agent 会自主规划生成任务并自动执行</small>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="agent-composer-right">
                {/* 模型选择面板：Auto 开关 + 精选推荐 + 更多模型 */}
                <div className="agent-model-picker" data-agent-menu>
                  <button
                    type="button"
                    className="agent-model-selector"
                    title="切换模型配置"
                    onClick={() => toggleMenu("models")}
                  >
                    <Sparkles size={13} />
                    <span>{autoModel ? "Auto" : textModel ? modelDisplay(textModel) : "选择模型"}</span>
                    <ChevronDown size={11} />
                  </button>
                  {openMenu === "models" && modelCatalog && (
                    <div className="agent-model-menu">
                      <div className="agent-model-auto">
                        <span>Auto</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={autoModel}
                          className={`agent-switch ${autoModel ? "on" : ""}`}
                          onClick={() => setAutoModel((v) => !v)}
                        >
                          <i />
                        </button>
                      </div>
                      <div className="agent-menu-label">精选推荐</div>
                      {modelCatalog.models.slice(0, 3).map((model) => (
                        <button
                          key={model}
                          type="button"
                          className={`agent-model-item ${!autoModel && model === textModel ? "active" : ""}`}
                          onClick={() => { setTextModel(model); setAutoModel(false); setOpenMenu(null); }}
                        >
                          <span><Sparkles size={12} /> {modelDisplay(model)}</span>
                          {!autoModel && model === textModel && <Check size={14} />}
                          <small>{modelCatalog.providerNames?.[model] || model}</small>
                        </button>
                      ))}
                      {modelCatalog.models.length > 3 && (
                        <>
                          <button
                            type="button"
                            className="agent-model-more"
                            onClick={() => setMoreModelsOpen((v) => !v)}
                          >
                            <span>更多模型</span>
                            <ChevronDown size={13} className={moreModelsOpen ? "rotated" : ""} />
                          </button>
                          {moreModelsOpen && modelCatalog.models.slice(3).map((model) => (
                            <button
                              key={model}
                              type="button"
                              className={`agent-model-item ${!autoModel && model === textModel ? "active" : ""}`}
                              onClick={() => { setTextModel(model); setAutoModel(false); setOpenMenu(null); }}
                            >
                              <span><Sparkles size={12} /> {modelDisplay(model)}</span>
                              {!autoModel && model === textModel && <Check size={14} />}
                              <small>{modelCatalog.providerNames?.[model] || model}</small>
                            </button>
                          ))}
                        </>
                      )}
                      <button
                        type="button"
                        className="agent-model-help"
                        onClick={() => toast.info("Auto 会根据任务自动选择模型；也可以在列表中手动指定。")}
                      >
                        <Info size={12} /> 如何选择模型？
                      </button>
                    </div>
                  )}
                </div>
                <button
                  className="agent-send-btn"
                  onClick={() => void sendPrompt()}
                  disabled={(channel === "online" && !effectiveModel) || (channel === "local" && !connected) || !prompt.trim() || waiting || Boolean(pendingTool)}
                  aria-label="发送"
                >
                  <ArrowUp size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function normalizeToolCalls(calls: ResponseToolCall[]): NormalizedToolCall[] {
  return calls.flatMap((call, index) => {
    const name = call.function?.name?.trim();
    if (!name) return [];
    return [{
      id: call.id?.trim() || `call-${Date.now()}-${index}`,
      name,
      arguments: call.function?.arguments || "{}",
    }];
  });
}

function parseToolArguments(value: string) {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("工具参数必须是 JSON 对象");
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("工具参数不是合法 JSON 对象");
  }
}

function pendingToolSummary(pending: PendingAgentTool) {
  if (pending.source === "local") return toolLabel(pending.request.name);
  return pending.calls.map((call) => toolLabel(call.name)).join("，") || "画布工具";
}

function pendingToolDetail(pending: PendingAgentTool) {
  if (pending.source === "online") return `在线助手请求执行 ${pending.calls.length} 个工具。`;
  const ops = Array.isArray(pending.request.input?.ops) ? pending.request.input.ops as CanvasAgentOp[] : [];
  return summarizeCanvasAgentOps(ops) || "本地 Agent 请求修改当前画布。";
}

function describeSnapshot(snapshot: CanvasAgentSnapshot) {
  const counts = snapshot.nodes.reduce<Record<string, number>>((result, node) => {
    result[node.type] = (result[node.type] || 0) + 1;
    return result;
  }, {});
  const breakdown = Object.entries(counts).map(([type, count]) => `${type} ${count}`).join("，");
  return `当前画布有 ${snapshot.nodes.length} 个节点、${snapshot.connections.length} 条连线${breakdown ? `；${breakdown}` : ""}。`;
}

function summarizeGenerationResults(results: CanvasAgentExecutionResult["generationResults"]) {
  if (!results.length) return "";
  return results.map((item) => {
    const outputs = item.outputNodeIds.length ? `，输出 ${item.outputNodeIds.length} 个节点` : "";
    return `${item.mode} ${item.status}${outputs}${item.error ? `：${item.error}` : ""}`;
  }).join("；");
}

function toolLabel(name: string) {
  const labels: Record<string, string> = {
    canvas_get_state: "读取画布",
    canvas_get_selection: "读取选区",
    canvas_export_snapshot: "导出快照",
    canvas_search_assets: "搜索资产",
    canvas_add_assets: "添加资产",
    canvas_list_jobs: "查看生成任务",
    canvas_cancel_job: "取消生成任务",
    canvas_apply_ops: "画布操作",
    canvas_create_node: "创建节点",
    canvas_create_text_node: "创建文本",
    canvas_create_text_nodes: "批量创建文本",
    canvas_create_config_node: "创建生成配置",
    canvas_create_image_prompt_flow: "创建生图流程",
    canvas_create_generation_flow: "创建生成流程",
    canvas_generate_text: "生成文本",
    canvas_generate_image: "生成图片",
    canvas_generate_video: "生成视频",
    canvas_generate_audio: "生成音频",
    canvas_update_node: "更新节点",
    canvas_update_node_text: "更新文本",
    canvas_move_nodes: "移动节点",
    canvas_resize_node: "调整节点尺寸",
    canvas_delete_nodes: "删除节点",
    canvas_connect_nodes: "连接节点",
    canvas_select_nodes: "选择节点",
    canvas_set_viewport: "调整视口",
    canvas_run_generation: "触发生成",
  };
  return labels[name] || name;
}
