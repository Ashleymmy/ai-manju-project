import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Sparkles, X } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import ErrorBoundary from "./ErrorBoundary";
import MetaBallOrb from "./MetaBallOrb";

const AgentPanel = lazy(() => import("./AgentPanel"));

/** Keep the current page in place; canvas pages retain their own connected Agent. */
export default function StudioAgentFab() {
  const [path] = useLocation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [open]);

  if (!user) return null;
  return <>
    <button
      type="button"
      ref={buttonRef}
      className="studio-agent-fab"
      title="打开 Agent 对话"
      aria-label="打开 Agent 对话"
      aria-haspopup="dialog"
      aria-expanded={open}
      hidden={open}
      onClick={() => { setLoaded(true); setOpen(true); }}
    >
      <MetaBallOrb className="studio-agent-fab-orb" />
      <Sparkles size={20} />
    </button>
    {loaded && createPortal(
      <div className="studio-agent-dialog" hidden={!open}>
        <ErrorBoundary contained>
          <Suspense fallback={<div className="studio-agent-loading" role="dialog" aria-label="Agent 对话">
            <button type="button" title="关闭对话" onClick={close}><X size={16} /></button>
            <span role="status"><Loader2 size={18} className="spin" />正在打开 Agent…</span>
          </div>}>
            <AgentPanel key={user.id} mode="studio" projectId={`studio:${user.id}`} open={open} onClose={close}
              displayName={user.display_name || user.username || "创作者"} pagePath={path} />
          </Suspense>
        </ErrorBoundary>
      </div>, document.body,
    )}
  </>;
}
