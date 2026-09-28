import { Archive, ArrowDownLeft, Check, ChevronDown, CircleAlert, FolderInput, Loader2, Pause, RotateCcw, Trash2 } from "lucide-react";
import { importTaskManager, useImportTask } from "../model/importTaskManager";
import type { ImportTask } from "../model/importTaskStorage";
import { AssetTransferPanel, formatTransferSize } from "./AssetTransferPanel";

// Match export task tones while retaining the import task's actual state.
const statuses: Record<ImportTask["status"], { label: string; tone: string }> = {
  running: { label: "导入中", tone: "active" },
  paused: { label: "已暂停", tone: "pending" },
  failed: { label: "待处理", tone: "error" },
  completed: { label: "已完成", tone: "success" },
};

export function AssetImportTaskPanel() {
  const { task, preparing, error } = useImportTask();
  const status = task ? statuses[task.status] : null;
  const running = task?.status === "running";
  const canRetry = task?.status === "paused" || task?.status === "failed";
  const size = task ? formatTransferSize(task.size) : "";
  return <AssetTransferPanel title="导入任务" count={task ? 1 : 0} icon={FolderInput}
    note={<><ArrowDownLeft size={13} aria-hidden="true" />最近导入</>}
    listLabel="导入任务详情" footerText="删除任务不会删除已导入素材">
    {error && <p className="asset-transfer-empty" role="alert">{error}</p>}
    {preparing && <p className="asset-transfer-empty" role="status">正在保存资产包，请勿刷新或关闭页面…</p>}
    {task && status && <>
      <ul className="asset-transfer-list">
        <li className={`asset-transfer-row is-${status.tone}`}>
          <span className="asset-transfer-file-icon" aria-hidden="true"><Archive size={18} strokeWidth={1.5} /></span>
          <div className="asset-transfer-file">
            <span className="asset-transfer-file-name" title={task.name}>{task.name}</span>
            <div className="asset-transfer-meta">
              <span>{task.progress.completed}/{task.progress.total} 个资产</span>
              <span>{task.scope === "personal" ? "个人素材" : "团队素材"}</span>
              {size && <span>{size}</span>}
              {task.progress.failures.length > 0 && <span className="asset-transfer-error-count">{task.progress.failures.length} 项失败</span>}
            </div>
            {task.status !== "completed" && <>
              <progress className="asset-transfer-progress is-compact" aria-label="资产包导入进度"
                max={task.progress.total || 1} value={task.progress.total > 0 ? task.progress.completed : undefined} />
              <p className="asset-transfer-phase" role="status">{task.progress.phase}</p>
            </>}
          </div>
          <span className={`asset-transfer-badge is-${status.tone}`}>
            {running ? <Loader2 size={12} className="asset-transfer-spinner" aria-hidden="true" /> : task.status === "completed" ? <Check size={12} aria-hidden="true" /> : null}
            {status.label}
          </span>
          <div className="asset-transfer-row-action">
            {running && <button type="button" className="asset-transfer-button is-quiet" disabled={preparing} onClick={importTaskManager.pause}><Pause size={13} aria-hidden="true" />暂停导入</button>}
            {canRetry && <button type="button" className="asset-transfer-button is-download" disabled={preparing} onClick={importTaskManager.resume}><RotateCcw size={13} aria-hidden="true" />{task.status === "failed" ? "重试未完成项" : "继续导入"}</button>}
            <button type="button" className="asset-transfer-delete" disabled={preparing}
              aria-label="删除任务" title={running ? "结束并删除任务，保留已导入素材" : "删除任务及本地残留，不影响已导入素材"}
              onClick={() => {
                const prompt = task.status === "completed"
                  ? "删除这条导入记录及本地残留？已导入的素材不会删除。"
                  : "结束并删除此任务，同时清除本地资产包？已导入的素材会保留，未完成项需要重新选择资产包。";
                if (window.confirm(prompt)) void importTaskManager.discard();
              }}><Trash2 size={15} /></button>
          </div>
        </li>
      </ul>
      {task.progress.failures.length > 0 && <details className="asset-transfer-notice is-error">
        <summary><CircleAlert size={14} aria-hidden="true" />{task.progress.failures.length} 项未能导入<ChevronDown size={14} className="asset-transfer-chevron" aria-hidden="true" /></summary>
        <ul>{task.progress.failures.map((failure, index) => <li key={index}><span>{failure.name}</span><small>{failure.error}</small></li>)}</ul>
      </details>}
      {task.warnings.length > 0 && <details className="asset-transfer-notice">
        <summary><CircleAlert size={14} aria-hidden="true" />{task.warnings.length} 项资产包提示<ChevronDown size={14} className="asset-transfer-chevron" aria-hidden="true" /></summary>
        <ul>{task.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
      </details>}
    </>}
    {!task && !preparing && !error && <p className="asset-transfer-empty">暂无导入任务</p>}
  </AssetTransferPanel>;
}
