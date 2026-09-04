import { Crop, Expand, Loader2, ZoomIn } from "lucide-react";
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
  ImageUpscaleAlgorithm,
  OutpaintMargins,
} from "@/lib/canvas-image-data";

/* ---- 关键帧工作台的图片编辑弹窗集合：历史预览 / 超分 / 扩图 / 裁剪 ---- */

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/* 裁剪框初始值（百分比）：居中 76% 区域，与画布裁剪默认草稿对齐 */
const DEFAULT_CROP_RECT = { x: 12, y: 12, width: 76, height: 76 };
/* 裁剪框允许的最小边长（百分比），防止拖出不可见的框 */
const MIN_CROP_EDGE = 5;
/* 裁剪宽高比预设按钮：label + 目标宽高比（null 表示自由框） */
const CROP_RATIO_PRESETS: Array<{ label: string; ratio: number | null }> = [
  { label: "自由", ratio: null },
  { label: "1:1", ratio: 1 },
  { label: "3:2", ratio: 3 / 2 },
  { label: "16:9", ratio: 16 / 9 },
  { label: "9:16", ratio: 9 / 16 },
  { label: "2:3", ratio: 2 / 3 },
];
/* 超分目标长边选项（px），与画布图片工具保持一致 */
const UPSCALE_LONG_EDGE_OPTIONS = [2048, 3072, 4096] as const;
/* 扩图单方向最大扩展比例（%），与画布图片工具保持一致 */
const MAX_OUTPAINT_MARGIN = 75;

type CropRectDraft = { x: number; y: number; width: number; height: number };

function clampCropRect(rect: CropRectDraft): CropRectDraft {
  const width = clamp(rect.width, MIN_CROP_EDGE, 100);
  const height = clamp(rect.height, MIN_CROP_EDGE, 100);
  return {
    width,
    height,
    x: clamp(rect.x, 0, 100 - width),
    y: clamp(rect.y, 0, 100 - height),
  };
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
      <DialogContent className="edit-dialog">
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
          <button className="outline-button small" onClick={onClose} disabled={busy}>取消</button>
          <button className="vermilion-button small" onClick={() => onRun(longEdge, algorithm)} disabled={busy}>
            {busy ? <Loader2 className="spin" size={13} /> : null} 开始超分
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
      <DialogContent className="edit-dialog">
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
          <button className="outline-button small" onClick={onClose} disabled={busy}>取消</button>
          <button className="vermilion-button small" onClick={() => onRun({ top: top / 100, right: right / 100, bottom: bottom / 100, left: left / 100 }, prompt.trim() || "延展画面边缘，保持主体、光线、材质和画风一致")} disabled={busy}>
            {busy ? <Loader2 className="spin" size={13} /> : null} 开始扩图
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
  const [rect, setRect] = useState<CropRectDraft>(DEFAULT_CROP_RECT);
  const [imageAspect, setImageAspect] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ stage: DOMRect; startX: number; startY: number; origin: CropRectDraft } | null>(null);

  useEffect(() => {
    if (open) setRect(DEFAULT_CROP_RECT);
  }, [open, imageUrl]);

  const applyPreset = (ratio: number | null) => {
    if (!ratio) {
      setRect(DEFAULT_CROP_RECT);
      return;
    }
    /* 在图片内取目标宽高比的最大居中区域，再缩到 92% 留边 */
    let frameWidth: number;
    let frameHeight: number;
    if (imageAspect >= ratio) {
      frameHeight = 1;
      frameWidth = ratio / imageAspect;
    } else {
      frameWidth = 1;
      frameHeight = imageAspect / ratio;
    }
    frameWidth *= 0.92;
    frameHeight *= 0.92;
    setRect({
      x: ((1 - frameWidth) / 2) * 100,
      y: ((1 - frameHeight) / 2) * 100,
      width: frameWidth * 100,
      height: frameHeight * 100,
    });
  };

  const onBoxPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { stage, startX: event.clientX, startY: event.clientY, origin: rect };
  };
  const onBoxPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = ((event.clientX - drag.startX) / Math.max(1, drag.stage.width)) * 100;
    const dy = ((event.clientY - drag.startY) / Math.max(1, drag.stage.height)) * 100;
    setRect(clampCropRect({ ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy }));
  };
  const onBoxPointerUp = () => {
    dragRef.current = null;
  };

  const numberField = (label: string, key: keyof CropRectDraft) => (
    <label>{label}
      <input
        type="number"
        min={0}
        max={100}
        value={Math.round(rect[key])}
        onChange={(event) => setRect((current) => clampCropRect({ ...current, [key]: Number(event.target.value) || 0 }))}
      />
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="edit-dialog crop-dialog">
        <DialogHeader>
          <DialogTitle><Crop size={16} /> 裁剪图片</DialogTitle>
          <DialogDescription>拖动选框调整位置，或用下方数值 / 宽高比预设精确设置。</DialogDescription>
        </DialogHeader>
        <div className="crop-dialog-stage">
          {imageUrl ? (
            <div className="crop-dialog-frame" ref={stageRef}>
              <img src={imageUrl} alt="裁剪预览" draggable={false} onLoad={(event) => setImageAspect(event.currentTarget.naturalWidth / Math.max(1, event.currentTarget.naturalHeight))} />
              <div
                className="crop-dialog-box"
                style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.width}%`, height: `${rect.height}%` }}
                onPointerDown={onBoxPointerDown}
                onPointerMove={onBoxPointerMove}
                onPointerUp={onBoxPointerUp}
              />
            </div>
          ) : (
            <Loader2 className="spin" size={22} />
          )}
        </div>
        <div className="crop-dialog-presets">
          {CROP_RATIO_PRESETS.map((preset) => <button key={preset.label} onClick={() => applyPreset(preset.ratio)}>{preset.label}</button>)}
        </div>
        <div className="edit-dialog-fields crop-fields">
          {numberField("左（%）", "x")}
          {numberField("上（%）", "y")}
          {numberField("宽（%）", "width")}
          {numberField("高（%）", "height")}
        </div>
        <DialogFooter>
          <button className="outline-button small" onClick={onClose} disabled={busy}>取消</button>
          <button className="vermilion-button small" onClick={() => onRun({ x: rect.x / 100, y: rect.y / 100, width: rect.width / 100, height: rect.height / 100 })} disabled={busy || !imageUrl}>
            {busy ? <Loader2 className="spin" size={13} /> : null} 确认裁剪
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
