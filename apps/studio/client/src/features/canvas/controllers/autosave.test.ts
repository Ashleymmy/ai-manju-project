import { describe, expect, it, vi } from "vitest";

import type { CanvasSnapshotResponse } from "@/entities/project";

import {
  CANVAS_AUTOSAVE_DELAY_MS,
  CanvasAutosaveController,
  type CanvasAutosaveBindings,
  type CanvasAutosaveScheduler,
  type CanvasSnapshotCapture,
} from "./autosave";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function saved(version: number): CanvasSnapshotResponse {
  return {
    project_id: "project",
    version,
    data: {},
    created_at: `created-${version}`,
    updated_at: `updated-${version}`,
  };
}

function capture(id: string): CanvasSnapshotCapture {
  return {
    nodes: [{ id, kind: "text", title: id, content: "", x: 0, y: 0, width: 10, height: 10 }],
    edges: [],
    groups: [],
    zoom: 90,
    panX: 1,
    panY: 2,
    backgroundMode: "lines",
    showImageInfo: false,
  };
}

function createScheduler() {
  let sequence = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const scheduler: CanvasAutosaveScheduler = {
    setTimer(callback, delay) {
      const timer = ++sequence;
      timers.set(timer, { callback, delay });
      return timer as ReturnType<typeof setTimeout>;
    },
    clearTimer(timer) {
      timers.delete(timer as number);
    },
  };
  return {
    scheduler,
    timers,
    run(delay: number) {
      const match = [...timers.entries()].find(([, timer]) => timer.delay === delay);
      if (!match) throw new Error(`Missing timer with delay ${delay}`);
      timers.delete(match[0]);
      match[1].callback();
    },
  };
}

function createController(
  saveSnapshot: CanvasAutosaveBindings["saveSnapshot"],
  scheduler?: CanvasAutosaveScheduler,
) {
  let current = capture("current");
  let switching = false;
  const patches: unknown[] = [];
  const onDisposed = vi.fn();
  const controller = new CanvasAutosaveController(scheduler);
  controller.updateBindings({
    capture: () => current,
    saveSnapshot,
    formatError: error => error instanceof Error ? error.message : "save failed",
    isSwitching: () => switching,
    onSessionPatch: patch => patches.push(patch),
    onWarning: vi.fn(),
    onSuccess: vi.fn(),
    onError: vi.fn(),
    onDisposed,
  });
  return {
    controller,
    patches,
    onDisposed,
    setCapture(next: CanvasSnapshotCapture) { current = next; },
    setSwitching(next: boolean) { switching = next; },
  };
}

function activate(controller: CanvasAutosaveController, projectId = "project-a", scope: "personal" | "team" = "personal") {
  controller.beginLoad(projectId);
  controller.activate({
    projectId,
    scope,
    key: `${scope}:${projectId}`,
    base: { extension: { keep: true } },
    writeReady: true,
  });
}

