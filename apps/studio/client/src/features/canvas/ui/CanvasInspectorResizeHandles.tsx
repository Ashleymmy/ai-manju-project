import type { PointerEvent } from "react";
import type { InspectorResizeMode } from "../domain/inspectorSize";
import "./inspectorResize.css";

const HANDLES: ReadonlyArray<{ mode: InspectorResizeMode; label: string }> = [
  { mode: "width", label: "拖动调整面板宽度" },
  { mode: "height", label: "拖动调整面板高度" },
  { mode: "proportional", label: "拖动等比缩放面板" },
];

export function CanvasInspectorResizeHandles({ onResize }: {
  onResize: (event: PointerEvent<HTMLButtonElement>, mode: InspectorResizeMode) => void;
}) {
  return HANDLES.map(({ mode, label }) => (
    <button key={mode} type="button" className={`inspector-resize-handle inspector-resize-${mode}`}
      title={label} aria-label={label} onPointerDown={event => onResize(event, mode)} />
  ));
}
