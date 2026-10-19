import { GenerationPrice } from "@/features/member";
import { CanvasGenerationPrice } from "./CanvasGenerationPrice";
import {
  Check,
  Image as ImageIcon,
  RotateCcw,
  Scan,
  Sparkles,
  X,
} from "lucide-react";
import {
  useState,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { RetryImage } from "@/shared/ui/RetryImage";
import { cropRectForAspectRatio } from "@/features/image";
import {
  imageCropRectFromDraft,
  imageToolDraftFromCropRect,
  resizeImageCropRect,
} from "@/features/canvas/domain/imageData";
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
import {
  CANVAS_CROP_RATIOS,
  defaultCanvasImageToolDraft,
  type CanvasImageToolDraft,
} from "@/features/canvas/domain/imageTool";
import type { CanvasImageToolMode } from "./CanvasNodeCard";
import { useCanvasUpscaleAvailability } from "./CanvasUpscaleAvailability";
export { defaultCanvasImageToolDraft } from "@/features/canvas/domain/imageTool";
export type { CanvasImageToolDraft } from "@/features/canvas/domain/imageTool";

const imageCropResizeHandles: ImageCropResizeHandle[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

export type CanvasImageToolDialogState = {
  nodeId: string;
  mode: CanvasImageToolMode;
};

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
  onStartCropPointer: (
    event: PointerEvent<HTMLDivElement | HTMLButtonElement>,
    mode: "move" | "resize",
    handle?: ImageCropResizeHandle
  ) => void;
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
  const upscaleAvailability = useCanvasUpscaleAvailability();
  const [imageSize, setImageSize] = useState({
    source: "",
    width: 0,
    height: 0,
  });
  const cropMode = dialog?.mode === "crop" || dialog?.mode === "focus";
  const imageReady =
    imageSize.source === preview && imageSize.width > 0 && imageSize.height > 0;
  const imageAspect = imageReady ? imageSize.width / imageSize.height : 1;
  const selectRatio = (ratio: number | null) => {
    onDraftChange(current => ({
      ...current,
      cropRatio: ratio,
      ...(ratio
        ? imageToolDraftFromCropRect(cropRectForAspectRatio(imageAspect, ratio))
        : {}),
    }));
  };
  const changeCropSize = (dimension: "width" | "height", value: number) => {
    if (!Number.isFinite(value)) return;
    onDraftChange(current => {
      const rect = imageCropRectFromDraft(current);
      const resized = resizeImageCropRect(
        rect,
        dimension === "width" ? value / 100 - rect.width : 0,
        dimension === "height" ? value / 100 - rect.height : 0,
        dimension === "width" ? "e" : "s",
        current.cropRatio !== null,
        imageSize,
        current.cropRatio ?? 1
      );
      return { ...current, ...imageToolDraftFromCropRect(resized) };
    });
  };
  return (
    <Dialog open={Boolean(dialog)} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[920px] canvas-image-tool-dialog canvas-tool-dialog"
        showCloseButton={!busy}
        onEscapeKeyDown={event => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={event => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={event => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader className={cropMode ? "sr-only" : undefined}>
          <DialogTitle>
            {dialog ? `图片${canvasImageToolLabel(dialog.mode)}` : "图片工具"}
          </DialogTitle>
          <DialogDescription>
            处理结果会上传到当前工作区，并以子节点连接到原图片；水平/垂直翻转直接更新原节点。
          </DialogDescription>
        </DialogHeader>
        <div className="canvas-image-tool-layout">
          <div className="canvas-image-tool-preview">
            {preview ? (
              dialog?.mode === "crop" || dialog?.mode === "focus" ? (
                <div ref={cropStageRef} className="canvas-image-crop-stage">
                  <RetryImage
                    src={preview}
                    alt={node?.title || "待处理图片"}
                    draggable={false}
                    onLoad={event =>
                      setImageSize({
                        source: preview,
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      })
                    }
                  />
                  <div
                    className="canvas-image-crop-mask top"
                    style={{ height: `${crop.y * 100}%` }}
                  />
                  <div
                    className="canvas-image-crop-mask bottom"
                    style={{ height: `${(1 - crop.y - crop.height) * 100}%` }}
                  />
                  <div
                    className="canvas-image-crop-mask left"
                    style={{
                      top: `${crop.y * 100}%`,
                      width: `${crop.x * 100}%`,
                      height: `${crop.height * 100}%`,
                    }}
                  />
                  <div
                    className="canvas-image-crop-mask right"
                    style={{
                      top: `${crop.y * 100}%`,
                      width: `${(1 - crop.x - crop.width) * 100}%`,
                      height: `${crop.height * 100}%`,
                    }}
                  />
                  <div
                    className="canvas-image-crop-box"
                    style={{
                      left: `${crop.x * 100}%`,
                      top: `${crop.y * 100}%`,
                      width: `${crop.width * 100}%`,
                      height: `${crop.height * 100}%`,
                    }}
                    onPointerDown={event => onStartCropPointer(event, "move")}
                  >
                    <span className="canvas-image-crop-rule horizontal first" />
                    <span className="canvas-image-crop-rule horizontal second" />
                    <span className="canvas-image-crop-rule vertical first" />
                    <span className="canvas-image-crop-rule vertical second" />
                    {imageCropResizeHandles.map(handle => (
                      <button
                        key={handle}
                        type="button"
                        className="canvas-image-crop-handle"
                        style={imageCropHandleStyle(handle)}
                        onPointerDown={event =>
                          onStartCropPointer(event, "resize", handle)
                        }
                        aria-label={`从 ${handle} 方向调整裁剪框`}
                        disabled={busy || !imageReady}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <img src={preview} alt={node?.title || "待处理图片"} />
              )
            ) : (
              <div className="empty-output">
                <ImageIcon size={28} />
                <p>{loading ? "正在加载原图…" : "原图暂不可预览"}</p>
                {!loading && onRetry ? (
                  <button type="button" onClick={onRetry}>
                    重试加载原图
                  </button>
                ) : null}
              </div>
            )}
          </div>
          <div className="canvas-image-tool-controls">
            <div className="canvas-image-tool-tabs">
              {(
                [
                  "crop",
                  "focus",
                  "split",
                  "upscale",
                  "ai-upscale",
                  "compress",
                  "outpaint",
                  "angle",
                ] as const
              )
                // Without an upscale model the tab is hidden, as before AI upscale existed.
                .filter(
                  mode => mode !== "ai-upscale" || upscaleAvailability.image
                )
                .map(mode => (
                  <button
                    key={mode}
                    type="button"
                    className={dialog?.mode === mode ? "active" : ""}
                    onClick={() => onSelectMode(mode)}
                    disabled={busy}
                  >
                    {canvasImageToolLabel(mode)}
                  </button>
                ))}
            </div>
            {cropMode ? (
              <div className="canvas-image-tool-fields">
                <div
                  className="canvas-image-crop-ratios"
                  role="group"
                  aria-label="裁剪比例"
                >
                  {CANVAS_CROP_RATIOS.map(({ label, ratio }) => (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={draft.cropRatio === ratio}
                      onClick={() => selectRatio(ratio)}
                      disabled={busy || !imageReady}
                    >
                      <span
                        className="canvas-image-crop-ratio-icon"
                        aria-hidden="true"
                      >
                        {ratio ? (
                          <span
                            style={{
                              width: ratio >= 1 ? 26 : 26 * ratio,
                              height: ratio >= 1 ? 26 / ratio : 26,
                            }}
                          />
                        ) : (
                          <Scan size={24} />
                        )}
                      </span>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                <label>
                  裁剪宽度（%）
                  <input
                    type="number"
                    min={1}
                    max={100}
                    step={0.1}
                    value={draft.cropWidth}
                    disabled={busy || !imageReady}
                    onChange={event =>
                      changeCropSize("width", Number(event.target.value))
                    }
                  />
                </label>
                <label>
                  裁剪高度（%）
                  <input
                    type="number"
                    min={1}
                    max={100}
                    step={0.1}
                    value={draft.cropHeight}
                    disabled={busy || !imageReady}
                    onChange={event =>
                      changeCropSize("height", Number(event.target.value))
                    }
                  />
                </label>
                <div className="canvas-image-crop-actions">
                  <button
                    type="button"
                    className="outline-button small"
                    onClick={() =>
                      draft.cropRatio
                        ? selectRatio(draft.cropRatio)
                        : onDraftChange(current => ({
                            ...current,
                            ...imageToolDraftFromCropRect(
                              imageCropRectFromDraft(
                                defaultCanvasImageToolDraft
                              )
                            ),
                          }))
                    }
                    disabled={busy || !imageReady}
                  >
                    <RotateCcw size={14} />
                    重置裁剪框
                  </button>
                </div>
              </div>
            ) : null}
            {dialog?.mode === "split" ? (
              <div className="canvas-image-tool-fields">
                <label>
                  行数
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={draft.splitRows}
                    onChange={event =>
                      onDraftChange(current => ({
                        ...current,
                        splitRows: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  列数
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={draft.splitColumns}
                    onChange={event =>
                      onDraftChange(current => ({
                        ...current,
                        splitColumns: Number(event.target.value),
                      }))
                    }
                  />
                </label>
              </div>
            ) : null}
            {dialog?.mode === "upscale" ? (
              <div className="canvas-image-tool-fields">
                <label>
                  目标长边
                  <select
                    value={draft.upscaleLongEdge}
                    onChange={event =>
                      onDraftChange(current => ({
                        ...current,
                        upscaleLongEdge: Number(event.target.value),
                      }))
                    }
                  >
                    <option value={1024}>1024 px</option>
                    <option value={2048}>2048 px</option>
                    <option value={3072}>3072 px</option>
                    <option value={4096}>4096 px</option>
                  </select>
                </label>
                <label>
                  缩放算法
                  <select
                    value={draft.upscaleAlgorithm}
                    onChange={event =>
                      onDraftChange(current => ({
                        ...current,
                        upscaleAlgorithm: event.target
                          .value as ImageUpscaleAlgorithm,
                      }))
                    }
                  >
                    <option value="high">高质量分步</option>
                    <option value="bilinear">双线性</option>
                    <option value="nearest">最近邻</option>
                  </select>
                </label>
              </div>
            ) : null}
            {dialog?.mode === "ai-upscale" ? (
              <div className="canvas-image-tool-fields canvas-image-tool-fields-wide">
                <label>
                  放大倍数（UpscaleFactor）
                  <select
                    value={draft.aiUpscaleFactor}
                    disabled={busy}
                    onChange={event =>
                      onDraftChange(current => ({
                        ...current,
                        aiUpscaleFactor: Number(event.target.value) as
                          1 | 2 | 3 | 4,
                      }))
                    }
                  >
                    <option value={2}>2x 超分（推荐）</option>
                    <option value={3}>3x 超分</option>
                    <option value={4}>4x 超分</option>
                    <option value={1}>1x（原尺寸画质修复）</option>
                  </select>
                </label>
                <label>
                  超分模式（Mode）
                  <select
                    value={draft.aiUpscaleMode}
                    disabled={busy}
                    onChange={event =>
                      onDraftChange(current => ({
                        ...current,
                        aiUpscaleMode: event.target.value as
                          "base" | "enhancement",
                      }))
                    }
                  >
                    <option value="enhancement">
                      增强模式（enhancement · 细节增强）
                    </option>
                    <option value="base">基础模式（base · 标准超分）</option>
                  </select>
                </label>
                <label>
                  输出格式（OutputFormat）
                  <select
                    value={draft.aiUpscaleOutputFormat}
                    disabled={busy}
                    onChange={event =>
                      onDraftChange(current => ({
                        ...current,
                        aiUpscaleOutputFormat: event.target.value as
                          "jpg" | "png" | "bmp",
                      }))
                    }
                  >
                    <option value="jpg">JPG</option>
                    <option value="png">PNG（无损）</option>
                    <option value="bmp">BMP</option>
                  </select>
                </label>
                {draft.aiUpscaleOutputFormat === "jpg" ? (
                  <label>
                    输出质量（OutputQuality 30–100）
                    <input
                      type="number"
                      min={30}
                      max={100}
                      value={draft.aiUpscaleOutputQuality}
                      disabled={busy}
                      onChange={event =>
                        onDraftChange(current => ({
                          ...current,
                          aiUpscaleOutputQuality: Math.max(
                            30,
                            Math.min(100, Number(event.target.value) || 95)
                          ),
                        }))
                      }
                    />
                  </label>
                ) : null}
                <p
                  className="canvas-image-tool-span"
                  style={{
                    fontSize: 12,
                    color: "var(--muted-foreground, #71717a)",
                    margin: 0,
                  }}
                >
                  调用已配置的图片超分模型（阿里云
                  MakeSuperResolutionImage），要求输入图片分辨率在 32×32 至
                  1920×1080 之间且大小不超过 5MB。
                </p>
              </div>
            ) : null}
            {dialog?.mode === "compress" ? (
              <div className="canvas-image-tool-fields">
                <label>
                  输出格式
                  <select
                    value={draft.compressionFormat}
                    onChange={event =>
                      onDraftChange(current => ({
                        ...current,
                        compressionFormat: event.target
                          .value as ImageCompressionFormat,
                      }))
                    }
                  >
                    <option value="image/jpeg">JPEG</option>
                    <option value="image/webp">WebP</option>
                  </select>
                </label>
                <label>
                  质量（%）
                  <input
                    type="number"
                    min={30}
                    max={95}
                    value={draft.compressionQuality}
                    onChange={event =>
                      onDraftChange(current => ({
                        ...current,
                        compressionQuality: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  最大长边
                  <input
                    type="number"
                    min={512}
                    max={4096}
                    step={128}
                    value={draft.compressionMaxDimension}
                    onChange={event =>
                      onDraftChange(current => ({
                        ...current,
                        compressionMaxDimension: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  目标体积（KB）
                  <input
                    type="number"
                    min={0}
                    max={20480}
                    step={100}
                    value={draft.compressionTargetKb}
                    onChange={event =>
                      onDraftChange(current => ({
                        ...current,
                        compressionTargetKb: Number(event.target.value),
                      }))
                    }
                    placeholder="0 表示不限制"
                  />
                </label>
              </div>
            ) : null}
            {dialog?.mode === "outpaint" ? (
              <div className="canvas-image-tool-fields canvas-image-tool-fields-wide">
                <label>
                  上方扩展（%）
                  <input
                    type="number"
                    min={0}
                    max={75}
                    value={draft.outpaintTop}
                    onChange={event =>
                      onDraftChange(current => ({
                        ...current,
                        outpaintTop: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  右侧扩展（%）
                  <input
                    type="number"
                    min={0}
                    max={75}
                    value={draft.outpaintRight}
                    onChange={event =>
                      onDraftChange(current => ({
                        ...current,
                        outpaintRight: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  下方扩展（%）
                  <input
                    type="number"
                    min={0}
                    max={75}
                    value={draft.outpaintBottom}
                    onChange={event =>
                      onDraftChange(current => ({
                        ...current,
                        outpaintBottom: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  左侧扩展（%）
                  <input
                    type="number"
                    min={0}
                    max={75}
                    value={draft.outpaintLeft}
                    onChange={event =>
                      onDraftChange(current => ({
                        ...current,
                        outpaintLeft: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label className="canvas-image-tool-span">
                  扩图要求
                  <textarea
                    value={draft.outpaintPrompt}
                    maxLength={500}
                    onChange={event =>
                      onDraftChange(current => ({
                        ...current,
                        outpaintPrompt: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
            ) : null}
            {dialog?.mode === "angle" ? (
              <div className="canvas-image-tool-fields canvas-image-tool-fields-wide">
                <label>
                  左右角度（°）
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={1}
                    value={draft.angleHorizontal}
                    onChange={event =>
                      onDraftChange(current => ({
                        ...current,
                        angleHorizontal: Number(event.target.value),
                      }))
                    }
                  />
                  <b>{draft.angleHorizontal}°</b>
                </label>
                <label>
                  俯仰角度（°）
                  <input
                    type="range"
                    min={-90}
                    max={90}
                    step={1}
                    value={draft.anglePitch}
                    onChange={event =>
                      onDraftChange(current => ({
                        ...current,
                        anglePitch: Number(event.target.value),
                      }))
                    }
                  />
                  <b>{draft.anglePitch}°</b>
                </label>
                <label>
                  镜头距离
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={0.1}
                    value={draft.angleDistance}
                    onChange={event =>
                      onDraftChange(current => ({
                        ...current,
                        angleDistance: Number(event.target.value),
                      }))
                    }
                  />
                  <b>{draft.angleDistance.toFixed(1)}</b>
                </label>
                <label>
                  镜头
                  <select
                    value={draft.angleLens}
                    onChange={event =>
                      onDraftChange(current => ({
                        ...current,
                        angleLens: event.target
                          .value as CanvasImageToolDraft["angleLens"],
                      }))
                    }
                  >
                    <option value="wide">广角</option>
                    <option value="standard">标准</option>
                    <option value="telephoto">长焦</option>
                  </select>
                </label>
              </div>
            ) : null}
            {error ? <p className="canvas-image-tool-error">{error}</p> : null}
          </div>
        </div>
        <DialogFooter>
          {node && (dialog?.mode === "outpaint" || dialog?.mode === "angle") ? (
            <CanvasGenerationPrice node={node} edit />
          ) : (
            <GenerationPrice kind="free" />
          )}
          <button
            className="outline-button"
            type="button"
            onClick={onCancel}
            disabled={busy}
          >
            <X size={15} /> 取消
          </button>
          <button
            className="vermilion-button"
            type="button"
            onClick={onRun}
            disabled={busy || !node || !preview}
          >
            <Check size={15} />{" "}
            {busy
              ? "处理中…"
              : `执行${dialog ? canvasImageToolLabel(dialog.mode) : "处理"}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function canvasImageToolLabel(mode: CanvasImageToolMode) {
  return (
    {
      crop: "裁剪",
      focus: "聚焦提取",
      split: "切图",
      upscale: "放大",
      "ai-upscale": "AI 超分",
      compress: "压缩",
      outpaint: "扩图",
      angle: "AI 多角度",
    } as const
  )[mode];
}

export type CanvasVideoUpscaleDialogProps = {
  open: boolean;
  node?: CanvasNodeData;
  bitRate: number;
  busy: boolean;
  error?: string;
  onBitRateChange: (bitRate: number) => void;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function CanvasVideoUpscaleDialog({
  open,
  node,
  bitRate,
  busy,
  error,
  onBitRateChange,
  onOpenChange,
  onCancel,
  onConfirm,
}: CanvasVideoUpscaleDialogProps) {
  const presets = [5, 10, 15, 20];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[460px] canvas-tool-dialog"
        showCloseButton={!busy}
        onEscapeKeyDown={event => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={event => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={event => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>视频 AI 超分（2x）</DialogTitle>
          <DialogDescription>
            对「{node?.title || "当前视频"}」执行 2 倍超分（阿里云
            SuperResolveVideo +
            GetAsyncJobResult），完成后将在右侧生成新的超分视频节点。
          </DialogDescription>
        </DialogHeader>
        <div
          className="canvas-image-tool-fields"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: "6px 0",
          }}
        >
          <div>
            <span
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 500,
                marginBottom: 8,
              }}
            >
              输出码率预设（BitRate）
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {presets.map(preset => (
                <button
                  key={preset}
                  type="button"
                  className={
                    bitRate === preset
                      ? "vermilion-button small"
                      : "outline-button small"
                  }
                  disabled={busy}
                  onClick={() => onBitRateChange(preset)}
                >
                  {preset} Mbps{preset === 10 ? "（推荐）" : ""}
                </button>
              ))}
            </div>
          </div>
          <label>
            自定义输出码率（1–20 Mbps）
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              value={bitRate}
              disabled={busy}
              onChange={event =>
                onBitRateChange(
                  Math.max(
                    1,
                    Math.min(20, Math.round(Number(event.target.value) || 10))
                  )
                )
              }
            />
          </label>
          <p
            style={{
              fontSize: 12,
              color: "var(--muted-foreground, #71717a)",
              margin: 0,
              lineHeight: 1.55,
            }}
          >
            要求源视频分辨率大于 360×360 且小于 1920×1080，文件大小不超过
            1GB。任务提交后将异步轮询进度并自动落库。
          </p>
          {error ? <p className="canvas-image-tool-error">{error}</p> : null}
        </div>
        <DialogFooter>
          <button
            className="outline-button"
            type="button"
            onClick={onCancel}
            disabled={busy}
          >
            <X size={15} /> 取消
          </button>
          <button
            className="vermilion-button"
            type="button"
            onClick={onConfirm}
            disabled={busy || !node}
          >
            <Sparkles size={15} /> {busy ? "提交中…" : "开始视频超分"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type CanvasAudioVoiceCloneDialogProps = {
  open: boolean;
  node?: CanvasNodeData;
  targetModel: string;
  prefix: string;
  audioUrl: string;
  fileName: string;
  sampleText: string;
  busy: boolean;
  error?: string;
  onTargetModelChange: (model: string) => void;
  onPrefixChange: (prefix: string) => void;
  onAudioUrlChange: (url: string) => void;
  onSelectFile: (file: File | undefined) => void;
  onSampleTextChange: (text: string) => void;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function CanvasAudioVoiceCloneDialog({
  open,
  targetModel,
  prefix,
  audioUrl,
  fileName,
  sampleText,
  busy,
  error,
  onTargetModelChange,
  onPrefixChange,
  onAudioUrlChange,
  onSelectFile,
  onSampleTextChange,
  onOpenChange,
  onCancel,
  onConfirm,
}: CanvasAudioVoiceCloneDialogProps) {
  const isMiniMax =
    targetModel.toLowerCase().includes("minimax") ||
    targetModel.toLowerCase().includes("speech-");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[500px] canvas-tool-dialog"
        showCloseButton={!busy}
        onEscapeKeyDown={event => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={event => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={event => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>声音克隆（角色音色复刻）</DialogTitle>
          <DialogDescription>
            提供一段 10–20 秒清晰的单人参考音频（WAV / MP3 / M4A），即可为
            CosyVoice 3.5 Plus 或 MiniMax Speech 2.8 HD 创建专属角色音色 ID。
          </DialogDescription>
        </DialogHeader>
        <div
          className="canvas-image-tool-fields"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: "6px 0",
          }}
        >
          <label>
            目标语音模型
            <select
              value={targetModel}
              disabled={busy}
              onChange={event => onTargetModelChange(event.target.value)}
            >
              <option value="cosyvoice-v3.5-plus">
                cosyvoice-v3.5-plus（主力 · 支持指令/方言控制）
              </option>
              <option value="cosyvoice-v3-plus">cosyvoice-v3-plus</option>
              <option value="cosyvoice-v3-flash">cosyvoice-v3-flash</option>
              <option value="MiniMax/speech-2.8-hd">
                MiniMax/speech-2.8-hd（高保真配音）
              </option>
              <option value="MiniMax/speech-2.8-turbo">
                MiniMax/speech-2.8-turbo
              </option>
            </select>
          </label>
          <label>
            {isMiniMax
              ? "自定义音色 ID（8位以上字母数字，首字符为字母）"
              : "角色音色标识前缀（英文或数字，≤10字符）"}
            <input
              value={prefix}
              disabled={busy}
              placeholder={isMiniMax ? "例如 HeroVoice001" : "例如 hero01"}
              onChange={event => onPrefixChange(event.target.value)}
            />
          </label>
          <label>
            上传本地参考音频文件（10–20秒 WAV / MP3 / M4A）
            <input
              type="file"
              accept="audio/wav,audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,.wav,.mp3,.m4a"
              disabled={busy}
              onChange={event => onSelectFile(event.target.files?.[0])}
            />
            {fileName ? (
              <small style={{ color: "var(--muted-foreground, #71717a)" }}>
                已选择文件：{fileName}
              </small>
            ) : null}
          </label>
          <label>
            或直接填写公网参考音频 URL
            <input
              type="url"
              value={audioUrl}
              disabled={busy}
              placeholder="https://example.com/sample-voice.wav"
              onChange={event => onAudioUrlChange(event.target.value)}
            />
          </label>
          {isMiniMax ? (
            <label>
              复刻试听文本（MiniMax 必填）
              <input
                value={sampleText}
                disabled={busy}
                placeholder="你好，这是角色声音复刻试听音频。"
                onChange={event => onSampleTextChange(event.target.value)}
              />
            </label>
          ) : null}
          {error ? <p className="canvas-image-tool-error">{error}</p> : null}
        </div>
        <DialogFooter>
          <button
            className="outline-button"
            type="button"
            onClick={onCancel}
            disabled={busy}
          >
            <X size={15} /> 取消
          </button>
          <button
            className="vermilion-button"
            type="button"
            onClick={onConfirm}
            disabled={busy}
          >
            <Sparkles size={15} /> {busy ? "正在复刻音色…" : "创建角色音色"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function imageCropHandleStyle(handle: ImageCropResizeHandle) {
  const top = handle.includes("n")
    ? "-6px"
    : handle.includes("s")
      ? "calc(100% - 6px)"
      : "calc(50% - 6px)";
  const left = handle.includes("w")
    ? "-6px"
    : handle.includes("e")
      ? "calc(100% - 6px)"
      : "calc(50% - 6px)";
  return { top, left, cursor: `${handle}-resize` };
}
