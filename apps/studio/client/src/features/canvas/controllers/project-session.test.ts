import { describe, expect, it, vi } from "vitest";

import type { CanvasProject } from "@/entities/project";

import {
  CanvasProjectSessionController,
  type CanvasProjectSessionBindings,
} from "./project-session";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

function project(id: string): CanvasProject {
  return {
    id,
    title: id,
    scope: "personal",
    data: { nodes: [], edges: [], custom: { keep: true } },
    created_at: "created",
    updated_at: "updated",
  };
}

function createHarness(overrides: Partial<CanvasProjectSessionBindings> = {}) {
  const loaded: string[] = [];
  const events: string[] = [];
  const autosave = {
    beginLoad: vi.fn(),
    activate: vi.fn(),
    flush: vi.fn().mockResolvedValue(true),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
  const history = { initialize: vi.fn(), dispose: vi.fn() };
  const controller = new CanvasProjectSessionController(autosave, history);
  controller.updateBindings({
    getProject: vi.fn(async id => project(id)),
    getSnapshot: vi.fn(async id => ({
      project_id: id,
      version: 1,
      data: { nodes: [], edges: [], custom: { keep: true } },
      created_at: "created",
      updated_at: "updated",
    })),
    isNotFound: () => false,
    formatError: error => error instanceof Error ? error.message : "failed",
    createStarterNodes: () => [],
    isUploading: () => false,
    onReset: id => events.push(`reset:${id}`),
    onProjectResolved: id => events.push(`project:${id.id}`),
    onSnapshotWarning: vi.fn(),
    onLoaded: result => loaded.push(result.project.id),
    onLoadError: vi.fn(),
    onSettled: () => events.push("settled"),
    onRedirect: vi.fn(),
    onSwitchingChange: switching => events.push(`switching:${switching}`),
    onLoadingChange: loading => events.push(`loading:${loading}`),
    onBeforeSwitch: () => events.push("before-switch"),
    onWarning: vi.fn(),
    onError: vi.fn(),
    navigate: href => events.push(`navigate:${href}`),
    ...overrides,
  });
  return { controller, autosave, history, loaded, events };
}

describe("CanvasProjectSessionController", () => {
  it("ignores a stale project load after a faster route change", async () => {
    const projectA = deferred<CanvasProject>();
    const projectB = deferred<CanvasProject>();
    const harness = createHarness({
      getProject: vi.fn((id: string) => id === "a" ? projectA.promise : projectB.promise),
    });

    const loadA = harness.controller.startLoad("a", "personal");
    const loadB = harness.controller.startLoad("b", "personal");
    projectA.resolve(project("a"));
    await loadA.completed;
    expect(harness.loaded).toEqual([]);

    projectB.resolve(project("b"));
    await loadB.completed;
    expect(harness.loaded).toEqual(["b"]);
    expect(harness.autosave.activate).toHaveBeenCalledOnce();
    expect(harness.controller.canonicalKey).toBe("personal:b");
  });

  it("flushes the current immutable queue before navigation", async () => {
    const flush = deferred<boolean>();
    const harness = createHarness();
    harness.autosave.flush.mockImplementationOnce(() => flush.promise);
    await harness.controller.startLoad("a", "personal").completed;

    const switching = harness.controller.switchProject("b", "/canvas/b?scope=personal");
    expect(harness.events.at(-2)).toBe("switching:true");
    expect(harness.events.at(-1)).toBe("before-switch");
    expect(harness.events).not.toContain("navigate:/canvas/b?scope=personal");

    flush.resolve(true);
    await expect(switching).resolves.toBe(true);
    expect(harness.events.slice(-2)).toEqual([
      "loading:true",
      "navigate:/canvas/b?scope=personal",
    ]);
  });

  it("reports a project missing in every scope via onProjectMissing instead of a stuck pending state", async () => {
    const notFound = Object.assign(new Error("not found"), { status: 404 });
    const onProjectMissing = vi.fn();
    const onLoadError = vi.fn();
    const harness = createHarness({
      getProject: vi.fn(async () => { throw notFound; }),
      isNotFound: error => (error as { status?: number }).status === 404,
      onProjectMissing,
      onLoadError,
    });

    await harness.controller.startLoad("gone", "personal").completed;

    // 两个工作区都 404 → 走缺失兜底，而不是普通加载失败（避免页面卡在"确认工作区"）
    expect(onProjectMissing).toHaveBeenCalledWith("personal");
    expect(onLoadError).not.toHaveBeenCalled();
    expect(harness.loaded).toEqual([]);
    expect(harness.events).toContain("settled");
  });
});
