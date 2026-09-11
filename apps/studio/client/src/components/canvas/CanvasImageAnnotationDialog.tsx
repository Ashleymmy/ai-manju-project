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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

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
  CANVAS_ANNOTATION_DEFAULT_COLOR,
  CANVAS_ANNOTATION_TEXT_MAX_LENGTH,
  canvasAnnotationBounds,
  canvasAnnotationFontSize,
  canvasAnnotationTextOriginFromDrag,
  canvasAnnotationTextSelectionBounds,
  shouldKeepCanvasTextEditor,
  canvasArrowGeometry,
  canvasArrowOutlinePath,
  canvasTextEditorOverlay,
  type CanvasAnnotationBounds,
  isCanvasAnnotationNativeUndoTarget,
  isCanvasAnnotationUndoShortcut,
  cloneCanvasAnnotations,
  isMeaningfulCanvasAnnotation,
  translateCanvasAnnotation,
  type CanvasAnnotationPoint,
  type CanvasAnnotationTool,
  type CanvasImageAnnotation,
  type CanvasTextAnnotation,
} from "@/features/canvas/domain/annotation";
import { exportCanvasAnnotations } from "@/features/canvas/adapters/annotationImage";
import "@/shared/styles/annotation-dialog.css";

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
  tool: Exclude<CanvasAnnotationTool, "select">;
  start: CanvasAnnotationPoint;
  end: CanvasAnnotationPoint;
  points: CanvasAnnotationPoint[];
};

type MoveState = {
  id: string;
  start: CanvasAnnotationPoint;
  originalMarks: CanvasImageAnnotation[];
  moved: boolean;
};

