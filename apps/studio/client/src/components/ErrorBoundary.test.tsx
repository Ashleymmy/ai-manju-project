// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ErrorBoundary from "./ErrorBoundary";
import {
  notePageNavigation,
  PAGE_ERROR_REPORT_KEY,
} from "@/shared/lib/pageErrorReport";

describe("ErrorBoundary route recovery", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not remount healthy editors when the project URL changes", async () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    function Editor() {
      useEffect(() => {
        mount();
        return unmount;
      }, []);
      return <textarea defaultValue="unsaved draft" />;
    }
    await act(async () =>
      root.render(
        <ErrorBoundary resetKey="/canvas/a">
          <Editor />
        </ErrorBoundary>
      )
    );
    const input = container.querySelector("textarea");
    await act(async () =>
      root.render(
        <ErrorBoundary resetKey="/canvas/b">
          <Editor />
        </ErrorBoundary>
      )
    );
    expect(container.querySelector("textarea")).toBe(input);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(unmount).not.toHaveBeenCalled();
  });

  it("clears an existing error only when navigating to a different page", async () => {
    function Broken(): never {
      throw new Error("render failure");
    }
    await act(async () =>
      root.render(
        <ErrorBoundary resetKey="/broken">
          <Broken />
        </ErrorBoundary>
      )
    );
    expect(container.querySelector("h2")?.textContent).toBe("页面遇到异常");
    await act(async () =>
      root.render(
        <ErrorBoundary resetKey="/broken">
          <p>healthy</p>
        </ErrorBoundary>
      )
    );
    expect(container.querySelector("h2")).not.toBeNull();
    await act(async () =>
      root.render(
        <ErrorBoundary resetKey="/healthy">
          <p>healthy</p>
        </ErrorBoundary>
      )
    );
    expect(container.textContent).toBe("healthy");
  });

  it("offers a readable module fallback without initiating a reload itself", async () => {
    function BrokenDialog(): never {
      throw new TypeError(
        "Failed to fetch dynamically imported module: /assets/dialog.js"
      );
    }
    const reloadGuard = window.sessionStorage.getItem(
      "ai-manju:route-module-reload"
    );
    await act(async () =>
      root.render(
        <ErrorBoundary>
          <BrokenDialog />
        </ErrorBoundary>
      )
    );
    expect(container.querySelector("h2")?.textContent).toBe("页面暂时未能加载");
    expect(container.querySelector("button")?.textContent).toBe("重新加载");
    expect(container.querySelector("button")?.style.color).toBe(
      "rgb(23, 23, 23)"
    );
    expect(window.sessionStorage.getItem("ai-manju:route-module-reload")).toBe(
      reloadGuard
    );
  });

  it("retries a transient render error in place without reloading the app", async () => {
    let broken = true;
    const mountShell = vi.fn();
    function Page() {
      if (broken) throw new Error("temporary failure");
      return <p>restored page</p>;
    }
    function Shell() {
      useEffect(mountShell, []);
      return (
        <>
          <nav>navigation</nav>
          <ErrorBoundary>
            <Page />
          </ErrorBoundary>
        </>
      );
    }
    await act(async () => root.render(<Shell />));
    expect(container.querySelector("nav")?.textContent).toBe("navigation");
    broken = false;
    await act(async () =>
      container.querySelector<HTMLButtonElement>("button")!.click()
    );
    expect(container.textContent).toContain("restored page");
    expect(mountShell).toHaveBeenCalledTimes(1);
  });

  it("stores the last crash and navigation even after recovery", async () => {
    window.history.replaceState(null, "", "/image?private=value#draft");
    notePageNavigation("/assets");
    notePageNavigation("/image");
    function Broken(): never {
      throw new Error("intermittent route failure");
    }
    await act(async () =>
      root.render(
        <ErrorBoundary resetKey="/image">
          <Broken />
        </ErrorBoundary>
      )
    );
    const report = JSON.parse(sessionStorage.getItem(PAGE_ERROR_REPORT_KEY)!);
    expect(report).toMatchObject({
      path: "/image",
      fromPath: "/assets",
      message: "intermittent route failure",
    });
    expect(report.componentStack).toContain("Broken");
    expect(report.path).not.toContain("private");
    await act(async () =>
      root.render(
        <ErrorBoundary resetKey="/assets">
          <p>healthy</p>
        </ErrorBoundary>
      )
    );
    expect(JSON.parse(sessionStorage.getItem(PAGE_ERROR_REPORT_KEY)!)).toEqual(
      report
    );
  });

  it("still offers recovery when session storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    function Broken(): never {
      throw new Error("page error");
    }
    await act(async () =>
      root.render(
        <ErrorBoundary>
          <Broken />
        </ErrorBoundary>
      )
    );
    expect(container.querySelector("button")?.textContent).toBe("重试此页面");
  });
});
