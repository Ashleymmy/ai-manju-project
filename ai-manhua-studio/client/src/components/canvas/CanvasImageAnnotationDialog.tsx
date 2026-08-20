import {
  ArrowUpRight,
  Brush,
  Check,
  Circle,
  MousePointer2,
  Redo2,
  RotateCcw,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CANVAS_ANNOTATION_COLORS,
  canvasAnnotationBounds,
  cloneCanvasAnnotations,
  exportCanvasAnnotations,
  isMeaningfulCanvasAnnotation,
  translateCanvasAnnotation,
  type CanvasAnnotationPoint,
  type CanvasAnnotationTool,
  type CanvasImageAnnotation,
  type CanvasTextAnnotation,
} from "@/lib/canvas-annotation";

export type CanvasImageAnnotationPayload = {
  dataUrl: string;
};

type Props = {
  dataUrl: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: CanvasImageAnnotationPayload) => void | Promise<void>;
};

type DrawState = {
  id: string;
  tool: Exclude<CanvasAnnotationTool, "select" | "text">;
  start: CanvasAnnotationPoint;
  points: CanvasAnnotationPoint[];
};

type MoveState = {
  id: string;
  start: CanvasAnnotationPoint;
  originalMarks: CanvasImageAnnotation[];
  moved: boolean;
};

const HISTORY_LIMIT = 50;
const toolOptions: Array<{ id: CanvasAnnotationTool; label: string; icon: typeof MousePointer2 }> = [
  { id: "select", label: "选择", icon: MousePointer2 },
  { id: "rect", label: "矩形", icon: Square },
  { id: "ellipse", label: "圆形", icon: Circle },
  { id: "arrow", label: "箭头", icon: ArrowUpRight },
  { id: "brush", label: "画笔", icon: Brush },
  { id: "text", label: "文字", icon: Type },
];

