import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

// Keep the insertion bar visible when the canvas and its floating inspector are zoomed out.
const CARET_SCREEN_WIDTH = 2;
const CARET_FONT_HEIGHT_RATIO = 1.25;
const CARET_METRICS = ["boxSizing", "font", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "wordSpacing", "textIndent", "textAlign", "direction", "tabSize", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle"] as const;
// Guard against pathological selections allocating thousands of highlight spans.
const MAX_SELECTION_RECTS = 400;

export type MentionCaretBox = {
  left: number;
  top: number;
  height: number;
  width: number;
};

export type MentionSelectionBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

interface DomPoint {
  node: Node;
  offset: number;
}

const boxesAlmostEqual = (a: MentionCaretBox | null, b: MentionCaretBox | null) => {
  if (!a || !b) return a === b;
  return Math.abs(a.left - b.left) < 0.01
    && Math.abs(a.top - b.top) < 0.01
    && Math.abs(a.height - b.height) < 0.01
    && Math.abs(a.width - b.width) < 0.01;
};

const rectListsAlmostEqual = (a: MentionSelectionBox[], b: MentionSelectionBox[]) => {
  if (a.length !== b.length) return false;
  return a.every((rect, index) => boxesAlmostEqual(rect, b[index] ?? null));
};

function contentChildren(overlay: HTMLElement) {
  return Array.from(overlay.children).filter((child): child is HTMLElement =>
    child instanceof HTMLElement && (child.hasAttribute("data-mention-text") || child.hasAttribute("data-mention-chip")));
}

/**
 * Map a display-value offset to a DOM position inside the overlay. Text spans map to
 * their inner text node; chips are atomic and snap to the nearest boundary, expressed
 * as element positions so Range measurements cover the whole chip box.
 */
function positionFromOffset(overlay: HTMLElement, offset: number): DomPoint | null {
  const children = contentChildren(overlay);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    const start = Number(child.dataset.mentionStart);
    const end = Number(child.dataset.mentionEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (child.hasAttribute("data-mention-text")) {
      const text = child.firstChild;
      if (offset <= end && text) {
        return { node: text, offset: Math.max(0, Math.min(offset - start, text.textContent?.length ?? 0)) };
      }
      continue;
    }
    if (offset < end || index === children.length - 1) {
      const childIndex = Array.prototype.indexOf.call(overlay.children, child);
      return { node: overlay, offset: offset - start <= end - offset ? childIndex : childIndex + 1 };
    }
  }
  const last = children[children.length - 1];
  if (last?.hasAttribute("data-mention-text") && last.firstChild) {
    return { node: last.firstChild, offset: last.firstChild.textContent?.length ?? 0 };
  }
  return { node: overlay, offset: overlay.children.length };
}

function rangeAt(point: DomPoint) {
  const range = (point.node.ownerDocument ?? document).createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);
  return range;
}

/** Collapsed ranges at element boundaries report no box in some engines; borrow a neighbor glyph's edge. */
function caretRectAt(overlay: HTMLElement, offset: number, valueLength: number) {
  const point = positionFromOffset(overlay, offset);
  if (!point) return null;
  const range = rangeAt(point);
  const direct = range.getClientRects()[0];
  if (direct && (direct.height > 0.5 || direct.width > 0.5)) return direct;
  // A chip spans multiple placeholder characters. Moving one character can snap
  // to the same DOM boundary again, so use the actual chip edge instead.
  if (point.node === overlay) {
    const next = overlay.childNodes[point.offset];
    const previous = overlay.childNodes[point.offset - 1];
    const chip = next instanceof HTMLElement && next.hasAttribute("data-mention-chip") ? next
      : previous instanceof HTMLElement && previous.hasAttribute("data-mention-chip") ? previous : null;
    if (chip) {
      const rect = chip.getBoundingClientRect();
      const left = chip === next ? rect.left : rect.right;
      return { left, right: left, top: rect.top, height: rect.height };
    }
  }
  if (offset < valueLength) {
    const next = positionFromOffset(overlay, offset + 1);
    if (next) {
      range.setEnd(next.node, next.offset);
      const rect = range.getClientRects()[0];
      if (rect) return { left: rect.left, right: rect.left, top: rect.top, height: rect.height } as DOMRect;
    }
  }
  if (offset > 0) {
    const previous = positionFromOffset(overlay, offset - 1);
    if (previous) {
      range.setStart(previous.node, previous.offset);
      const rect = range.getClientRects()[0];
      if (rect) return { left: rect.right, right: rect.right, top: rect.top, height: rect.height } as DOMRect;
    }
  }
  return direct ?? null;
}

