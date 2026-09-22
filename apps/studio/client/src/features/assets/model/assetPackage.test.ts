import { describe, expect, it, vi } from "vitest";
import { createZip } from "./zip";
import { readAssetPackageContents } from "./assetPackage";
import { AssetPackageImportSession } from "./importAssetPackage";
import type { Asset, AssetFolder } from "@/entities/asset";
import type { SemanticTag } from "@/entities/tag";

const manifest = () => ({
  app: "ai-manju-studio", version: 2,
  folders: [{ id: "root", parent_id: "", name: "1" }, { id: "child", parent_id: "root", name: "2" }, { id: "empty", parent_id: "root", name: "空目录" }],
  tags: [{ id: "style", parent_id: "", name: "风格" }, { id: "tag", parent_id: "style", name: "古风" }],
  assets: [{ id: "image", name: "角色.png", type: "image", category: "character", folder_id: "child", tags: ["古风"], tag_ids: ["tag"], note: "角色备注" }],
  files: [{ assetId: "image", path: "1/2/角色.png", mimeType: "image/png", bytes: 3 }],
});
async function archive(data: unknown, binary = true) {
  return createZip([{ name: "assets.json", data: JSON.stringify(data) }, ...(binary ? [{ name: "1/2/角色.png", data: new Uint8Array([1, 2, 3]) }] : [])]);
}
function dependencies() {
  const folders: AssetFolder[] = [{ id: "existing", parent_id: "", name: "1", kind: "user", sort_order: 0, asset_count: 1, descendant_asset_count: 1 }];
  const tags: SemanticTag[] = [];
  return {
    getAssetFolders: vi.fn(async () => [...folders]),
    createAssetFolder: vi.fn(async (input: { name: string; parent_id?: string }) => ({ ...folders[0], ...input, id: `new-folder-${folders.push({ ...folders[0], ...input })}` })),
    listAllTags: vi.fn(async () => [...tags]),
    createTag: vi.fn(async (_scope: string, input: { name: string; parent_id?: string; asset_enabled: boolean; prompt_enabled: boolean }) => {
      const tag = { ...input, id: `new-tag-${tags.length}`, parent_id: input.parent_id || "", scope_type: "workspace", status: "active", aliases: [], sort_order: 0 } as SemanticTag;
      tags.push(tag); return tag;
    }),
    uploadAsset: vi.fn(async () => ({ id: "uploaded" }) as Asset),
  };
}

