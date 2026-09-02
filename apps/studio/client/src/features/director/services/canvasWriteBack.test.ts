import { describe, expect, it, vi } from "vitest";

import type { Asset } from "@/entities/asset";
import type { CanvasProject, CanvasSnapshotResponse } from "@/entities/project";

import type { RequestDirector } from "../model/protocol";
import type { ArchivedDirectorFrame } from "./frameArchive";
import {
  createCanvasFromDirectorAsset,
  directorCanvasIdentity,
  extractProjectCanvasData,
  extractServerCanvasSnapshotData,
  writeDirectorFrameToCanvas,
  type DirectorCanvasDependencies,
} from "./canvasWriteBack";

const asset: Asset = {
  id: "asset-frame",
  type: "image",
  name: "director-frame.png",
  size: 1234,
  content_type: "image/png",
};

const archivedFrame: ArchivedDirectorFrame = {
  asset,
  frame: {
    dataUrl: "data:image/png;base64,AA==",
    width: 1920,
    height: 1080,
    fileName: "director-frame.png",
  },
};

function canvasSnapshot(outputKeys: string[] = []) {
  return {
    schema: "ai-manhua-studio-canvas",
    nodes: [
      {
        id: "director-node",
        kind: "director",
        title: "3D 导演台",
        x: 100,
        y: 80,
        width: 300,
        height: 170,
        metadata: {
          directorOutputKeys: outputKeys,
          directorOutputNodeIds: [],
        },
      },
    ],
    edges: [],
    customExtension: { keep: true },
  };
}

function project(data: unknown = canvasSnapshot()): CanvasProject {
  return {
    id: "canvas-1",
    title: "Canvas",
    scope: "team",
    data,
    created_at: "2026-08-17T00:00:00.000Z",
    updated_at: "2026-08-17T00:00:00.000Z",
  };
}

function snapshotResponse(data: unknown): CanvasSnapshotResponse {
  return {
    project_id: "canvas-1",
    version: 3,
    data,
    created_at: "2026-08-17T00:00:00.000Z",
    updated_at: "2026-08-17T00:00:00.000Z",
  };
}

function createDependencies(): DirectorCanvasDependencies {
  return {
    create: vi.fn(),
    get: vi.fn(),
    getSnapshot: vi.fn(),
    saveSnapshot: vi.fn(),
  };
}

function createRequestDirector(): RequestDirector {
  return vi.fn(async action => {
    if (action === "project.get") {
      return { projectFingerprint: "fingerprint-1" };
    }
    if (action === "timeline.get") {
      return { activeCameraId: "camera-1", progress: 0.5 };
    }
    throw new Error(`unexpected action: ${action}`);
  });
}

