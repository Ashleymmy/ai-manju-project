import { useEffect, useState } from "react";
import { GenerationPrice } from "@/features/member";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getAssetContentObjectUrl } from "@/entities/asset";
import type { ComicBatchDetail, ComicGenerationItem } from "@/entities/comic";
import { jobErrorMessage } from "@/entities/job";
import { publicApiError } from "@/shared/api/errors";
import type { WorkspaceScope } from "@/shared/config";

import {
  COMIC_BATCH_ITEM_STATUS_LABELS,
  COMIC_BATCH_STATUS_LABELS,
  COMIC_OUTPUT_THUMBNAIL_SIZE,
  COMIC_QUEUE_PHASE_LABELS,
} from "../model/constants";
import { useComicBatchItemJobQuery } from "../model/queries";
import { comicBatchProgress } from "../model/workflow";
import "./comic-batch-panel.css";

function ComicOutputImage({
  assetId,
  name,
  scope,
  original = false,
}: {
  assetId: string;
  name: string;
  scope: WorkspaceScope;
  original?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setUrl("");
    setError("");
    void getAssetContentObjectUrl(
      assetId,
      scope,
      original ? undefined : COMIC_OUTPUT_THUMBNAIL_SIZE,
      controller.signal
    )
      .then(value => {
        if (controller.signal.aborted) {
          URL.revokeObjectURL(value);
          return;
        }
        objectUrl = value;
        setUrl(value);
      })
      .catch(reason => {
        if (!controller.signal.aborted)
          setError(publicApiError(reason, "图片加载失败"));
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, scope, original, attempt]);

  if (error)
    return (
      <div className="comic-output-error">
        <span>{error}</span>
        <button onClick={() => setAttempt(value => value + 1)}>
          重新加载图片
        </button>
      </div>
    );
  if (!url) return <small>正在加载生成图片…</small>;
  if (original)
    return (
      <img
        className="comic-output-original"
        src={url}
        alt={name}
        onError={() => setError("图片加载失败")}
      />
    );
  return (
    <>
      <button
        className="comic-output-preview"
        aria-label={`查看 ${name} 的生成图片`}
        onClick={() => setOpen(true)}
      >
        <img
          src={url}
          alt={`${name} 生成结果`}
          onError={() => setError("图片加载失败")}
        />
        <span>查看图片</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="comic-output-dialog"
          aria-describedby={undefined}
        >
          <DialogTitle>{name} · 生成结果</DialogTitle>
          {open && (
            <ComicOutputImage
              assetId={assetId}
              name={name}
              scope={scope}
              original
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ComicBatchItem({
  batch,
  item,
  scope,
  busy,
  onRetry,
}: {
  batch: ComicBatchDetail["batch"];
  item: ComicGenerationItem;
  scope: WorkspaceScope;
  busy: boolean;
  onRetry: () => void;
}) {
  const active = item.status === "queued" || item.status === "running";
  const jobQuery = useComicBatchItemJobQuery(item.job_id, active);
  const job = active ? jobQuery.data : undefined;
  const status = job?.status || item.status;
  const progress =
    typeof job?.progress === "number" && Number.isFinite(job.progress)
      ? Math.max(0, Math.min(100, Math.round(job.progress)))
      : undefined;
  const error =
    status === "failed"
      ? item.error?.message || (job ? jobErrorMessage(job) : "生成失败，请重试")
      : "";
  const label =
    job?.status === "succeeded"
      ? "正在保存图片"
      : COMIC_BATCH_ITEM_STATUS_LABELS[status];

  return (
    <article
      className={`comic-batch-item ${status}`}
      aria-label={item.asset_name}
    >
      <div className="comic-batch-item-heading">
        <b>{item.asset_name}</b>
        <span>
          {label}
          {status === "running" && progress !== undefined
            ? ` ${progress}%`
            : ""}
        </span>
      </div>
      {status === "running" && (
        <progress
          aria-label={`${item.asset_name} 生成进度`}
          max={100}
          value={progress}
        />
      )}
      {status === "pending" && (
        <small>等待批次调度，前面的任务完成后继续</small>
      )}
      {status === "queued" && (
        <small>
          {COMIC_QUEUE_PHASE_LABELS[job?.queue_phase || ""] ||
            "已提交，等待生成服务接单"}
        </small>
      )}
      {active && jobQuery.error && (
        <p className="comic-batch-error" role="alert">
          {publicApiError(jobQuery.error, "暂时无法读取任务进度")}，将自动重试
        </p>
      )}
      {error && <p className="comic-batch-error">{error}</p>}
      {error && item.error?.suggestion && (
        <p className="comic-batch-hint">{item.error.suggestion}</p>
      )}
      {item.status === "succeeded" && item.output_asset_id && (
        <ComicOutputImage
          assetId={item.output_asset_id}
          name={item.asset_name}
          scope={scope}
        />
      )}
      {item.job_id && (
        <small className="comic-batch-job-id">
          任务 {item.job_id.slice(-8)}
        </small>
      )}
      {item.status === "failed" && (
        <button className="comic-item-retry" disabled={busy} onClick={onRetry}>
          重试此项 <ComicItemPrice item={item} batch={batch} />
        </button>
      )}
    </article>
  );
}

export function ComicBatchPanel({
  detail,
  scope,
  busy,
  error,
  refreshing,
  onRefresh,
  onControl,
  onRetryFailed,
  onRetryItem,
}: {
  detail: ComicBatchDetail;
  scope: WorkspaceScope;
  busy: boolean;
  error?: unknown;
  refreshing?: boolean;
  onRefresh: () => void;
  onControl: (action: "pause" | "resume" | "stop") => void;
  onRetryFailed: () => void;
  onRetryItem: (id: string) => void;
}) {
  const { batch, items } = detail;
  const ended = batch.succeeded + batch.failed + batch.canceled;
  const canPause = batch.status === "queued" || batch.status === "running";
  const canResume = batch.status === "paused";
  return (
    <section
      className="comic-batch-card comic-batch-progress-panel"
      aria-label="批量生成进度"
    >
      <div className="comic-batch-heading">
        <span className={`status-chip ${batch.status}`}>
          {COMIC_BATCH_STATUS_LABELS[batch.status]}
        </span>
        <b>
          已结束 {ended}/{batch.total}
        </b>
      </div>
      <progress
        aria-label="批次完成进度"
        max={100}
        value={comicBatchProgress(batch)}
      />
      <div className="comic-batch-counts" role="status">
        <span>等待 {batch.pending}</span>
        <span>进行中 {batch.active}</span>
        <span>成功 {batch.succeeded}</span>
        <span>失败 {batch.failed}</span>
        {batch.canceled > 0 && <span>已取消 {batch.canceled}</span>}
      </div>
      <p className="comic-batch-hint">
        {canResume
          ? "已暂停新增任务，正在生成的任务会继续完成。"
          : batch.status === "stopping"
            ? "正在停止后续任务，已开始的任务会继续完成。"
            : "进度自动更新，完成后可在下方查看图片。"}
      </p>
      {Boolean(error) && (
        <p className="comic-batch-error" role="alert">
          进度刷新失败，当前显示上次结果。{publicApiError(error, "请稍后重试")}
        </p>
      )}
      <div className="comic-batch-controls">
        {(canPause || canResume) && (
          <button
            disabled={busy}
            onClick={() => onControl(canResume ? "resume" : "pause")}
          >
            {canResume ? "恢复" : "暂停"}
          </button>
        )}
        {(canPause || canResume) && (
          <button disabled={busy} onClick={() => onControl("stop")}>
            停止
          </button>
        )}
        {batch.failed > 0 && (
          <button
            disabled={busy || batch.status === "stopping"}
            onClick={onRetryFailed}
          >
            重试失败（逐项计费，见下方）
          </button>
        )}
        <button disabled={busy || refreshing} onClick={onRefresh}>
          {refreshing ? "刷新中…" : "刷新进度"}
        </button>
      </div>
      <div className="comic-batch-result-list">
        {items.map(item => (
          <ComicBatchItem
            batch={batch}
            key={item.id}
            item={item}
            scope={scope}
            busy={busy}
            onRetry={() => onRetryItem(item.id)}
          />
        ))}
      </div>
    </section>
  );
}

function ComicItemPrice({ item, batch }: { item: ComicGenerationItem; batch: ComicBatchDetail["batch"] }) {
  const snapshot = item.config_snapshot;
  return <GenerationPrice model={snapshot?.model || batch.model} size={snapshot?.size ?? batch.size} quality={snapshot?.quality ?? batch.quality} references={snapshot?.reference_asset_ids?.length ?? 0} />;
}
