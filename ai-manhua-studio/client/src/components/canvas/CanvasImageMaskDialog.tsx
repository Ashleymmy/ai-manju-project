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
import { canvasMaskBrushSize, canvasMaskPoint, type CanvasMaskPoint } from "@/lib/canvas-mask";

export type CanvasImageMaskPayload = {
  maskDataUrl: string;
  prompt: string;
};

type Props = {
  dataUrl: string;
  open: boolean;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (payload: CanvasImageMaskPayload) => void | Promise<void>;
};

export function CanvasImageMaskDialog({ dataUrl, open, busy = false, error = "", onClose, onConfirm }: Props) {
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [brushSize, setBrushSize] = useState(64);
  const [prompt, setPrompt] = useState("");
  const [hasPaint, setHasPaint] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<CanvasMaskPoint | null>(null);

  useEffect(() => {
    if (!open || !dataUrl) return;
    const image = new Image();
    image.onload = () => {
      setImageSize({ width: Math.max(1, image.naturalWidth || image.width), height: Math.max(1, image.naturalHeight || image.height) });
      setBrushSize(canvasMaskBrushSize(64, image.naturalWidth || image.width, image.naturalHeight || image.height));
      clearSelection(canvasRef.current);
      setHasPaint(false);
      setPrompt("");
    };
    image.src = dataUrl;
  }, [dataUrl, open]);

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return canvasMaskPoint(event.clientX, event.clientY, rect, imageSize.width, imageSize.height);
  };

  const beginStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (busy || event.button !== 0) return;
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
    if (!selection || !hasPaint || !prompt.trim()) return;
    await onConfirm({ maskDataUrl: buildEditMask(selection), prompt: prompt.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent className="canvas-image-mask-dialog">
        <DialogHeader>
          <DialogTitle>蒙版编辑</DialogTitle>
          <DialogDescription>涂抹需要 AI 修改的区域，未涂抹区域会保持不变。</DialogDescription>
        </DialogHeader>
        <div className="canvas-image-mask-layout">
          <div className="canvas-image-mask-stage" style={{ aspectRatio: `${imageSize.width} / ${imageSize.height}` }}>
            <img src={dataUrl} alt="蒙版编辑原图" draggable={false} />
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
            <button type="button" className="full-outline" onClick={reset} disabled={busy || !hasPaint}><RotateCcw size={14} /> 清空蒙版</button>
            <label className="canvas-image-mask-prompt">
              <span>修改要求</span>
              <textarea value={prompt} maxLength={500} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：把选中区域改成红色雨伞" />
            </label>
            {error ? <p className="dialog-error">{error}</p> : null}
          </div>
        </div>
        <DialogFooter>
          <button type="button" className="outline-button" onClick={onClose} disabled={busy}><X size={15} /> 取消</button>
          <button type="button" className="primary-button" onClick={() => void submit()} disabled={busy || !hasPaint || !prompt.trim()}><Check size={15} /> {busy ? "生成中…" : "生成局部修改"}</button>
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
