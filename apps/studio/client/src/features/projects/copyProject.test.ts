import { describe, expect, it, vi } from "vitest";
import { copyProjectSnapshot, projectCopyTitle, copyProject } from "./copyProject";
import { ApiError } from "@/shared/api/errors";

const api = vi.hoisted(() => ({ createProject: vi.fn(), getProject: vi.fn(), getProjectSummaries: vi.fn(), getProjectSnapshot: vi.fn() }));
vi.mock("@/entities/project", () => api);

describe("independent canvas copies", () => {
  it("preserves graph, references, history and viewport while detaching running work", () => {
    const source = { projectId: "original", nodes: [
      { id: "image", metadata: { assetId: "asset", seedanceVolcanoAssets: [{ id: "registered" }], generationRevisions: [{ assetId: "old" }] } },
      { id: "video", content: "@[node:image]", metadata: { status: "loading", batchStatus: "running", jobId: "job", jobProgress: 50, batchChildIds: ["image"], textAssetId: "original-text", textAssetScope: "personal" } },
      { id: "director", metadata: { directorInstanceId: "old-instance", directorProject: { title: "Scene" } } },
    ], connections: [{ id: "edge", fromNodeId: "image", toNodeId: "video" }], groups: [{ id: "group", nodeIds: ["image", "video"] }], viewport: { k: 0.5, x: 20, y: 30 } };
    const copy = copyProjectSnapshot(source, () => "new-instance") as typeof source;
    expect(copy.projectId).toBeUndefined();
    expect(copy.connections).toEqual(source.connections);
    expect(copy.groups).toEqual(source.groups);
    expect(copy.viewport).toEqual(source.viewport);
    expect(copy.nodes[1]).toMatchObject({ content: "@[node:image]", metadata: { status: "idle", batchStatus: "idle", batchChildIds: ["image"] } });
    expect(copy.nodes[1].metadata.jobId).toBeUndefined();
    expect(copy.nodes[1].metadata.textAssetId).toBeUndefined();
    expect(copy.nodes[2].metadata.directorInstanceId).toBe("new-instance");
    copy.nodes[0].metadata.assetId = "new";
    expect(source.nodes[0].metadata.assetId).toBe("asset");
    expect(source.nodes[1].metadata.jobId).toBe("job");
    expect(copy.nodes[0].metadata.generationRevisions).toEqual([{ assetId: "old" }]);
  });
  it("numbers repeated copies and refuses corrupted snapshots", () => {
    expect(projectCopyTitle("画布", new Set(["画布（副本）", "画布（副本） 2"]))).toBe("画布（副本） 3");
    expect(() => copyProjectSnapshot(null)).toThrow();
    expect(() => copyProjectSnapshot({ nodes: "bad" })).toThrow();
  });
  it("never creates an empty copy after a failed snapshot request", async () => {
    api.createProject.mockClear();
    api.getProject.mockResolvedValue({ id: "source", title: "Original", data: { nodes: [] } });
    api.getProjectSnapshot.mockRejectedValue(new Error("network"));
    await expect(copyProject("source", "personal")).rejects.toThrow("network");
    expect(api.createProject).not.toHaveBeenCalled();
  });
  it("falls back only for legacy missing snapshots", async () => {
    api.getProject.mockResolvedValue({ id: "source", title: "Original", data: { nodes: [{ id: "text" }] } });
    api.getProjectSnapshot.mockRejectedValue(new ApiError("missing", 404));
    api.getProjectSummaries.mockResolvedValue([]);
    await copyProject("source", "team");
    expect(api.createProject).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "team", data: { nodes: [{ id: "text" }] } }));
  });
});
