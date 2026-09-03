import { describe, expect, it, vi } from "vitest";

import type { CanvasSnapshotState } from "@/features/canvas/domain/types";

import {
  CANVAS_HISTORY_COMMIT_DELAY_MS,
  CanvasHistoryController,
  type CanvasHistoryScheduler,
  type CanvasHistorySource,
} from "./history";

function snapshot(id: string): CanvasSnapshotState {
  return {
    nodes: [{ id, kind: "text", title: id, content: "", x: 0, y: 0, width: 10, height: 10 }],
    edges: [],
    groups: [],
    backgroundMode: "lines",
    showImageInfo: false,
  };
}

function createScheduler() {
  let sequence = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const scheduler: CanvasHistoryScheduler = {
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

function source(entry: CanvasSnapshotState): CanvasHistorySource {
  return {
    nodes: entry.nodes,
    edges: entry.edges,
    groups: entry.groups,
    backgroundMode: entry.backgroundMode,
    showImageInfo: entry.showImageInfo,
  };
}

describe("CanvasHistoryController", () => {
  it("debounces commits and preserves undo/redo ordering", () => {
    const clock = createScheduler();
    const first = snapshot("first");
    let current = first;
    const applied: string[] = [];
    const availability = vi.fn();
    const controller = new CanvasHistoryController(clock.scheduler);
    controller.updateBindings({
      capture: () => structuredClone(current),
      getSource: () => source(current),
      apply(entry) {
        current = entry;
        applied.push(entry.nodes[0].id);
      },
      onAvailabilityChange: availability,
      onResumeChanged: vi.fn(),
    });
    controller.initialize(structuredClone(first), source(first));

    current = snapshot("second");
    controller.schedule(true);
    expect([...clock.timers.values()].map(timer => timer.delay)).toEqual([
      CANVAS_HISTORY_COMMIT_DELAY_MS,
    ]);
    clock.run(CANVAS_HISTORY_COMMIT_DELAY_MS);
    expect(availability).toHaveBeenLastCalledWith({ canUndo: true, canRedo: false });

    expect(controller.undo()).toBe(true);
    expect(applied).toEqual(["first"]);
    clock.run(0);
    expect(availability).toHaveBeenLastCalledWith({ canUndo: false, canRedo: true });

    expect(controller.redo()).toBe(true);
    expect(applied).toEqual(["first", "second"]);
    clock.run(0);
    expect(availability).toHaveBeenLastCalledWith({ canUndo: true, canRedo: false });
  });

  it("aligns pause/resume with one interaction history transaction", () => {
    const clock = createScheduler();
    const first = snapshot("first");
    let current = first;
    const onResumeChanged = vi.fn(() => {
      current = { ...current, nodes: [...current.nodes] };
    });
    const controller = new CanvasHistoryController(clock.scheduler);
    controller.updateBindings({
      capture: () => structuredClone(current),
      getSource: () => source(current),
      apply: entry => { current = entry; },
      onAvailabilityChange: vi.fn(),
      onResumeChanged,
    });
    controller.initialize(structuredClone(first), source(first));

    controller.pause();
    current = snapshot("dragged");
    expect(controller.commit()).toBe(false);
    controller.resume(true);
    expect(onResumeChanged).toHaveBeenCalledOnce();
    controller.schedule(true);
    clock.run(CANVAS_HISTORY_COMMIT_DELAY_MS);

    expect(controller.undo()).toBe(true);
    expect(current.nodes[0].id).toBe("first");
  });

  it("cancels pending work when disposed", () => {
    const clock = createScheduler();
    const first = snapshot("first");
    let current = first;
    const apply = vi.fn();
    const controller = new CanvasHistoryController(clock.scheduler);
    controller.updateBindings({
      capture: () => structuredClone(current),
      getSource: () => source(current),
      apply,
      onAvailabilityChange: vi.fn(),
      onResumeChanged: vi.fn(),
    });
    controller.initialize(structuredClone(first), source(first));
    current = snapshot("second");
    controller.schedule(true);

    controller.dispose();
    expect(clock.timers.size).toBe(0);
    expect(controller.undo()).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });
});
