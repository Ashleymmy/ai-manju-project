import {
  ChevronLeft,
  ChevronRight,
  Download,
  GalleryHorizontalEnd,
  Image as ImageIcon,
} from "lucide-react";
import type { ComponentProps } from "react";
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
import { numberValue, stringValue } from "@/features/canvas/domain/value";
import type { StoryboardLayout } from "@/lib/canvas-image-data";

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
      <DialogContent className="sm:max-w-[560px] canvas-storyboard-dialog" showCloseButton={!busy}>
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
          <button className="outline-button small" type="button" onClick={onClose} disabled={busy}>取消</button>
          <button className="vermilion-button" type="button" onClick={onExport} disabled={busy || !selectedCount}><GalleryHorizontalEnd size={15} /> {busy ? "合成中…" : "导出故事板"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type CanvasImagePreviewDialogProps = {
  node?: CanvasNodeData;
  source: string;
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
  return (
    <Dialog open={Boolean(node && source)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-[1120px] canvas-image-preview-dialog">
        <DialogHeader>
          <DialogTitle>{node?.title || "图片预览"}</DialogTitle>
          <DialogDescription>节点产物的详细预览，底部缩略图或键盘 ← → 可切换同组图片。</DialogDescription>
        </DialogHeader>
        {node ? (
          <div className="preview-detail-layout">
            <div className="preview-detail-main">
              <div className="canvas-image-preview-stage">
                {source ? <img src={source} alt={node.title || "画布图片"} /> : null}
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
                      {imageSrcFromNode(sibling, previews) ? <img src={imageSrcFromNode(sibling, previews)} alt={sibling.title} /> : <ImageIcon size={16} />}
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
                <div><span>文件大小</span><b>{numberValue(node.metadata?.bytes) ? formatBytes(numberValue(node.metadata?.bytes) as number) : "—"}</b></div>
                <div><span>日期</span><b>{createdAt ? new Date(createdAt).toLocaleString("zh-CN") : "—"}</b></div>
                <div><span>创建者</span><b>{creatorLabel}</b></div>
              </div>
              <div className="preview-detail-actions">
                {node.metadata?.batchRootId ? (
                  <button className="outline-button small" type="button" onClick={() => onSetBatchPrimary(node)}>设为主图</button>
                ) : null}
                <button className="outline-button small" type="button" onClick={() => {
                  if (node.metadata?.batchRootId) onDetachBatchChild(node);
                  onClose();
                }}>应用到画布</button>
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
              <img src={preview.url} alt={preview.title} />
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
