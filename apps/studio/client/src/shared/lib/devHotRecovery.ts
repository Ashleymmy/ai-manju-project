/**
 * Development-only recovery for render errors caused by Vite hot updates.
 *
 * Hooks in plain `.ts` modules get no React Fast Refresh signature, so editing the
 * hooks they call keeps stale hook state and can crash the next render. Saving a
 * half-finished edit can also throw briefly. A remount with fresh state fixes both
 * once the code is valid again. Production builds have no `import.meta.hot`, so the
 * recovery is inert there.
 */

/** Render errors this soon after a hot update are attributed to the update. */
export const HOT_UPDATE_ERROR_WINDOW_MS = 3000;

type HotEventSource = {
  on(event: "vite:beforeUpdate" | "vite:afterUpdate", callback: () => void): void;
};

export type HotRecovery = {
  /** Increments for every hot update; 0 when no update has happened. */
  updateId(): number;
  /** True when a render error most likely comes from the latest hot update. */
  isHotUpdateError(): boolean;
  /** Called after each hot update has been applied. */
  subscribe(listener: () => void): () => void;
};

export function createHotRecovery(hot: HotEventSource | undefined, now: () => number = () => Date.now()): HotRecovery {
  let updateId = 0;
  let updatedAt = 0;
  const listeners = new Set<() => void>();
  hot?.on("vite:beforeUpdate", () => {
    updateId += 1;
    updatedAt = now();
  });
  hot?.on("vite:afterUpdate", () => {
    updatedAt = now();
    listeners.forEach(listener => listener());
  });
  return {
    updateId: () => updateId,
    isHotUpdateError: () => updateId > 0 && now() - updatedAt <= HOT_UPDATE_ERROR_WINDOW_MS,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const hotRecovery = createHotRecovery(import.meta.hot);
