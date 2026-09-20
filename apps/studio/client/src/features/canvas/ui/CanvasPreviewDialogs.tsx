import {
  ChevronLeft,
  ChevronRight,
  Download,
  GalleryHorizontalEnd,
  Image as ImageIcon,
  X,
} from "lucide-react";
import { useCallback, useRef, useState, type ComponentProps } from "react";
import { RetryImage } from "@/shared/ui/RetryImage";
import { CanvasImageAnnotationDialog } from "@/components/canvas/CanvasImageAnnotationDialog";
import { CanvasImageMaskDialog } from "@/components/canvas/CanvasImageMaskDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { imageSrcFromNode } from "@/features/canvas/domain/nodes";
import { promptTextFromNode } from "@/features/canvas/domain/nodeUtils";
import type { CanvasNodeData } from "@/features/canvas/domain/types";
import { stringValue } from "@/features/canvas/domain/value";
import type { StoryboardLayout } from "@/features/canvas/domain/imageData";

export type CanvasAnnotationMaskDialogsProps = {
  annotation: ComponentProps<typeof CanvasImageAnnotationDialog>;
  mask: ComponentProps<typeof CanvasImageMaskDialog>;
};

export function CanvasAnnotationMaskDialogs({ annotation, mask }: CanvasAnnotationMaskDialogsProps) {
  return (
    <>
      <CanvasImageAnnotationDialog {...annotation} />
      <CanvasImageMaskDialog {...mask} />
    </>
  );
}

export type CanvasStoryboardDialogProps = {
  nodeId: string;
  busy: boolean;
  layout: StoryboardLayout;
  selectedCount: number;
  onClose: () => void;
  onLayoutChange: (layout: StoryboardLayout) => void;
  onExport: () => void;
};

