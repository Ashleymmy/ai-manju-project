import { Download, Film, Image as ImageIcon, Loader2, Music2, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getAssetContentObjectUrl } from "@/entities/asset";

import { workbenchFormatBytes } from "../model/referenceEngine";
import {
  loadWorkbenchMedia,
  type VideoWorkbenchAttachment,
  type VideoWorkbenchMessage,
} from "../repositories/conversationRepository";

/* 消息流：用户气泡（附件缩略图 + token 高亮）与系统任务卡（进度/取消/重试/视频内嵌播放）。 */

export type WorkbenchTaskRuntime = {
  status?: string;
  progress?: number;
  url?: string;
  error?: string;
  cancelling?: boolean;
};

export function MessageFeed({
  messages,
  taskRuntime,
  resultUrlFor,
  resolveThumb,
  onOpenMedia,
  onCancelTask,
  onRetryTask,
  onRegenerate,
  onDownload,
  empty,
}: {
  messages: VideoWorkbenchMessage[];
  taskRuntime: Record<string, WorkbenchTaskRuntime>;
  /** 已完成任务的结果播放地址（内部带加载与缓存，可能先返回空串再回填） */
  resultUrlFor: (message: VideoWorkbenchMessage) => string;
  resolveThumb: (attachment: VideoWorkbenchAttachment) => string;
  onOpenMedia: (url: string, kind: "image" | "video") => void;
  onCancelTask: (message: VideoWorkbenchMessage) => void;
  onRetryTask: (message: VideoWorkbenchMessage) => void;
  onRegenerate: (message: VideoWorkbenchMessage) => void;
  onDownload: (message: VideoWorkbenchMessage) => void;
  empty: string;
}) {
  return (
    <div className="wb-feed">
      {!messages.length ? (
        <div className="wb-feed-empty">
          <Film size={30} strokeWidth={1.2} />
          <p>{empty}</p>
        </div>
      ) : null}
      {messages.map((message) => message.role === "user" ? (
        <UserBubble
          key={message.id}
          message={message}
          resolveThumb={resolveThumb}
          onOpenMedia={onOpenMedia}
          onRegenerate={onRegenerate}
        />
      ) : (
        <SystemTaskCard
          key={message.id}
          message={message}
          runtime={taskRuntime[message.id] || {}}
          resultUrlFor={resultUrlFor}
          onOpenMedia={onOpenMedia}
          onCancel={onCancelTask}
          onRetry={onRetryTask}
          onDownload={onDownload}
        />
      ))}
    </div>
  );
}

function UserBubble({
  message,
  resolveThumb,
  onOpenMedia,
  onRegenerate,
}: {
  message: VideoWorkbenchMessage;
  resolveThumb: (attachment: VideoWorkbenchAttachment) => string;
  onOpenMedia: (url: string, kind: "image" | "video") => void;
  onRegenerate: (message: VideoWorkbenchMessage) => void;
}) {
  return (
    <div className="wb-msg user">
      <div className="wb-bubble">
        <button type="button" className="wb-msg-retry" title="用这条描述重新生成" onClick={() => onRegenerate(message)}>
          <RotateCcw size={12} />
        </button>
        <p>{message.text}</p>
        {message.attachments?.length ? (
          <div className="wb-msg-attachments">
            {message.attachments.map((attachment) => (
              <AttachmentThumb key={attachment.id} attachment={attachment} resolveThumb={resolveThumb} onOpenMedia={onOpenMedia} />
            ))}
          </div>
        ) : null}
      </div>
      <span className="wb-msg-time">{formatTime(message.createdAt)}</span>
    </div>
  );
}