type TextEditorSession = {
  mode: "create" | "edit";
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
  strokeWidth: number;
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
  const [color, setColor] = useState(CANVAS_ANNOTATION_DEFAULT_COLOR);
  const [strokeWidth, setStrokeWidth] = useState(8);
  const [marks, setMarks] = useState<CanvasImageAnnotation[]>([]);
  const [draftMark, setDraftMark] = useState<CanvasImageAnnotation | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [textEditor, setTextEditor] = useState<TextEditorSession | null>(null);
  const [stageSize, setStageSize] = useState({ width: 1, height: 1 });
  const [undoStack, setUndoStack] = useState<CanvasImageAnnotation[][]>([]);
  const [redoStack, setRedoStack] = useState<CanvasImageAnnotation[][]>([]);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const stageWrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<SVGSVGElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const marksRef = useRef<CanvasImageAnnotation[]>([]);
  const draftMarkRef = useRef<CanvasImageAnnotation | null>(null);
  const drawRef = useRef<DrawState | null>(null);
  const moveRef = useRef<MoveState | null>(null);
  const textEditorRef = useRef<TextEditorSession | null>(null);
  const undoStackRef = useRef<CanvasImageAnnotation[][]>([]);
  const redoStackRef = useRef<CanvasImageAnnotation[][]>([]);
  const styleBaselineRef = useRef<CanvasImageAnnotation[] | null>(null);
  const skipTextBlurRef = useRef(false);
  marksRef.current = marks;
  textEditorRef.current = textEditor;

  const selectedMark = useMemo(() => marks.find((mark) => mark.id === selectedId) || null, [marks, selectedId]);

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
      undoStackRef.current = [];
      redoStackRef.current = [];
      styleBaselineRef.current = null;
      setTool("rect");
      setColor(CANVAS_ANNOTATION_DEFAULT_COLOR);
      setTextEditor(null);
      textEditorRef.current = null;
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

  const flushStyleBaseline = () => {
    const baseline = styleBaselineRef.current;
    if (!baseline) return;
    styleBaselineRef.current = null;
    undoStackRef.current = [...undoStackRef.current, cloneCanvasAnnotations(baseline)].slice(-HISTORY_LIMIT);
    redoStackRef.current = [];
    setUndoStack(undoStackRef.current);
    setRedoStack([]);
  };

  const pushHistory = (previous: CanvasImageAnnotation[]) => {
    flushStyleBaseline();
    undoStackRef.current = [...undoStackRef.current, cloneCanvasAnnotations(previous)].slice(-HISTORY_LIMIT);
    redoStackRef.current = [];
    setUndoStack(undoStackRef.current);
    setRedoStack([]);
  };

  const commitMarks = (next: CanvasImageAnnotation[]) => {
    pushHistory(marksRef.current);
    const cloned = cloneCanvasAnnotations(next);
    marksRef.current = cloned;
    setMarks(cloned);
  };

  const cancelTextEditor = useCallback(() => {
    skipTextBlurRef.current = true;
    textEditorRef.current = null;
    setTextEditor(null);
    queueMicrotask(() => { skipTextBlurRef.current = false; });
  }, []);

  const commitTextEditor = useCallback(() => {
    const session = textEditorRef.current;
    if (!session) return;
    const text = (textInputRef.current?.value ?? session.text).slice(0, CANVAS_ANNOTATION_TEXT_MAX_LENGTH);
    skipTextBlurRef.current = true;
    textEditorRef.current = null;
    setTextEditor(null);
    queueMicrotask(() => { skipTextBlurRef.current = false; });
    const trimmed = text.trim();
    if (session.mode === "create") {
      if (!trimmed) return;
      const mark: CanvasTextAnnotation = {
        id: session.id,
        type: "text",
        color: session.color,
        strokeWidth: session.strokeWidth,
        x: session.x,
        y: session.y,
        text: trimmed,
        fontSize: session.fontSize,
      };
      commitMarks([...marksRef.current, mark]);
      setSelectedId(mark.id);
      return;
    }
    const current = marksRef.current.find((mark) => mark.id === session.id);
    if (!trimmed) {
      commitMarks(marksRef.current.filter((mark) => mark.id !== session.id));
      setSelectedId("");
      return;
    }
    if (current?.type === "text" && current.text === trimmed && current.color === session.color && current.fontSize === session.fontSize) return;
    commitMarks(marksRef.current.map((mark) => mark.id === session.id
      ? { ...mark, text: trimmed, color: session.color, strokeWidth: session.strokeWidth, fontSize: session.fontSize } as CanvasImageAnnotation
      : mark));
    setSelectedId(session.id);
  }, []);

  const openTextEditor = useCallback((session: TextEditorSession) => {
    moveRef.current = null;
    skipTextBlurRef.current = false;
    textEditorRef.current = session;
    setTextEditor(session);
    setSelectedId(session.mode === "edit" ? session.id : "");
  }, []);

  const undo = useCallback(() => {
    if (drawRef.current || draftMarkRef.current) {
      drawRef.current = null;
      draftMarkRef.current = null;
      setDraftMark(null);
      return;
    }
    if (textEditorRef.current) {
      cancelTextEditor();
      return;
    }
    const styleBaseline = styleBaselineRef.current;
    if (styleBaseline) {
      styleBaselineRef.current = null;
      const restoredStyle = cloneCanvasAnnotations(styleBaseline);
      marksRef.current = restoredStyle;
      setMarks(restoredStyle);
      return;
    }
    const previous = undoStackRef.current.at(-1);
    if (!previous) return;
    redoStackRef.current = [cloneCanvasAnnotations(marksRef.current), ...redoStackRef.current].slice(0, HISTORY_LIMIT);
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    const restored = cloneCanvasAnnotations(previous);
    marksRef.current = restored;
    setUndoStack(undoStackRef.current);
    setRedoStack(redoStackRef.current);
    setMarks(restored);
    setSelectedId("");
  }, [cancelTextEditor]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isCanvasAnnotationUndoShortcut(event)) return;
      if (isCanvasAnnotationNativeUndoTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (!applying) undo();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [applying, open, undo]);

  useEffect(() => {
    if (!open) return;
    const node = stageWrapRef.current;
    if (!node) return;
    const sync = () => {
      const rect = node.getBoundingClientRect();
      setStageSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, imageSize.width, imageSize.height]);

  useLayoutEffect(() => {
    if (!textEditor) return;
    const input = textInputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    const caret = input.value.length;
    input.setSelectionRange(caret, caret);
    const pinCaret = () => {
      if (textInputRef.current !== input) return;
      input.setSelectionRange(caret, caret);
    };
    const frame = requestAnimationFrame(pinCaret);
    return () => cancelAnimationFrame(frame);
  }, [textEditor?.id, textEditor?.mode]);

  const redo = () => {
    if (drawRef.current || draftMarkRef.current) {
      drawRef.current = null;
      draftMarkRef.current = null;
      setDraftMark(null);
      return;
    }
    if (textEditorRef.current) {
      cancelTextEditor();
      return;
    }
    flushStyleBaseline();
    const next = redoStackRef.current[0];
    if (!next) return;
    undoStackRef.current = [...undoStackRef.current, cloneCanvasAnnotations(marksRef.current)].slice(-HISTORY_LIMIT);
    redoStackRef.current = redoStackRef.current.slice(1);
    const restored = cloneCanvasAnnotations(next);
    marksRef.current = restored;
    setUndoStack(undoStackRef.current);
    setRedoStack(redoStackRef.current);
    setMarks(restored);
    setSelectedId("");
  };

  const pointFromClient = (clientX: number, clientY: number): CanvasAnnotationPoint => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    return {
      x: Math.min(imageSize.width, Math.max(0, (clientX - rect.left) / rect.width * imageSize.width)),
      y: Math.min(imageSize.height, Math.max(0, (clientY - rect.top) / rect.height * imageSize.height)),
    };
  };

  const pointFromEvent = (event: ReactPointerEvent<SVGElement>): CanvasAnnotationPoint => {
    return pointFromClient(event.clientX, event.clientY);
  };

  const beginDraw = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (applying || event.button !== 0) return;
    // 双击第二下不再开新草稿，交给 onDoubleClick 进入文字输入。
    if (event.detail >= 2) return;
    if (tool === "select") {
      if (textEditorRef.current) commitTextEditor();
      setSelectedId("");
      return;
    }
    if (textEditorRef.current) commitTextEditor();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 指针已释放或非真实指针 */ }
    const point = pointFromEvent(event);
    const id = crypto.randomUUID();
    drawRef.current = { id, tool, start: point, end: point, points: [point] };
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
    drawing.end = point;
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
        pushHistory(moving.originalMarks);
      }
      return;
    }
    const drawing = drawRef.current;
    drawRef.current = null;
    const finishedDraft = draftMarkRef.current;
    draftMarkRef.current = null;
    setDraftMark(null);
    if (drawing?.tool === "text" && !applying) {
      const fontSize = canvasAnnotationFontSize(strokeWidth);
      const origin = canvasAnnotationTextOriginFromDrag(drawing.start, drawing.end, fontSize);
      openTextEditor({
        mode: "create",
        id: drawing.id,
        x: origin.x,
        y: origin.y,
        text: "",
        color,
        fontSize,
        strokeWidth,
      });
      return;
    }
    if (finishedDraft && isMeaningfulCanvasAnnotation(finishedDraft)) {
      commitMarks([...marksRef.current, finishedDraft]);
      setSelectedId(finishedDraft.id);
    }
  };

  const beginMove = (event: ReactPointerEvent<SVGElement>, mark: CanvasImageAnnotation) => {
    event.stopPropagation();
    if (textEditorRef.current) commitTextEditor();
    setSelectedId(mark.id);
    if (applying || event.button !== 0) return;
    if (tool !== "select") return;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 指针已释放或非真实指针 */ }
    moveRef.current = {
      id: mark.id,
      start: pointFromEvent(event),
      originalMarks: cloneCanvasAnnotations(marksRef.current),
      moved: false,
    };
  };

  const beginEditText = (event: ReactPointerEvent<SVGElement> | ReactMouseEvent<SVGElement>, mark: CanvasImageAnnotation) => {
    if (applying || mark.type !== "text") return;
    event.stopPropagation();
    event.preventDefault();
    openTextEditor({
      mode: "edit",
      id: mark.id,
      x: mark.x,
      y: mark.y,
      text: mark.text,
      color: mark.color,
      fontSize: mark.fontSize,
      strokeWidth: mark.strokeWidth,
    });
  };

  const applyStyle = (nextColor: string, nextStrokeWidth: number, coalesce = false) => {
    setColor(nextColor);
    setStrokeWidth(nextStrokeWidth);
    const fontSize = canvasAnnotationFontSize(nextStrokeWidth);
    const session = textEditorRef.current;
    if (session) {
      const next = { ...session, color: nextColor, strokeWidth: nextStrokeWidth, fontSize };
      textEditorRef.current = next;
      setTextEditor(next);
      return;
    }
    if (tool !== "select" || !selectedMark) return;
    const patch = selectedMark.type === "text"
      ? { color: nextColor, strokeWidth: nextStrokeWidth, fontSize }
      : { color: nextColor, strokeWidth: nextStrokeWidth };
    if (!coalesce) {
      updateSelected(patch);
      return;
    }
    if (!styleBaselineRef.current) styleBaselineRef.current = cloneCanvasAnnotations(marksRef.current);
    const next = marksRef.current.map((mark) => mark.id === selectedId ? { ...mark, ...patch } as CanvasImageAnnotation : mark);
    marksRef.current = next;
    setMarks(next);
  };

  const updateSelected = (patch: Partial<CanvasImageAnnotation>) => {
    if (!selectedId) return;
    commitMarks(marksRef.current.map((mark) => mark.id === selectedId ? { ...mark, ...patch } as CanvasImageAnnotation : mark));
  };

  const chooseTool = (next: CanvasAnnotationTool) => {
    if (textEditorRef.current) commitTextEditor();
    flushStyleBaseline();
    setTool(next);
  };

  const beginTextByDoubleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (applying) return;
    event.preventDefault();
    const point = pointFromClient(event.clientX, event.clientY);
    drawRef.current = null;
    draftMarkRef.current = null;
    setDraftMark(null);
    if (shouldKeepCanvasTextEditor(textEditorRef.current, point)) {
      setTool("text");
      return;
    }
    chooseTool("text");
    const fontSize = canvasAnnotationFontSize(strokeWidth);
    openTextEditor({
      mode: "create",
      id: crypto.randomUUID(),
      x: point.x,
      y: point.y,
      text: "",
      color,
      fontSize,
      strokeWidth,
    });
  };

  const removeSelected = () => {
    if (textEditorRef.current) {
      const session = textEditorRef.current;
      cancelTextEditor();
      if (session.mode === "edit") {
        commitMarks(marksRef.current.filter((mark) => mark.id !== session.id));
        setSelectedId("");
      }
      return;
    }
    if (!selectedId) return;
    commitMarks(marksRef.current.filter((mark) => mark.id !== selectedId));
    setSelectedId("");
  };

  const clear = () => {
    if (textEditorRef.current) cancelTextEditor();
    if (!marksRef.current.length) return;
    commitMarks([]);
    setSelectedId("");
  };

  const submit = async () => {
    if (textEditorRef.current) commitTextEditor();
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

  const displayedMarks = (draftMark && tool !== "text" ? [...marks, draftMark] : marks).filter((mark) => !(textEditor?.mode === "edit" && mark.id === textEditor.id));
  const textOverlay = textEditor ? canvasTextEditorOverlay(textEditor, imageSize, stageSize) : null;
  const canSave = Boolean(marks.length || textEditor?.text.trim());
  const textGuide = tool === "text" && draftMark?.type === "rect" ? draftMark : null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !applying) { cancelTextEditor(); onClose(); } }}>
      <DialogContent className="canvas-annotation-dialog canvas-tool-dialog" showCloseButton={!applying}>
        <DialogHeader>
          <DialogTitle>图片标注</DialogTitle>
          <DialogDescription>在原图上添加矩形、圆形、箭头、画笔和文字，结果会保存为新的图片节点。</DialogDescription>
        </DialogHeader>
        <div className="canvas-annotation-layout">
          <div className="canvas-annotation-workspace">
            <div className="canvas-annotation-toolbar" role="toolbar" aria-label="标注工具">
              {toolOptions.map((option) => {
                const Icon = option.icon;
                const title = option.id === "text" ? "文字（双击图片也可输入）" : option.label;
                return <button key={option.id} type="button" className={tool === option.id ? "active" : ""} title={title} aria-label={option.label} onClick={() => chooseTool(option.id)} disabled={applying}><Icon size={16} /></button>;
              })}
              <span className="canvas-annotation-toolbar-separator" />
              <button type="button" title="撤销 (Ctrl+Z)" aria-label="撤销" aria-keyshortcuts="Control+Z" onClick={undo} disabled={applying || (!undoStack.length && !textEditor && !draftMark)}><Undo2 size={16} /></button>
              <button type="button" title="重做" aria-label="重做" onClick={redo} disabled={applying || !redoStack.length}><Redo2 size={16} /></button>
              <button type="button" title="删除所选标注" aria-label="删除所选标注" onClick={removeSelected} disabled={applying || (!selectedId && textEditor?.mode !== "edit")}><Trash2 size={16} /></button>
            </div>
            <div
              ref={stageWrapRef}
              className="canvas-annotation-stage"
              data-tool={tool}
              data-editing={textEditor ? "true" : "false"}
              style={{ aspectRatio: `${imageSize.width} / ${imageSize.height}` }}
            >
              <svg
                ref={stageRef}
                viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                onPointerDown={beginDraw}
                onPointerMove={continuePointer}
                onPointerUp={finishPointer}
                onPointerCancel={finishPointer}
                onLostPointerCapture={finishPointer}
                onDoubleClick={beginTextByDoubleClick}
              >
                <image href={dataUrl} x={0} y={0} width={imageSize.width} height={imageSize.height} preserveAspectRatio="none" />
                <defs>
                  <filter id="annotation-selection-glow"><feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#ffffff" floodOpacity="0.8" /></filter>
                </defs>
                {displayedMarks.map((mark) => (
                  <AnnotationMark
                    key={mark.id}
                    mark={mark}
                    selected={mark.id === selectedId && !textEditor}
                    movable={tool === "select"}
                    onPointerDown={beginMove}
                    onDoubleClick={beginEditText}
                  />
                ))}
                {textGuide ? (
                  <rect
                    x={Math.min(textGuide.start.x, textGuide.end.x)}
                    y={Math.min(textGuide.start.y, textGuide.end.y)}
                    width={Math.abs(textGuide.end.x - textGuide.start.x)}
                    height={Math.abs(textGuide.end.y - textGuide.start.y)}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={1.5}
                    strokeDasharray="7 5"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                ) : null}
              </svg>
              {textEditor && textOverlay ? (
                <div
                  className="canvas-annotation-text-editor"
                  style={{
                    left: textOverlay.left,
                    top: textOverlay.top,
                    fontSize: textOverlay.fontSize,
                    color: textEditor.color,
                    caretColor: textEditor.color,
                  }}
                >
                  <span className="canvas-annotation-text-sizer" aria-hidden>{textEditor.text || "\u200b"}</span>
                  <input
                    ref={textInputRef}
                    value={textEditor.text}
                    size={1}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={CANVAS_ANNOTATION_TEXT_MAX_LENGTH}
                    aria-label="标注文字"
                    disabled={applying}
                    onChange={(event) => {
                      const next = { ...textEditor, text: event.target.value.slice(0, CANVAS_ANNOTATION_TEXT_MAX_LENGTH) };
                      textEditorRef.current = next;
                      setTextEditor(next);
                    }}
                    onBlur={(event) => {
                      if (skipTextBlurRef.current || !event.currentTarget.isConnected) return;
                      commitTextEditor();
                    }}
                    onKeyDown={(event) => {
                      if (isCanvasAnnotationUndoShortcut(event.nativeEvent)) {
                        event.stopPropagation();
                      }
                      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitTextEditor();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelTextEditor();
                      }
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  />
                </div>
              ) : null}
            </div>
          </div>
          <div className="canvas-annotation-controls">
            <section>
              <h4>颜色</h4>
              <div className="canvas-annotation-colors">
                {CANVAS_ANNOTATION_COLORS.map((value) => <button key={value} type="button" className={color === value ? "active" : ""} style={{ background: value }} title={value} aria-label={`选择颜色 ${value}`} onClick={() => applyStyle(value, strokeWidth)} disabled={applying} />)}
                <input type="color" value={color} aria-label="自定义颜色" onChange={(event) => applyStyle(event.target.value, strokeWidth)} disabled={applying} />
              </div>
            </section>
            <label>
              <span>{tool === "text" || selectedMark?.type === "text" || textEditor ? "字号" : "线宽"}</span>
              <input
                type="range"
                min={2}
                max={40}
                value={strokeWidth}
                onChange={(event) => applyStyle(color, Number(event.target.value), true)}
                onPointerUp={flushStyleBaseline}
                onPointerCancel={flushStyleBaseline}
                onBlur={flushStyleBaseline}
                disabled={applying}
              />
              <b>{tool === "text" || selectedMark?.type === "text" || textEditor ? `${canvasAnnotationFontSize(strokeWidth)} px` : `${strokeWidth} px`}</b>
            </label>
            <div className="canvas-annotation-sidebar-foot">
              <p className="canvas-annotation-hint">选择工具后在图片上拖动绘制；切回选择工具可移动已有标注并改颜色/线宽。双击图片可直接输入文字，双击文字可再编辑。</p>
              <button type="button" className="canvas-annotation-clear" onClick={clear} disabled={applying || (!marks.length && !textEditor)}><RotateCcw size={15} /> 清空全部标注</button>
              {error ? <p className="dialog-error">{error}</p> : null}
            </div>
          </div>
        </div>
        <DialogFooter className="canvas-annotation-footer">
          <button type="button" className="outline-button" onClick={() => { cancelTextEditor(); onClose(); }} disabled={applying}><X size={15} /> 取消</button>
          <button type="button" className="vermilion-button" onClick={() => void submit()} disabled={applying || !canSave}><Check size={15} /> {applying ? "合成中…" : "保存标注图片"}</button>
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
  if (tool === "text") return { id, type: "rect", color, strokeWidth, start: { ...start }, end: { ...end } };
  if (tool === "brush") return { id, type: "brush", color, strokeWidth, points: points.map((point) => ({ ...point })) };
  return { id, type: tool, color, strokeWidth, start: { ...start }, end: { ...end } };
}

