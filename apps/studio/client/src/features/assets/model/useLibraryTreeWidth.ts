import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

/** Folder sidebar width bounds; the default matches the original fixed column. */
export const LIBRARY_TREE_WIDTH = {
  defaultPx: 200,
  minPx: 180,
  maxPx: 360,
  /** Arrow-key step when the resize handle has focus. */
  keyStepPx: 16,
  storageKey: "ai-manju:asset-library-tree-width",
} as const;

export function clampLibraryTreeWidth(value: unknown) {
  const width = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(width)) return LIBRARY_TREE_WIDTH.defaultPx;
  return Math.round(Math.min(LIBRARY_TREE_WIDTH.maxPx, Math.max(LIBRARY_TREE_WIDTH.minPx, width)));
}

function readSavedWidth() {
  try {
    const saved = localStorage.getItem(LIBRARY_TREE_WIDTH.storageKey);
    return saved === null ? LIBRARY_TREE_WIDTH.defaultPx : clampLibraryTreeWidth(saved);
  } catch {
    return LIBRARY_TREE_WIDTH.defaultPx;
  }
}

function saveWidth(width: number) {
  try {
    localStorage.setItem(LIBRARY_TREE_WIDTH.storageKey, String(width));
  } catch {
    /* localStorage 不可用时静默降级为会话内状态 */
  }
}

export function useLibraryTreeWidth() {
  const [width, setWidth] = useState(readSavedWidth);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width, width };
    setDragging(true);
  }, [width]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current) return;
    current.width = clampLibraryTreeWidth(current.startWidth + event.clientX - current.startX);
    setWidth(current.width);
  }, []);

  const endDrag = useCallback(() => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    setDragging(false);
    saveWidth(current.width);
  }, []);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const delta = event.key === "ArrowLeft" ? -LIBRARY_TREE_WIDTH.keyStepPx : event.key === "ArrowRight" ? LIBRARY_TREE_WIDTH.keyStepPx : 0;
    if (!delta) return;
    event.preventDefault();
    setWidth((current) => {
      const next = clampLibraryTreeWidth(current + delta);
      saveWidth(next);
      return next;
    });
  }, []);

  // Unmounting mid-drag must still persist the last width.
  useEffect(() => endDrag, [endDrag]);

  return {
    dragging,
    workspaceStyle: { "--library-tree-width": `${width}px` } as CSSProperties,
    resizerProps: {
      role: "separator",
      "aria-orientation": "vertical",
      "aria-label": "调整文件夹栏宽度",
      "aria-valuemin": LIBRARY_TREE_WIDTH.minPx,
      "aria-valuemax": LIBRARY_TREE_WIDTH.maxPx,
      "aria-valuenow": width,
      tabIndex: 0,
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown,
    } as const,
  };
}
