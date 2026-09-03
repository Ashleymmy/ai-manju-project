import type { CanvasSnapshotResponse } from "@/entities/project";
import type { CanvasGroupData } from "@/features/canvas/domain/groups";
import { buildCanvasSnapshot } from "@/features/canvas/domain/snapshotCodec";
import type { CanvasSnapshotBase } from "@/features/canvas/domain/snapshotRoundTrip";
import type {
  CanvasBackgroundMode,
  CanvasEdgeData,
  CanvasNodeData,
} from "@/features/canvas/domain/types";
import type { CanvasSyncStatus } from "@/features/canvas/model/store";
import type { WorkspaceScope } from "@/shared/config";

export const CANVAS_AUTOSAVE_DELAY_MS = 1_200;

export const CANVAS_SAVE_MESSAGES = {
  scopePending: "正在确认项目工作区，保存已暂停以避免写入错误空间",
  snapshotUnavailable: "未取得完整原始快照，保存已暂停以保护现有画布数据",
  success: "画布快照已保存",
  failure: "保存画布快照失败",
} as const;

export type CanvasSnapshotCapture = {
  nodes: CanvasNodeData[];
  edges: CanvasEdgeData[];
  groups: CanvasGroupData[];
  zoom: number;
  panX: number;
  panY: number;
  backgroundMode: CanvasBackgroundMode;
  showImageInfo: boolean;
};

export type CanvasAutosaveSession = {
  projectId: string;
  scope: WorkspaceScope;
  key: string;
  base: CanvasSnapshotBase | null;
  writeReady: boolean;
};

export type CanvasAutosaveSessionPatch = {
  saving?: boolean;
  snapshotVersion?: number;
  snapshotUpdatedAt?: string;
  snapshotWriteReady?: boolean;
  syncError?: string;
  syncStatus?: CanvasSyncStatus;
};