interface OverlayGeometry {
  scale: number;
  bounds: DOMRect;
  borderLeft: number;
  borderTop: number;
  lineHeight: number;
}

function overlayGeometry(overlay: HTMLElement): OverlayGeometry {
  const bounds = overlay.getBoundingClientRect();
  const style = getComputedStyle(overlay);
  const fontSize = parseFloat(style.fontSize) || 12;
  return {
    scale: bounds.width && overlay.offsetWidth ? bounds.width / overlay.offsetWidth : 1,
    bounds,
    borderLeft: parseFloat(style.borderLeftWidth) || 0,
    borderTop: parseFloat(style.borderTopWidth) || 0,
    lineHeight: parseFloat(style.lineHeight) || fontSize * CARET_FONT_HEIGHT_RATIO,
  };
}

/** Convert a viewport-space rect into the overlay's scrolled content space (the layer scrolls with it). */
function toContentBox(overlay: HTMLElement, geometry: OverlayGeometry, rect: Pick<DOMRect, "left" | "top" | "width" | "height">): MentionSelectionBox {
  return {
    left: (rect.left - geometry.bounds.left) / geometry.scale - geometry.borderLeft + overlay.scrollLeft,
    top: (rect.top - geometry.bounds.top) / geometry.scale - geometry.borderTop + overlay.scrollTop,
    width: rect.width / geometry.scale,
    height: rect.height / geometry.scale,
  };
}

function measureOverlay(
  textarea: HTMLTextAreaElement,
  overlay: HTMLElement,
): { caret: MentionCaretBox | null; selection: MentionSelectionBox[] } {
  const geometry = overlayGeometry(overlay);
  const valueLength = textarea.value.length;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  try {
    if (start === end) {
      const rect = caretRectAt(overlay, start, valueLength);
      if (!rect) return { caret: null, selection: [] };
      const height = rect.height > 0.5 ? rect.height / geometry.scale : geometry.lineHeight;
      const box = toContentBox(overlay, geometry, { left: rect.left, top: rect.top, width: 0, height: rect.height });
      return {
        caret: {
          left: box.left,
          top: rect.height > 0.5 ? box.top : box.top - (height - geometry.lineHeight) / 2,
          height,
          width: CARET_SCREEN_WIDTH / geometry.scale,
        },
        selection: [],
      };
    }
    const anchor = positionFromOffset(overlay, Math.min(start, end));
    const focus = positionFromOffset(overlay, Math.max(start, end));
    if (!anchor || !focus) return { caret: null, selection: [] };
    const range = overlay.ownerDocument.createRange();
    range.setStart(anchor.node, anchor.offset);
    range.setEnd(focus.node, focus.offset);
    const selection = Array.from(range.getClientRects())
      .filter(rect => rect.width > 0.5 && rect.height > 0.5)
      .slice(0, MAX_SELECTION_RECTS)
      .map(rect => toContentBox(overlay, geometry, rect));
    return { caret: null, selection };
  } catch {
    // jsdom and detached nodes have no layout; skip painting rather than crashing.
    return { caret: null, selection: [] };
  }
}

/**
 * Hit-test the overlay back into a display-value offset. The highlight layer is hidden
 * during the hit-test so its boxes cannot swallow the point. Chips snap by midpoint.
 */
