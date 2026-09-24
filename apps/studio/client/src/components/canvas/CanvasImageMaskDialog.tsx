import { Brush, Check, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { canvasMaskBrushSize, canvasMaskPoint, canvasMaskStageStyle, type CanvasMaskPoint } from "@/features/canvas/domain/mask";

export type CanvasImageMaskPayload = {
  maskDataUrl: string;
  prompt: string;
};

type Props = {
  price?: React.ReactNode;
  dataUrl: string;
  open: boolean;
  loading?: boolean;
  sourceError?: string;
  onRetry?: () => void;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (payload: CanvasImageMaskPayload) => void | Promise<void>;
};

export function CanvasImageMaskDialog({ price, dataUrl, open, loading = false, sourceError = "", onRetry, busy = false, error = "", onClose, onConfirm }: Props) {
  const [loadedSource, setLoadedSource] = useState("");
  const [loadError, setLoadError] = useState("");
  const ready = Boolean(dataUrl && loadedSource === dataUrl && !loading && !sourceError && !loadError);
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [brushSize, setBrushSize] = useState(64);
  const [prompt, setPrompt] = useState("");
  const [hasPaint, setHasPaint] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<CanvasMaskPoint | null>(null);

  useEffect(() => {
    if (!open || !dataUrl) return;
    let active = true;
    setLoadedSource("");
    setLoadError("");
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      setLoadedSource(dataUrl);
      setImageSize({ width: Math.max(1, image.naturalWidth || image.width), height: Math.max(1, image.naturalHeight || image.height) });
      setBrushSize(canvasMaskBrushSize(64, image.naturalWidth || image.width, image.naturalHeight || image.height));
      clearSelection(canvasRef.current);
      setHasPaint(false);
      setPrompt("");
    };
    image.onerror = () => { if (active) setLoadError("原图读取失败，请重试"); };
    image.src = dataUrl;
    return () => { active = false; };
  }, [dataUrl, open]);

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return canvasMaskPoint(event.clientX, event.clientY, rect, imageSize.width, imageSize.height);
  };

  const beginStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (busy || !ready || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    drawingRef.current = true;
    lastPointRef.current = point;
    drawSelectionStroke(event.currentTarget, point, point, brushSize);
    setHasPaint(true);
  };

  const continueStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const point = pointFromEvent(event);
    drawSelectionStroke(event.currentTarget, lastPointRef.current || point, point, brushSize);
    lastPointRef.current = point;
  };

  const finishStroke = () => {
    drawingRef.current = false;
    lastPointRef.current = null;
  };

  const reset = () => {
    clearSelection(canvasRef.current);
    setHasPaint(false);
  };

  const submit = async () => {
    const selection = canvasRef.current;
    if (!selection || !ready || !hasPaint || !prompt.trim()) return;
    await onConfirm({ maskDataUrl: buildEditMask(selection), prompt: prompt.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent className="canvas-image-mask-dialog canvas-tool-dialog">
        <DialogHeader>
          <DialogTitle>蒙版修改</DialogTitle>
          <DialogDescription>涂抹需要 AI 修改的区域，未涂抹区域会保持不变。</DialogDescription>
        </DialogHeader>
        {!ready ? <div role="status">{sourceError || loadError || "正在加载原图…"}{(sourceError || loadError) && onRetry ? <button type="button" onClick={onRetry}>重试加载原图</button> : null}</div> : <p className="text-xs text-muted-foreground">原图 {imageSize.width} × {imageSize.height}</p>}
        <div className="canvas-image-mask-layout" style={!ready ? { display: "none" } : undefined}>
          <div className="canvas-image-mask-stage" style={canvasMaskStageStyle(imageSize.width, imageSize.height)}>
            <img src={dataUrl} alt="蒙版修改原图" draggable={false} />
            <canvas
              ref={canvasRef}
              width={imageSize.width}
              height={imageSize.height}
              onPointerDown={beginStroke}
              onPointerMove={continueStroke}
              onPointerUp={finishStroke}
              onPointerCancel={finishStroke}
              onPointerLeave={finishStroke}
            />
          </div>
          <div className="canvas-image-mask-controls">
            <label>
              <span><Brush size={14} /> 画笔大小</span>
              <input
                type="range"
                min={Math.max(2, Math.round(Math.max(imageSize.width, imageSize.height) * 0.002))}
                max={Math.max(8, Math.round(Math.max(imageSize.width, imageSize.height) * 0.25))}
                value={brushSize}
                onChange={(event) => setBrushSize(canvasMaskBrushSize(Number(event.target.value), imageSize.width, imageSize.height))}
              />
              <b>{Math.round(brushSize)} px</b>
            </label>
            <button type="button" className="canvas-tool-clear" onClick={reset} disabled={busy || !hasPaint}><RotateCcw size={15} /> 清空蒙版</button>
            <label className="canvas-image-mask-prompt">
              <span>修改要求</span>
              <textarea value={prompt} maxLength={500} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：把选中区域改成红色雨伞" />
            </label>
            {error ? <p className="dialog-error">{error}</p> : null}
          </div>
        </div>
        <DialogFooter>
          {price}
          <button type="button" className="outline-button" onClick={onClose} disabled={busy}><X size={15} /> 取消</button>
          <button type="button" className="vermilion-button" onClick={() => void submit()} disabled={busy || !ready || !hasPaint || !prompt.trim()}><Check size={15} /> {busy ? "生成中…" : "生成局部修改"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function clearSelection(canvas: HTMLCanvasElement | null) {
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function drawSelectionStroke(canvas: HTMLCanvasElement, from: CanvasMaskPoint, to: CanvasMaskPoint, brushSize: number) {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.save();
  context.strokeStyle = "rgba(233,81,62,.62)";
  context.fillStyle = "rgba(233,81,62,.62)";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = brushSize;
  if (from.x === to.x && from.y === to.y) {
    context.beginPath();
    context.arc(to.x, to.y, brushSize / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }
  context.restore();
}

function buildEditMask(selection: HTMLCanvasElement) {
  const canvas = document.createElement("canvas");
  canvas.width = selection.width;
  canvas.height = selection.height;
  const context = canvas.getContext("2d");
  if (!context) return selection.toDataURL("image/png");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = "destination-out";
  context.drawImage(selection, 0, 0);
  context.globalCompositeOperation = "source-over";
  return canvas.toDataURL("image/png");
}
