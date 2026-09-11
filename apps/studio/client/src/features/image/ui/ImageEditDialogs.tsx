import { Check, Crop, Expand, Loader2, X, ZoomIn } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Asset } from "@/entities/asset";
import type {
  ImageCropRect,
  ImageCropResizeHandle,
  ImageUpscaleAlgorithm,
  OutpaintMargins,
} from "@/lib/canvas-image-data";
import { moveImageCropRect, resizeImageCropRect } from "@/lib/canvas-image-data";
import { cropRectForAspectRatio, DEFAULT_IMAGE_CROP_RECT } from "@/features/image/model/cropRect";
import "@/shared/styles/annotation-dialog.css";

/* ---- 关键帧工作台的图片编辑弹窗集合：历史预览 / 超分 / 扩图 / 裁剪 ---- */

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/* 裁剪宽高比预设按钮：label + 目标宽高比（null 表示自由框） */
const CROP_RATIO_PRESETS: Array<{ label: string; ratio: number | null }> = [
  { label: "自由", ratio: null },
  { label: "1:1", ratio: 1 },
  { label: "3:2", ratio: 3 / 2 },
  { label: "16:9", ratio: 16 / 9 },
  { label: "9:16", ratio: 9 / 16 },
  { label: "2:3", ratio: 2 / 3 },
];
const CROP_RESIZE_HANDLES: ImageCropResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
/* 超分目标长边选项（px），与画布图片工具保持一致 */
const UPSCALE_LONG_EDGE_OPTIONS = [2048, 3072, 4096] as const;
/* 扩图单方向最大扩展比例（%），与画布图片工具保持一致 */
const MAX_OUTPAINT_MARGIN = 75;

function cropHandleStyle(handle: ImageCropResizeHandle) {
  const top = handle.includes("n") ? "-6px" : handle.includes("s") ? "calc(100% - 6px)" : "calc(50% - 6px)";
  const left = handle.includes("w") ? "-6px" : handle.includes("e") ? "calc(100% - 6px)" : "calc(50% - 6px)";
  return { top, left, cursor: `${handle}-resize` };
}

/* ===================== 历史记录小弹窗预览 ===================== */

