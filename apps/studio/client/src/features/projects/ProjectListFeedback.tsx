import { AlertCircle, RefreshCw } from "lucide-react";
import "./styles.css";

/** A failed list is never presented as a successful empty workspace. */
export function ProjectListFeedback({ error, refreshing, hasProjects, onRetry }: {
  error: string; refreshing: boolean; hasProjects: boolean; onRetry: () => void;
}) {
  if (!error) return null;
  return <div className="project-list-feedback" role="status">
    <AlertCircle size={18} aria-hidden="true" />
    <div><strong>项目列表暂时无法加载</strong><p>{hasProjects ? "已保留上次加载的项目，可重试获取最新列表。" : "暂时无法读取项目，不代表项目已被删除。请重试。"}</p></div>
    <button className="outline-button small" disabled={refreshing} onClick={onRetry}>
      <RefreshCw size={14} className={refreshing ? "animate-spin" : undefined} />{refreshing ? "正在重试…" : "重试"}
    </button>
  </div>;
}
