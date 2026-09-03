import type { CanvasProject, CanvasSnapshotResponse } from "@/entities/project";
import { normalizeCanvasGroups } from "@/features/canvas/domain/groups";
import { resetInterruptedCanvasGenerations } from "@/features/canvas/domain/batch";
import { parseCanvasSnapshot } from "@/features/canvas/domain/snapshotCodec";
import {
  extractProjectCanvasData,
  extractServerCanvasSnapshotData,
  type CanvasSnapshotBase,
} from "@/features/canvas/domain/snapshotRoundTrip";
import type {
  CanvasEdgeData,
  CanvasNodeData,
  CanvasSnapshotState,
} from "@/features/canvas/domain/types";
import { projectScopeFromServer } from "@/features/canvas/domain/workspace";
import type { WorkspaceScope } from "@/shared/config";

import type {
  CanvasAutosaveController,
  CanvasAutosaveSession,
} from "./autosave";
import type {
  CanvasHistoryController,
  CanvasHistorySource,
} from "./history";

export const CANVAS_PROJECT_SESSION_MESSAGES = {
  loadSnapshotFailure: "读取项目快照失败",
  loadProjectFailure: "读取画布项目失败",
  fallbackSnapshotSuffix: "，将尝试项目内嵌数据",
  snapshotUnavailable: "未取得完整原始快照，保存已暂停以保护现有画布数据",
  loadingBlocksLeave: "画布快照仍在读取，请稍后再切换",
  scopePendingBlocksLeave: "正在确认项目工作区，请稍后再切换",
  uploadBlocksLeave: "当前画布仍在上传图片，请等待上传完成后再切换",
  saveBlocksSwitch: "切换已取消：当前画布快照保存失败，已留在原项目",
  switchProjectFailure: "切换画布失败",
  switchScopeFailure: "切换工作区失败",
} as const;

export type CanvasProjectSessionLoaded = {
  project: CanvasProject;
  scope: WorkspaceScope;
  key: string;
  base: CanvasSnapshotBase | null;
  nodes: CanvasNodeData[];
  edges: CanvasEdgeData[];
  groups: CanvasSnapshotState["groups"];
  backgroundMode: CanvasSnapshotState["backgroundMode"];
  showImageInfo: boolean;
  viewport: { zoom: number; panX: number; panY: number };
  snapshotVersion: number;
  snapshotUpdatedAt: string;
  snapshotError: string;
  writeReady: boolean;
};

export type CanvasProjectSessionBindings = {
  getProject(projectId: string, scope: WorkspaceScope): Promise<CanvasProject>;
  getSnapshot(projectId: string, scope: WorkspaceScope): Promise<CanvasSnapshotResponse>;
  isNotFound(error: unknown): boolean;
  formatError(error: unknown, fallback: string): string;
  createStarterNodes(): CanvasNodeData[];
  isUploading(): boolean;
  onReset(projectId: string): void;
  onProjectResolved(project: CanvasProject): void;
  onSnapshotWarning(message: string): void;
  onLoaded(result: CanvasProjectSessionLoaded): void;
  onLoadError(message: string): void;
  onSettled(): void;
  onRedirect(scope: WorkspaceScope): void;
  onSwitchingChange(switching: boolean): void;
  onLoadingChange(loading: boolean): void;
  onBeforeSwitch(): void;
  onWarning(message: string): void;
  onError(message: string): void;
  navigate(href: string): void;
};

type AutosaveBoundary = Pick<
  CanvasAutosaveController,
  "beginLoad" | "activate" | "flush" | "dispose"
>;

type HistoryBoundary = Pick<
  CanvasHistoryController,
  "initialize" | "dispose"
>;

const emptyBindings: CanvasProjectSessionBindings = {
  getProject: async () => {
    throw new Error("Canvas project session bindings are not initialized");
  },
  getSnapshot: async () => {
    throw new Error("Canvas project session bindings are not initialized");
  },
  isNotFound: () => false,
  formatError: (_error, fallback) => fallback,
  createStarterNodes: () => [],
  isUploading: () => false,
  onReset: () => undefined,
  onProjectResolved: () => undefined,
  onSnapshotWarning: () => undefined,
  onLoaded: () => undefined,
  onLoadError: () => undefined,
  onSettled: () => undefined,
  onRedirect: () => undefined,
  onSwitchingChange: () => undefined,
  onLoadingChange: () => undefined,
  onBeforeSwitch: () => undefined,
  onWarning: () => undefined,
  onError: () => undefined,
  navigate: () => undefined,
};

export class CanvasProjectSessionController {
  private bindings = emptyBindings;
  private loadSequence = 0;
  private currentProjectId = "";
  private requestedScope: WorkspaceScope = "personal";
  private currentCanonicalScope: WorkspaceScope | null = null;
  private currentCanonicalKey = "";
  private currentLoading = true;
  private currentSwitching = false;
  private disposed = false;
  private disposing: Promise<void> | null = null;

