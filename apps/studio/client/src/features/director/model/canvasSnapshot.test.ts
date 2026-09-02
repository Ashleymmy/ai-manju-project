import { describe, expect, it } from "vitest";

import {
  applyDirectorFrameToCanvasSnapshot,
  canvasDirectorOutputExists,
} from "./canvasSnapshot";

const identity = {
  instanceId: "director-1",
  canvasId: "canvas-1",
  nodeId: "director-node",
  outputKey: "director-1:fingerprint:camera:0.500000",
  projectFingerprint: "fingerprint",
  activeCameraId: "camera",
  progress: 0.5,
  scope: "team" as const,
};

describe("Director Canvas snapshot adapter", () => {
  it("updates the source node and creates one connected image node", () => {
    const result = applyDirectorFrameToCanvasSnapshot({
      snapshot: {
        nodes: [
          {
            id: "director-node",
            kind: "director",
            title: "导演台",
            x: 100,
            y: 80,
            width: 300,
            height: 170,
            metadata: {
              directorRevision: 2,
              directorOutputKeys: [],
              directorOutputNodeIds: [],
            },
          },
        ],
        edges: [],
        zoom: 90,
        customExtension: { keep: true },
      },
      asset: {
        id: "asset-1",
        name: "frame.png",
        size: 1234,
        content_type: "image/png",
      },
      frame: { width: 1920, height: 1080 },
      identity,
      createNodeId: () => "image-node",
      createEdgeId: () => "edge-1",
      now: "2026-08-17T00:00:00.000Z",
    });

    expect(result.duplicate).toBe(false);
    expect(result.snapshot.nodes).toHaveLength(2);
    expect(result.snapshot.nodes[0]).toMatchObject({
      imageAssetId: "asset-1",
      metadata: {
        directorRevision: 3,
        directorOutputKeys: [identity.outputKey],
        directorOutputNodeIds: ["image-node"],
      },
    });
    expect(result.snapshot.nodes[1]).toMatchObject({
      id: "image-node",
      kind: "image",
      type: "image",
      imageAssetId: "asset-1",
      position: { x: 496, y: 80 },
      width: 340,
      height: 191,
    });
    expect(result.snapshot.edges).toEqual([
      {
        id: "edge-1",
        from: "director-node",
        to: "image-node",
        fromNodeId: "director-node",
        toNodeId: "image-node",
      },
    ]);
    expect(result.snapshot.connections).toEqual(result.snapshot.edges);
    expect(result.snapshot.customExtension).toEqual({ keep: true });
  });

  it("does not duplicate a previously saved project and camera frame", () => {
    const snapshot = {
      nodes: [
        {
          id: "director-node",
          type: "director",
          position: { x: 0, y: 0 },
          metadata: { directorOutputKeys: [identity.outputKey] },
        },
      ],
      connections: [],
    };
    const result = applyDirectorFrameToCanvasSnapshot({
      snapshot,
      asset: { id: "asset-1" },
      frame: {},
      identity,
      createNodeId: () => "unused",
      createEdgeId: () => "unused",
      now: "2026-08-17T00:00:00.000Z",
    });

    expect(result).toMatchObject({ duplicate: true, outputNodeId: "" });
    expect(result.snapshot).toBe(snapshot);
    expect(
      canvasDirectorOutputExists(snapshot, identity.nodeId, identity.outputKey)
    ).toBe(true);
  });

  it("rejects a missing Director source node", () => {
    expect(() =>
      applyDirectorFrameToCanvasSnapshot({
        snapshot: { nodes: [] },
        asset: { id: "asset-1" },
        frame: {},
        identity,
        createNodeId: () => "unused",
        createEdgeId: () => "unused",
        now: "2026-08-17T00:00:00.000Z",
      })
    ).toThrow("未找到对应的导演台画布节点");
  });
});
