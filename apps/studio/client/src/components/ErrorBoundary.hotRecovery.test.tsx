// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const hot = vi.hoisted(() => {
  const handlers: Record<string, Array<() => void>> = {};
  return {
    source: { on: (event: string, callback: () => void) => { (handlers[event] ||= []).push(callback); } },
    update() {
      handlers["vite:beforeUpdate"]?.forEach(handler => handler());
      handlers["vite:afterUpdate"]?.forEach(handler => handler());
    },
  };
});
const report = vi.hoisted(() => vi.fn());
vi.mock("@/shared/lib/devHotRecovery", async importOriginal => {
  const actual = await importOriginal<typeof import("@/shared/lib/devHotRecovery")>();
  return { ...actual, hotRecovery: actual.createHotRecovery(hot.source) };
});
vi.mock("@/shared/lib/runtimeErrorReport", () => ({ reportRuntimeError: report }));

import ErrorBoundary from "./ErrorBoundary";
import { createHotRecovery, HOT_UPDATE_ERROR_WINDOW_MS } from "@/shared/lib/devHotRecovery";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  report.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  // React reports its own concurrent-render retry as recoverable; the boundary behaviour is asserted directly.
  root = createRoot(container, { onRecoverableError: () => undefined });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("remounts once with fresh state when a hot update breaks the render", async () => {
  let renders = 0;
  function StaleHookPage() {
    renders += 1;
    // React retries a failed concurrent render once by itself; only the boundary's remount succeeds.
    if (renders <= 2) throw new TypeError("observer.getOptimisticResult is not a function");
    return <p>library</p>;
  }
  hot.update();
  await act(async () => root.render(<ErrorBoundary><StaleHookPage /></ErrorBoundary>));
  expect(container.textContent).toBe("library");
  expect(renders).toBe(3);
  expect(report).not.toHaveBeenCalled();
});

it("shows the error page for a half-finished edit and recovers on the next hot update", async () => {
  let broken = true;
  function EditedPage() {
    if (broken) throw new ReferenceError("seedanceFiltered is not defined");
    return <p>seedance</p>;
  }
  hot.update();
  await act(async () => root.render(<ErrorBoundary><EditedPage /></ErrorBoundary>));
  expect(container.querySelector("h2")?.textContent).toBe("页面遇到异常");
  expect(report).not.toHaveBeenCalled();
  broken = false;
  await act(async () => hot.update());
  expect(container.textContent).toBe("seedance");
});

it("keeps reporting errors that are not tied to a recent hot update", async () => {
  hot.update();
  vi.setSystemTime(Date.now() + HOT_UPDATE_ERROR_WINDOW_MS + 1);
  function Broken(): never {
    throw new Error("real failure");
  }
  await act(async () => root.render(<ErrorBoundary><Broken /></ErrorBoundary>));
  expect(container.querySelector("h2")?.textContent).toBe("页面遇到异常");
  expect(report).toHaveBeenCalledTimes(1);
});

it("is inert without a Vite hot context", () => {
  const recovery = createHotRecovery(undefined);
  const listener = vi.fn();
  recovery.subscribe(listener);
  expect(recovery.updateId()).toBe(0);
  expect(recovery.isHotUpdateError()).toBe(false);
});
