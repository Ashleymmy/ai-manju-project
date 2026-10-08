import { useEffect, useRef } from "react";
import { History } from "lucide-react";
import type { ComicAnalysisDetail } from "@/entities/comic";
import type { WorkspaceScope } from "@/shared/config";
import { useComicAnalysisHistory } from "../controllers/useComicAnalysisHistory";

const statusLabels = { processing: "分析中", active: "待确认", failed: "查看状态", confirmed: "已入库" };

export function ComicAnalysisHistory({ scope, onRecovered }: { scope: WorkspaceScope; onRecovered: (detail: ComicAnalysisDetail, signal: AbortSignal) => void | Promise<void> }) {
  const history = useComicAnalysisHistory(scope, onRecovered);
  const rootRef = useRef<HTMLElement>(null);
  const { open, close } = history;

  // Outside pointer or Escape closes the popover, same as the explicit close button.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) close(); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [open, close]);

  return <section ref={rootRef} className="comic-history" aria-label="分析记录">
    <button type="button" className={`comic-history-trigger${open ? " is-open" : ""}`} aria-expanded={open} onClick={() => open ? close() : void history.load()}><History size={14} />找回分析记录</button>
    {open && <div className="comic-history-panel" role="region" aria-label="我的待确认分析">
      <header className="comic-history-head">
        <h3>我的待确认分析</h3>
        <p>显示当前账号在此空间最近 7 天的未入库分析。关闭页面或重新登录后，可从这里继续查看原结果。</p>
      </header>
      {history.error && <p className="comic-history-note is-error" role="alert">{history.error}</p>}
      {history.items.length > 0 && <ul className="comic-history-list">
        {history.items.map(item => <li className="comic-history-item" key={item.id}>
          <div className="comic-history-meta">
            <strong title={item.title}>{item.title}</strong>
            <span title={item.source_file_name}>{item.source_file_name} · {new Date(item.created_at).toLocaleString()}</span>
          </div>
          <span className={`comic-history-status is-${item.status}`}>{statusLabels[item.status]}</span>
          <button type="button" className="comic-history-resume" disabled={!!history.resuming} onClick={() => void history.resume(item.id)}>{history.resuming === item.id ? "正在读取原任务…" : "继续查看"}</button>
        </li>)}
      </ul>}
      {!history.items.length && !history.busy && !history.error && <p className="comic-history-empty">当前没有待确认的分析。</p>}
      {history.busy && <p className="comic-history-note" role="status">正在读取记录…</p>}
      {history.resuming && <p className="comic-history-note" role="status">原分析仍在后台处理，返回结果后会自动打开。可以收起此处，稍后继续查看。</p>}
      <footer className="comic-history-foot">
        {history.nextCursor && <button type="button" disabled={history.busy} onClick={() => void history.load(history.nextCursor)}>更早的记录</button>}
        <button type="button" onClick={close}>收起记录</button>
      </footer>
    </div>}
  </section>;
}
