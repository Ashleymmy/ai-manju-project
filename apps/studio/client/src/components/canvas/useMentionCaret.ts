import { useCallback, useLayoutEffect, useState, type RefObject } from "react";

// Keep the insertion bar visible when the canvas and its floating inspector are zoomed out.
const CARET_SCREEN_WIDTH = 2;
const CARET_FONT_HEIGHT_RATIO = 1.25;
const CARET_METRICS = ["boxSizing", "font", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "wordSpacing", "textIndent", "textAlign", "direction", "tabSize", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle"] as const;

/** Mirror native textarea layout only for drawing; the textarea remains the sole editing surface. */
export function useMentionCaret(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  const [caret, setCaret] = useState<{ left: number; top: number; height: number; width: number } | null>(null);
  const refresh = useCallback(() => {
    const textarea = ref.current;
    if (!textarea || document.activeElement !== textarea || textarea.selectionStart !== textarea.selectionEnd || !textarea.offsetWidth) {
      setCaret(null);
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
    marker.textContent = textarea.value.slice(textarea.selectionStart) || "\u200b";
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
      setCaret(null);
      return;
    }
    const next = { left: textarea.offsetLeft + left, top: textarea.offsetTop + top, height, width: CARET_SCREEN_WIDTH / scale };
    setCaret(current => current && Object.keys(next).every(key => current[key as keyof typeof next] === next[key as keyof typeof next]) ? current : next);
  }, [ref]);
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
  }, [ref, value, refresh]);
  return { caret, refresh };
}
