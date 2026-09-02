import type { Asset } from "@/entities/asset";
import {
  createProject,
  getProject,
  getProjectSnapshot,
  saveProjectSnapshot,
  type CanvasProject,
} from "@/entities/project";
import type { WorkspaceScope } from "@/shared/config";

import {
  applyDirectorFrameToCanvasSnapshot,
  canvasDirectorOutputExists,
  type DirectorCanvasIdentity,
} from "../model/canvasSnapshot";
import {
  isRecord,
  numberValue,
  stringValue,
  type DirectorFrameExport,
  type RequestDirector,
} from "../model/protocol";
import type { ArchivedDirectorFrame } from "./frameArchive";

export type DirectorCanvasDependencies = {
  create: typeof createProject;
  get: typeof getProject;
  getSnapshot: typeof getProjectSnapshot;
  saveSnapshot: typeof saveProjectSnapshot;
};

const defaultDependencies: DirectorCanvasDependencies = {
  create: createProject,
  get: getProject,
  getSnapshot: getProjectSnapshot,
  saveSnapshot: saveProjectSnapshot,
};

export type DirectorWriteBackResult =
  | {
      kind: "duplicate";
      outputKey: string;
    }
  | {
      kind: "written";
      outputKey: string;
      outputNodeId: string;
      frame: DirectorFrameExport;
      asset: Asset;
    };

export async function writeDirectorFrameToCanvas(
  input: {
    requestDirector: RequestDirector;
    archiveFrame: () => Promise<ArchivedDirectorFrame>;
    instanceId: string;
    canvasId: string;
    nodeId: string;
    scope: WorkspaceScope;
    createNodeId?: () => string;
    createEdgeId?: () => string;
    now?: string;
  },
  dependencies: DirectorCanvasDependencies = defaultDependencies
): Promise<DirectorWriteBackResult> {
  const [projectState, timelineState, project] = await Promise.all([
    input.requestDirector("project.get"),
    input.requestDirector("timeline.get"),
    dependencies.get(input.canvasId, input.scope),
  ]);
  const identity = directorCanvasIdentity({
    projectState,
    timelineState,
    instanceId: input.instanceId,
    canvasId: input.canvasId,
    nodeId: input.nodeId,
    scope: input.scope,
  });
  let snapshotData: Record<string, unknown> | null = null;
  try {
    snapshotData = extractServerCanvasSnapshotData(
      await dependencies.getSnapshot(input.canvasId, input.scope)
    );
  } catch {
    snapshotData = null;
  }
  if (!snapshotData) snapshotData = extractProjectCanvasData(project.data);
  if (!snapshotData) throw new Error("未取得完整画布快照，已停止导演台回写");
  if (
    canvasDirectorOutputExists(snapshotData, input.nodeId, identity.outputKey)
  ) {
    return { kind: "duplicate", outputKey: identity.outputKey };
  }

  const { frame, asset } = await input.archiveFrame();
  const applied = applyDirectorFrameToCanvasSnapshot({
    snapshot: snapshotData,
    asset,
    frame,
    identity,
    createNodeId: input.createNodeId || (() => crypto.randomUUID()),
    createEdgeId: input.createEdgeId || (() => crypto.randomUUID()),
    now: input.now || new Date().toISOString(),
  });
  await dependencies.saveSnapshot(
    input.canvasId,
    applied.snapshot,
    input.scope
  );
  return {
    kind: "written",
    outputKey: identity.outputKey,
    outputNodeId: applied.outputNodeId,
    frame,
    asset,
  };
}

export function directorCanvasIdentity(input: {
  projectState: unknown;
  timelineState: unknown;
  instanceId: string;
  canvasId: string;
  nodeId: string;
  scope: WorkspaceScope;
}): DirectorCanvasIdentity {
  const projectData = isRecord(input.projectState) ? input.projectState : {};
  const timeline = isRecord(input.timelineState) ? input.timelineState : {};
  const projectFingerprint =
    stringValue(projectData.projectFingerprint) ||
    stringValue(projectData.project_fingerprint);
  if (!projectFingerprint) throw new Error("导演台没有返回有效的工程指纹");
  const activeCameraId =
    stringValue(timeline.activeCameraId) ||
    stringValue(timeline.active_camera_id) ||
    "current-camera";
  const progress = Math.max(0, Math.min(1, numberValue(timeline.progress)));
  return {
    instanceId: input.instanceId,
    canvasId: input.canvasId,
    nodeId: input.nodeId,
    outputKey: `${input.instanceId}:${projectFingerprint}:${activeCameraId}:${progress.toFixed(6)}`,
    projectFingerprint,
    activeCameraId,
    progress,
    scope: input.scope,
  };
}

export async function createCanvasFromDirectorAsset(
  input: {
    asset: Asset;
    scope: WorkspaceScope;
    createNodeId?: () => string;
    now?: Date;
  },
  dependencies: Pick<DirectorCanvasDependencies, "create"> = defaultDependencies
): Promise<CanvasProject> {
  const now = input.now || new Date();
  return dependencies.create({
    scope: input.scope,
    title: `导演台构图 ${now.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })}`,
    data: {
      nodes: [
        {
          id: input.createNodeId?.() || crypto.randomUUID(),
          kind: "image",
          title: input.asset.name || "导演台构图",
          content: "从 3D 导演台导出的构图占位图。",
          x: 120,
          y: 120,
          width: 340,
          height: 240,
          imageAssetId: input.asset.id,
        },
      ],
      edges: [],
      zoom: 90,
    },
  });
}

export function extractServerCanvasSnapshotData(
  value: unknown
): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const isServerEnvelope =
    "data" in value &&
    ("project_id" in value ||
      "version" in value ||
      "created_at" in value ||
      "updated_at" in value);
  if (isServerEnvelope) return isRecord(value.data) ? value.data : null;
  return value;
}

export function extractProjectCanvasData(
  value: unknown
): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
