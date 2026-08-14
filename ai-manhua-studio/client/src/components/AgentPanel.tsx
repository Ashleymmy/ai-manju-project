import { useEffect, useRef, useState } from "react";
import { KeyRound, Link2, MessageCircle, Plug, PlugZap, Send, X } from "lucide-react";
import { toast } from "sonner";

type AgentMsg = { id: string; role: "user" | "assistant" | "error"; text: string };

const URL_KEY = "canvas-agent-url";
const TOK_KEY = "canvas-agent-token";

export default function AgentPanel({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"connect" | "chat">("connect");
  const [url, setUrl] = useState(() => localStorage.getItem(URL_KEY) ?? "http://127.0.0.1:17371");
  const [token, setToken] = useState(() => localStorage.getItem(TOK_KEY) ?? "");
  const [enabled, setEnabled] = useState(false);
  const [connected, setConnected] = useState(false);
  const [activity, setActivity] = useState("未连接");
  const [messages, setMessages] = useState<AgentMsg[]>([]);
  const [prompt, setPrompt] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [threadId, setThreadId] = useState<string | undefined>();
  const listRef = useRef<HTMLDivElement>(null);
  const wasConnectedRef = useRef(false);
  const clientId = useRef(crypto.randomUUID()).current;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, waiting]);

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

  const sendPrompt = async () => {
    const text = prompt.trim();
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
  };

  if (!open) return null;

  return (
    <aside className="agent-panel">
      <div className="agent-panel-head">
        <div>
          <p className="eyebrow">LOCAL AGENT</p>
          <div className="agent-status">
            <i className={`status-dot ${connected ? "connected" : ""}`} />
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
          <div ref={listRef} className="agent-messages">
            {messages.length === 0 && (
              <div className="agent-empty">
                <p>连接后可以让 Codex Agent 操作画布、生成资产或提供创作建议。</p>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`agent-msg agent-msg-${m.role}`}>
                {m.role !== "user" && (
                  <span className="agent-msg-label">{m.role === "error" ? "错误" : "Codex"}</span>
                )}
                <p>{m.text}</p>
              </div>
            ))}
            {waiting && (
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
              placeholder={connected ? "询问 Codex，或让它操作画布…" : "先在「连接」标签页配置并连接本地 Agent"}
              disabled={!connected || waiting}
              rows={3}
            />
            <button
              className="vermilion-button"
              onClick={() => void sendPrompt()}
              disabled={!connected || !prompt.trim() || waiting}
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
