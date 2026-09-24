import { describe, expect, it, vi } from "vitest";
import type { CanvasNodeData } from "../domain/types";
import { syncCanvasNodeAssetName } from "./assetNames";

const context = { userId: "user", projectId: "canvas", scope: "personal" as const };
const node = (kind: CanvasNodeData["kind"], title = "新名称"): CanvasNodeData => ({
  id: "node", kind, title, content: "正文", x: 0, y: 0, width: 200, height: 180,
  metadata: { assetId: "asset", assetScope: "team", textAssetId: "saved-text", textAssetScope: "team" },
});
function services() {
  return {
    updateAssetMetadata: vi.fn(async (id: string, data: Record<string, unknown>) => ({ id, name: String(data.name), type: "image" as const })),
    renameCanvasTextAsset: vi.fn(async (input: { id: string; title: string }) => ({ ...input, content: "已存内容", scope: "team" as const, createdAt: "", updatedAt: "" })),
    publishAssetNameChange: vi.fn(),
  };
}

describe("canvas asset names", () => {
  it.each(["image", "video", "audio"] as const)("persists %s names without filename extensions in the asset's actual scope", async kind => {
    const api = services();
    await syncCanvasNodeAssetName(node(kind, `新名称.${kind === "image" ? "png" : kind === "video" ? "mp4" : "mp3"}`), context, api);
    expect(api.updateAssetMetadata).toHaveBeenCalledWith("asset", { name: "新名称" }, "team");
    expect(api.publishAssetNameChange).toHaveBeenCalledWith({ assetId: "asset", name: "新名称", scope: "team" });
  });
  it("renames manually archived text without writing its body", async () => {
    const api = services();
    await syncCanvasNodeAssetName(node("text"), context, api);
    expect(api.renameCanvasTextAsset).toHaveBeenCalledWith({ userId: "user", scope: "team", id: "saved-text", title: "新名称" });
    expect(api.updateAssetMetadata).not.toHaveBeenCalled();
    expect(api.publishAssetNameChange).toHaveBeenCalledWith({ assetId: "local-text:saved-text", name: "新名称", scope: "team" });
  });
  it("serializes rapid renames and continues after a rejected write", async () => {
    const api = services();
    let reject!: (error: Error) => void;
    api.updateAssetMetadata.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const first = syncCanvasNodeAssetName(node("image", "旧请求"), context, api);
    const failed = expect(first).rejects.toThrow("network");
    const second = syncCanvasNodeAssetName(node("image", "最新请求"), context, api);
    await vi.waitFor(() => expect(api.updateAssetMetadata).toHaveBeenCalledTimes(1));
    expect(api.publishAssetNameChange).not.toHaveBeenCalled();
    reject(new Error("network"));
    await failed;
    await second;
    expect(api.updateAssetMetadata).toHaveBeenLastCalledWith("asset", { name: "最新请求" }, "team");
    expect(api.publishAssetNameChange).toHaveBeenCalledOnce();
    expect(api.publishAssetNameChange).toHaveBeenLastCalledWith({ assetId: "asset", name: "最新请求", scope: "team" });
  });
  it("does not treat an empty placeholder or configuration as a server asset", async () => {
    const api = services();
    await syncCanvasNodeAssetName({ ...node("image"), metadata: {} }, context, api);
    await syncCanvasNodeAssetName(node("config"), context, api);
    expect(api.updateAssetMetadata).not.toHaveBeenCalled();
  });
});
