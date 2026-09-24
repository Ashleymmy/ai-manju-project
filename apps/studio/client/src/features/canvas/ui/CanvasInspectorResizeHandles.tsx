import type { PointerEvent } from "react";
import type { InspectorResizeMode } from "../domain/inspectorSize";
import "./inspectorResize.css";

const EDGE_HANDLES: ReadonlyArray<{
  mode: "width" | "both";
  side: "left" | "right";
  label: string;
}> = [
  { mode: "width", side: "left", label: "从左侧拖动调整面板宽度" },
  { mode: "width", side: "right", label: "从右侧拖动调整面板宽度" },
  { mode: "both", side: "left", label: "从左下角拖动调整面板大小" },
  { mode: "both", side: "right", label: "从右下角拖动调整面板大小" },
];

export function CanvasInspectorResizeHandles({ onResize }: {
  onResize: (event: PointerEvent<HTMLButtonElement>, mode: InspectorResizeMode) => void;
}) {
  return (
    <>
      {EDGE_HANDLES.map(({ mode, side, label }) => (
        <button key={`${mode}-${side}`} type="button"
          className={`inspector-resize-handle inspector-resize-${mode} inspector-resize-${mode}-${side}`}
          data-inspector-resize-side={side}
          title={label} aria-label={label} onPointerDown={event => onResize(event, mode)} />
      ))}
      <button type="button" className="inspector-resize-handle inspector-resize-height"
        title="拖动调整面板高度" aria-label="拖动调整面板高度"
        onPointerDown={event => onResize(event, "height")} />
    </>
  );
}
