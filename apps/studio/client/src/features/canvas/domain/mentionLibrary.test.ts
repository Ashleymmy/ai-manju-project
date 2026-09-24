import { describe, expect, it } from "vitest";
import type { AssetFolder } from "@/entities/asset";
import { buildCanvasMentionReferences } from "./mentions";
import { buildCanvasMentionLibraryMenu, emptyCanvasMentionLibrary, type CanvasMentionLibraryState } from "./mentionLibrary";

export const folder = (id: string, parent_id: string, name: string, extra: Partial<AssetFolder> = {}): AssetFolder => ({
  id, parent_id, name, kind: "system", asset_count: 0, descendant_asset_count: 0, sort_order: 0, ...extra,
});
const folders = [
  folder("system", "", "系统归档", { system_key: "system_root" }),
  folder("canvas", "system", "画布工坊", { system_key: "canvas", sort_order: 40 }),
  folder("mine", "canvas", "未命名画布1", { system_key: "canvas_project", source_ref_id: "project-1" }),
  folder("same-title", "canvas", "未命名画布1", { system_key: "canvas_project", source_ref_id: "project-2" }),
  folder("roles", "mine", "角色", { sort_order: 10 }),
  folder("scenes", "mine", "场景", { sort_order: 20 }),
  folder("props", "mine", "道具", { sort_order: 30 }),
  folder("other", "mine", "其他", { sort_order: 70 }),
  folder("unfiled", "system", "未分类", { sort_order: 10 }),
  folder("custom", "", "素材草稿", { kind: "user" }),
];
const nodes = ["source", "ancestor", "target", "downstream", "sibling"].map(id => ({ id, kind: "text", title: id, content: id }));
const edges = [
  { from: "source", to: "target" }, { from: "ancestor", to: "source" },
  { from: "target", to: "downstream" }, { from: "source", to: "sibling" },
];
const references = buildCanvasMentionReferences("target", nodes, edges, [
  { id: "role", name: "角色立绘", type: "image" },
  { id: "scene", name: "街道", type: "image" },
], "personal");
const library: CanvasMentionLibraryState = { ...emptyCanvasMentionLibrary("project-1"), folders };