export function offsetFromOverlayPoint(overlay: HTMLElement, x: number, y: number, valueLength: number): number {
  const layer = overlay.querySelector<HTMLElement>("[data-mention-layer]");
  const previousDisplay = layer?.style.display ?? "";
  if (layer) layer.style.display = "none";
  try {
    const doc = overlay.ownerDocument as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node | null; offset: number } | null;
    };
    let node: Node | null = null;
    let offset = 0;
    const range = doc.caretRangeFromPoint?.(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    } else {
      const position = doc.caretPositionFromPoint?.(x, y);
      node = position?.offsetNode ?? null;
      offset = position?.offset ?? 0;
    }
    if (!node || !overlay.contains(node)) {
      const bounds = overlay.getBoundingClientRect();
      return y >= (bounds.top + bounds.bottom) / 2 ? valueLength : 0;
    }
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
    const chip = element?.closest("[data-mention-chip]");
    if (chip) {
      const rect = chip.getBoundingClientRect();
      const chipStart = Number(chip.getAttribute("data-mention-start"));
      const chipEnd = Number(chip.getAttribute("data-mention-end"));
      return x < rect.left + rect.width / 2 ? chipStart : chipEnd;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const span = element?.closest("[data-mention-text]");
      if (span) return Number(span.getAttribute("data-mention-start")) + offset;
    }
    if (element?.hasAttribute("data-mention-text")) {
      // Element offset into a text span's single text child.
      const spanStart = Number(element.getAttribute("data-mention-start"));
      return offset > 0 ? Number(element.getAttribute("data-mention-end")) : spanStart;
    }
    // Element position among the overlay's children: take the end of the last content child before it.
    let result = 0;
    const children = Array.from((node as Element).children ?? []);
    for (let index = 0; index < Math.min(offset, children.length); index += 1) {
      const child = children[index];
      if (!(child instanceof HTMLElement)) continue;
      const mentionEnd = child.dataset.mentionEnd;
      if (mentionEnd !== undefined) result = Number(mentionEnd);
    }
    return result;
  } finally {
    if (layer) layer.style.display = previousDisplay;
  }
}

/**
 * Caret/selection painter for the mention editor.
 *
 * With the chip overlay active, the overlay is the only visual source of truth: both the
 * caret and the selection highlight are measured from the overlay's real layout with DOM
 * Ranges, then painted in its scrolled content space. The textarea keeps the invisible
 * native text for editing, so measuring from the mirror used to drift a line off whenever
 * chip widths differed from the raw token text by even a subpixel.
 *
 * Plain text (no overlay) keeps the mirror-div caret, which only draws a wider insertion
 * bar so it stays visible when the canvas is zoomed out.
 */