export type CanvasAutosaveScheduler = {
  setTimer(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
};

export type CanvasAutosaveBindings = {
  capture(): CanvasSnapshotCapture;
  saveSnapshot(
    projectId: string,
    snapshot: CanvasSnapshotBase,
    scope: WorkspaceScope,
  ): Promise<CanvasSnapshotResponse>;
  formatError(error: unknown, fallback: string): string;
  isSwitching(): boolean;
  onSessionPatch(patch: CanvasAutosaveSessionPatch): void;
  onWarning(message: string): void;
  onSuccess(message: string): void;
  onError(message: string): void;
  onDisposed?(): void;
};

type CanvasSaveEnvelope = Readonly<{
  projectId: string;
  scope: WorkspaceScope;
  key: string;
  sessionGeneration: number;
  revision: number;
  quiet: boolean;
  snapshot: CanvasSnapshotBase;
}>;

type ActiveCanvasAutosaveSession = CanvasAutosaveSession & {
  sessionGeneration: number;
};

const defaultScheduler: CanvasAutosaveScheduler = {
  setTimer: (callback, delay) => setTimeout(callback, delay),
  clearTimer: timer => clearTimeout(timer),
};

const emptyBindings: CanvasAutosaveBindings = {
  capture: () => {
    throw new Error("Canvas autosave bindings are not initialized");
  },
  saveSnapshot: async () => {
    throw new Error("Canvas autosave bindings are not initialized");
  },
  formatError: (_error, fallback) => fallback,
  isSwitching: () => false,
  onSessionPatch: () => undefined,
  onWarning: () => undefined,
  onSuccess: () => undefined,
  onError: () => undefined,
};

export class CanvasAutosaveController {
  private bindings = emptyBindings;
  private requestedProjectId = "";
  private activeSession: ActiveCanvasAutosaveSession | null = null;
  private sessionGeneration = 0;
  private revision = 0;
  private skipNextDirty = true;
  private saveQueue: Promise<void> = Promise.resolve();
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private acceptingWrites = true;
  private disposing: Promise<void> | null = null;

  constructor(private readonly scheduler = defaultScheduler) {}

  updateBindings(bindings: CanvasAutosaveBindings) {
    this.bindings = bindings;
  }

  get currentRevision() {
    return this.revision;
  }

  get snapshotBase() {
    return this.activeSession?.base ?? null;
  }

  beginLoad(projectId: string) {
    this.cancelScheduledSave();
    this.sessionGeneration += 1;
    this.requestedProjectId = projectId;
    this.activeSession = null;
    this.revision = 0;
    this.skipNextDirty = true;
  }

  activate(session: CanvasAutosaveSession) {
    if (!this.acceptingWrites) return;
    this.requestedProjectId = session.projectId;
    this.activeSession = { ...session, sessionGeneration: this.sessionGeneration };
  }

  observe(enabled: boolean, capture: CanvasSnapshotCapture) {
    this.cancelScheduledSave();
    if (!enabled || !this.acceptingWrites) return () => undefined;
    if (this.skipNextDirty) {
      this.skipNextDirty = false;
      return () => undefined;
    }

    this.revision += 1;
    this.bindings.onSessionPatch({ syncStatus: "pending", syncError: "" });
    const timer = this.scheduler.setTimer(() => {
      if (this.autosaveTimer !== timer) return;
      this.autosaveTimer = null;
      void this.persist(capture, { quiet: true });
    }, CANVAS_AUTOSAVE_DELAY_MS);
    this.autosaveTimer = timer;
    return () => {
      if (this.autosaveTimer === timer) this.cancelScheduledSave();
    };
  }

  persist(
    capture?: CanvasSnapshotCapture,
    options: { quiet?: boolean; expectedKey?: string } = {},
  ): Promise<boolean> {
    const quiet = options.quiet === true;
    if (!this.acceptingWrites) return Promise.resolve(false);
    if (!this.requestedProjectId) return Promise.resolve(true);
    if (quiet && this.bindings.isSwitching()) return Promise.resolve(false);

    const session = this.activeSession;
    if (
      !session
      || session.key !== `${session.scope}:${session.projectId}`
      || (options.expectedKey !== undefined && session.key !== options.expectedKey)
    ) {
      if (!quiet) this.bindings.onWarning(CANVAS_SAVE_MESSAGES.scopePending);
      return Promise.resolve(false);
    }
    if (!session.writeReady || session.base === null) {
      if (!quiet) this.bindings.onWarning(CANVAS_SAVE_MESSAGES.snapshotUnavailable);
      return Promise.resolve(false);
    }
    const snapshotCapture = capture || this.bindings.capture();

    const envelope: CanvasSaveEnvelope = Object.freeze({
      projectId: session.projectId,
      scope: session.scope,
      key: session.key,
      sessionGeneration: session.sessionGeneration,
      revision: this.revision,
      quiet,
      snapshot: structuredClone(buildCanvasSnapshot(
        session.base,
        snapshotCapture.nodes,
        snapshotCapture.edges,
        snapshotCapture.zoom,
        snapshotCapture.panX,
        snapshotCapture.panY,
        snapshotCapture.groups,
        snapshotCapture.backgroundMode,
        snapshotCapture.showImageInfo,
      )),
    });
    if (!quiet) this.bindings.onSessionPatch({ saving: true });

    const saveOperation = this.saveQueue
      .catch(() => undefined)
      .then(async () => {
        const active = this.activeSession;
        if (
          !active
          || active.key !== envelope.key
          || active.sessionGeneration !== envelope.sessionGeneration
        ) {
          if (!envelope.quiet) this.bindings.onWarning(CANVAS_SAVE_MESSAGES.scopePending);
          return false;
        }
        if (!active.writeReady || active.base === null) {
          if (!envelope.quiet) this.bindings.onWarning(CANVAS_SAVE_MESSAGES.snapshotUnavailable);
          return false;
        }

        this.bindings.onSessionPatch({ syncStatus: "saving", syncError: "" });
        const saved = await this.bindings.saveSnapshot(
          envelope.projectId,
          envelope.snapshot,
          envelope.scope,
        );
        if (
          this.activeSession?.key === envelope.key
          && this.activeSession.sessionGeneration === envelope.sessionGeneration
        ) {
          this.activeSession = {
            ...this.activeSession,
            base: envelope.snapshot,
          };
          this.bindings.onSessionPatch({
            snapshotVersion: saved.version || 0,
            snapshotUpdatedAt: saved.updated_at || "",
            syncStatus: this.revision > envelope.revision ? "pending" : "synced",
          });
        }
        if (!envelope.quiet) this.bindings.onSuccess(CANVAS_SAVE_MESSAGES.success);
        return true;
      })
      .catch(error => {
        const message = this.bindings.formatError(error, CANVAS_SAVE_MESSAGES.failure);
        if (
          this.activeSession?.key === envelope.key
          && this.activeSession.sessionGeneration === envelope.sessionGeneration
        ) {
          this.bindings.onSessionPatch({ syncStatus: "error", syncError: message });
        }
        if (!envelope.quiet) this.bindings.onError(message);
        return false;
      })
      .finally(() => {
        if (!envelope.quiet) this.bindings.onSessionPatch({ saving: false });
      });

    this.saveQueue = saveOperation.then(() => undefined, () => undefined);
    return saveOperation;
  }

  flush() {
    this.cancelScheduledSave();
    if (!this.acceptingWrites) return Promise.resolve(false);
    return this.persist(this.bindings.capture());
  }

  drain() {
    return this.saveQueue;
  }

  dispose() {
    if (this.disposing) return this.disposing;
    this.acceptingWrites = false;
    this.cancelScheduledSave();
    this.disposing = this.saveQueue.then(() => {
      this.activeSession = null;
      this.requestedProjectId = "";
      this.bindings.onDisposed?.();
      this.bindings = emptyBindings;
    });
    return this.disposing;
  }

  private cancelScheduledSave() {
    if (this.autosaveTimer === null) return;
    this.scheduler.clearTimer(this.autosaveTimer);
    this.autosaveTimer = null;
  }
}