function SystemTaskCard({
  message,
  runtime,
  resultUrlFor,
  onOpenMedia,
  onCancel,
  onRetry,
  onDownload,
}: {
  message: VideoWorkbenchMessage;
  runtime: WorkbenchTaskRuntime;
  resultUrlFor: (message: VideoWorkbenchMessage) => string;
  onOpenMedia: (url: string, kind: "image" | "video") => void;
  onCancel: (message: VideoWorkbenchMessage) => void;
  onRetry: (message: VideoWorkbenchMessage) => void;
  onDownload: (message: VideoWorkbenchMessage) => void;
}) {
  const status = runtime.status || message.taskStatus || "queued";
  const progress = typeof runtime.progress === "number" ? runtime.progress : message.taskProgress;
  const running = status === "queued" || status === "running";
  const videoUrl = runtime.url || (status === "succeeded" ? resultUrlFor(message) : "");
  return (
    <div className="wb-msg system">
      <div className="wb-bubble task">
        <div className="wb-task-head">
          <Film size={14} />
          <span className="wb-task-prompt" title={message.text}>{message.text || "视频生成任务"}</span>
          <span className="wb-task-meta">
            {message.model ? <i>{message.model}</i> : null}
            {message.config?.seconds ? <i>{message.config.seconds === "-1" ? "智能时长" : `${message.config.seconds}s`}</i> : null}
            {message.config?.size ? <i>{message.config.size}</i> : null}
          </span>
          {message.taskId ? <span className="wb-task-id">ID: {message.taskId}</span> : null}
        </div>
        {running ? (
          <div className="wb-task-running">
            <Loader2 className="spin" size={16} />
            <div className="wb-task-progress">
              <b>{status === "queued" ? "排队中" : "生成中"}</b>
              {typeof progress === "number" ? (
                <div className="wb-progress"><i style={{ width: `${Math.max(0, Math.min(100, Math.round(progress)))}%` }} /><b>{Math.round(progress)}%</b></div>
              ) : null}
            </div>
            <button type="button" className="wb-task-cancel" disabled={Boolean(runtime.cancelling)} onClick={() => onCancel(message)}>
              <Square size={11} /> {runtime.cancelling ? "取消中…" : "取消生成"}
            </button>
          </div>
        ) : null}
        {status === "failed" ? (
          <div className="wb-task-error">
            <p>{runtime.error || message.taskError || "视频生成失败"}</p>
            <button type="button" onClick={() => onRetry(message)}><RotateCcw size={12} /> 重试</button>
          </div>
        ) : null}
        {status === "canceled" ? <div className="wb-task-error"><p>任务已取消</p><button type="button" onClick={() => onRetry(message)}><RotateCcw size={12} /> 重试</button></div> : null}
        {status === "succeeded" && videoUrl ? (
          <div className="wb-task-video" onClick={() => onOpenMedia(videoUrl, "video")} role="button" tabIndex={0}
            onKeyDown={(event) => { if (event.key === "Enter") onOpenMedia(videoUrl, "video"); }}>
            <video src={`${videoUrl}#t=0.5`} preload="metadata" muted />
            <span className="wb-task-play"><Film size={18} /></span>
          </div>
        ) : null}
        {status === "succeeded" && !videoUrl ? (
          <div className="wb-task-error"><p>结果记录已完成，正在读取可播放预览…</p></div>
        ) : null}
        {status === "succeeded" ? (
          <div className="wb-task-actions">
            <button type="button" onClick={() => onDownload(message)}><Download size={12} /> 下载</button>
            <button type="button" onClick={() => onRetry(message)}><RotateCcw size={12} /> 再来一条</button>
          </div>
        ) : null}
      </div>
      <span className="wb-msg-time">{formatTime(message.createdAt)}</span>
    </div>
  );
}

export function AttachmentThumb({
  attachment,
  resolveThumb,
  onOpenMedia,
}: {
  attachment: VideoWorkbenchAttachment;
  resolveThumb: (attachment: VideoWorkbenchAttachment) => string;
  onOpenMedia?: (url: string, kind: "image" | "video") => void;
}) {
  const url = resolveThumb(attachment);
  const clickable = Boolean(onOpenMedia && url && attachment.kind !== "audio");
  return (
    <span
      className={`wb-att ${clickable ? "clickable" : ""}`}
      title={`${attachment.name} · ${workbenchFormatBytes(attachment.bytes)}`}
      onClick={clickable ? () => onOpenMedia?.(url, attachment.kind === "video" ? "video" : "image") : undefined}
    >
      {attachment.kind === "image" && url ? <img src={url} alt={attachment.name} loading="lazy" /> : null}
      {attachment.kind === "video" && url ? <video src={url} muted preload="metadata" /> : null}
      {attachment.kind === "audio" ? <Music2 size={15} /> : null}
      {!url && attachment.kind !== "audio" ? <ImageIcon size={15} /> : null}
      <i>{attachment.role === "first_frame" ? "首帧" : attachment.role === "last_frame" ? "尾帧" : attachment.token || "参考"}</i>
    </span>
  );
}

/** 附件缩略图解析 hook：assetId / 本地媒体 key → Object URL，带缓存与释放。 */
export function useWorkbenchThumbCache() {
  const [cache, setCache] = useState<Record<string, string>>({});
  const pendingRef = useRef(new Set<string>());
  useEffect(() => () => {
    pendingRef.current.clear();
    setCache((current) => {
      Object.values(current).forEach((url) => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); });
      return {};
    });
  }, []);

  const resolveThumb = (attachment: VideoWorkbenchAttachment) => {
    const key = attachment.assetId ? `asset:${attachment.assetId}` : attachment.storageKey ? `local:${attachment.storageKey}` : "";
    if (!key) return "";
    const hit = cache[key];
    if (hit !== undefined) return hit;
    if (!pendingRef.current.has(key)) {
      pendingRef.current.add(key);
      const load = attachment.assetId
        ? getAssetContentObjectUrl(attachment.assetId, attachment.scope || "personal", 320)
        : loadWorkbenchMedia(attachment.storageKey || "").then((blob) => URL.createObjectURL(blob));
      load
        .then((url) => setCache((current) => current[key] ? current : { ...current, [key]: url }))
        .catch(() => setCache((current) => ({ ...current, [key]: "" })))
        .finally(() => pendingRef.current.delete(key));
    }
    return "";
  };
  return { resolveThumb, thumbCache: cache };
}

function formatTime(createdAt: number) {
  const date = new Date(createdAt);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