function AnnotationMark({
  mark,
  selected,
  movable,
  onPointerDown,
  onDoubleClick,
}: {
  mark: CanvasImageAnnotation;
  selected: boolean;
  movable: boolean;
  onPointerDown: (event: ReactPointerEvent<SVGElement>, mark: CanvasImageAnnotation) => void;
  onDoubleClick: (event: ReactMouseEvent<SVGElement>, mark: CanvasImageAnnotation) => void;
}) {
  const textRef = useRef<SVGTextElement>(null);
  const [textInk, setTextInk] = useState<CanvasAnnotationBounds | null>(null);

  useLayoutEffect(() => {
    if (mark.type !== "text") {
      setTextInk(null);
      return;
    }
    const node = textRef.current;
    if (!node) return;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      try {
        const box = node.getBBox();
        if (!Number.isFinite(box.width) || box.width <= 0 || !Number.isFinite(box.height) || box.height <= 0) return;
        setTextInk({ x: box.x, y: box.y, width: box.width, height: box.height });
      } catch {
        /* SVG 尚未完成布局时 getBBox 会抛错 */
      }
    };
    measure();
    void document.fonts?.ready.then(measure);
    return () => { cancelled = true; };
  }, [mark]);

  const common = {
    stroke: mark.color,
    strokeWidth: mark.strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    filter: selected && mark.type !== "text" ? "url(#annotation-selection-glow)" : undefined,
    style: { cursor: movable ? "move" : "inherit" },
    onPointerDown: (event: ReactPointerEvent<SVGElement>) => onPointerDown(event, mark),
    onDoubleClick: (event: ReactMouseEvent<SVGElement>) => onDoubleClick(event, mark),
  };
  let content;
  if (mark.type === "rect") {
    content = <rect {...common} x={Math.min(mark.start.x, mark.end.x)} y={Math.min(mark.start.y, mark.end.y)} width={Math.abs(mark.end.x - mark.start.x)} height={Math.abs(mark.end.y - mark.start.y)} fill="transparent" pointerEvents="all" />;
  } else if (mark.type === "ellipse") {
    content = <ellipse {...common} cx={(mark.start.x + mark.end.x) / 2} cy={(mark.start.y + mark.end.y) / 2} rx={Math.abs(mark.end.x - mark.start.x) / 2} ry={Math.abs(mark.end.y - mark.start.y) / 2} fill="transparent" pointerEvents="all" />;
  } else if (mark.type === "arrow") {
    const arrow = canvasArrowGeometry(mark.start, mark.end, mark.strokeWidth);
    const { filter, ...rest } = common;
    content = (
      <g {...rest} fill={mark.color} pointerEvents="all">
        <path d={canvasArrowOutlinePath(arrow)} stroke="none" filter={filter} />
        <line
          x1={mark.start.x}
          y1={mark.start.y}
          x2={mark.end.x}
          y2={mark.end.y}
          stroke="transparent"
          strokeWidth={Math.max(mark.strokeWidth * 3, 16)}
          fill="none"
        />
      </g>
    );
  } else if (mark.type === "brush") {
    content = <polyline {...common} points={mark.points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" pointerEvents="stroke" />;
  } else if (mark.type === "text") {
    const hit = textInk ?? canvasAnnotationBounds(mark);
    content = (
      <g {...common} pointerEvents="all" role="img" aria-label={`文字 ${mark.text}`}>
        <rect x={hit.x} y={hit.y} width={hit.width} height={hit.height} fill="transparent" stroke="none" />
        <text ref={textRef} x={mark.x} y={mark.y} fill={mark.color} stroke="none" fontSize={mark.fontSize} fontWeight={600} fontFamily="sans-serif">{mark.text}</text>
      </g>
    );
  }
  if (!selected) return content;
  const outline = mark.type === "text"
    ? canvasAnnotationTextSelectionBounds(textInk ?? canvasAnnotationBounds(mark), mark.fontSize)
    : canvasAnnotationBounds(mark);
  return (
    <g>
      {content}
      <rect
        x={outline.x}
        y={outline.y}
        width={outline.width}
        height={outline.height}
        fill="none"
        stroke="#ffffff"
        strokeWidth={1.5}
        strokeDasharray="7 5"
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
    </g>
  );
}
