import { useEffect, useRef } from "react";

/** Observe outside presses before canvas dragging or controls stop event bubbling. */
export function useOutsidePress(enabled: boolean, isInside: (event: Event) => boolean, onOutside: () => void, includeClick = true) {
  const callbacks = useRef({ isInside, onOutside });
  callbacks.current = { isInside, onOutside };
  useEffect(() => {
    if (!enabled) return;
    const dismiss = (event: Event) => {
      if (!callbacks.current.isInside(event)) callbacks.current.onOutside();
    };
    document.addEventListener("pointerdown", dismiss, true);
    if (includeClick) document.addEventListener("click", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("click", dismiss, true);
    };
  }, [enabled, includeClick]);
}
