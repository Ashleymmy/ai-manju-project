import { useEffect, useRef, type PointerEvent, type RefObject } from "react";
import { INSPECTOR_SIZE, resizeInspector, type InspectorResizeMode, type InspectorSize, type InspectorSizeLimits } from "../domain/inspectorSize";

type Options = {
  panelRef: RefObject<HTMLElement | null>;
  nodeId?: string;
  limits: InspectorSizeLimits;
  onResize: (nodeId: string, size: InspectorSize, mode: InspectorResizeMode) => void;
};

export function useInspectorResize({ panelRef, nodeId, limits, onResize }: Options) {
  const latest = useRef({ nodeId, onResize });
  latest.current = { nodeId, onResize };
  const cleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cleanup.current?.(), [nodeId]);

  return (event: PointerEvent<HTMLButtonElement>, mode: InspectorResizeMode) => {
    if (event.button !== 0 || !nodeId || !panelRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    cleanup.current?.();
    const panel = panelRef.current;
    const start = panel.getBoundingClientRect();
    if (!start.width || !start.height) return;
    const editor = panel.querySelector<HTMLElement>(".canvas-mention-editor");
    const dragLimits = {
      ...limits,
      // Keep the header, reference strip and action rows usable while shrinking the prompt.
      minHeight: Math.min(limits.maxHeight, Math.max(limits.minHeight,
        start.height - (editor?.getBoundingClientRect().height || 0) + INSPECTOR_SIZE.minEditorHeight)),
    };
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    const handle = event.currentTarget;
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId || latest.current.nodeId !== nodeId) return;
      latest.current.onResize(nodeId, resizeInspector(start, {
        width: next.clientX - startX, height: next.clientY - startY,
      }, mode, dragLimits), mode);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", stop);
      handle.removeEventListener("lostpointercapture", stop);
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
      cleanup.current = undefined;
    };
    const up = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      move(next);
      stop();
    };
    const cancel = (next: globalThis.PointerEvent) => {
      if (next.pointerId === pointerId) stop();
    };
    cleanup.current = stop;
    handle.setPointerCapture?.(pointerId);
    handle.addEventListener("lostpointercapture", stop);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", stop);
  };
}
