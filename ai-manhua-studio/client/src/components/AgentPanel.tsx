import { useEffect, useRef, useState } from "react";
import { Bot, Check, Globe2, KeyRound, Link2, MessageCircle, Plug, PlugZap, RotateCcw, Send, ShieldCheck, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  fetchAiModels,
  imageModelLabel,
  publicApiError,
  requestAiText,
  type ResponseFunctionTool,
  type ResponseInputMessage,
  type ResponseToolCall,
  type TextModelCatalog,
} from "@/services/api";
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

type AgentMsg = { id: string; role: "user" | "assistant" | "error" | "tool"; text: string };
type AgentToolResult = { ok: boolean; message: string; data?: unknown };
type NormalizedToolCall = { id: string; name: string; arguments: string };
type OnlineToolContext = {
  source: "online";
  calls: NormalizedToolCall[];
  messages: ResponseInputMessage[];
  step: number;
  assistantId: string;
};
type PendingAgentTool = { source: "local"; request: CanvasAgentToolRequest } | OnlineToolContext;

const URL_KEY = "canvas-agent-url";
const TOK_KEY = "canvas-agent-token";
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
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  snapshot: CanvasAgentSnapshot;
  canUndoOps: boolean;
  onApplyOps: (ops: CanvasAgentOp[]) => Promise<CanvasAgentExecutionResult>;
  onExecuteWorkspaceTool: (name: string, input: Record<string, unknown>) => Promise<AgentToolResult>;
  onUndoOps: () => Promise<CanvasAgentSnapshot | null>;
}) {
  const [tab, setTab] = useState<"connect" | "chat">("chat");
  const [channel, setChannel] = useState<"online" | "local">("online");
  const [url, setUrl] = useState(() => localStorage.getItem(URL_KEY) ?? "http://127.0.0.1:17371");
  const [token, setToken] = useState(() => localStorage.getItem(TOK_KEY) ?? "");
  const [enabled, setEnabled] = useState(false);
  const [connected, setConnected] = useState(false);
  const [activity, setActivity] = useState("未连接");
  const [messages, setMessages] = useState<AgentMsg[]>([]);
  const [prompt, setPrompt] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [threadId, setThreadId] = useState<string | undefined>();
  const [modelCatalog, setModelCatalog] = useState<TextModelCatalog | null>(null);
  const [textModel, setTextModel] = useState("");
  const [modelLoadError, setModelLoadError] = useState("");
  const [confirmTools, setConfirmTools] = useState(true);
  const [pendingTool, setPendingTool] = useState<PendingAgentTool | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const wasConnectedRef = useRef(false);
  const clientId = useRef(crypto.randomUUID()).current;
  const snapshotRef = useRef(snapshot);
  const pendingToolRef = useRef<PendingAgentTool | null>(null);
  const confirmToolsRef = useRef(confirmTools);
  const onApplyOpsRef = useRef(onApplyOps);
  const onExecuteWorkspaceToolRef = useRef(onExecuteWorkspaceTool);
  const onUndoOpsRef = useRef(onUndoOps);
  const localToolHandlerRef = useRef<(request: CanvasAgentToolRequest) => void>(() => undefined);

  const setPendingAgentTool = (value: PendingAgentTool | null) => {
    pendingToolRef.current = value;
    setPendingTool(value);
  };

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pendingTool, waiting]);

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
    const base = url.trim().replace(/\/$/, "");
    const src = new EventSource(
      `${base}/events?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`
    );
    src.addEventListener("hello", () => {
      wasConnectedRef.current = true;
      setConnected(true);
      setActivity("已连接");
      toast.success("本地Agent 已连接");
      void postAgentState(base, token, clientId, snapshotRef.current);
    });
    src.addEventListener("tool_call", (event) => {
      const request = parseEventData<CanvasAgentToolRequest>(event);
      if (!request?.requestId) return;
      if (isCanvasAgentToolName(request.name)) {
        localToolHandlerRef.current(request);
        return;
      }
      void postAgentResult(base, token, clientId, { requestId: request.requestId, error: `不支持的工具：${String(request.name || "unknown")}` }).catch(() => undefined);
    });
    src.addEventListener("agent_event", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as {
          type?: string; thread_id?: string;
          item?: { id?: string; type?: string; text?: string };
        };
        if (d.thread_id) setThreadId(d.thread_id);
        if (d.type === "turn.started") { setActivity("思考中"); setWaiting(true); }
        if (
          (d.type === "item.updated" || d.type === "item.completed") &&
          d.item?.type === "agent_message" && d.item.text
        ) {
          const { id = String(Date.now()), text } = d.item;
          setMessages((prev) => {
            const i = prev.findIndex((m) => m.id === id);
            return i >= 0
              ? prev.map((m, j) => (j === i ? { ...m, text } : m))
              : [...prev, { id, role: "assistant", text }];
          });
        }
      } catch { /* ignore */ }
    });
    src.addEventListener("agent_done", () => { setActivity("完成"); setWaiting(false); });
    src.addEventListener("agent_error", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { message?: string };
        setMessages((prev) => [
          ...prev,
          { id: `err-${Date.now()}`, role: "error", text: d.message ?? "Agent 出错" },
        ]);
      } catch { /* ignore */ }
      setActivity("出错"); setWaiting(false);
    });
    src.onerror = () => {
      const was = wasConnectedRef.current;
      wasConnectedRef.current = false;
      setConnected(false);
      setActivity(was ? "连接断开" : "连接失败");
      if (!was) { src.close(); setEnabled(false); }
    };
    return () => { src.close(); wasConnectedRef.current = false; setConnected(false); };
  }, [enabled, url, token, clientId]);

  useEffect(() => {
    if (!connected) return;
    const base = url.trim().replace(/\/$/, "");
    const timer = window.setTimeout(() => {
      void postAgentState(base, token, clientId, snapshot);
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
    const base = url.trim().replace(/\/$/, "");
    setWaiting(true);
    setActivity("发送中");
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text }]);
    setPrompt("");
    try {
      const res = await fetch(`${base}/agent/codex/turn?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text, canvasId: projectId, threadId }),
      });
      if (!res.ok) throw new Error("请求被拒绝");
      const data = await res.json() as { threadId?: string };
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
    if (!textModel) {
      const message = modelLoadError || "没有支持 Agent 工具调用的文本模型";
      setMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: "error", text: message }]);
      setActivity("Agent 模型未配置");
      return;
    }
    setWaiting(true);
    setActivity("在线模型思考中");
    const userMessage: AgentMsg = { id: `u-${Date.now()}`, role: "user", text };
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
      model: textModel,
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
      await postAgentResult(base, token, clientId, { requestId: request.requestId, result });
      setMessages((prev) => [...prev, { id: `tool-${Date.now()}`, role: "tool", text: `${toolLabel(request.name)}：${result.message}` }]);
      if (!isCanvasAgentReadTool(request.name)) void postAgentState(base, token, clientId, snapshotRef.current);
      setActivity(result.ok ? "工具完成" : "工具失败");
    } catch (error) {
      const message = error instanceof Error ? error.message : "画布工具执行失败";
      await postAgentResult(base, token, clientId, { requestId: request.requestId, error: message }).catch(() => undefined);
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
        await postAgentResult(base, token, clientId, { requestId: request.requestId, error: "仍有待确认的画布工具调用" }).catch(() => undefined);
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
      await postAgentResult(base, token, clientId, { requestId: pending.request.requestId, error: "用户取消了画布工具调用" }).catch(() => undefined);
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
      void postAgentState(base, token, clientId, restored);
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
    localStorage.setItem(URL_KEY, url.trim().replace(/\/$/, ""));
    localStorage.setItem(TOK_KEY, token);
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

  if (!open) return null;

  return (
    <aside className="agent-panel">
      <div className="agent-panel-head">
        <div>
          <p className="eyebrow">CANVAS AGENT</p>
          <div className="agent-status">
            <i className={`status-dot ${channel === "online" ? textModel ? "connected" : "" : connected ? "connected" : ""}`} />
            <span>{activity}</span>
          </div>
        </div>
        <div className="agent-head-actions">
          <div className="agent-tabs">
            <button className={tab === "connect" ? "active" : ""} onClick={() => setTab("connect")}>
              <PlugZap size={13} /> 连接
            </button>
            <button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>
              <MessageCircle size={13} /> 对话
            </button>
          </div>
          <button className="icon-button subtle" onClick={onClose} aria-label="关闭 Agent 面板">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="agent-channel-switch">
        <button className={channel === "online" ? "active" : ""} onClick={() => { setChannel("online"); setTab("chat"); }}>
          <Globe2 size={13} /> 在线助手
        </button>
        <button className={channel === "local" ? "active" : ""} onClick={() => { setChannel("local"); setTab("connect"); }}>
          <Bot size={13} /> 本地 Agent
        </button>
      </div>
      <div className="agent-safety-row">
        <label>
          <input type="checkbox" checked={confirmTools} onChange={(event) => setConfirmTools(event.target.checked)} />
          <ShieldCheck size={13} /> 写操作需确认
        </label>
        <button type="button" onClick={() => void undoLastTool()} disabled={!canUndoOps || waiting} title="撤销上一次 Agent 画布操作">
          <RotateCcw size={13} /> 撤销
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
            ? <button className="outline-button" onClick={disconnect}><Plug size={14} /> 断开连接</button>
            : <button className="vermilion-button" onClick={connect}><PlugZap size={14} /> 连接本地Agent</button>
          }
        </div>
      ) : (
        <div className="agent-chat">
          {channel === "online" && (
            <label className="agent-field online-model">
              <span className="field-label">文本模型</span>
              <select value={textModel} onChange={(event) => setTextModel(event.target.value)}>
                <option value="">{modelLoadError || "选择 Agent 文本模型"}</option>
                {modelCatalog?.models.map((item) => <option key={item} value={item}>{imageModelLabel(item, modelCatalog)}</option>)}
              </select>
            </label>
          )}
          <div ref={listRef} className="agent-messages">
            {messages.length === 0 && (
              <div className="agent-empty">
                <p>{channel === "online" ? modelLoadError || "在线助手会使用支持工具调用的 Agent 模型操作节点、连线和生成流程。" : "连接后可以让 Codex Agent 操作画布、生成资产或提供创作建议。"}</p>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`agent-msg agent-msg-${m.role}`}>
                {m.role !== "user" && (
                  <span className="agent-msg-label">{m.role === "error" ? "错误" : m.role === "tool" ? "工具" : "Codex"}</span>
                )}
                <p>{m.text}</p>
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
                <span className="agent-msg-label">Codex</span>
                <p className="agent-working"><span /><span /><span /></p>
              </div>
            )}
          </div>
          <div className="agent-composer">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendPrompt(); }
              }}
              placeholder={channel === "online" ? "询问在线助手…" : connected ? "询问 Codex，或让它操作画布…" : "先在「连接」标签页配置并连接本地 Agent"}
              disabled={(channel === "online" && !textModel) || (channel === "local" && !connected) || waiting || Boolean(pendingTool)}
              rows={3}
            />
            <button
              className="vermilion-button"
              onClick={() => void sendPrompt()}
              disabled={(channel === "online" && !textModel) || (channel === "local" && !connected) || !prompt.trim() || waiting || Boolean(pendingTool)}
              aria-label="发送"
            >
              <Send size={14} />
            </button>
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

function parseEventData<T>(event: Event) {
  try {
    return JSON.parse((event as MessageEvent).data) as T;
  } catch {
    return null;
  }
}

async function postAgentState(endpoint: string, token: string, clientId: string, snapshot: CanvasAgentSnapshot) {
  try {
    await fetch(`${endpoint}/canvas/state?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...snapshot, protocolVersion: CANVAS_AGENT_PROTOCOL_VERSION }),
    });
  } catch {
    // SSE 会负责呈现连接状态，快照同步失败时等待下一轮 300ms 同步。
  }
}

async function postAgentResult(
  endpoint: string,
  token: string,
  clientId: string,
  body: { requestId: string; result?: unknown; error?: string },
) {
  const response = await fetch(`${endpoint}/canvas/result?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, protocolVersion: CANVAS_AGENT_PROTOCOL_VERSION }),
  });
  if (!response.ok) throw new Error("本地 Agent 未接收工具结果");
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