  constructor(
    private readonly autosave: AutosaveBoundary,
    private readonly history: HistoryBoundary,
  ) {}

  updateBindings(bindings: CanvasProjectSessionBindings) {
    this.bindings = bindings;
  }

  get projectId() {
    return this.currentProjectId;
  }

  get canonicalScope() {
    return this.currentCanonicalScope;
  }

  get canonicalKey() {
    return this.currentCanonicalKey;
  }

  get loading() {
    return this.currentLoading;
  }

  get switching() {
    return this.currentSwitching;
  }

  startLoad(projectId: string, requestedScope: WorkspaceScope) {
    if (this.disposed) {
      return { completed: Promise.resolve(), cancel: () => undefined };
    }
    const sequence = ++this.loadSequence;
    this.currentProjectId = projectId;
    this.requestedScope = requestedScope;
    this.currentCanonicalScope = null;
    this.currentCanonicalKey = "";
    this.currentLoading = Boolean(projectId);
    this.autosave.beginLoad(projectId);
    this.bindings.onReset(projectId);

    if (!projectId) {
      this.currentLoading = false;
      this.setSwitching(false);
      this.bindings.onSettled();
      return {
        completed: Promise.resolve(),
        cancel: () => this.cancelLoad(sequence),
      };
    }

    const completed = this.performLoad(sequence, projectId, requestedScope);
    return {
      completed,
      cancel: () => this.cancelLoad(sequence),
    };
  }

  async switchProject(targetProjectId: string, targetHref: string) {
    if (
      !targetProjectId
      || targetProjectId === this.currentProjectId
      || this.currentSwitching
      || this.disposed
      || !this.canLeave()
    ) {
      return false;
    }
    if (!this.currentCanonicalScope) {
      this.bindings.onWarning(CANVAS_PROJECT_SESSION_MESSAGES.scopePendingBlocksLeave);
      return false;
    }
    return this.switchTo(targetHref, CANVAS_PROJECT_SESSION_MESSAGES.switchProjectFailure);
  }

  async switchScope(targetScope: WorkspaceScope, targetHref: string) {
    if (this.disposed) return false;
    const activeScope = this.currentProjectId
      ? this.currentCanonicalScope
      : this.requestedScope;
    if (targetScope === activeScope || this.currentSwitching) return false;
    if (!this.currentProjectId) {
      this.bindings.navigate(targetHref);
      return true;
    }
    if (!this.canLeave()) return false;
    return this.switchTo(targetHref, CANVAS_PROJECT_SESSION_MESSAGES.switchScopeFailure);
  }

  dispose() {
    if (this.disposing) return this.disposing;
    this.disposed = true;
    this.loadSequence += 1;
    this.disposing = this.autosave.dispose().then(() => {
      this.history.dispose();
      this.bindings = emptyBindings;
      this.currentCanonicalScope = null;
      this.currentCanonicalKey = "";
    });
    return this.disposing;
  }

