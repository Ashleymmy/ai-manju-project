import { describe, expect, it } from "vitest";

import { assetPackageUploadMetadata, createAssetPackage, readAssetPackage } from "./asset-transfer";
import type { Asset } from "@/entities/asset";

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset_001",
    type: "image",
    name: "夜巷参考.png",
    category: "reference",
    tags: ["tag_a", "tag_b"],
    note: "灯光参考",
    source_type: "manual_upload",
    content_type: "image/png",
    ...overrides,
  } as Asset;
}

describe("asset package", () => {
  it("round-trips assets and their binaries through zip", async () => {
    const first = asset();
    const second = asset({ id: "asset_002", name: "街景", content_type: "image/jpeg" });
    const zip = await createAssetPackage([
      { asset: first, blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) },
      { asset: second, blob: new Blob([new Uint8Array([4, 5])], { type: "image/jpeg" }) },
    ]);

    const items = await readAssetPackage(zip);
    expect(items).toHaveLength(2);
    expect(items[0].asset.id).toBe("asset_001");
    expect(items[0].file?.name).toBe("夜巷参考.png");
    expect(await items[0].file?.arrayBuffer().then((buffer) => new Uint8Array(buffer))).toEqual(new Uint8Array([1, 2, 3]));
    // 名称无扩展名时按 MIME 推导
    expect(items[1].file?.name).toBe("街景.jpg");
  });

  it("skips assets without binary content but keeps them listed", async () => {
    const zip = await createAssetPackage([{ asset: asset(), blob: null }]);
    const items = await readAssetPackage(zip);
    expect(items).toHaveLength(1);
    expect(items[0].file).toBeUndefined();
  });

  it("rejects a zip without the manifest", async () => {
    const { createZip } = await import("./zip");
    const zip = await createZip([{ name: "files/foo.png", data: new Blob([new Uint8Array([1])]) }]);
    await expect(readAssetPackage(zip)).rejects.toThrow("assets.json");
  });

  it("maps asset fields onto upload metadata", () => {
    expect(assetPackageUploadMetadata(asset(), "folder_1")).toEqual({
      name: "夜巷参考.png",
      source_type: "manual_upload",
      folder_id: "folder_1",
      category: "reference",
      tag_ids: "tag_a,tag_b",
      note: "灯光参考",
    });
  });
});
