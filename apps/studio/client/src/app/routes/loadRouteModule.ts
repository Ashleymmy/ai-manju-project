import { isModuleLoadError } from "@/shared/lib/moduleLoadError";

/** Shared across routes and reloads so a broken deployment cannot loop. */
export const ROUTE_RELOAD_KEY = "ai-manju:route-module-reload";
/** At most one automatic recovery per tab in this interval. */
export const ROUTE_RELOAD_COOLDOWN_MS = 5 * 60 * 1000;
/** If navigation is cancelled, leave the loading state and offer manual recovery. */
const RELOAD_SETTLE_MS = 1500;

export function claimRouteReload(storage: Pick<Storage, "getItem" | "setItem">, now = Date.now()): boolean {
  try {
    const previous = Number(storage.getItem(ROUTE_RELOAD_KEY));
    if (previous > 0 && now - previous < ROUTE_RELOAD_COOLDOWN_MS) return false;
    storage.setItem(ROUTE_RELOAD_KEY, String(now));
    return true;
  } catch {
    // Without persistent loop protection, automatic reload is unsafe.
    return false;
  }
}

/** Only wrap route/layout imports, not dialogs opened inside an active editor. */
export async function loadRouteModule<T>(loader: () => Promise<T>): Promise<T> {
  const href = window.location.href;
  try {
    return await loader();
  } catch (error) {
    if (isModuleLoadError(error) && navigator.onLine && window.location.href === href) {
      try {
        if (claimRouteReload(window.sessionStorage)) {
          // Browsers cache rejected module imports. Reload the current URL to
          // obtain a fresh entry graph, preserving its path, query and hash.
          window.location.reload();
          await new Promise(resolve => window.setTimeout(resolve, RELOAD_SETTLE_MS));
        }
      } catch {
        // Storage or navigation may be blocked by browser policy.
      }
    }
    throw error;
  }
}
