import { describe, expect, it } from "vitest";

import {
  buildCanvasArchiveProjectRecord,
  collectCanvasArchiveAssetIds,
  collectCanvasArchiveAssetReferences,
  canvasArchiveProjectSnapshot,
  canvasArchiveStorageKey,
  parseCanvasProjectArchive,
  remapCanvasArchiveSnapshotAssets,
} from "./canvas-project-archive";

describe("canvas project archive", () => {
  it("builds and parses the production projects.json v3 shape", () => {
    const storageKey = canvasArchiveStorageKey("personal", "image", "asset-old");
    const project = buildCanvasArchiveProjectRecord({
      id: "project-1",
      title: "第一集",
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T01:00:00.000Z",
      scope: "personal",
      snapshot: {
        nodes: [{ id: "node-1", metadata: { assetId: "asset-old" } }],
        connections: [],
        groups: [],
        viewport: { x: 12, y: 18, k: 0.9 },
      },
      storageKeysByAssetId: new Map([["asset-old", storageKey]]),
    });
    const archive = parseCanvasProjectArchive({
      app: "infinite-canvas",
      version: 3,
      exportedAt: "2026-08-17T02:00:00.000Z",
      projects: [{ project, files: [{ storageKey, path: "projects/project-1/files/a.png", mimeType: "image/png", bytes: 12 }] }],
    });

    expect(archive.projects[0].project).toMatchObject({ id: "project-1", title: "第一集" });
    expect((archive.projects[0].project.nodes as Array<{ metadata: { storageKey: string } }>)[0].metadata.storageKey).toBe(storageKey);
  });

  it("converts production project records to snapshots and remaps uploaded media", () => {
    const storageKey = canvasArchiveStorageKey("team", "video", "video-old");
    const snapshot = canvasArchiveProjectSnapshot({
      id: "project-1",
      title: "导入项目",
      nodes: [{ id: "video-1", type: "video", metadata: { storageKey, content: storageKey } }],
      connections: [],
      groups: [],
      viewport: { x: 4, y: 8, k: 1.25 },
    });
    const remapped = remapCanvasArchiveSnapshotAssets(
      snapshot,
      new Map([[storageKey, { id: "video-new", mimeType: "video/mp4", kind: "video" }]]),
      "team",
    );
    expect(remapped).toMatchObject({
      zoom: 125,
      nodes: [{ imageAssetId: "video-new", metadata: { assetId: "video-new", assetScope: "team", mimeType: "video/mp4", content: "" } }],
    });
  });

  it("collects direct and nested media references", () => {
    expect([...collectCanvasArchiveAssetIds({
      nodes: [{ imageAssetId: "image-1", metadata: { assetId: "image-1", referenceInputs: [{ assetId: "image-2" }] } }],
      assistant: { attachment: { assetId: "audio-1" } },
    })].sort()).toEqual(["audio-1", "image-1", "image-2"]);
  });

  it("keeps the source scope for cross-workspace asset references", () => {
    const references = collectCanvasArchiveAssetReferences({
      nodes: [
        { imageAssetId: "fallback" },
        { imageAssetId: "team-asset", metadata: { assetId: "team-asset", assetScope: "team" } },
      ],
    }, "personal");

    expect(Array.from(references.entries())).toEqual([
      ["fallback", "personal"],
      ["team-asset", "team"],
    ]);
  });

  it("rejects archives that do not match the production contract", () => {
    expect(() => parseCanvasProjectArchive({ app: "other", version: 3, projects: [] })).toThrow("不是有效的画布项目包");
  });
});
