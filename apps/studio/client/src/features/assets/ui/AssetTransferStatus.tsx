import { Archive, ArrowDownToLine, ArrowUpRight, Check, ChevronDown, CircleAlert, Clock3, FolderInput, Loader2, Package, Pause, RotateCcw, X } from "lucide-react";
import type { AssetExportBatch } from "@/entities/asset";
import type { PackageImportProgress } from "../model/importAssetPackage";
import "./assetTransfer.css";

type Props = {
  batches: AssetExportBatch[];
  progress: PackageImportProgress | null;
  warnings: string[];
  importing: boolean;
  canPause: boolean;
  canRetry: boolean;
  onRetry: () => void;
  onPause: () => void;
  onDismiss: () => void;
  onDownload: (batch: AssetExportBatch) => void;
  onCancel: (batch: AssetExportBatch) => void;
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
const BYTES_PER_KIB = 1024;
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

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < BYTES_PER_KIB) return `${bytes} B`;
  if (bytes < BYTES_PER_KIB ** 2) return `${Math.ceil(bytes / BYTES_PER_KIB)} KB`;
  return `${(bytes / BYTES_PER_KIB ** 2).toFixed(1)} MB`;
}

function ExportTask({ batch, onDownload, onCancel }: Pick<Props, "onDownload" | "onCancel"> & { batch: AssetExportBatch }) {
  const status = statuses[batch.status];
  const pending = batch.status === "queued" || batch.status === "running";
  const downloadable = batch.status === "succeeded" || batch.status === "partial_failed";
  const packageName = batch.file_name && !/^ai-manju-assets-/.test(batch.file_name) ? batch.file_name : packageNames[batch.selection_mode];
  const progress = batch.total > 0 ? Math.min(PERCENT_MAX, Math.round((batch.succeeded + batch.failed) / batch.total * PERCENT_MAX)) : 0;
  const date = formatDate(batch.created_at);
  const size = formatSize(batch.size);
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
      {pending && <progress className="asset-transfer-progress is-export" aria-label={`${packageName}打包进度`} max={PERCENT_MAX} value={progress} />}
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
    </div>
  </li>;
}

export function AssetTransferStatus({ batches, progress, warnings, importing, canPause, canRetry, onRetry, onPause, onDismiss, onDownload, onCancel }: Props) {
  const completed = !importing && progress?.phase === "导入完成";
  const paused = !importing && Boolean(progress?.phase.includes("暂停"));
  const importTone = importing ? "active" : completed ? "success" : paused ? "pending" : "warning";
  const ImportIcon = importing ? FolderInput : completed ? Check : paused ? Pause : CircleAlert;
  const importTitle = importing ? "正在导入资产" : completed ? "导入完成" : paused ? "导入已暂停" : "导入未完成";
  return <div className="asset-transfer-status">
    {batches.length > 0 && <section className="asset-transfer-panel" aria-label="资产导出任务">
      <header className="asset-transfer-header">
        <span className="asset-transfer-heading-icon" aria-hidden="true"><Package size={18} strokeWidth={1.5} /></span>
        <div className="asset-transfer-heading"><h3>导出任务 <span className="asset-transfer-count">{batches.length}</span></h3><p>打包分享，让整理好的素材随处可用</p></div>
        <span className="asset-transfer-header-note"><ArrowUpRight size={13} aria-hidden="true" />最近导出</span>
      </header>
      <ul className="asset-transfer-list">{batches.map(batch => <ExportTask key={batch.id} batch={batch} onDownload={onDownload} onCancel={onCancel} />)}</ul>
      <footer className="asset-transfer-footer"><FolderInput size={13} aria-hidden="true" />对方通过「导入资产包」即可恢复目录、分类与标签</footer>
    </section>}
    {progress && <section className={`asset-transfer-panel asset-import-panel is-${importTone}`} aria-label="资产包导入进度">
      <div className="asset-import-summary">
        <span className={`asset-import-icon is-${importTone}`} aria-hidden="true"><ImportIcon size={19} strokeWidth={1.7} /></span>
        <div className="asset-import-copy"><h3 aria-live="polite">{importTitle}</h3><p title={progress.phase}>{completed ? "已保留目录层级、分类、标签与备注" : progress.phase}</p></div>
        <div className="asset-import-count"><strong>{progress.completed}<span> / {progress.total}</span></strong><small>个资产已导入</small></div>
        {!importing && !canRetry && <button className="asset-transfer-dismiss" onClick={onDismiss} aria-label="收起导入结果" title="收起导入结果"><X size={15} /></button>}
      </div>
      {(progress.total > 0 || importing) && <progress className={`asset-transfer-progress is-${importTone}`} aria-label="资产包导入进度" max={progress.total || PERCENT_MAX} value={progress.total > 0 ? progress.completed : undefined} />}
      {(importing && canPause || !importing && canRetry) && <div className="asset-import-actions"><span>已完成的资产会保留，继续时跳过已完成项</span>{importing ? <button className="asset-transfer-button is-quiet" onClick={onPause}><Pause size={13} aria-hidden="true" />暂停导入</button> : <button className="asset-transfer-button is-download" onClick={onRetry}><RotateCcw size={13} aria-hidden="true" />继续 / 重试未完成项</button>}</div>}
      {progress.failures.length > 0 && <details className="asset-transfer-notice is-error" open><summary><CircleAlert size={14} aria-hidden="true" />{progress.failures.length} 项未能导入<ChevronDown size={14} className="asset-transfer-chevron" aria-hidden="true" /></summary><ul>{progress.failures.map((failure, index) => <li key={index}><span>{failure.name}</span><small>{failure.error}</small></li>)}</ul></details>}
      {warnings.length > 0 && <details className="asset-transfer-notice" open><summary><CircleAlert size={14} aria-hidden="true" />{warnings.length} 项资产包提示<ChevronDown size={14} className="asset-transfer-chevron" aria-hidden="true" /></summary><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
    </section>}
  </div>;
}