describe("Director Canvas write-back", () => {
  it("archives and writes one idempotent connected output", async () => {
    const sourceSnapshot = canvasSnapshot();
    const dependencies = createDependencies();
    vi.mocked(dependencies.get).mockResolvedValue(project());
    vi.mocked(dependencies.getSnapshot).mockResolvedValue(
      snapshotResponse(sourceSnapshot)
    );
    vi.mocked(dependencies.saveSnapshot).mockResolvedValue(
      snapshotResponse(sourceSnapshot)
    );
    const requestDirector = createRequestDirector();
    const archiveFrame = vi.fn(async () => archivedFrame);

    const result = await writeDirectorFrameToCanvas(
      {
        requestDirector,
        archiveFrame,
        instanceId: "director-instance",
        canvasId: "canvas-1",
        nodeId: "director-node",
        scope: "team",
        createNodeId: () => "image-node",
        createEdgeId: () => "edge-1",
        now: "2026-08-17T00:00:00.000Z",
      },
      dependencies
    );

    expect(result).toMatchObject({
      kind: "written",
      outputKey: "director-instance:fingerprint-1:camera-1:0.500000",
      outputNodeId: "image-node",
      frame: archivedFrame.frame,
      asset,
    });
    expect(requestDirector).toHaveBeenNthCalledWith(1, "project.get");
    expect(requestDirector).toHaveBeenNthCalledWith(2, "timeline.get");
    expect(dependencies.get).toHaveBeenCalledWith("canvas-1", "team");
    expect(dependencies.getSnapshot).toHaveBeenCalledWith("canvas-1", "team");
    expect(archiveFrame).toHaveBeenCalledOnce();
    expect(dependencies.saveSnapshot).toHaveBeenCalledOnce();
    const [canvasId, saved, scope] = vi.mocked(dependencies.saveSnapshot).mock
      .calls[0];
    expect(canvasId).toBe("canvas-1");
    expect(scope).toBe("team");
    expect(saved).toMatchObject({
      customExtension: { keep: true },
      nodes: [
        {
          id: "director-node",
          imageAssetId: "asset-frame",
          metadata: {
            directorOutputKeys: [
              "director-instance:fingerprint-1:camera-1:0.500000",
            ],
            directorOutputNodeIds: ["image-node"],
          },
        },
        {
          id: "image-node",
          imageAssetId: "asset-frame",
          metadata: {
            generationType: "director",
            sourceNodeId: "director-node",
            assetScope: "team",
          },
        },
      ],
      edges: [
        {
          id: "edge-1",
          from: "director-node",
          to: "image-node",
          fromNodeId: "director-node",
          toNodeId: "image-node",
        },
      ],
    });
  });

  it("does not archive or save a duplicate output key", async () => {
    const outputKey = "director-instance:fingerprint-1:camera-1:0.500000";
    const sourceSnapshot = canvasSnapshot([outputKey]);
    const dependencies = createDependencies();
    vi.mocked(dependencies.get).mockResolvedValue(project());
    vi.mocked(dependencies.getSnapshot).mockResolvedValue(
      snapshotResponse(sourceSnapshot)
    );
    const archiveFrame = vi.fn(async () => archivedFrame);

    await expect(
      writeDirectorFrameToCanvas(
        {
          requestDirector: createRequestDirector(),
          archiveFrame,
          instanceId: "director-instance",
          canvasId: "canvas-1",
          nodeId: "director-node",
          scope: "team",
        },
        dependencies
      )
    ).resolves.toEqual({ kind: "duplicate", outputKey });
    expect(archiveFrame).not.toHaveBeenCalled();
    expect(dependencies.saveSnapshot).not.toHaveBeenCalled();
  });

  it("falls back to project data when the snapshot endpoint fails", async () => {
    const sourceSnapshot = canvasSnapshot();
    const dependencies = createDependencies();
    vi.mocked(dependencies.get).mockResolvedValue(project(sourceSnapshot));
    vi.mocked(dependencies.getSnapshot).mockRejectedValue(
      new Error("snapshot unavailable")
    );
    vi.mocked(dependencies.saveSnapshot).mockResolvedValue(
      snapshotResponse(sourceSnapshot)
    );

    const result = await writeDirectorFrameToCanvas(
      {
        requestDirector: createRequestDirector(),
        archiveFrame: async () => archivedFrame,
        instanceId: "director-instance",
        canvasId: "canvas-1",
        nodeId: "director-node",
        scope: "team",
        createNodeId: () => "image-node",
        createEdgeId: () => "edge-1",
        now: "2026-08-17T00:00:00.000Z",
      },
      dependencies
    );

    expect(result.kind).toBe("written");
    expect(dependencies.saveSnapshot).toHaveBeenCalledOnce();
  });

  it("normalizes identity aliases and clamps timeline progress", () => {
    expect(
      directorCanvasIdentity({
        projectState: { project_fingerprint: "fingerprint-snake" },
        timelineState: { active_camera_id: "camera-snake", progress: 2 },
        instanceId: "director-instance",
        canvasId: "canvas-1",
        nodeId: "director-node",
        scope: "personal",
      })
    ).toEqual({
      instanceId: "director-instance",
      canvasId: "canvas-1",
      nodeId: "director-node",
      outputKey: "director-instance:fingerprint-snake:camera-snake:1.000000",
      projectFingerprint: "fingerprint-snake",
      activeCameraId: "camera-snake",
      progress: 1,
      scope: "personal",
    });
    expect(() =>
      directorCanvasIdentity({
        projectState: {},
        timelineState: {},
        instanceId: "director-instance",
        canvasId: "canvas-1",
        nodeId: "director-node",
        scope: "personal",
      })
    ).toThrow("导演台没有返回有效的工程指纹");
  });

  it("creates a standalone Canvas with the legacy project payload", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.create).mockResolvedValue(project());
    const now = new Date("2026-08-17T04:34:00.000Z");

    await expect(
      createCanvasFromDirectorAsset(
        {
          asset,
          scope: "personal",
          createNodeId: () => "image-node",
          now,
        },
        dependencies
      )
    ).resolves.toEqual(project());

    expect(dependencies.create).toHaveBeenCalledWith({
      scope: "personal",
      title: `导演台构图 ${now.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })}`,
      data: {
        nodes: [
          {
            id: "image-node",
            kind: "image",
            title: "director-frame.png",
            content: "从 3D 导演台导出的构图占位图。",
            x: 120,
            y: 120,
            width: 340,
            height: 240,
            imageAssetId: "asset-frame",
          },
        ],
        edges: [],
        zoom: 90,
      },
    });
  });

  it("unwraps server snapshots without unwrapping direct project data", () => {
    const serverData = { nodes: [], customExtension: true };
    const directData = { data: { businessValue: true }, nodes: [] };
    expect(
      extractServerCanvasSnapshotData({
        project_id: "canvas-1",
        version: 3,
        data: serverData,
      })
    ).toBe(serverData);
    expect(extractServerCanvasSnapshotData(directData)).toBe(directData);
    expect(extractProjectCanvasData(directData)).toBe(directData);
    expect(
      extractServerCanvasSnapshotData({
        project_id: "canvas-1",
        version: 3,
        data: null,
      })
    ).toBeNull();
  });
});
