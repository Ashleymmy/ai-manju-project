import { Archive, ArrowDownToLine, ArrowUpRight, Check, ChevronLeft, ChevronRight, Clock3, Loader2, Package, RotateCcw, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { AssetExportBatch } from "@/entities/asset";
import { AssetTransferPanel, formatTransferSize } from "./AssetTransferPanel";

type Props = {
  batches: AssetExportBatch[];
  onDownload: (batch: AssetExportBatch) => void;
  onCancel: (batch: AssetExportBatch) => void;
  onDelete?: (batch: AssetExportBatch) => void;
  deletingId?: string;
  showExports?: boolean;
  exportLoading?: boolean;
  exportError?: string;
  onReloadExports?: () => void;
};

// Keep labels, tones and progress scales consistent across both transfer surfaces.
const statuses: Record<AssetExportBatch["status"], { label: string; tone: string }> = {
  queued: { label: "等待中", tone: "pending" },
  running: { label: "打包中", tone: "active" },
  succeeded: { label: "已完成", tone: "success" },
  partial_failed: { label: "部分完成", tone: "warning" },
  failed: { label: "打包失败", tone: "error" },
  canceled: { label: "已取消", tone: "muted" },
  expired: { label: "已过期", tone: "muted" },
};
const packageNames = { folder: "目录资产包", selected: "选中资产包", filter: "筛选资产包" };
const PERCENT_MAX = 100;
// Bound rendered task rows even when the user retains a long export history.
const EXPORT_TASK_PAGE_SIZE = 20;
const transferDate = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

function exportFailureMessage(error: AssetExportBatch["error"]) {
  const message = (typeof error === "string" ? error : error?.message)?.trim() || "";
  if (/no space left on device|disk full|not enough space/i.test(message)) return "打包临时空间不足，请联系管理员扩容后重新导出。";
  if (/HTTP 413|entity too large|payload too large/i.test(message)) return "资产包超过存储服务的大小限制，请联系管理员调整后重新导出。";
  if (/timeout|timed out|deadline exceeded/i.test(message)) return "素材传输超时，请稍后重新导出。";
  if (/all asset files failed to export/i.test(message)) return "未能读取目录中的素材文件，请联系管理员检查素材存储。";
  return message || "服务未返回详细原因，请联系管理员检查导出任务。";
}

function formatDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : transferDate.format(date);
}

function ExportTask({ batch, onDownload, onCancel, onDelete, deletingId }: Pick<Props, "onDownload" | "onCancel" | "onDelete" | "deletingId"> & { batch: AssetExportBatch }) {
  const status = statuses[batch.status];
  const pending = batch.status === "queued" || batch.status === "running";
  const downloadable = batch.status === "succeeded" || batch.status === "partial_failed";
  const packageName = batch.file_name && !/^ai-manju-assets-/.test(batch.file_name) ? batch.file_name : packageNames[batch.selection_mode];
  const progress = batch.total > 0 ? Math.min(PERCENT_MAX, Math.round((batch.succeeded + batch.failed) / batch.total * PERCENT_MAX)) : 0;
  const date = formatDate(batch.created_at);
  const size = formatTransferSize(batch.size);
  return <li className={`asset-transfer-row is-${status.tone}`}>
    <span className="asset-transfer-file-icon" aria-hidden="true"><Archive size={18} strokeWidth={1.5} /></span>
    <div className="asset-transfer-file">
      <span className="asset-transfer-file-name" title={batch.file_name || packageName}>{packageName}</span>
      <div className="asset-transfer-meta">
        <span>{pending ? `${batch.succeeded}/${batch.total}` : batch.succeeded} 个资产</span>
        {date && <time dateTime={batch.created_at}>{date}</time>}
        {size && <span>{size}</span>}
        {batch.failed > 0 && <span className="asset-transfer-error-count">{batch.failed} 项失败</span>}
      </div>
      {pending && <progress className="asset-transfer-progress is-compact" aria-label={`${packageName}打包进度`} max={PERCENT_MAX} value={progress} />}
      {batch.status === "failed" && <p className="asset-transfer-failure" role="status">{exportFailureMessage(batch.error)}</p>}
    </div>
    <span className={`asset-transfer-badge is-${status.tone}`}>
      {pending ? <Loader2 size={12} className="asset-transfer-spinner" aria-hidden="true" /> : downloadable ? <Check size={12} aria-hidden="true" /> : batch.status === "expired" ? <Clock3 size={12} aria-hidden="true" /> : null}
      {status.label}
    </span>
    <div className="asset-transfer-row-action">
      {downloadable ? <button className="asset-transfer-button is-download" onClick={() => onDownload(batch)}><ArrowDownToLine size={14} aria-hidden="true" />下载资产包</button>
        : pending ? <button className="asset-transfer-button is-quiet" onClick={() => onCancel(batch)}><X size={13} aria-hidden="true" />取消</button>
          : <span className="asset-transfer-unavailable">{batch.status === "expired" || batch.status === "failed" ? "请重新导出" : "—"}</span>}
      {!pending && onDelete && <button type="button" className="asset-transfer-delete" disabled={deletingId === batch.id}
        title="删除任务及打包文件，不影响原素材" aria-label={`删除导出任务 ${packageName}`}
        onClick={() => onDelete(batch)}>{deletingId === batch.id ? <Loader2 size={15} className="asset-transfer-spinner" /> : <Trash2 size={15} />}</button>}
    </div>
  </li>;
}

export function AssetTransferStatus({ batches, onDownload, onCancel, onDelete, deletingId, showExports, exportLoading, exportError, onReloadExports }: Props) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(batches.length / EXPORT_TASK_PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visibleBatches = batches.slice(currentPage * EXPORT_TASK_PAGE_SIZE, (currentPage + 1) * EXPORT_TASK_PAGE_SIZE);
  if (!showExports && !batches.length) return null;
  return <AssetTransferPanel title="导出任务" count={batches.length} icon={Package}
    note={<><ArrowUpRight size={13} aria-hidden="true" />最近导出</>}
    listLabel="导出任务列表" footerText="删除任务不会删除原素材"
    footerAction={pages > 1 && <div className="asset-transfer-pagination"><button type="button" title="上一页任务" aria-label="上一页导出任务" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={15} /></button><span>{currentPage + 1} / {pages}</span><button type="button" title="下一页任务" aria-label="下一页导出任务" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight size={15} /></button></div>}>
    {exportError ? <p className="asset-transfer-empty" role="alert">{exportError} <button type="button" className="asset-transfer-button is-quiet" onClick={onReloadExports}><RotateCcw size={14} />重试</button></p>
      : exportLoading && !batches.length ? <p className="asset-transfer-empty" role="status">正在读取导出任务…</p>
        : !batches.length ? <p className="asset-transfer-empty">暂无导出任务</p>
          : <ul className="asset-transfer-list">{visibleBatches.map(batch => <ExportTask key={batch.id} batch={batch} onDownload={onDownload} onCancel={onCancel} onDelete={onDelete} deletingId={deletingId} />)}</ul>}
  </AssetTransferPanel>;
}