export function CanvasStoryboardDialog({
  nodeId,
  busy,
  layout,
  selectedCount,
  onClose,
  onLayoutChange,
  onExport,
}: CanvasStoryboardDialogProps) {
  return (
    <Dialog open={Boolean(nodeId)} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-[560px] canvas-storyboard-dialog canvas-tool-dialog" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>故事板导出</DialogTitle>
          <DialogDescription>使用当前所选图片生成一张带标题与提示词备注的故事板 PNG。</DialogDescription>
        </DialogHeader>
        <div className="canvas-storyboard-layouts">
          {([
            ["grid-2x2", "2 × 2", "最多 4 格"],
            ["grid-3x3", "3 × 3", "最多 9 格"],
            ["strip-horizontal", "横向条带", "最多 6 格"],
            ["strip-vertical", "纵向条带", "最多 6 格"],
          ] as const).map(([value, label, description]) => (
            <button key={value} type="button" className={layout === value ? "active" : ""} onClick={() => onLayoutChange(value)} disabled={busy}>
              <b>{label}</b><span>{description}</span>
            </button>
          ))}
        </div>
        <p className="canvas-storyboard-count">将导出当前选择中的 {selectedCount} 张图片；没有多选时仅使用当前图片。</p>
        <DialogFooter>
          <button className="outline-button" type="button" onClick={onClose} disabled={busy}><X size={15} /> 取消</button>
          <button className="vermilion-button" type="button" onClick={onExport} disabled={busy || !selectedCount}><GalleryHorizontalEnd size={15} /> {busy ? "合成中…" : "导出故事板"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type CanvasImagePreviewDialogProps = {
  node?: CanvasNodeData;
  source: string;
  loading?: boolean;
  error?: string;
  originalBytes?: number;
  onRetry?: () => void;
  siblings: CanvasNodeData[];
  selectedNodeId: string;
  previews: Record<string, string>;
  modelLabel: string;
  createdAt?: string;
  creatorLabel: string;
  onSelectNode: (nodeId: string) => void;
  onSetBatchPrimary: (node: CanvasNodeData) => void;
  onDetachBatchChild: (node: CanvasNodeData) => void;
  onDownload: (node: CanvasNodeData) => void;
  onClose: () => void;
};

export function CanvasImagePreviewDialog({
  node,
  source,
  loading = false,
  error = "",
  originalBytes,
  onRetry,
  siblings,
  selectedNodeId,
  previews,
  modelLabel,
  createdAt,
  creatorLabel,
  onSelectNode,
  onSetBatchPrimary,
  onDetachBatchChild,
  onDownload,
  onClose,
}: CanvasImagePreviewDialogProps) {
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const [failedSource, setFailedSource] = useState("");
  const [loadedResolution, setLoadedResolution] = useState<{
    nodeId: string | undefined;
    source: string;
    width: number;
    height: number;
  } | null>(null);
  const nodeId = node?.id;
  const imageKey = `${nodeId}:${source}`;
  const imageError = error || (failedSource === imageKey ? "原图无法显示，请重试" : "");
  const readImageResolution = useCallback((image: HTMLImageElement) => {
    if (image !== previewImageRef.current) return;
    // 读取实际图片的像素尺寸，不使用画布节点大小或可能已过期的生成参数。
    const { naturalWidth: width, naturalHeight: height } = image;
    const next = image.complete && width > 0 && height > 0
      ? { nodeId, source, width, height }
      : null;
    setLoadedResolution(current => (
      current?.nodeId === next?.nodeId && current?.source === next?.source
      && current?.width === next?.width && current?.height === next?.height
        ? current : next
    ));
  }, [nodeId, source]);
  const bindPreviewImage = useCallback((image: HTMLImageElement | null) => {
    previewImageRef.current = image;
    // 缓存命中的图片也要读取，不能只依赖后续的 load 事件。
    if (image) readImageResolution(image);
  }, [readImageResolution]);
  const resolution = loadedResolution?.nodeId === nodeId && loadedResolution?.source === source
    ? loadedResolution : null;

  return (
    <Dialog open={Boolean(node)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-[1120px] canvas-image-preview-dialog">
        <DialogHeader>
          <DialogTitle>{node?.title || "图片预览"}</DialogTitle>
          <DialogDescription>节点产物的详细预览，底部缩略图或键盘 ← → 可切换同组图片。</DialogDescription>
        </DialogHeader>
        {node ? (
          <div className="preview-detail-layout">
            <div className="preview-detail-main">
              <div className="canvas-image-preview-stage">
                {loading || imageError ? (
                  <div className="canvas-original-image-status" role={imageError ? "alert" : "status"}>
                    <span>{imageError || "正在加载原图…"}</span>
                    {imageError && onRetry ? <button className="outline-button small" type="button" onClick={() => { setFailedSource(""); onRetry(); }}>重新加载</button> : null}
                  </div>
                ) : null}
                {source && !imageError ? <img
                  key={`${node.id}:${source}`}
                  ref={bindPreviewImage}
                  src={source}
                  alt={node.title || "画布图片"}
                  onLoad={event => readImageResolution(event.currentTarget)}
                  onError={event => {
                    if (event.currentTarget === previewImageRef.current) {
                      setLoadedResolution(null);
                      setFailedSource(imageKey);
                    }
                  }}
                /> : null}
                {siblings.length > 1 ? (
                  <div className="preview-detail-pager">
                    <button type="button" title="上一张" onClick={() => {
                      const ids = siblings.map((item) => item.id);
                      const index = ids.indexOf(selectedNodeId);
                      onSelectNode(ids[(index - 1 + ids.length) % ids.length]);
                    }}><ChevronLeft size={14} /></button>
                    <b>{siblings.findIndex((item) => item.id === selectedNodeId) + 1} / {siblings.length}</b>
                    <button type="button" title="下一张" onClick={() => {
                      const ids = siblings.map((item) => item.id);
                      const index = ids.indexOf(selectedNodeId);
                      onSelectNode(ids[(index + 1) % ids.length]);
                    }}><ChevronRight size={14} /></button>
                  </div>
                ) : null}
              </div>
              {siblings.length > 1 ? (
                <div className="preview-detail-thumbs">
                  {siblings.map((sibling) => (
                    <button key={sibling.id} type="button" className={sibling.id === selectedNodeId ? "selected" : ""} onClick={() => onSelectNode(sibling.id)} title={sibling.title}>
                      {imageSrcFromNode(sibling, previews) ? <RetryImage src={imageSrcFromNode(sibling, previews)} alt={sibling.title} fallback={<ImageIcon size={16} />} /> : <ImageIcon size={16} />}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <aside className="preview-detail-info">
              <h4>提示词</h4>
              <p className="preview-detail-prompt">{promptTextFromNode(node) || "—"}</p>
              <h4>信息</h4>
              <div className="preview-detail-rows">
                <div><span>模型</span><b>{modelLabel}</b></div>
                <div><span>质量</span><b>{stringValue(node.metadata?.quality) || "auto"}</b></div>
                <div><span>宽高比</span><b>{stringValue(node.metadata?.size) || "auto"}</b></div>
                <div><span>分辨率</span><b>{resolution ? `${resolution.width} × ${resolution.height} px` : "—"}</b></div>
                <div><span>文件大小</span><b>{originalBytes !== undefined ? formatBytes(originalBytes) : "—"}</b></div>
                <div><span>日期</span><b>{createdAt ? new Date(createdAt).toLocaleString("zh-CN") : "—"}</b></div>
                <div><span>创建者</span><b>{creatorLabel}</b></div>
              </div>
              <div className="preview-detail-actions">
                {node.metadata?.batchRootId ? (
                  <button className="outline-button small" type="button" onClick={() => onSetBatchPrimary(node)}>设为主图</button>
                ) : null}
                {node.metadata?.batchRootId ? (
                  <button
                    className="outline-button small"
                    type="button"
                    title="将这张批次图片拆出为独立节点"
                    onClick={() => {
                      onDetachBatchChild(node);
                      onClose();
                    }}
                  >应用到画布</button>
                ) : null}
                <button className="vermilion-button" type="button" onClick={() => onDownload(node)}><Download size={15} /> 下载</button>
              </div>
            </aside>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export type CanvasMentionMediaPreview = {
  url: string;
  title: string;
  kind: "image" | "video" | "audio";
};

export function CanvasMentionPreviewDialog({
  preview,
  onClose,
}: {
  preview: CanvasMentionMediaPreview | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-[860px] canvas-mention-preview-dialog">
        <DialogHeader>
          <DialogTitle>{preview?.title || "素材预览"}</DialogTitle>
          <DialogDescription>@ 引用的素材详情预览。</DialogDescription>
        </DialogHeader>
        {preview ? (
          <div className="canvas-image-preview-stage">
            {preview.kind === "video" ? (
              <video src={preview.url} controls autoPlay />
            ) : preview.kind === "audio" ? (
              <audio src={preview.url} controls autoPlay />
            ) : (
              <RetryImage src={preview.url} alt={preview.title} showRetryButton />
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
