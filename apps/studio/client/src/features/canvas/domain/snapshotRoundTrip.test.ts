import { describe, expect, it } from "vitest";

import {
  buildRoundTripCanvasSnapshot,
  collectRoundTripCanvasEdgeEntries,
  collectRoundTripCanvasEdges,
  extractProjectCanvasData,
  extractServerCanvasSnapshotData,
  hasRoundTripCanvasGraph,
  normalizeRoundTripCanvasEdge,
} from "./snapshotRoundTrip";

describe("canvas snapshot round trip", () => {
  it("preserves production extensions while replacing managed fields", () => {
    const base = {
      schema: "production-canvas",
      version: 17,
      groups: [{ id: "group-1" }],
      chatSessions: [{ id: "chat-1" }],
      activeChatId: "chat-1",
      backgroundMode: "grid",
      showImageInfo: true,
      sync: { status: "synced" },
      customExtension: { keep: true },
      viewport: { x: 1, y: 2, k: 0.5, rotation: 12 },
      nodes: [{ id: "old-node" }],
      connections: [{ id: "old-edge" }],
    };
    const original = structuredClone(base);
    const nodes = [{ id: "new-node" }];
    const edges = [{ id: "new-edge" }];
    const groups = [{ id: "new-group", nodeIds: ["new-node"] }];

    const result = buildRoundTripCanvasSnapshot(base, {
      nodes,
      edges,
      groups,
      zoom: 125,
      panX: 44,
      panY: -18,
      backgroundMode: "dots",
      showImageInfo: false,
      updatedAt: "2026-08-16T00:00:00.000Z",
      defaultSchema: "ai-manhua-studio-canvas",
      defaultVersion: 3,
    });

    expect(result).toMatchObject({
      schema: "production-canvas",
      version: 17,
      groups,
      chatSessions: [{ id: "chat-1" }],
      activeChatId: "chat-1",
      backgroundMode: "dots",
      showImageInfo: false,
      sync: { status: "synced" },
      customExtension: { keep: true },
      viewport: { x: 44, y: -18, k: 1.25, rotation: 12 },
      zoom: 125,
      panX: 44,
      panY: -18,
      updated_at: "2026-08-16T00:00:00.000Z",
    });
    expect(result.nodes).toBe(nodes);
    expect(result.edges).toBe(edges);
    expect(result.connections).toBe(edges);
    expect(result.groups).toBe(groups);
    expect(base).toEqual(original);
  });

  it("treats an empty object as a valid writable base", () => {
    const result = buildRoundTripCanvasSnapshot({}, {
      nodes: [],
      edges: [],
      zoom: 90,
      panX: 0,
      panY: 0,
      updatedAt: "2026-08-16T00:00:00.000Z",
      defaultSchema: "ai-manhua-studio-canvas",
      defaultVersion: 3,
    });

    expect(result.schema).toBe("ai-manhua-studio-canvas");
    expect(result.version).toBe(3);
    expect(result.viewport).toEqual({ x: 0, y: 0, k: 0.9 });
  });

  it("treats empty canvas graph arrays as a valid canvas snapshot", () => {
    expect(hasRoundTripCanvasGraph({ nodes: [], connections: [] })).toBe(true);
    expect(hasRoundTripCanvasGraph({ edges: [] })).toBe(true);
    expect(hasRoundTripCanvasGraph({ customExtension: true })).toBe(false);
    expect(hasRoundTripCanvasGraph(null)).toBe(false);
  });

  it("unwraps server envelopes without unwrapping direct project data", () => {
    const serverData = { groups: [], customExtension: { keep: true } };
    const directProjectData = { data: { businessValue: true }, nodes: [] };
    const directServerData = { updated_at: "2026-08-16T00:00:00.000Z", nodes: [] };

    expect(extractServerCanvasSnapshotData({ project_id: "project-1", version: 4, data: serverData })).toBe(serverData);
    expect(extractServerCanvasSnapshotData(directServerData)).toBe(directServerData);
    expect(extractProjectCanvasData(directProjectData)).toBe(directProjectData);
    expect(extractServerCanvasSnapshotData({ project_id: "project-1", version: 4, data: null })).toBeNull();
    expect(extractServerCanvasSnapshotData(null)).toBeNull();
    expect(extractProjectCanvasData([])).toBeNull();
  });

  it("normalizes production and legacy connection endpoint field names", () => {
    expect(normalizeRoundTripCanvasEdge({ id: "prod", fromNodeId: "a", toNodeId: "b" })).toEqual({ id: "prod", from: "a", to: "b" });
    expect(normalizeRoundTripCanvasEdge({ id: "snake", from_node_id: "a", to_node_id: "c" })).toEqual({ id: "snake", from: "a", to: "c" });
    expect(normalizeRoundTripCanvasEdge({ sourceNodeId: "a", targetNodeId: "d" })).toEqual({ id: "a:d", from: "a", to: "d" });
    expect(normalizeRoundTripCanvasEdge({ source: { node_id: "a" }, target: { id: "e" } })).toEqual({ id: "a:e", from: "a", to: "e" });
    expect(normalizeRoundTripCanvasEdge({ from: "same", to: "same" })).toBeNull();
  });

  it("merges connections and edges without dropping edges when connections is empty", () => {
    const result = collectRoundTripCanvasEdges({
      connections: [],
      edges: [
        { id: "edge-1", source: "text-1", target: "config-1" },
        { id: "edge-duplicate", fromNodeId: "text-1", toNodeId: "config-1" },
        { id: "edge-2", from_node_id: "config-1", to_node_id: "image-1" },
      ],
    });

    expect(result).toEqual([
      { id: "edge-1", from: "text-1", to: "config-1" },
      { id: "edge-2", from: "config-1", to: "image-1" },
    ]);
  });

  it("merges duplicate edge representations without dropping extension fields", () => {
    const [entry] = collectRoundTripCanvasEdgeEntries({
      connections: [{
        id: "connection-primary",
        fromNodeId: "text-1",
        toNodeId: "config-1",
        metadata: { connectionOnly: true, shared: "connection" },
      }],
      edges: [{
        id: "edge-secondary",
        from: "text-1",
        to: "config-1",
        edgeStyle: "dashed",
        metadata: { edgeOnly: true, shared: "edge" },
      }],
    });

    expect(entry.edge).toEqual({
      id: "connection-primary",
      from: "text-1",
      to: "config-1",
    });
    expect(entry.base).toMatchObject({
      id: "connection-primary",
      edgeStyle: "dashed",
      metadata: {
        connectionOnly: true,
        edgeOnly: true,
        shared: "connection",
      },
    });
  });
});