  private async performLoad(
    sequence: number,
    projectId: string,
    requestedScope: WorkspaceScope,
  ) {
    try {
      const { project, scope } = await this.getProjectFromCanonicalScope(
        projectId,
        requestedScope,
      );
      if (!this.isCurrent(sequence, projectId, requestedScope)) return;
      if (scope !== requestedScope) {
        this.bindings.onRedirect(scope);
        return;
      }

      this.bindings.onProjectResolved(project);
      let snapshot: CanvasSnapshotResponse | undefined;
      let snapshotError = "";
      try {
        snapshot = await this.bindings.getSnapshot(projectId, scope);
      } catch (error) {
        snapshotError = this.bindings.formatError(
          error,
          CANVAS_PROJECT_SESSION_MESSAGES.loadSnapshotFailure,
        );
        if (this.isCurrent(sequence, projectId, requestedScope)) {
          this.bindings.onSnapshotWarning(
            `${snapshotError}${CANVAS_PROJECT_SESSION_MESSAGES.fallbackSnapshotSuffix}`,
          );
        }
      }
      if (!this.isCurrent(sequence, projectId, requestedScope)) return;

      const key = `${scope}:${projectId}`;
      const snapshotBase = snapshot === undefined
        ? null
        : extractServerCanvasSnapshotData(snapshot);
      const projectBase = extractProjectCanvasData(project.data);
      const base = snapshotBase ?? projectBase;
      const parsed = base ? parseCanvasSnapshot(base) : null;
      const nodes = resetInterruptedCanvasGenerations(
        parsed ? parsed.nodes || [] : this.bindings.createStarterNodes(),
      );
      const edges: CanvasEdgeData[] = parsed?.edges || [];
      const groups = normalizeCanvasGroups(parsed?.groups || [], nodes);
      const backgroundMode = parsed?.backgroundMode || "dots";
      const showImageInfo = parsed?.showImageInfo || false;
      const viewport = {
        zoom: parsed?.zoom || 90,
        panX: parsed?.panX || 0,
        panY: parsed?.panY || 0,
      };
      const historyEntry: CanvasSnapshotState = {
        nodes: structuredClone(nodes),
        edges: structuredClone(edges),
        groups: structuredClone(groups),
        backgroundMode,
        showImageInfo,
      };
      const historySource: CanvasHistorySource = {
        nodes,
        edges,
        groups,
        backgroundMode,
        showImageInfo,
      };
      const autosaveSession: CanvasAutosaveSession = {
        projectId,
        scope,
        key,
        base,
        writeReady: base !== null,
      };

      this.history.initialize(historyEntry, historySource);
      this.currentCanonicalScope = scope;
      this.currentCanonicalKey = key;
      this.autosave.activate(autosaveSession);
      this.bindings.onLoaded({
        project,
        scope,
        key,
        base,
        nodes,
        edges,
        groups,
        backgroundMode,
        showImageInfo,
        viewport,
        snapshotVersion: snapshot?.version || 0,
        snapshotUpdatedAt: snapshot?.updated_at || project.updated_at || "",
        snapshotError,
        writeReady: base !== null,
      });
      if (base === null) {
        this.bindings.onSnapshotWarning(
          CANVAS_PROJECT_SESSION_MESSAGES.snapshotUnavailable,
        );
      }
    } catch (error) {
      if (this.isCurrent(sequence, projectId, requestedScope)) {
        this.bindings.onLoadError(
          this.bindings.formatError(
            error,
            CANVAS_PROJECT_SESSION_MESSAGES.loadProjectFailure,
          ),
        );
      }
    } finally {
      if (this.isCurrent(sequence, projectId, requestedScope)) {
        this.currentLoading = false;
        this.setSwitching(false);
        this.bindings.onSettled();
      }
    }
  }

  private async getProjectFromCanonicalScope(
    projectId: string,
    preferredScope: WorkspaceScope,
  ) {
    try {
      const project = await this.bindings.getProject(projectId, preferredScope);
      return {
        project,
        scope: projectScopeFromServer(project, preferredScope),
      };
    } catch (error) {
      if (!this.bindings.isNotFound(error)) throw error;
    }

    const fallbackScope: WorkspaceScope = preferredScope === "personal"
      ? "team"
      : "personal";
    const project = await this.bindings.getProject(projectId, fallbackScope);
    return {
      project,
      scope: projectScopeFromServer(project, fallbackScope),
    };
  }

  private canLeave() {
    if (this.currentLoading) {
      this.bindings.onWarning(CANVAS_PROJECT_SESSION_MESSAGES.loadingBlocksLeave);
      return false;
    }
    if (
      this.currentProjectId
      && (
        !this.currentCanonicalScope
        || this.currentCanonicalKey
          !== `${this.currentCanonicalScope}:${this.currentProjectId}`
      )
    ) {
      this.bindings.onWarning(CANVAS_PROJECT_SESSION_MESSAGES.scopePendingBlocksLeave);
      return false;
    }
    if (this.bindings.isUploading()) {
      this.bindings.onWarning(CANVAS_PROJECT_SESSION_MESSAGES.uploadBlocksLeave);
      return false;
    }
    return true;
  }

  private async switchTo(targetHref: string, failureMessage: string) {
    this.setSwitching(true);
    this.bindings.onBeforeSwitch();
    try {
      const saved = await this.autosave.flush();
      if (!saved) {
        this.bindings.onWarning(CANVAS_PROJECT_SESSION_MESSAGES.saveBlocksSwitch);
        this.setSwitching(false);
        return false;
      }
      this.currentLoading = true;
      this.bindings.onLoadingChange(true);
      this.bindings.navigate(targetHref);
      return true;
    } catch (error) {
      this.bindings.onError(this.bindings.formatError(error, failureMessage));
      this.setSwitching(false);
      return false;
    }
  }

  private setSwitching(switching: boolean) {
    this.currentSwitching = switching;
    this.bindings.onSwitchingChange(switching);
  }

  private cancelLoad(sequence: number) {
    if (this.loadSequence === sequence) this.loadSequence += 1;
  }

  private isCurrent(
    sequence: number,
    projectId: string,
    requestedScope: WorkspaceScope,
  ) {
    return !this.disposed
      && this.loadSequence === sequence
      && this.currentProjectId === projectId
      && this.requestedScope === requestedScope;
  }
}
