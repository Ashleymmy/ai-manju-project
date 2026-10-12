import { useEffect } from "react";

/**
 * Keeps the page still while a modal is open. A fixed backdrop is not a scroll
 * container, so wheel events over it (or past the edge of the modal's own
 * scroller) would otherwise scroll the document underneath.
 */
export function useDocumentScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const { overflow, paddingRight } = root.style;
    // Hiding a classic scrollbar widens the viewport; pad it back so content does not shift.
    const scrollbarWidth = window.innerWidth - root.clientWidth;
    root.style.overflow = "hidden";
    if (scrollbarWidth > 0) root.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      root.style.overflow = overflow;
      root.style.paddingRight = paddingRight;
    };
  }, [active]);
}
