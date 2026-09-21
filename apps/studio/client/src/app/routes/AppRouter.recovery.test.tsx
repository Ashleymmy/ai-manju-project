// @vitest-environment jsdom
import { act, lazy, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Link, Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ routes: [] as any[] }));
vi.mock("./routes", () => ({ appRoutes: mocks.routes }));
vi.mock("@/components/AuthGuard", () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../layouts/StudioLayout", () => ({
  default: ({ children }: { children: ReactNode }) => (
    <>
      <nav>
        <Link href="/dashboard">工作台</Link>
        <Link href="/image">图片</Link>
        <Link href="/pending">加载页</Link>
      </nav>
      <main>{children}</main>
    </>
  ),
}));
import AppRouter from "./AppRouter";
import AppRecoveryBoundary from "../providers/AppRecoveryBoundary";

describe("page switch error containment", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mocks.routes.splice(0);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  function route(path: string, Component: any) {
    mocks.routes.push({
      id: path,
      path,
      layout: "studio",
      permission: "public",
      Component,
    });
  }
  async function click(label: string) {
    await act(async () =>
      [
        ...container.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>(
          "button, a"
        ),
      ]
        .find(element => element.textContent === label)!
        .click()
    );
  }

  it("keeps navigation available during lazy loading and page failure, and retries without remounting the shell", async () => {
    let broken = true;
    function Image() {
      if (broken) throw new Error("temporary page failure");
      return <p>图片已恢复</p>;
    }
    route("/dashboard", () => <p>正常工作台</p>);
    route("/image", Image);
    let resolvePage!: (module: { default: () => ReactNode }) => void;
    route(
      "/pending",
      lazy(
        () =>
          new Promise<{ default: () => ReactNode }>(resolve => {
            resolvePage = resolve;
          })
      )
    );
    const location = memoryLocation({ path: "/dashboard" });
    await act(async () =>
      root.render(
        <Router hook={location.hook}>
          <AppRecoveryBoundary>
            <AppRouter />
          </AppRecoveryBoundary>
        </Router>
      )
    );
    await click("图片");
    const nav = container.querySelector("nav");
    expect(nav).not.toBeNull();
    expect(container.textContent).toContain("页面遇到异常");
    broken = false;
    await click("重试此页面");
    expect(container.textContent).toContain("图片已恢复");
    expect(container.querySelector("nav")).toBe(nav);
    await click("加载页");
    expect(container.querySelector("nav")).not.toBeNull();
    expect(container.textContent).toContain("连接工作区");
    // Navigate away before a slow page resolves; its late completion must not replace the current route.
    await click("工作台");
    await act(async () => resolvePage({ default: () => <p>过期页面</p> }));
    expect(container.textContent).toContain("正常工作台");
    expect(container.textContent).not.toContain("过期页面");
  });

  it("lets navigation escape an error thrown while unmounting the previous page", async () => {
    function Departing() {
      useEffect(
        () => () => {
          throw new Error("cleanup failed");
        },
        []
      );
      return <p>旧页面</p>;
    }
    function Body() {
      const [path] = useLocation();
      return path === "/old" ? <Departing /> : <p>正常页面 {path}</p>;
    }
    const location = memoryLocation({ path: "/old" });
    await act(async () =>
      root.render(
        <Router hook={location.hook}>
          <AppRecoveryBoundary>
            <Body />
          </AppRecoveryBoundary>
        </Router>
      )
    );
    await act(async () => location.navigate("/image"));
    expect(container.textContent).toContain("页面遇到异常");
    await act(async () => location.navigate("/dashboard"));
    expect(container.textContent).toContain("正常页面 /dashboard");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
