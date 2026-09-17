import { useEffect, useRef, useState, type ReactNode } from "react";

// Ignore small hand movements so ordinary clicks and double-click previews still work.
const DRAG_THRESHOLD = 5;
type Point = { x: number; y: number };
type SelectionRect = { left: number; top: number; width: number; height: number };

export function AssetSelectionArea({ selectedIds, onSelectionChange, children }: {
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef({ selectedIds, onSelectionChange });
  latest.current = { selectedIds, onSelectionChange };
  const gesture = useRef<{ id: number; start: Point; current: Point; initial: string[]; additive: boolean; active: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [rectangle, setRectangle] = useState<SelectionRect | null>(null);

  useEffect(() => {
    const update = () => {
      const drag = gesture.current;
      const element = root.current;
      if (!drag?.active || !element) return;
      const bounds = element.getBoundingClientRect();
      const startX = drag.start.x + bounds.left;
      const startY = drag.start.y + bounds.top;
      const left = Math.min(startX, drag.current.x);
      const top = Math.min(startY, drag.current.y);
      const right = Math.max(startX, drag.current.x);
      const bottom = Math.max(startY, drag.current.y);
      const hits = Array.from(element.querySelectorAll<HTMLElement>("[data-asset-id]")).filter(card => {
        const box = card.getBoundingClientRect();
        return box.right > left && box.left < right && box.bottom > top && box.top < bottom;
      }).map(card => card.dataset.assetId!);
      latest.current.onSelectionChange(Array.from(new Set([...(drag.additive ? drag.initial : []), ...hits])));
      setRectangle({ left: left - bounds.left, top: top - bounds.top, width: right - left, height: bottom - top });
    };
    const move = (event: PointerEvent) => {
      const drag = gesture.current;
      if (!drag || event.pointerId !== drag.id) return;
      drag.current = { x: event.clientX, y: event.clientY };
      const bounds = root.current!.getBoundingClientRect();
      if (!drag.active && Math.hypot(drag.current.x - bounds.left - drag.start.x, drag.current.y - bounds.top - drag.start.y) < DRAG_THRESHOLD) return;
      if (!drag.active) root.current?.setPointerCapture?.(drag.id);
      drag.active = true;
      suppressClick.current = true;
      event.preventDefault();
      update();
    };
    const finish = (event?: PointerEvent, cancel = false) => {
      const drag = gesture.current;
      if (!drag || (event && event.pointerId !== drag.id)) return;
      if (cancel) latest.current.onSelectionChange(drag.initial);
      else if (drag.active) { if (event) drag.current = { x: event.clientX, y: event.clientY }; update(); }
      gesture.current = null;
      if (root.current?.hasPointerCapture?.(drag.id)) root.current.releasePointerCapture(drag.id);
      setRectangle(null);
    };
    const up = (event: PointerEvent) => finish(event);
    const cancel = (event: PointerEvent) => finish(event, true);
    const blur = () => finish(undefined, true);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && gesture.current) { event.preventDefault(); blur(); } };
    const clearFromOutside = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!latest.current.selectedIds.length || root.current?.contains(target)) return;
      // Bulk controls and the tag dialog intentionally operate on the current selection.
      if (target instanceof Element && target.closest(".asset-bulk-bar, .asset-bulk-tags-dialog, [data-keep-asset-selection]")) return;
      latest.current.onSelectionChange([]);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", key);
    window.addEventListener("scroll", update, true);
    document.addEventListener("pointerdown", clearFromOutside, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", key);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("pointerdown", clearFromOutside, true);
    };
  }, []);

  return <div ref={root} className={`asset-selection-area${rectangle ? " is-selecting" : ""}`}
    onPointerDown={event => {
      suppressClick.current = false;
      if (event.button !== 0 || event.pointerType === "touch") return;
      const target = event.target as HTMLElement;
      if (target.closest("input, label, a, select, textarea, button:not(.library-asset-preview)")) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      gesture.current = { id: event.pointerId, start: { x: event.clientX - bounds.left, y: event.clientY - bounds.top }, current: { x: event.clientX, y: event.clientY }, initial: [...latest.current.selectedIds], additive: event.ctrlKey || event.metaKey || event.shiftKey, active: false };
    }}
    onDragStart={event => event.preventDefault()}
    onClickCapture={event => {
      if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
    }}>
    {children}
    {rectangle && <div className="asset-selection-rectangle" style={rectangle} aria-hidden="true" />}
  </div>;
}