describe("canvas mention library navigation", () => {
  it.each(["root", "folder:roles", "favorites"] as const)("groups mixed media in %s, retaining complete numbered names and stable same-type order", target => {
    const mixed = ["audio", "image", "text", "video", "image"];
    const inputs = mixed.map((kind, index) => ({ id: `n${index}`, kind, title: `素材（${index}）`, content: "内容", metadata: { assetId: `source${index}` } }));
    const assets = mixed.map((type, index) => ({ id: `a${index}`, type, name: `素材（${index}）` }));
    const refs = buildCanvasMentionReferences("target", [...inputs, { id: "target", kind: "text", title: "目标", content: "" }], inputs.map(node => ({ from: node.id, to: "target" })), assets, "personal");
    const query = target === "root" ? "素材" : "";
    const menu = buildCanvasMentionLibraryMenu(refs, query, target, { ...library, target, query, assetIds: assets.map(asset => asset.id) });
    const entries = menu.flatMap(item => item.kind === "reference" ? [item.reference] : []);
    expect(entries.map(ref => ref.key)).toEqual(["node:n2", "node:n1", "node:n4", "node:n3", "node:n0", "asset:a2", "asset:a1", "asset:a4", "asset:a3", "asset:a0"]);
    expect(entries.find(ref => ref.key === "asset:a4")?.label).toBe("素材（4）");
    expect(assets.map(asset => asset.id)).toEqual(["a0", "a1", "a2", "a3", "a4"]);
  });
  it("lists only direct predecessors before the library entries", () => {
    expect(buildCanvasMentionLibraryMenu(references, "", "root", library).map(item => item.id)).toEqual([
      "node:source", "folder:mine", "favorites", "folder:canvas", "library",
    ]);
  });

  it("opens actual direct children and never turns category names into folder IDs", () => {
    const items = buildCanvasMentionLibraryMenu(references, "", "folder:mine", library);
    expect(items.filter(item => item.kind === "folder").map(item => [item.label, item.target])).toEqual([
      ["角色", "folder:roles"], ["场景", "folder:scenes"], ["道具", "folder:props"], ["其他", "folder:other"],
    ]);
  });

  it("shows top-level other-material folders without repeating the current project", () => {
    expect(buildCanvasMentionLibraryMenu([], "", "root", library).map(item => item.id)).toEqual(["folder:mine", "favorites", "folder:canvas", "library"]);
    expect(buildCanvasMentionLibraryMenu([], "", "library", library).map(item => item.id)).toEqual(["folder:unfiled", "folder:custom"]);
    expect(buildCanvasMentionLibraryMenu([], "", "folder:canvas", library).map(item => item.id)).toEqual(["folder:same-title"]);
  });

  it("lists system and user folders inside the grouped asset view", () => {
    const view: CanvasMentionLibraryState = {
      ...library, target: "library", assetIds: ["role"], hasMore: true,
      folders: [...folders,
        folder("upload", "system", "手动上传", { sort_order: 20 }),
        folder("workbench", "system", "生图工作台", { sort_order: 30 }),
        folder("comic", "system", "漫剧资产助手", { sort_order: 50 }),
        folder("custom-2", "", "额外素材", { kind: "user" }),
      ],
    };
    expect(buildCanvasMentionLibraryMenu([], "", "root", view).map(item => item.id)).toEqual(["folder:mine", "favorites", "folder:canvas", "library"]);
    expect(buildCanvasMentionLibraryMenu([], "", "library", view).map(item => item.id)).toEqual([
      "folder:unfiled", "folder:upload", "folder:workbench", "folder:comic", "folder:custom-2", "folder:custom",
    ]);
    expect(buildCanvasMentionLibraryMenu(references, "", "library", view).map(item => item.id)).toEqual([
      "node:source", "folder:unfiled", "folder:upload", "folder:workbench", "folder:comic", "folder:custom-2", "folder:custom",
    ]);
  });

  it("keeps global search results accessible at both index levels and filters grouped folders", () => {
    const rootView = { ...library, target: "root" as const, query: "角色", assetIds: ["role"] };
    expect(buildCanvasMentionLibraryMenu(references, "角色", "root", rootView).map(item => item.id)).toContain("asset:role");
    const otherView = { ...library, target: "library" as const, query: "角色", assetIds: ["role"] };
    expect(buildCanvasMentionLibraryMenu(references, "角色", "library", otherView).map(item => item.id)).not.toContain("asset:role");
    expect(buildCanvasMentionLibraryMenu([], "草稿", "library", library).map(item => item.id)).toEqual(["folder:custom"]);
    expect(buildCanvasMentionLibraryMenu([], "", "root", { ...library, projectId: "new-project" }).map(item => item.id)).toEqual(["favorites", "folder:canvas", "library"]);
  });

  it("skips automatic dates while keeping categories, manually named dates and archived assets accessible", () => {
    const view: CanvasMentionLibraryState = {
      ...library, target: "folder:mine", assetIds: ["role", "scene"],
      folders: [...folders,
        folder("day-1", "mine", "2026-09-15", { system_key: "canvas_project_date" }),
        folder("day-2", "mine", "2026-09-16", { system_key: "canvas_project_date" }),
        folder("manual-day", "mine", "2026-09-16", { kind: "user", sort_order: 40 }),
        folder("nested", "day-1", "补充素材", { kind: "user", sort_order: 50 }),
      ],
    };
    expect(buildCanvasMentionLibraryMenu(references, "", "folder:mine", view).map(item => item.id)).toEqual([
      "node:source", "folder:roles", "folder:scenes", "folder:props",
      "folder:manual-day", "folder:nested", "folder:other", "asset:role", "asset:scene",
    ]);
    expect(view.folders.find(item => item.id === "nested")?.parent_id).toBe("day-1");
  });

  it("also skips system month buckets when browsing the other asset libraries", () => {
    const view: CanvasMentionLibraryState = {
      ...library, target: "folder:workbench", assetIds: ["scene"],
      folders: [...folders,
        folder("workbench", "system", "生图工作台", { system_key: "image_workbench" }),
        folder("month", "workbench", "2026-09", { system_key: "image_workbench_month" }),
      ],
    };
    expect(buildCanvasMentionLibraryMenu([], "", "folder:workbench", view)).toEqual([]);
    expect(buildCanvasMentionLibraryMenu(references, "", "folder:workbench", view).map(item => item.id)).toEqual([
      "node:source", "asset:scene",
    ]);
  });

  it("uses only the latest folder/favorites response, preserving other cached chips", () => {
    const view = { ...library, target: "folder:roles" as const, assetIds: ["role"] };
    expect(buildCanvasMentionLibraryMenu(references, "", "folder:roles", view).map(item => item.id)).toEqual(["node:source", "asset:role"]);
    expect(buildCanvasMentionLibraryMenu(references, "", "favorites", view).filter(item => item.kind === "reference" && item.reference.source === "asset")).toEqual([]);
    expect(buildCanvasMentionLibraryMenu(references, "", "favorites", { ...view, target: "favorites", assetIds: ["scene"] }).map(item => item.id)).toEqual(["node:source", "asset:scene"]);
  });

  it("handles cycles and missing edges while retaining old reference resolution", () => {
    const cyclic = buildCanvasMentionReferences("target", nodes, [...edges, { from: "target", to: "ancestor" }, { from: "missing", to: "target" }], [], "personal");
    const items = buildCanvasMentionLibraryMenu(cyclic, "", "root", library);
    expect(items.filter(item => item.kind === "reference").map(item => item.id)).toEqual(["node:source"]);
    expect(cyclic.find(ref => ref.nodeId === "ancestor")?.active).toBe(true);
    expect(cyclic.find(ref => ref.nodeId === "downstream")?.active).toBe(true);
  });

  it("does not reveal earlier ancestors through search, but includes them when directly connected", () => {
    expect(buildCanvasMentionLibraryMenu(references, "ancestor", "root", library).filter(item => item.kind === "reference")).toEqual([]);
    const direct = buildCanvasMentionReferences("target", nodes, [...edges,
      { from: "ancestor", to: "target" }, { from: "source", to: "target" },
    ], [], "personal");
    expect(buildCanvasMentionLibraryMenu(direct, "", "root", library).filter(item => item.kind === "reference").map(item => item.id)).toEqual(["node:source", "node:ancestor"]);
  });
});
