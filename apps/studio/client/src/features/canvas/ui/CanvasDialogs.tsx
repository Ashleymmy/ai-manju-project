import { GenerationPrice } from "@/features/member";
import { CanvasGenerationPrice } from "./CanvasGenerationPrice";
import {
  Check,
  Image as ImageIcon,
  RotateCcw,
  Scan,
  X,
} from "lucide-react";
import { useState, type PointerEvent, type RefObject, type SetStateAction } from "react";
import { RetryImage } from "@/shared/ui/RetryImage";
import { cropRectForAspectRatio } from "@/features/image";
import { imageCropRectFromDraft, imageToolDraftFromCropRect, resizeImageCropRect } from "@/features/canvas/domain/imageData";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  ImageCompressionFormat,
  ImageCropRect,
  ImageCropResizeHandle,
  ImageUpscaleAlgorithm,
} from "@/features/canvas/domain/imageData";
import type { CanvasNodeData } from "@/features/canvas/domain/types";
import { CANVAS_CROP_RATIOS, defaultCanvasImageToolDraft, type CanvasImageToolDraft } from "@/features/canvas/domain/imageTool";
import type { CanvasImageToolMode } from "./CanvasNodeCard";
export { defaultCanvasImageToolDraft } from "@/features/canvas/domain/imageTool";
export type { CanvasImageToolDraft } from "@/features/canvas/domain/imageTool";

const imageCropResizeHandles: ImageCropResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export type CanvasImageToolDialogState = { nodeId: string; mode: CanvasImageToolMode };

export type CanvasImageToolDialogProps = {
  dialog: CanvasImageToolDialogState | null;
  busy: boolean;
  error: string;
  preview: string;
  loading?: boolean;
  onRetry?: () => void;
  node?: CanvasNodeData;
  crop: ImageCropRect;
  cropStageRef: RefObject<HTMLDivElement | null>;
  draft: CanvasImageToolDraft;
  onOpenChange: (open: boolean) => void;
  onStartCropPointer: (event: PointerEvent<HTMLDivElement | HTMLButtonElement>, mode: "move" | "resize", handle?: ImageCropResizeHandle) => void;
  onSelectMode: (mode: CanvasImageToolMode) => void;
  onDraftChange: (update: SetStateAction<CanvasImageToolDraft>) => void;
  onCancel: () => void;
  onRun: () => void;
};

