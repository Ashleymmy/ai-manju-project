import { describe, expect, it } from "vitest";
import type { AssetFolder } from "@/entities/asset";
import { buildCanvasMentionReferences } from "./mentions";
import { buildCanvasMentionLibraryMenu, emptyCanvasMentionLibrary, type CanvasMentionLibraryState } from "./mentionLibrary";

export const folder = (id: string, parent_id: string, name: string, extra: Partial<AssetFolder> = {}): AssetFolder => ({
  id, parent_id, name, kind: "system", asset_count: 0, descendant_asset_count: 0, sort_order: 0, ...extra,
});
const folders = [
  folder("system", "", "系统归档", { system_key: "system_root" }),
  folder("canvas", "system", "画布工坊", { sort_order: 40 }),
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
  it("prioritizes incoming nodes, the exact linked folder, favorites and promoted archive folders", () => {
    expect(buildCanvasMentionLibraryMenu(references, "", "root", library).map(item => item.id)).toEqual([
      "node:source", "node:ancestor", "folder:mine", "favorites", "folder:unfiled", "folder:canvas", "folder:custom",
    ]);
  });

  it("opens actual direct children and never turns category names into folder IDs", () => {
    const items = buildCanvasMentionLibraryMenu(references, "", "folder:mine", library);
    expect(items.filter(item => item.kind === "folder").map(item => [item.label, item.target])).toEqual([
      ["角色", "folder:roles"], ["场景", "folder:scenes"], ["道具", "folder:props"], ["其他", "folder:other"],
    ]);
  });

  it("keeps other folders hierarchical and does not repeat the current project", () => {
    expect(buildCanvasMentionLibraryMenu([], "", "root", library).map(item => item.id)).toEqual(["folder:mine", "favorites", "folder:unfiled", "folder:canvas", "folder:custom"]);
    expect(buildCanvasMentionLibraryMenu([], "", "folder:canvas", library).map(item => item.id)).toEqual(["folder:same-title"]);
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
      "node:source", "node:ancestor", "folder:roles", "folder:scenes", "folder:props",
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
      "node:source", "node:ancestor", "asset:scene",
    ]);
  });

  it("uses only the latest folder/favorites response, preserving other cached chips", () => {
    const view = { ...library, target: "folder:roles" as const, assetIds: ["role"] };
    expect(buildCanvasMentionLibraryMenu(references, "", "folder:roles", view).map(item => item.id)).toEqual(["node:source", "node:ancestor", "asset:role"]);
    expect(buildCanvasMentionLibraryMenu(references, "", "favorites", view).filter(item => item.kind === "reference" && item.reference.source === "asset")).toEqual([]);
    expect(buildCanvasMentionLibraryMenu(references, "", "favorites", { ...view, target: "favorites", assetIds: ["scene"] }).map(item => item.id)).toEqual(["node:source", "node:ancestor", "asset:scene"]);
  });

  it("handles cycles and missing edges while retaining old reference resolution", () => {
    const cyclic = buildCanvasMentionReferences("target", nodes, [...edges, { from: "target", to: "ancestor" }, { from: "missing", to: "target" }], [], "personal");
    const items = buildCanvasMentionLibraryMenu(cyclic, "", "root", library);
    expect(items.filter(item => item.kind === "reference").map(item => item.id)).toEqual(["node:source", "node:ancestor"]);
    expect(cyclic.find(ref => ref.nodeId === "downstream")?.active).toBe(true);
  });
});
