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
    // Left/above panels expand away from the node, using their outer edges.
    const style = getComputedStyle(panel);
    const directionX = style.getPropertyValue("--inspector-resize-x").trim() === "-1" ? -1 : 1;
    const directionY = style.getPropertyValue("--inspector-resize-y").trim() === "-1" ? -1 : 1;
    const centerDistance = parseFloat(style.getPropertyValue("--inspector-resize-center-distance"));
    const boundaryDistance = parseFloat(style.getPropertyValue("--inspector-resize-boundary-distance"));
    const centered = Number.isFinite(centerDistance) && Number.isFinite(boundaryDistance);
    const pointerId = event.pointerId;
    const handle = event.currentTarget;
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId || latest.current.nodeId !== nodeId) return;
      const outwardX = (next.clientX - startX) * directionX;
      // Centered panels grow on both sides until the opposite edge reaches the viewport.
      // Invert that placement so the dragged edge stays under the pointer in both cases.
      const width = centered ? Math.min((centerDistance + outwardX) * 2, boundaryDistance + outwardX)
        : start.width + outwardX;
      latest.current.onResize(nodeId, resizeInspector(start, {
        width: width - start.width, height: (next.clientY - startY) * directionY,
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
