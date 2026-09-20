import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isModuleLoadError } from "@/shared/lib/moduleLoadError";
import { claimRouteReload, loadRouteModule, ROUTE_RELOAD_COOLDOWN_MS, ROUTE_RELOAD_KEY } from "./loadRouteModule";

describe("route module recovery", () => {
  const moduleError = new TypeError("Failed to fetch dynamically imported module: https://studio.test/assets/page-old.js");
  let values: Map<string, string>;
  let storage: Pick<Storage, "getItem" | "setItem">;
  let location: { href: string; reload: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    values = new Map();
    storage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
    };
    location = { href: "https://studio.test/canvas/project?scope=team#node", reload: vi.fn() };
    vi.stubGlobal("window", { location, sessionStorage: storage, setTimeout });
    vi.stubGlobal("navigator", { onLine: true });
  });

  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("returns successful imports without touching reload protection", async () => {
    const module = { default: () => null };
    expect(await loadRouteModule(async () => module)).toBe(module);
    expect(values.size).toBe(0);
    expect(location.reload).not.toHaveBeenCalled();
  });

  it.each([
    "Failed to fetch dynamically imported module: /assets/page.js",
    "error loading dynamically imported module: /assets/page.js",
    "Importing a module script failed.",
    "Unable to preload CSS for /assets/page.css",
    "Loading chunk 27 failed.",
  ])("recognizes module transport failures: %s", message => {
    expect(isModuleLoadError(new TypeError(message))).toBe(true);
  });

  it.each([new Error("render failed"), new TypeError("Failed to fetch"), new SyntaxError("Unexpected token")])(
    "does not reload for unrelated errors: %s", async error => {
      await expect(loadRouteModule(async () => { throw error; })).rejects.toBe(error);
      expect(location.reload).not.toHaveBeenCalled();
    },
  );

  it("reloads the same URL once and exits loading if the browser cancels navigation", async () => {
    const result = loadRouteModule(async () => { throw moduleError; }).catch(error => error);
    await vi.runAllTimersAsync();
    expect(await result).toBe(moduleError);
    expect(location.reload).toHaveBeenCalledTimes(1);
    expect(location.href).toBe("https://studio.test/canvas/project?scope=team#node");
    expect(values.has(ROUTE_RELOAD_KEY)).toBe(true);
    await expect(loadRouteModule(async () => { throw moduleError; })).rejects.toBe(moduleError);
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("shares the circuit breaker between simultaneous layout and page failures", async () => {
    const results = [1, 2].map(() => loadRouteModule(async () => { throw moduleError; }).catch(error => error));
    await vi.runAllTimersAsync();
    expect(await Promise.all(results)).toEqual([moduleError, moduleError]);
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("keeps protection across new loader instances and only expires after the cooldown", () => {
    expect(claimRouteReload(storage, 1000)).toBe(true);
    expect(claimRouteReload({ ...storage }, 1001)).toBe(false);
    expect(claimRouteReload(storage, 1000 + ROUTE_RELOAD_COOLDOWN_MS)).toBe(true);
  });

  it("does not auto-reload offline or after the user has navigated elsewhere", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await expect(loadRouteModule(async () => { throw moduleError; })).rejects.toBe(moduleError);
    vi.stubGlobal("navigator", { onLine: true });
    await expect(loadRouteModule(async () => {
      location.href = "https://studio.test/dashboard";
      throw moduleError;
    })).rejects.toBe(moduleError);
    expect(location.reload).not.toHaveBeenCalled();
  });

  it("never loops when browser storage is unavailable", async () => {
    storage.setItem = () => { throw new Error("storage blocked"); };
    await expect(loadRouteModule(async () => { throw moduleError; })).rejects.toBe(moduleError);
    expect(location.reload).not.toHaveBeenCalled();
    Object.defineProperty(window, "sessionStorage", { get() { throw new Error("access blocked"); } });
    await expect(loadRouteModule(async () => { throw moduleError; })).rejects.toBe(moduleError);
    expect(location.reload).not.toHaveBeenCalled();
  });
});
