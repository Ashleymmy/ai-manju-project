import { describe, expect, it, vi } from "vitest";
import type { AssetFolder } from "@/entities/asset";
import type { CanvasProject } from "@/entities/project";
import type { CanvasNodeData } from "../domain/types";
import { archiveCanvasMediaAsset, resolveCanvasArchiveFolder } from "./assetArchive";

const node: CanvasNodeData = { id: "node", kind: "image", title: "风景", content: "", x: 0, y: 0, width: 320, height: 240,
  imageAssetId: "asset", metadata: { assetScope: "personal" } };
const folders: AssetFolder[] = [
  { id: "unrelated", parent_id: "", name: "同名画布", system_key: "canvas_project", source_ref_id: "another" },
  { id: "wrong-category", parent_id: "unrelated", name: "其他", system_key: "canvas_category", source_ref_id: "another:other" },
  { id: "mine", parent_id: "", name: "同名画布", system_key: "canvas_project", source_ref_id: "project" },
  { id: "other", parent_id: "mine", name: "其他", system_key: "canvas_category", source_ref_id: "project:other" },
  { id: "roles", parent_id: "mine", name: "角色", system_key: "canvas_category", source_ref_id: "project:character" },
].map(folder => ({ ...folder, kind: "system", asset_count: 0, descendant_asset_count: 0, sort_order: 0 }));

function services() {
  return {
    getAssetContentObjectUrl: vi.fn(async () => "blob:source"),
    updateAssetMetadata: vi.fn(async () => ({ id: "asset", name: "风景", type: "image" as const })),
    uploadAsset: vi.fn(async () => ({ id: "copied", name: "风景", type: "image" as const })),
    fetch: vi.fn(async () => new Response(new Blob(["image"], { type: "image/png" }))),
    revokeObjectURL: vi.fn(),
  };
}
const input = { node, projectId: "project", projectTitle: "同名画布", scope: "personal" as const, folderId: "roles", category: "character" as const };

describe("canvas node archival", () => {
  it("resolves the exact linked project and defaults to other even when canvas names collide", async () => {
    const api = { getProject: vi.fn(async () => ({} as CanvasProject)), getAssetFolders: vi.fn(async () => folders) };
    expect((await resolveCanvasArchiveFolder("project", "personal", undefined, api)).id).toBe("other");
    expect(api.getProject).toHaveBeenCalledWith("project", "personal");
    expect((await resolveCanvasArchiveFolder("project", "personal", "character", api)).id).toBe("roles");
    await expect(resolveCanvasArchiveFolder("missing", "personal", "other", api)).rejects.toThrow("尚未就绪");
  });

  it.each(["image", "video", "audio"] as const)("reclassifies existing %s without re-uploading or replacing its content", async kind => {
    const api = services();
    const saved = await archiveCanvasMediaAsset({ ...input, node: { ...node, kind } }, api);
    expect(saved.id).toBe("asset");
    expect(api.updateAssetMetadata).toHaveBeenCalledWith("asset", { folder_id: "roles", category: "character" }, "personal");
    expect(api.fetch).not.toHaveBeenCalled();
    expect(api.uploadAsset).not.toHaveBeenCalled();
    expect(node.imageAssetId).toBe("asset");
  });

  it("copies cross-workspace media into the selected canvas category and releases temporary data", async () => {
    const api = services();
    await archiveCanvasMediaAsset({ ...input, scope: "team", category: "other", folderId: "other" }, api);
    expect(api.getAssetContentObjectUrl).toHaveBeenCalledWith("asset", "personal");
    expect(api.updateAssetMetadata).not.toHaveBeenCalled();
    expect(api.uploadAsset).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ folder_id: "other", category: "other", source_project_id: "project" }), "team");
    expect(api.revokeObjectURL).toHaveBeenCalledWith("blob:source");
  });

  it("uploads unarchived media to the chosen category and propagates failures for retry", async () => {
    const api = services();
    await archiveCanvasMediaAsset({ ...input, node: { ...node, imageAssetId: undefined, imageSrc: "data:image/png;base64,aW1hZ2U=" } }, api);
    expect(api.uploadAsset).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ folder_id: "roles", category: "character" }), "personal");
    api.updateAssetMetadata.mockRejectedValueOnce(new Error("save failed"));
    await expect(archiveCanvasMediaAsset(input, api)).rejects.toThrow("save failed");
    expect(api.uploadAsset).toHaveBeenCalledTimes(1);
  });
});