export function HistoryPreviewDialog({
  asset,
  imageUrl,
  onClose,
  onLoadIntoPreview,
  onAddReference,
  onDownload,
}: {
  asset: Asset | null;
  imageUrl: string;
  onClose: () => void;
  onLoadIntoPreview: (asset: Asset) => void;
  onAddReference: (asset: Asset) => void;
  onDownload: (asset: Asset) => void;
}) {
  return (
    <Dialog open={Boolean(asset)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="history-preview-dialog">
        <DialogHeader>
          <DialogTitle>{asset?.name || "生成记录"}</DialogTitle>
          <DialogDescription>
            {asset ? `归档于 ${new Date(asset.created_at || Date.now()).toLocaleString("zh-CN")}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="history-preview-stage">
          {imageUrl ? <img src={imageUrl} alt={asset?.name || "预览"} /> : <Loader2 className="spin" size={22} />}
        </div>
        {asset && (
          <DialogFooter className="history-preview-actions">
            <button onClick={() => onLoadIntoPreview(asset)}>载入预览区</button>
            <button onClick={() => onAddReference(asset)}>设为参考图</button>
            <button onClick={() => onDownload(asset)}>下载</button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ===================== 超分 ===================== */

export function UpscaleDialog({
  open,
  busy,
  onClose,
  onRun,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onRun: (targetLongEdge: number, algorithm: ImageUpscaleAlgorithm) => void;
}) {
  const [longEdge, setLongEdge] = useState<number>(UPSCALE_LONG_EDGE_OPTIONS[0]);
  const [algorithm, setAlgorithm] = useState<ImageUpscaleAlgorithm>("high");
  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="edit-dialog canvas-tool-dialog">
        <DialogHeader>
          <DialogTitle><ZoomIn size={16} /> 超分放大</DialogTitle>
          <DialogDescription>本地高质量放大，结果会作为新图片加入预览区域。</DialogDescription>
        </DialogHeader>
        <div className="edit-dialog-fields">
          <label>目标长边
            <select value={longEdge} onChange={(event) => setLongEdge(Number(event.target.value))}>
              {UPSCALE_LONG_EDGE_OPTIONS.map((value) => <option key={value} value={value}>{value} px</option>)}
            </select>
          </label>
          <label>缩放算法
            <select value={algorithm} onChange={(event) => setAlgorithm(event.target.value as ImageUpscaleAlgorithm)}>
              <option value="high">高质量分步</option>
              <option value="bilinear">双线性</option>
              <option value="nearest">最近邻</option>
            </select>
          </label>
        </div>
        <DialogFooter>
          <button type="button" className="outline-button" onClick={onClose} disabled={busy}><X size={15} /> 取消</button>
          <button type="button" className="vermilion-button" onClick={() => onRun(longEdge, algorithm)} disabled={busy}>
            {busy ? <Loader2 className="spin" size={13} /> : <Check size={15} />} {busy ? "处理中…" : "开始超分"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ===================== 扩图（AI 外扩） ===================== */

export function OutpaintDialog({
  open,
  busy,
  onClose,
  onRun,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onRun: (margins: OutpaintMargins, prompt: string) => void;
}) {
  const [top, setTop] = useState(22);
  const [right, setRight] = useState(22);
  const [bottom, setBottom] = useState(22);
  const [left, setLeft] = useState(22);
  const [prompt, setPrompt] = useState("延展画面边缘，保持主体、光线、材质和画风一致");
  const marginInput = (label: string, value: number, setValue: (next: number) => void) => (
    <label>{label}
      <input type="number" min={0} max={MAX_OUTPAINT_MARGIN} value={value} onChange={(event) => setValue(clamp(Number(event.target.value) || 0, 0, MAX_OUTPAINT_MARGIN))} />
    </label>
  );
  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="edit-dialog canvas-tool-dialog">
        <DialogHeader>
          <DialogTitle><Expand size={16} /> AI 扩图</DialogTitle>
          <DialogDescription>向外扩展画布并由当前模型补全边缘，走生成队列，完成后自动归档。</DialogDescription>
        </DialogHeader>
        <div className="edit-dialog-fields outpaint-fields">
          {marginInput("上方扩展（%）", top, setTop)}
          {marginInput("右侧扩展（%）", right, setRight)}
          {marginInput("下方扩展（%）", bottom, setBottom)}
          {marginInput("左侧扩展（%）", left, setLeft)}
          <label className="outpaint-prompt">扩图要求
            <textarea value={prompt} maxLength={500} onChange={(event) => setPrompt(event.target.value)} />
          </label>
        </div>
        <DialogFooter>
          <button type="button" className="outline-button" onClick={onClose} disabled={busy}><X size={15} /> 取消</button>
          <button type="button" className="vermilion-button" onClick={() => onRun({ top: top / 100, right: right / 100, bottom: bottom / 100, left: left / 100 }, prompt.trim() || "延展画面边缘，保持主体、光线、材质和画风一致")} disabled={busy}>
            {busy ? <Loader2 className="spin" size={13} /> : <Check size={15} />} {busy ? "生成中…" : "开始扩图"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ===================== 裁剪 ===================== */

export function CropDialog({
  open,
  imageUrl,
  busy,
  onClose,
  onRun,
}: {
  open: boolean;
  imageUrl: string;
  busy: boolean;
  onClose: () => void;
  onRun: (rect: ImageCropRect) => void;
}) {
  const [rect, setRect] = useState<ImageCropRect>(DEFAULT_IMAGE_CROP_RECT);
  const [imageAspect, setImageAspect] = useState(1);
  const [presetLabel, setPresetLabel] = useState("自由");
  const stageRef = useRef<HTMLDivElement>(null);
  const rectRef = useRef(rect);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  rectRef.current = rect;

  useEffect(() => {
    if (!open) {
      dragCleanupRef.current?.();
      return;
    }
    setRect(DEFAULT_IMAGE_CROP_RECT);
    setPresetLabel("自由");
  }, [open, imageUrl]);

  useEffect(() => () => { dragCleanupRef.current?.(); }, []);

  const applyPreset = (label: string, ratio: number | null) => {
    setPresetLabel(label);
    if (!ratio) return;
    setRect(cropRectForAspectRatio(imageAspect, ratio));
  };

  const startCropPointer = (
    event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>,
    mode: "move" | "resize",
    handle: ImageCropResizeHandle = "se",
  ) => {
    if (event.button !== 0) return;
    const box = stageRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0 || busy) return;
    event.preventDefault();
    event.stopPropagation();
    dragCleanupRef.current?.();
    const start = { clientX: event.clientX, clientY: event.clientY, crop: { ...rectRef.current } };
    const locked = presetLabel !== "自由";
    const move = (pointer: PointerEvent) => {
      const dx = (pointer.clientX - start.clientX) / box.width;
      const dy = (pointer.clientY - start.clientY) / box.height;
      setRect(mode === "move"
        ? moveImageCropRect(start.crop, dx, dy)
        : resizeImageCropRect(start.crop, dx, dy, handle, locked, box));
    };
    const finish = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      if (dragCleanupRef.current === finish) dragCleanupRef.current = null;
    };
    dragCleanupRef.current = finish;
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="edit-dialog crop-dialog canvas-tool-dialog">
        <DialogHeader>
          <DialogTitle><Crop size={16} /> 裁剪图片</DialogTitle>
          <DialogDescription>拖动选框移动，拖动边角或边缘调整大小。下方比例预设会约束裁剪框。</DialogDescription>
        </DialogHeader>
        <div className="crop-dialog-stage">
          {imageUrl ? (
            <div className="crop-dialog-frame" ref={stageRef}>
              <img src={imageUrl} alt="裁剪预览" draggable={false} onLoad={(event) => setImageAspect(event.currentTarget.naturalWidth / Math.max(1, event.currentTarget.naturalHeight))} />
              <div
                className="crop-dialog-box"
                style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}
                onPointerDown={(event) => startCropPointer(event, "move")}
              >
                {CROP_RESIZE_HANDLES.map((handle) => (
                  <button
                    key={handle}
                    type="button"
                    className="crop-dialog-handle"
                    style={cropHandleStyle(handle)}
                    aria-label={`从 ${handle} 方向调整裁剪框`}
                    disabled={busy}
                    onPointerDown={(event) => startCropPointer(event, "resize", handle)}
                  />
                ))}
              </div>
            </div>
          ) : (
            <Loader2 className="spin" size={22} />
          )}
        </div>
        <div className="crop-dialog-presets" role="group" aria-label="裁剪比例">
          {CROP_RATIO_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={presetLabel === preset.label ? "active" : ""}
              onClick={() => applyPreset(preset.label, preset.ratio)}
              disabled={busy}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <DialogFooter>
          <button type="button" className="outline-button" onClick={onClose} disabled={busy}><X size={15} /> 取消</button>
          <button type="button" className="vermilion-button" onClick={() => onRun(rect)} disabled={busy || !imageUrl}>
            {busy ? <Loader2 className="spin" size={13} /> : <Check size={15} />} {busy ? "处理中…" : "确认裁剪"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