async function nextMicrotask() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("CanvasAutosaveController", () => {
  it("serializes immutable save envelopes without dropping unknown fields", async () => {
    const firstSave = deferred<CanvasSnapshotResponse>();
    const secondSave = deferred<CanvasSnapshotResponse>();
    const saveSnapshot = vi.fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);
    const harness = createController(saveSnapshot);
    activate(harness.controller);

    const firstCapture = capture("first");
    const first = harness.controller.persist(firstCapture, { quiet: true });
    firstCapture.nodes[0].title = "mutated-after-enqueue";
    const second = harness.controller.persist(capture("second"), { quiet: true });
    await nextMicrotask();

    expect(saveSnapshot).toHaveBeenCalledTimes(1);
    const firstPayload = saveSnapshot.mock.calls[0][1] as Record<string, unknown>;
    expect(firstPayload).toMatchObject({ extension: { keep: true } });
    expect((firstPayload.nodes as Array<{ title: string }>)[0].title).toBe("first");

    firstSave.resolve(saved(1));
    await first;
    await nextMicrotask();
    expect(saveSnapshot).toHaveBeenCalledTimes(2);
    expect(saveSnapshot.mock.calls[1].slice(0, 1)).toEqual(["project-a"]);
    expect(saveSnapshot.mock.calls[1][2]).toBe("personal");
    secondSave.resolve(saved(2));
    await expect(second).resolves.toBe(true);
  });

  it("continues the serial queue after a failed save", async () => {
    const saveSnapshot = vi.fn()
      .mockRejectedValueOnce(new Error("first failed"))
      .mockResolvedValueOnce(saved(2));
    const harness = createController(saveSnapshot);
    activate(harness.controller);

    const first = harness.controller.persist(capture("first"), { quiet: true });
    const second = harness.controller.persist(capture("second"), { quiet: true });

    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    expect(saveSnapshot).toHaveBeenCalledTimes(2);
    expect(harness.patches).toContainEqual({ syncStatus: "error", syncError: "first failed" });
    expect(harness.patches).toContainEqual(expect.objectContaining({ syncStatus: "synced" }));
  });

  it("uses a deterministic debounce and preserves the first-load dirty skip", async () => {
    const clock = createScheduler();
    const saveSnapshot = vi.fn().mockResolvedValue(saved(1));
    const harness = createController(saveSnapshot, clock.scheduler);
    activate(harness.controller);

    harness.controller.observe(true, capture("hydrated"));
    expect(clock.timers.size).toBe(0);
    harness.controller.observe(true, capture("edited"));
    expect(harness.controller.currentRevision).toBe(1);
    expect([...clock.timers.values()][0].delay).toBe(CANVAS_AUTOSAVE_DELAY_MS);

    clock.run(CANVAS_AUTOSAVE_DELAY_MS);
    await harness.controller.drain();
    expect(saveSnapshot).toHaveBeenCalledOnce();
    expect((saveSnapshot.mock.calls[0][1].nodes as Array<{ id: string }>)[0].id).toBe("edited");
  });

  it("drops queued writes after a session changes and never retargets their payload", async () => {
    const slowSave = deferred<CanvasSnapshotResponse>();
    const saveSnapshot = vi.fn()
      .mockImplementationOnce(() => slowSave.promise)
      .mockResolvedValue(saved(2));
    const harness = createController(saveSnapshot);
    activate(harness.controller, "project-a", "personal");

    const active = harness.controller.persist(capture("active"), { quiet: true });
    const staleQueued = harness.controller.persist(capture("stale"), { quiet: true });
    await nextMicrotask();
    harness.controller.beginLoad("project-b");
    harness.controller.activate({
      projectId: "project-b",
      scope: "team",
      key: "team:project-b",
      base: { extension: "project-b" },
      writeReady: true,
    });
    slowSave.resolve(saved(1));

    await expect(active).resolves.toBe(true);
    await expect(staleQueued).resolves.toBe(false);
    await expect(harness.controller.persist(capture("late-stale"), {
      quiet: true,
      expectedKey: "personal:project-a",
    })).resolves.toBe(false);
    const next = harness.controller.persist(capture("project-b"), { quiet: true });
    await expect(next).resolves.toBe(true);
    expect(saveSnapshot).toHaveBeenCalledTimes(2);
    expect(saveSnapshot.mock.calls.map(call => [call[0], call[2]])).toEqual([
      ["project-a", "personal"],
      ["project-b", "team"],
    ]);
  });

  it("blocks new writes before disposal waits for the existing queue", async () => {
    const slowSave = deferred<CanvasSnapshotResponse>();
    const saveSnapshot = vi.fn(() => slowSave.promise);
    const harness = createController(saveSnapshot);
    activate(harness.controller);
    const active = harness.controller.persist(capture("active"), { quiet: true });
    await nextMicrotask();

    const disposing = harness.controller.dispose();
    await expect(harness.controller.persist()).resolves.toBe(false);
    expect(harness.onDisposed).not.toHaveBeenCalled();
    slowSave.resolve(saved(1));
    await expect(active).resolves.toBe(true);
    await disposing;

    expect(saveSnapshot).toHaveBeenCalledOnce();
    expect(harness.onDisposed).toHaveBeenCalledOnce();
  });
});