export function CanvasImageAnnotationDialog({ dataUrl, open, onClose, onConfirm }: Props) {
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [tool, setTool] = useState<CanvasAnnotationTool>("rect");
  const [color, setColor] = useState(CANVAS_ANNOTATION_COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(8);
  const [textDraft, setTextDraft] = useState("标注");
  const [marks, setMarks] = useState<CanvasImageAnnotation[]>([]);
  const [draftMark, setDraftMark] = useState<CanvasImageAnnotation | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [undoStack, setUndoStack] = useState<CanvasImageAnnotation[][]>([]);
  const [redoStack, setRedoStack] = useState<CanvasImageAnnotation[][]>([]);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const stageRef = useRef<SVGSVGElement>(null);
  const marksRef = useRef<CanvasImageAnnotation[]>([]);
  const draftMarkRef = useRef<CanvasImageAnnotation | null>(null);
  const drawRef = useRef<DrawState | null>(null);
  const moveRef = useRef<MoveState | null>(null);
  marksRef.current = marks;

  const selectedMark = useMemo(() => marks.find((mark) => mark.id === selectedId) || null, [marks, selectedId]);
  const selectedText = selectedMark?.type === "text" ? selectedMark : null;

  useEffect(() => {
    if (!open || !dataUrl) return;
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      setImageSize({ width: Math.max(1, image.naturalWidth || image.width), height: Math.max(1, image.naturalHeight || image.height) });
      marksRef.current = [];
      draftMarkRef.current = null;
      setMarks([]);
      setDraftMark(null);
      setSelectedId("");
      setUndoStack([]);
      setRedoStack([]);
      setTool("rect");
      setTextDraft("标注");
      setError("");
    };
    image.onerror = () => active && setError("标注原图读取失败");
    image.src = dataUrl;
    return () => {
      active = false;
      drawRef.current = null;
      moveRef.current = null;
    };
  }, [dataUrl, open]);

  const commitMarks = (next: CanvasImageAnnotation[]) => {
    setUndoStack((stack) => [...stack, cloneCanvasAnnotations(marksRef.current)].slice(-HISTORY_LIMIT));
    setRedoStack([]);
    const cloned = cloneCanvasAnnotations(next);
    marksRef.current = cloned;
    setMarks(cloned);
  };

  const undo = () => {
    setUndoStack((stack) => {
      const previous = stack.at(-1);
      if (!previous) return stack;
      setRedoStack((items) => [cloneCanvasAnnotations(marksRef.current), ...items].slice(0, HISTORY_LIMIT));
      const restored = cloneCanvasAnnotations(previous);
      marksRef.current = restored;
      setMarks(restored);
      setSelectedId("");
      return stack.slice(0, -1);
    });
  };

  const redo = () => {
    setRedoStack((stack) => {
      const next = stack[0];
      if (!next) return stack;
      setUndoStack((items) => [...items, cloneCanvasAnnotations(marksRef.current)].slice(-HISTORY_LIMIT));
      const restored = cloneCanvasAnnotations(next);
      marksRef.current = restored;
      setMarks(restored);
      setSelectedId("");
      return stack.slice(1);
    });
  };

  const pointFromEvent = (event: ReactPointerEvent<SVGElement>): CanvasAnnotationPoint => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    return {
      x: Math.min(imageSize.width, Math.max(0, (event.clientX - rect.left) / rect.width * imageSize.width)),
      y: Math.min(imageSize.height, Math.max(0, (event.clientY - rect.top) / rect.height * imageSize.height)),
    };
  };

  const beginDraw = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (applying || event.button !== 0) return;
    if (tool === "select") {
      setSelectedId("");
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    if (tool === "text") {
      const text = textDraft.trim();
      if (!text) return;
      const mark: CanvasTextAnnotation = {
        id: crypto.randomUUID(),
        type: "text",
        color,
        strokeWidth,
        x: point.x,
        y: point.y,
        text,
        fontSize: Math.max(14, strokeWidth * 4),
      };
      commitMarks([...marksRef.current, mark]);
      setSelectedId(mark.id);
      setTool("select");
      return;
    }
    const id = crypto.randomUUID();
    drawRef.current = { id, tool, start: point, points: [point] };
    setSelectedId("");
    const draft = draftForPointer(id, tool, point, point, [point], color, strokeWidth);
    draftMarkRef.current = draft;
    setDraftMark(draft);
  };

  const continuePointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = pointFromEvent(event);
    const moving = moveRef.current;
    if (moving) {
      const dx = point.x - moving.start.x;
      const dy = point.y - moving.start.y;
      const next = moving.originalMarks.map((mark) => mark.id === moving.id ? translateCanvasAnnotation(mark, dx, dy, imageSize) : mark);
      moving.moved = moving.moved || Math.hypot(dx, dy) >= 1;
      marksRef.current = next;
      setMarks(next);
      return;
    }
    const drawing = drawRef.current;
    if (!drawing) return;
    if (drawing.tool === "brush") drawing.points.push(point);
    const draft = draftForPointer(drawing.id, drawing.tool, drawing.start, point, drawing.points, color, strokeWidth);
    draftMarkRef.current = draft;
    setDraftMark(draft);
  };

  const finishPointer = () => {
    const moving = moveRef.current;
    if (moving) {
      moveRef.current = null;
      if (moving.moved) {
        setUndoStack((stack) => [...stack, cloneCanvasAnnotations(moving.originalMarks)].slice(-HISTORY_LIMIT));
        setRedoStack([]);
      }
      return;
    }
    drawRef.current = null;
    const finishedDraft = draftMarkRef.current;
    if (finishedDraft && isMeaningfulCanvasAnnotation(finishedDraft)) {
      commitMarks([...marksRef.current, finishedDraft]);
      setSelectedId(finishedDraft.id);
    }
    draftMarkRef.current = null;
    setDraftMark(null);
  };

  const beginMove = (event: ReactPointerEvent<SVGElement>, mark: CanvasImageAnnotation) => {
    event.stopPropagation();
    setSelectedId(mark.id);
    if (tool !== "select" || applying || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    moveRef.current = {
      id: mark.id,
      start: pointFromEvent(event),
      originalMarks: cloneCanvasAnnotations(marksRef.current),
      moved: false,
    };
  };

  const updateSelected = (patch: Partial<CanvasImageAnnotation>) => {
    if (!selectedId) return;
    commitMarks(marksRef.current.map((mark) => mark.id === selectedId ? { ...mark, ...patch } as CanvasImageAnnotation : mark));
  };

  const removeSelected = () => {
    if (!selectedId) return;
    commitMarks(marksRef.current.filter((mark) => mark.id !== selectedId));
    setSelectedId("");
  };

  const clear = () => {
    if (!marksRef.current.length) return;
    commitMarks([]);
    setSelectedId("");
  };

  const submit = async () => {
    if (!marksRef.current.length || applying) return;
    setApplying(true);
    setError("");
    try {
      const annotated = await exportCanvasAnnotations(dataUrl, marksRef.current);
      await onConfirm({ dataUrl: annotated });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "标注图片合成失败");
    } finally {
      setApplying(false);
    }
  };

  const displayedMarks = draftMark ? [...marks, draftMark] : marks;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !applying) onClose(); }}>
      <DialogContent className="canvas-annotation-dialog" showCloseButton={!applying}>
        <DialogHeader>
          <DialogTitle>图片标注</DialogTitle>
          <DialogDescription>在原图上添加矩形、圆形、箭头、画笔和文字，结果会保存为新的图片节点。</DialogDescription>
        </DialogHeader>
        <div className="canvas-annotation-layout">
          <div className="canvas-annotation-workspace">
            <div className="canvas-annotation-toolbar" role="toolbar" aria-label="标注工具">
              {toolOptions.map((option) => {
                const Icon = option.icon;
                return <button key={option.id} type="button" className={tool === option.id ? "active" : ""} title={option.label} aria-label={option.label} onClick={() => setTool(option.id)} disabled={applying}><Icon size={16} /></button>;
              })}
              <span className="canvas-annotation-toolbar-separator" />
              <button type="button" title="撤销" aria-label="撤销" onClick={undo} disabled={applying || !undoStack.length}><Undo2 size={16} /></button>
              <button type="button" title="重做" aria-label="重做" onClick={redo} disabled={applying || !redoStack.length}><Redo2 size={16} /></button>
              <button type="button" title="删除所选标注" aria-label="删除所选标注" onClick={removeSelected} disabled={applying || !selectedId}><Trash2 size={16} /></button>
            </div>
            <div className="canvas-annotation-stage" style={{ aspectRatio: `${imageSize.width} / ${imageSize.height}` }}>
              <svg
                ref={stageRef}
                viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                onPointerDown={beginDraw}
                onPointerMove={continuePointer}
                onPointerUp={finishPointer}
                onPointerCancel={finishPointer}
              >
                <image href={dataUrl} x={0} y={0} width={imageSize.width} height={imageSize.height} preserveAspectRatio="none" />
                <defs>
                  <filter id="annotation-selection-glow"><feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#ffffff" floodOpacity="0.8" /></filter>
                </defs>
                {displayedMarks.map((mark) => <AnnotationMark key={mark.id} mark={mark} selected={mark.id === selectedId} onPointerDown={beginMove} />)}
              </svg>
            </div>
          </div>
          <div className="canvas-annotation-controls">
            <section>
              <h4>颜色</h4>
              <div className="canvas-annotation-colors">
                {CANVAS_ANNOTATION_COLORS.map((value) => <button key={value} type="button" className={color === value ? "active" : ""} style={{ background: value }} title={value} aria-label={`选择颜色 ${value}`} onClick={() => { setColor(value); if (selectedMark) updateSelected({ color: value }); }} disabled={applying} />)}
                <input type="color" value={color} aria-label="自定义颜色" onChange={(event) => { setColor(event.target.value); if (selectedMark) updateSelected({ color: event.target.value }); }} disabled={applying} />
              </div>
            </section>
            <label>
              <span>线宽</span>
              <input type="range" min={2} max={40} value={strokeWidth} onChange={(event) => { const value = Number(event.target.value); setStrokeWidth(value); if (selectedMark) updateSelected({ strokeWidth: value }); }} disabled={applying} />
              <b>{strokeWidth} px</b>
            </label>
            <label>
              <span>文字内容</span>
              <input value={textDraft} maxLength={80} onChange={(event) => setTextDraft(event.target.value)} disabled={applying} />
            </label>
            {selectedText ? <label>
              <span>编辑所选文字</span>
              <input value={selectedText.text} maxLength={80} onChange={(event) => updateSelected({ text: event.target.value })} disabled={applying} />
            </label> : null}
            <button type="button" className="full-outline" onClick={clear} disabled={applying || !marks.length}><RotateCcw size={15} /> 清空全部标注</button>
            <p className="canvas-annotation-hint">选择工具后在图片上拖动；切回选择工具可移动已有标注。</p>
            {error ? <p className="dialog-error">{error}</p> : null}
          </div>
        </div>
        <DialogFooter>
          <button type="button" className="outline-button" onClick={onClose} disabled={applying}><X size={15} /> 取消</button>
          <button type="button" className="primary-button" onClick={() => void submit()} disabled={applying || !marks.length}><Check size={15} /> {applying ? "合成中…" : "保存标注图片"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function draftForPointer(
  id: string,
  tool: DrawState["tool"],
  start: CanvasAnnotationPoint,
  end: CanvasAnnotationPoint,
  points: CanvasAnnotationPoint[],
  color: string,
  strokeWidth: number,
): CanvasImageAnnotation {
  if (tool === "brush") return { id, type: "brush", color, strokeWidth, points: points.map((point) => ({ ...point })) };
  return { id, type: tool, color, strokeWidth, start: { ...start }, end: { ...end } };
}

function AnnotationMark({
  mark,
  selected,
  onPointerDown,
}: {
  mark: CanvasImageAnnotation;
  selected: boolean;
  onPointerDown: (event: ReactPointerEvent<SVGElement>, mark: CanvasImageAnnotation) => void;
}) {
  const common = {
    stroke: mark.color,
    strokeWidth: mark.strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    filter: selected ? "url(#annotation-selection-glow)" : undefined,
    onPointerDown: (event: ReactPointerEvent<SVGElement>) => onPointerDown(event, mark),
  };
  let content;
  if (mark.type === "rect") {
    content = <rect {...common} x={Math.min(mark.start.x, mark.end.x)} y={Math.min(mark.start.y, mark.end.y)} width={Math.abs(mark.end.x - mark.start.x)} height={Math.abs(mark.end.y - mark.start.y)} fill="transparent" pointerEvents="all" />;
  } else if (mark.type === "ellipse") {
    content = <ellipse {...common} cx={(mark.start.x + mark.end.x) / 2} cy={(mark.start.y + mark.end.y) / 2} rx={Math.abs(mark.end.x - mark.start.x) / 2} ry={Math.abs(mark.end.y - mark.start.y) / 2} fill="transparent" pointerEvents="all" />;
  } else if (mark.type === "arrow") {
    const head = arrowHead(mark.start, mark.end, mark.strokeWidth);
    content = <g {...common} fill={mark.color} pointerEvents="all"><line x1={mark.start.x} y1={mark.start.y} x2={mark.end.x} y2={mark.end.y} /><polygon points={head} stroke="none" /></g>;
  } else if (mark.type === "brush") {
    content = <polyline {...common} points={mark.points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" pointerEvents="stroke" />;
  } else if (mark.type === "text") {
    content = <text {...common} x={mark.x} y={mark.y} fill={mark.color} stroke="none" fontSize={mark.fontSize} fontWeight={600} pointerEvents="all">{mark.text}</text>;
  }
  if (!selected) return content;
  const bounds = canvasAnnotationBounds(mark);
  return <g>{content}<rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill="none" stroke="#ffffff" strokeWidth={1.5} strokeDasharray="7 5" pointerEvents="none" /></g>;
}

function arrowHead(start: CanvasAnnotationPoint, end: CanvasAnnotationPoint, strokeWidth: number) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const size = Math.max(12, strokeWidth * 3.2);
  const left = { x: end.x - size * Math.cos(angle - Math.PI / 6), y: end.y - size * Math.sin(angle - Math.PI / 6) };
  const right = { x: end.x - size * Math.cos(angle + Math.PI / 6), y: end.y - size * Math.sin(angle + Math.PI / 6) };
  return `${end.x},${end.y} ${left.x},${left.y} ${right.x},${right.y}`;
}