describe("portable asset packages", () => {
  it("accepts the API's Unicode character limits without counting surrogate pairs twice", async () => {
    const data = manifest();
    data.folders[0].name = "🌸".repeat(80);
    data.tags[1].name = "🌸".repeat(64);
    const contents = await readAssetPackageContents(await archive(data));
    expect(contents.folders[0].name).toBe(data.folders[0].name);
    expect(contents.tags[1].name).toBe(data.tags[1].name);
  });
  it("restores folders, empty directories, tag hierarchy and file metadata using new account IDs", async () => {
    const contents = await readAssetPackageContents(await archive(manifest()));
    const deps = dependencies();
    const session = new AssetPackageImportSession(contents, "personal", "selected-system-folder", deps);
    await session.run(vi.fn(), new AbortController().signal);
    expect(deps.createAssetFolder.mock.calls.map(([input]) => input.name)).toEqual(["1（导入 1）", "2", "空目录"]);
    expect(deps.createAssetFolder.mock.calls[0][0].parent_id).toBe("");
    expect(deps.createAssetFolder.mock.calls[1][0].parent_id).toBe(session.folderIds.get("root"));
    expect(deps.createTag.mock.calls[1][1].parent_id).toBe(session.tagIds.get("style"));
    const [file, metadata, scope] = deps.uploadAsset.mock.calls[0] as unknown as [File, Record<string, string>, string];
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(metadata).toMatchObject({ name: "角色.png", category: "character", note: "角色备注", source_type: "manual_upload", folder_id: session.folderIds.get("child"), tag_ids: JSON.stringify([session.tagIds.get("tag")]) });
    expect(scope).toBe("personal");
    expect(metadata).not.toHaveProperty("tags");
  });

  it("retries only failed uploads with stable keys and without recreating folders or tags", async () => {
    const contents = await readAssetPackageContents(await archive(manifest()));
    contents.items.push({ asset: { ...contents.items[0].asset, id: "second", name: "second.png" }, file: contents.items[0].file });
    const deps = dependencies();
    deps.uploadAsset.mockResolvedValueOnce({ id: "ok" } as Asset).mockRejectedValueOnce(new Error("connection lost")).mockResolvedValueOnce({ id: "retry" } as Asset);
    const progress = vi.fn();
    const session = new AssetPackageImportSession(contents, "personal", undefined, deps);
    await session.run(progress, new AbortController().signal);
    expect(progress.mock.lastCall![0]).toMatchObject({ completed: 1, failures: [{ name: "second.png", error: "connection lost" }] });
    await session.run(progress, new AbortController().signal);
    expect(deps.createAssetFolder).toHaveBeenCalledTimes(3);
    expect(deps.createTag).toHaveBeenCalledTimes(2);
    expect(deps.uploadAsset).toHaveBeenCalledTimes(3);
    const calls = deps.uploadAsset.mock.calls as unknown as Array<[File, Record<string, string>]>;
    expect(calls[1][1].idempotency_key).toBe(calls[2][1].idempotency_key);
    expect(progress.mock.lastCall![0]).toMatchObject({ phase: "导入完成", completed: 2, failures: [] });
  });

  it("resumes after cancellation without restarting completed uploads", async () => {
    const contents = await readAssetPackageContents(await archive(manifest()));
    const deps = dependencies();
    const controller = new AbortController();
    deps.uploadAsset.mockImplementationOnce(async () => { controller.abort(); throw new Error("canceled"); });
    const session = new AssetPackageImportSession(contents, "team", undefined, deps);
    await expect(session.run(vi.fn(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    await session.run(vi.fn(), new AbortController().signal);
    expect(session.completed.size).toBe(1);
    expect(deps.createAssetFolder).toHaveBeenCalledTimes(3);
  });

  it("imports legacy server directory ZIPs and treats legacy labels as names", async () => {
    const zip = await createZip([{ name: "manifest.json", data: JSON.stringify({ version: 1, assets: [{ asset_id: "old", name: "a.png", type: "image", content_type: "image/png", size: 1, archive_path: "1/2/a.png", folder_path: "1/2", category: "other", tags: ["古风,人物"], status: "succeeded" }] }) }, { name: "1/2/a.png", data: new Uint8Array([1]) }]);
    const contents = await readAssetPackageContents(zip);
    expect(contents.folders.map(folder => folder.name)).toEqual(["1", "2"]);
    const deps = dependencies();
    await new AssetPackageImportSession(contents, "personal", undefined, deps).run(vi.fn(), new AbortController().signal);
    const metadata = (deps.uploadAsset.mock.calls[0] as unknown as [File, Record<string, string>])[1];
    expect(metadata.tags).toBe('["古风,人物"]');
    expect(metadata).not.toHaveProperty("tag_ids");
  });

  it.each(["missing", "size", "cycle", "parent", "duplicate", "tag", "path", "version"])("rejects %s corruption before any mutations", async kind => {
    const data = manifest();
    if (kind === "size") data.files[0].bytes = 4;
    if (kind === "cycle") data.folders[0].parent_id = "child";
    if (kind === "parent") data.folders[1].parent_id = "absent";
    if (kind === "duplicate") data.assets.push(data.assets[0]);
    if (kind === "tag") data.assets[0].tag_ids = ["absent"];
    if (kind === "path") data.files[0].path = "../secret";
    if (kind === "version") data.version = 99;
    await expect(readAssetPackageContents(await archive(data, kind !== "missing"))).rejects.toThrow();
  });

  it("preserves packages consisting only of empty folders", async () => {
    const data = { ...manifest(), assets: [], files: [], tags: [] };
    const contents = await readAssetPackageContents(await archive(data, false));
    const deps = dependencies();
    await new AssetPackageImportSession(contents, "personal", undefined, deps).run(vi.fn(), new AbortController().signal);
    expect(deps.createAssetFolder).toHaveBeenCalledTimes(3);
    expect(deps.uploadAsset).not.toHaveBeenCalled();
  });
});
