/** Sidebar proximity and easing are decorative; values must always stay in [0, 1]. */
export const SIDEBAR_POINTER_RADIUS_PX = 100;
const SIDEBAR_EASING_SECONDS = 0.1;
const SIDEBAR_MAX_FRAME_SECONDS = 0.05;
const SIDEBAR_SETTLED_THRESHOLD = 0.0015;

export function clampSidebarEffect(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function nextSidebarEffect(current: number, target: number, elapsedMs: number) {
  const from = clampSidebarEffect(current);
  const to = clampSidebarEffect(target);
  const seconds = Number.isFinite(elapsedMs)
    ? Math.max(0, Math.min(elapsedMs / 1000, SIDEBAR_MAX_FRAME_SECONDS)) : 0;
  const next = from + (to - from) * (1 - Math.exp(-seconds / SIDEBAR_EASING_SECONDS));
  return Math.abs(to - next) < SIDEBAR_SETTLED_THRESHOLD ? to : clampSidebarEffect(next);
}
