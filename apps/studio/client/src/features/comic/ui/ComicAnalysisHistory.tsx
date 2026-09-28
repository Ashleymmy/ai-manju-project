import type { ComicAnalysisDetail } from "@/entities/comic";
import type { WorkspaceScope } from "@/shared/config";
import { useComicAnalysisHistory } from "../controllers/useComicAnalysisHistory";

const statusLabels = { processing: "分析中", active: "待确认", failed: "查看状态", confirmed: "已入库" };

export function ComicAnalysisHistory({ scope, onRecovered }: { scope: WorkspaceScope; onRecovered: (detail: ComicAnalysisDetail, signal: AbortSignal) => void | Promise<void> }) {
  const history = useComicAnalysisHistory(scope, onRecovered);
  return <section aria-label="分析记录">
    <button type="button" className="full-outline" onClick={() => void history.load()}>找回分析记录</button>
    {history.open && <div className="comic-panel" role="region" aria-label="我的待确认分析">
      <h3>我的待确认分析</h3>
      <p>显示当前账号在此空间最近 7 天的未入库分析。关闭页面或重新登录后，可从这里继续查看原结果。</p>
      {history.error && <p role="alert">{history.error}</p>}
      {history.items.map(item => <div className="comic-project-row" key={item.id}>
        <span>{item.title} · {item.source_file_name} · {statusLabels[item.status]} · {new Date(item.created_at).toLocaleString()}</span>
        <button type="button" disabled={!!history.resuming} onClick={() => void history.resume(item.id)}>{history.resuming === item.id ? "正在读取原任务…" : "继续查看"}</button>
      </div>)}
      {!history.items.length && !history.busy && !history.error && <p>当前没有待确认的分析。</p>}
      {history.busy && <p role="status">正在读取记录…</p>}
      {history.resuming && <p role="status">原分析仍在后台处理，返回结果后会自动打开。可以收起此处，稍后继续查看。</p>}
      {history.nextCursor && <button type="button" disabled={history.busy} onClick={() => void history.load(history.nextCursor)}>更早的记录</button>}
      <button type="button" onClick={history.close}>收起记录</button>
    </div>}
  </section>;
}