export function useMentionCaret(
  ref: RefObject<HTMLTextAreaElement | null>,
  overlayRef: RefObject<HTMLElement | null>,
  value: string,
  overlayActive: boolean,
) {
  const [caret, setCaret] = useState<MentionCaretBox | null>(null);
  const [selection, setSelection] = useState<MentionSelectionBox[]>([]);
  const ensureKeyRef = useRef("");
  const refresh = useCallback(() => {
    const textarea = ref.current;
    if (!textarea || document.activeElement !== textarea || !textarea.offsetWidth) {
      setCaret(current => (current === null ? current : null));
      setSelection(current => (current.length === 0 ? current : []));
      return;
    }
    const overlay = overlayActive ? overlayRef.current : null;
    if (overlay) {
      const measured = measureOverlay(textarea, overlay);
      setCaret(current => (boxesAlmostEqual(current, measured.caret) ? current : measured.caret));
      setSelection(current => (rectListsAlmostEqual(current, measured.selection) ? current : measured.selection));
      // Scroll the caret into view only when the edit/selection moved it, so manual
      // wheel scrolling is never yanked back to the caret line.
      const ensureKey = `${value.length}:${textarea.selectionStart}:${textarea.selectionEnd}`;
      if (measured.caret && ensureKeyRef.current !== ensureKey) {
        ensureKeyRef.current = ensureKey;
        const maxTop = Math.max(0, textarea.scrollHeight - textarea.clientHeight);
        let nextTop = textarea.scrollTop;
        if (measured.caret.top < nextTop) nextTop = measured.caret.top;
        else if (measured.caret.top + measured.caret.height > nextTop + textarea.clientHeight) {
          nextTop = measured.caret.top + measured.caret.height - textarea.clientHeight;
        }
        nextTop = Math.max(0, Math.min(nextTop, maxTop));
        if (Math.abs(nextTop - textarea.scrollTop) > 0.5) {
          textarea.scrollTop = nextTop;
          overlay.scrollTop = nextTop;
        }
      }
      return;
    }
    setSelection(current => (current.length === 0 ? current : []));
    if (textarea.selectionStart !== textarea.selectionEnd) {
      setCaret(current => (current === null ? current : null));
      return;
    }
    const style = getComputedStyle(textarea);
    const mirror = document.createElement("div");
    for (const property of CARET_METRICS) mirror.style[property] = style[property];
    Object.assign(mirror.style, {
      position: "fixed", left: "-10000px", top: "0", visibility: "hidden",
      boxSizing: "border-box", width: `${textarea.clientWidth + parseFloat(style.borderLeftWidth || "0") + parseFloat(style.borderRightWidth || "0")}px`,
      height: "auto", whiteSpace: "pre-wrap", overflowWrap: "break-word", wordBreak: style.wordBreak,
    });
    mirror.textContent = textarea.value.slice(0, textarea.selectionStart);
    const marker = document.createElement("span");
    marker.textContent = textarea.value.slice(textarea.selectionStart) || "​";
    mirror.append(marker);
    document.body.append(mirror);
    const point = marker.getClientRects()[0];
    const bounds = mirror.getBoundingClientRect();
    const fontSize = parseFloat(style.fontSize);
    const lineHeight = parseFloat(style.lineHeight) || fontSize * CARET_FONT_HEIGHT_RATIO;
    const height = Math.min(lineHeight, fontSize * CARET_FONT_HEIGHT_RATIO);
    const scale = textarea.getBoundingClientRect().width / textarea.offsetWidth || 1;
    const left = point ? point.left - bounds.left - textarea.scrollLeft : 0;
    const top = point ? point.top - bounds.top - textarea.scrollTop : 0;
    mirror.remove();
    if (!point || left < 0 || left > textarea.clientWidth || top < 0 || top + height > textarea.clientHeight) {
      setCaret(current => (current === null ? current : null));
      return;
    }
    const next = { left: textarea.offsetLeft + left, top: textarea.offsetTop + top, height, width: CARET_SCREEN_WIDTH / scale };
    setCaret(current => (boxesAlmostEqual(current, next) ? current : next));
  }, [ref, overlayRef, overlayActive, value]);
  useLayoutEffect(() => {
    refresh();
    const textarea = ref.current;
    if (!textarea) return;
    // React must commit onChange before we redraw. A native input listener can flush a render
    // before React's delegated handler, restoring the old controlled value and losing the edit.
    const events = ["focus", "blur", "select", "keyup", "pointerup", "scroll"] as const;
    events.forEach(event => textarea.addEventListener(event, refresh));
    document.addEventListener("selectionchange", refresh);
    window.addEventListener("resize", refresh);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refresh);
    observer?.observe(textarea);
    return () => {
      events.forEach(event => textarea.removeEventListener(event, refresh));
      document.removeEventListener("selectionchange", refresh);
      window.removeEventListener("resize", refresh);
      observer?.disconnect();
    };
  }, [ref, refresh]);
  // Re-measure after every commit so thumbnail swaps, font loads, and overlay re-layouts
  // stay pinned; the equality guards above keep this from becoming a render loop.
  useLayoutEffect(() => {
    refresh();
  });
  return { caret, selection, refresh };
}
