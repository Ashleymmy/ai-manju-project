import { useEffect } from "react";

export const WHEEL_SCROLL_CHAINING = {
  /** Pixels per wheel "line" when the device reports `deltaMode === 1`. */
  lineHeightPx: 16,
  /** Share of the remaining distance covered each animation frame. */
  easing: 0.3,
  /** Below this distance the animation snaps to its target and stops. */
  settlePx: 1.5,
} as const;

type ScrollAnimation = { target: number; frame: number };

/**
 * Scrolls a nested list and then its page as one continuous wheel motion.
 *
 * Browsers latch a wheel gesture to the scroller it started in, and only the
 * first event of a gesture can be cancelled. Native chaining therefore waits for
 * a new gesture once the list reaches its edge. Taking over every wheel event
 * over the list keeps the gesture cancellable: each step scrolls the list first
 * and passes whatever it cannot use to the nearest scrollable ancestor.
 */
export function useWheelScrollChaining(element: HTMLElement | null) {
  useEffect(() => {
    if (!element) return;
    const animations = new Map<HTMLElement, ScrollAnimation>();
    const targetOf = (scroller: HTMLElement) => animations.get(scroller)?.target ?? scroller.scrollTop;

    const scrollToTarget = (scroller: HTMLElement, target: number) => {
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        const running = animations.get(scroller);
        if (running) cancelAnimationFrame(running.frame);
        animations.delete(scroller);
        scroller.scrollTop = target;
        return;
      }
      const running = animations.get(scroller);
      if (running) {
        running.target = target;
        return;
      }
      const animation: ScrollAnimation = { target, frame: 0 };
      animations.set(scroller, animation);
      const step = () => {
        const remaining = animation.target - scroller.scrollTop;
        if (Math.abs(remaining) <= WHEEL_SCROLL_CHAINING.settlePx) {
          scroller.scrollTop = animation.target;
          animations.delete(scroller);
          return;
        }
        const before = scroller.scrollTop;
        scroller.scrollTop = before + remaining * WHEEL_SCROLL_CHAINING.easing;
        // Content shrank or something else holds the position: stop instead of spinning.
        if (scroller.scrollTop === before) {
          animations.delete(scroller);
          return;
        }
        animation.frame = requestAnimationFrame(step);
      };
      animation.frame = requestAnimationFrame(step);
    };

    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const delta = wheelDeltaPixels(event, element);
      if (!delta) return;
      const listFrom = targetOf(element);
      const listTo = clamp(listFrom + delta, 0, maxScrollTop(element));
      const rest = delta - (listTo - listFrom);
      const outer = rest ? scrollableAncestor(element, rest, targetOf) : null;
      if (listTo === listFrom && !outer) return;
      event.preventDefault();
      if (listTo !== listFrom) scrollToTarget(element, listTo);
      if (outer) scrollToTarget(outer, clamp(targetOf(outer) + rest, 0, maxScrollTop(outer)));
    };

    // Scrolling the page moves the list out from under a still pointer. While the
    // page is animating, wheel steps over the rest of it extend that animation
    // instead of starting a native scroll that would fight it.
    const onOuterWheel = (event: WheelEvent) => {
      if (!animations.size || event.defaultPrevented || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      if (!(event.target instanceof Element) || element.contains(event.target)) return;
      const delta = wheelDeltaPixels(event, element);
      const scroller = delta ? nearestScrollable(event.target, delta, targetOf) : null;
      if (!scroller || scroller === element || !animations.has(scroller)) return;
      event.preventDefault();
      scrollToTarget(scroller, clamp(targetOf(scroller) + delta, 0, maxScrollTop(scroller)));
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("wheel", onOuterWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
      window.removeEventListener("wheel", onOuterWheel);
      for (const animation of animations.values()) cancelAnimationFrame(animation.frame);
      animations.clear();
    };
  }, [element]);
}

function wheelDeltaPixels(event: WheelEvent, element: HTMLElement) {
  if (event.deltaMode === 1) return event.deltaY * WHEEL_SCROLL_CHAINING.lineHeightPx;
  if (event.deltaMode === 2) return event.deltaY * element.clientHeight;
  return event.deltaY;
}

function maxScrollTop(element: Element) {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function scrollableAncestor(element: HTMLElement, delta: number, targetOf: (scroller: HTMLElement) => number) {
  return element.parentElement ? nearestScrollable(element.parentElement, delta, targetOf) : null;
}

/** The first scroller from `start` outward that can still move by `delta`. */
function nearestScrollable(start: Element, delta: number, targetOf: (scroller: HTMLElement) => number): HTMLElement | null {
  const canScroll = (candidate: HTMLElement) => delta < 0
    ? targetOf(candidate) > 0
    : targetOf(candidate) < maxScrollTop(candidate) - 1;
  for (let node: Element | null = start; node; node = node.parentElement) {
    if (node instanceof HTMLElement && /(auto|scroll|overlay)/.test(getComputedStyle(node).overflowY) && canScroll(node)) return node;
  }
  const root = document.scrollingElement;
  return root instanceof HTMLElement && canScroll(root) ? root : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
