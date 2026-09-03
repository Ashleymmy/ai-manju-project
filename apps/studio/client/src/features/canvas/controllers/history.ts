import {
  commitCanvasHistory,
  redoCanvasHistory,
  undoCanvasHistory,
  type CanvasHistoryStack,
} from "@/features/canvas/domain/history";
import type { CanvasSnapshotState } from "@/features/canvas/domain/types";

export const CANVAS_HISTORY_COMMIT_DELAY_MS = 180;

export type CanvasHistoryAvailability = {
  canUndo: boolean;
  canRedo: boolean;
};

export type CanvasHistorySource = Pick<
  CanvasSnapshotState,
  "nodes" | "edges" | "groups" | "backgroundMode" | "showImageInfo"
>;

export type CanvasHistoryScheduler = {
  setTimer(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
};

export type CanvasHistoryBindings = {
  capture(): CanvasSnapshotState;
  getSource(): CanvasHistorySource;
  apply(entry: CanvasSnapshotState): void;
  onAvailabilityChange(availability: CanvasHistoryAvailability): void;
  onResumeChanged(): void;
};

const defaultScheduler: CanvasHistoryScheduler = {
  setTimer: (callback, delay) => setTimeout(callback, delay),
  clearTimer: timer => clearTimeout(timer),
};

const emptyBindings: CanvasHistoryBindings = {
  capture: () => {
    throw new Error("Canvas history bindings are not initialized");
  },
  getSource: () => {
    throw new Error("Canvas history bindings are not initialized");
  },
  apply: () => {
    throw new Error("Canvas history bindings are not initialized");
  },
  onAvailabilityChange: () => undefined,
  onResumeChanged: () => undefined,
};

function sameSource(
  left: CanvasHistorySource | null,
  right: CanvasHistorySource,
) {
  return Boolean(
    left
      && left.nodes === right.nodes
      && left.edges === right.edges
      && left.groups === right.groups
      && left.backgroundMode === right.backgroundMode
      && left.showImageInfo === right.showImageInfo,
  );
}

function sourceFromEntry(entry: CanvasSnapshotState): CanvasHistorySource {
  return {
    nodes: entry.nodes,
    edges: entry.edges,
    groups: entry.groups,
    backgroundMode: entry.backgroundMode,
    showImageInfo: entry.showImageInfo,
  };
}

export class CanvasHistoryController {
  private bindings = emptyBindings;
  private stack: CanvasHistoryStack<CanvasSnapshotState> = { past: [], future: [] };
  private lastEntry: CanvasSnapshotState | null = null;
  private lastSource: CanvasHistorySource | null = null;
  private commitTimer: ReturnType<typeof setTimeout> | null = null;
  private applyTimer: ReturnType<typeof setTimeout> | null = null;
  private applying = false;
  private paused = false;
  private disposed = false;

  constructor(private readonly scheduler = defaultScheduler) {}

  updateBindings(bindings: CanvasHistoryBindings) {
    this.bindings = bindings;
  }

  get isApplying() {
    return this.applying;
  }

  get isPaused() {
    return this.paused;
  }

  initialize(entry: CanvasSnapshotState, source: CanvasHistorySource) {
    if (this.disposed) return;
    this.clearCommitTimer();
    this.clearApplyTimer();
    this.stack = { past: [], future: [] };
    this.lastEntry = entry;
    this.lastSource = source;
    this.applying = false;
    this.paused = false;
    this.emitAvailability();
  }

  commit() {
    if (this.disposed || this.applying || this.paused) return false;
    const source = this.bindings.getSource();
    if (sameSource(this.lastSource, source)) return false;

    const previous = this.lastEntry;
    const current = this.bindings.capture();
    this.lastEntry = current;
    this.lastSource = source;
    if (!previous) return false;

    this.stack = commitCanvasHistory(this.stack, previous);
    this.emitAvailability();
    return true;
  }

  schedule(enabled: boolean) {
    this.clearCommitTimer();
    if (
      !enabled
      || this.disposed
      || this.applying
      || this.paused
      || sameSource(this.lastSource, this.bindings.getSource())
    ) {
      return () => undefined;
    }

    const timer = this.scheduler.setTimer(() => {
      if (this.commitTimer !== timer) return;
      this.commitTimer = null;
      this.commit();
    }, CANVAS_HISTORY_COMMIT_DELAY_MS);
    this.commitTimer = timer;
    return () => {
      if (this.commitTimer === timer) this.clearCommitTimer();
    };
  }

  undo() {
    if (this.disposed || this.paused) return false;
    this.clearCommitTimer();
    this.commit();
    const current = this.lastEntry;
    if (!current) return false;
    const result = undoCanvasHistory(this.stack, current);
    if (!result) return false;
    this.stack = result.stack;
    this.apply(result.entry);
    return true;
  }

  redo() {
    if (this.disposed || this.paused) return false;
    this.clearCommitTimer();
    this.commit();
    const current = this.lastEntry;
    if (!current) return false;
    const result = redoCanvasHistory(this.stack, current);
    if (!result) return false;
    this.stack = result.stack;
    this.apply(result.entry);
    return true;
  }

  pause() {
    if (this.disposed) return;
    this.clearCommitTimer();
    this.commit();
    this.paused = true;
  }

  resume(changed: boolean) {
    if (this.disposed) return;
    this.paused = false;
    if (changed) this.bindings.onResumeChanged();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearCommitTimer();
    this.clearApplyTimer();
    this.bindings = emptyBindings;
    this.lastEntry = null;
    this.lastSource = null;
    this.stack = { past: [], future: [] };
  }

  private apply(entry: CanvasSnapshotState) {
    this.clearCommitTimer();
    this.clearApplyTimer();
    this.applying = true;
    this.bindings.apply(entry);
    this.applyTimer = this.scheduler.setTimer(() => {
      this.applyTimer = null;
      this.lastEntry = entry;
      this.lastSource = sourceFromEntry(entry);
      this.applying = false;
      this.emitAvailability();
    }, 0);
  }

  private emitAvailability() {
    this.bindings.onAvailabilityChange({
      canUndo: this.stack.past.length > 0,
      canRedo: this.stack.future.length > 0,
    });
  }

  private clearCommitTimer() {
    if (this.commitTimer === null) return;
    this.scheduler.clearTimer(this.commitTimer);
    this.commitTimer = null;
  }

  private clearApplyTimer() {
    if (this.applyTimer === null) return;
    this.scheduler.clearTimer(this.applyTimer);
    this.applyTimer = null;
  }
}