export function CanvasImageToolDialog({
  dialog,
  busy,
  error,
  preview,
  loading = false,
  onRetry,
  node,
  crop,
  cropStageRef,
  draft,
  onOpenChange,
  onStartCropPointer,
  onSelectMode,
  onDraftChange,
  onCancel,
  onRun,
}: CanvasImageToolDialogProps) {
  const [imageSize, setImageSize] = useState({ source: "", width: 0, height: 0 });
  const cropMode = dialog?.mode === "crop" || dialog?.mode === "focus";
  const imageReady = imageSize.source === preview && imageSize.width > 0 && imageSize.height > 0;
  const imageAspect = imageReady ? imageSize.width / imageSize.height : 1;
  const selectRatio = (ratio: number | null) => {
    onDraftChange(current => ({ ...current, cropRatio: ratio,
      ...(ratio ? imageToolDraftFromCropRect(cropRectForAspectRatio(imageAspect, ratio)) : {}),
    }));
  };
  const changeCropSize = (dimension: "width" | "height", value: number) => {
    if (!Number.isFinite(value)) return;
    onDraftChange(current => {
      const rect = imageCropRectFromDraft(current);
      const resized = resizeImageCropRect(rect, dimension === "width" ? value / 100 - rect.width : 0,
        dimension === "height" ? value / 100 - rect.height : 0, dimension === "width" ? "e" : "s",
        current.cropRatio !== null, imageSize, current.cropRatio ?? 1);
      return { ...current, ...imageToolDraftFromCropRect(resized) };
    });
  };
  return (
    <Dialog open={Boolean(dialog)} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[920px] canvas-image-tool-dialog canvas-tool-dialog"
        showCloseButton={!busy}
        onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}
        onInteractOutside={(event) => { if (busy) event.preventDefault(); }}
      >
        <DialogHeader className={cropMode ? "sr-only" : undefined}>
          <DialogTitle>{dialog ? `图片${canvasImageToolLabel(dialog.mode)}` : "图片工具"}</DialogTitle>
          <DialogDescription>处理结果会上传到当前工作区，并以子节点连接到原图片；水平/垂直翻转直接更新原节点。</DialogDescription>
        </DialogHeader>
        <div className="canvas-image-tool-layout">
          <div className="canvas-image-tool-preview">
            {preview ? dialog?.mode === "crop" || dialog?.mode === "focus" ? (
              <div ref={cropStageRef} className="canvas-image-crop-stage">
                <RetryImage src={preview} alt={node?.title || "待处理图片"} draggable={false}
                  onLoad={event => setImageSize({ source: preview, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
                <div className="canvas-image-crop-mask top" style={{ height: `${crop.y * 100}%` }} />
                <div className="canvas-image-crop-mask bottom" style={{ height: `${(1 - crop.y - crop.height) * 100}%` }} />
                <div className="canvas-image-crop-mask left" style={{ top: `${crop.y * 100}%`, width: `${crop.x * 100}%`, height: `${crop.height * 100}%` }} />
                <div className="canvas-image-crop-mask right" style={{ top: `${crop.y * 100}%`, width: `${(1 - crop.x - crop.width) * 100}%`, height: `${crop.height * 100}%` }} />
                <div
                  className="canvas-image-crop-box"
                  style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}
                  onPointerDown={(event) => onStartCropPointer(event, "move")}
                >
                  <span className="canvas-image-crop-rule horizontal first" />
                  <span className="canvas-image-crop-rule horizontal second" />
                  <span className="canvas-image-crop-rule vertical first" />
                  <span className="canvas-image-crop-rule vertical second" />
                  {imageCropResizeHandles.map((handle) => (
                    <button
                      key={handle}
                      type="button"
                      className="canvas-image-crop-handle"
                      style={imageCropHandleStyle(handle)}
                      onPointerDown={(event) => onStartCropPointer(event, "resize", handle)}
                      aria-label={`从 ${handle} 方向调整裁剪框`}
                      disabled={busy || !imageReady}
                    />
                  ))}
                </div>
              </div>
            ) : <img src={preview} alt={node?.title || "待处理图片"} /> : <div className="empty-output"><ImageIcon size={28} /><p>{loading ? "正在加载原图…" : "原图暂不可预览"}</p>{!loading && onRetry ? <button type="button" onClick={onRetry}>重试加载原图</button> : null}</div>}
          </div>
          <div className="canvas-image-tool-controls">
            <div className="canvas-image-tool-tabs">
              {(["crop", "focus", "split", "upscale", "compress", "outpaint", "angle"] as const).map((mode) => (
                <button key={mode} type="button" className={dialog?.mode === mode ? "active" : ""} onClick={() => onSelectMode(mode)} disabled={busy}>
                  {canvasImageToolLabel(mode)}
                </button>
              ))}
            </div>
            {cropMode ? <div className="canvas-image-tool-fields">
              <div className="canvas-image-crop-ratios" role="group" aria-label="裁剪比例">
                {CANVAS_CROP_RATIOS.map(({ label, ratio }) => (
                  <button key={label} type="button" aria-pressed={draft.cropRatio === ratio}
                    onClick={() => selectRatio(ratio)} disabled={busy || !imageReady}>
                    <span className="canvas-image-crop-ratio-icon" aria-hidden="true">
                      {ratio ? <span style={{ width: ratio >= 1 ? 26 : 26 * ratio, height: ratio >= 1 ? 26 / ratio : 26 }} /> : <Scan size={24} />}
                    </span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              <label>裁剪宽度（%）<input type="number" min={1} max={100} step={0.1} value={draft.cropWidth} disabled={busy || !imageReady} onChange={(event) => changeCropSize("width", Number(event.target.value))} /></label>
              <label>裁剪高度（%）<input type="number" min={1} max={100} step={0.1} value={draft.cropHeight} disabled={busy || !imageReady} onChange={(event) => changeCropSize("height", Number(event.target.value))} /></label>
              <div className="canvas-image-crop-actions">
                <button type="button" className="outline-button small" onClick={() => draft.cropRatio ? selectRatio(draft.cropRatio) : onDraftChange(current => ({ ...current,
                  ...imageToolDraftFromCropRect(imageCropRectFromDraft(defaultCanvasImageToolDraft)),
                }))} disabled={busy || !imageReady}><RotateCcw size={14} />重置裁剪框</button>
              </div>
            </div> : null}
            {dialog?.mode === "split" ? <div className="canvas-image-tool-fields">
              <label>行数<input type="number" min={1} max={6} value={draft.splitRows} onChange={(event) => onDraftChange((current) => ({ ...current, splitRows: Number(event.target.value) }))} /></label>
              <label>列数<input type="number" min={1} max={6} value={draft.splitColumns} onChange={(event) => onDraftChange((current) => ({ ...current, splitColumns: Number(event.target.value) }))} /></label>
            </div> : null}
            {dialog?.mode === "upscale" ? <div className="canvas-image-tool-fields">
              <label>目标长边<select value={draft.upscaleLongEdge} onChange={(event) => onDraftChange((current) => ({ ...current, upscaleLongEdge: Number(event.target.value) }))}><option value={1024}>1024 px</option><option value={2048}>2048 px</option><option value={3072}>3072 px</option><option value={4096}>4096 px</option></select></label>
              <label>缩放算法<select value={draft.upscaleAlgorithm} onChange={(event) => onDraftChange((current) => ({ ...current, upscaleAlgorithm: event.target.value as ImageUpscaleAlgorithm }))}><option value="high">高质量分步</option><option value="bilinear">双线性</option><option value="nearest">最近邻</option></select></label>
            </div> : null}
            {dialog?.mode === "compress" ? <div className="canvas-image-tool-fields">
              <label>输出格式<select value={draft.compressionFormat} onChange={(event) => onDraftChange((current) => ({ ...current, compressionFormat: event.target.value as ImageCompressionFormat }))}><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option></select></label>
              <label>质量（%）<input type="number" min={30} max={95} value={draft.compressionQuality} onChange={(event) => onDraftChange((current) => ({ ...current, compressionQuality: Number(event.target.value) }))} /></label>
              <label>最大长边<input type="number" min={512} max={4096} step={128} value={draft.compressionMaxDimension} onChange={(event) => onDraftChange((current) => ({ ...current, compressionMaxDimension: Number(event.target.value) }))} /></label>
              <label>目标体积（KB）<input type="number" min={0} max={20480} step={100} value={draft.compressionTargetKb} onChange={(event) => onDraftChange((current) => ({ ...current, compressionTargetKb: Number(event.target.value) }))} placeholder="0 表示不限制" /></label>
            </div> : null}
            {dialog?.mode === "outpaint" ? <div className="canvas-image-tool-fields canvas-image-tool-fields-wide">
              <label>上方扩展（%）<input type="number" min={0} max={75} value={draft.outpaintTop} onChange={(event) => onDraftChange((current) => ({ ...current, outpaintTop: Number(event.target.value) }))} /></label>
              <label>右侧扩展（%）<input type="number" min={0} max={75} value={draft.outpaintRight} onChange={(event) => onDraftChange((current) => ({ ...current, outpaintRight: Number(event.target.value) }))} /></label>
              <label>下方扩展（%）<input type="number" min={0} max={75} value={draft.outpaintBottom} onChange={(event) => onDraftChange((current) => ({ ...current, outpaintBottom: Number(event.target.value) }))} /></label>
              <label>左侧扩展（%）<input type="number" min={0} max={75} value={draft.outpaintLeft} onChange={(event) => onDraftChange((current) => ({ ...current, outpaintLeft: Number(event.target.value) }))} /></label>
              <label className="canvas-image-tool-span">扩图要求<textarea value={draft.outpaintPrompt} maxLength={500} onChange={(event) => onDraftChange((current) => ({ ...current, outpaintPrompt: event.target.value }))} /></label>
            </div> : null}
            {dialog?.mode === "angle" ? <div className="canvas-image-tool-fields canvas-image-tool-fields-wide">
              <label>左右角度（°）<input type="range" min={-180} max={180} step={1} value={draft.angleHorizontal} onChange={(event) => onDraftChange((current) => ({ ...current, angleHorizontal: Number(event.target.value) }))} /><b>{draft.angleHorizontal}°</b></label>
              <label>俯仰角度（°）<input type="range" min={-90} max={90} step={1} value={draft.anglePitch} onChange={(event) => onDraftChange((current) => ({ ...current, anglePitch: Number(event.target.value) }))} /><b>{draft.anglePitch}°</b></label>
              <label>镜头距离<input type="range" min={1} max={10} step={0.1} value={draft.angleDistance} onChange={(event) => onDraftChange((current) => ({ ...current, angleDistance: Number(event.target.value) }))} /><b>{draft.angleDistance.toFixed(1)}</b></label>
              <label>镜头<select value={draft.angleLens} onChange={(event) => onDraftChange((current) => ({ ...current, angleLens: event.target.value as CanvasImageToolDraft["angleLens"] }))}><option value="wide">广角</option><option value="standard">标准</option><option value="telephoto">长焦</option></select></label>
            </div> : null}
            {error ? <p className="canvas-image-tool-error">{error}</p> : null}
          </div>
        </div>
        <DialogFooter>
          {node && (dialog?.mode === "outpaint" || dialog?.mode === "angle") ? <CanvasGenerationPrice node={node} edit /> : <GenerationPrice kind="free" />}
          <button className="outline-button" type="button" onClick={onCancel} disabled={busy}><X size={15} /> 取消</button>
          <button className="vermilion-button" type="button" onClick={onRun} disabled={busy || !node || !preview}>
            <Check size={15} /> {busy ? "处理中…" : `执行${dialog ? canvasImageToolLabel(dialog.mode) : "处理"}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function canvasImageToolLabel(mode: CanvasImageToolMode) {
  return ({ crop: "裁剪", focus: "聚焦提取", split: "切图", upscale: "放大", compress: "压缩", outpaint: "扩图", angle: "AI 多角度" } as const)[mode];
}

function imageCropHandleStyle(handle: ImageCropResizeHandle) {
  const top = handle.includes("n") ? "-6px" : handle.includes("s") ? "calc(100% - 6px)" : "calc(50% - 6px)";
  const left = handle.includes("w") ? "-6px" : handle.includes("e") ? "calc(100% - 6px)" : "calc(50% - 6px)";
  return { top, left, cursor: `${handle}-resize` };
}
