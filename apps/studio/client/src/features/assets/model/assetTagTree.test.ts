import { describe, expect, it } from "vitest";
import type { SemanticTag } from "@/entities/tag";
import { assetTagBranches, assetTagEntries, searchAssetTagEntries, type AssetTagBranch } from "./assetTagTree";

function tag(id: string, name: string, parentId = "", patch: Partial<SemanticTag> = {}): SemanticTag {
  return {
    id, name, parent_id: parentId, sort_order: 0, aliases: [], scope_type: "user", description: "",
    asset_enabled: true, prompt_enabled: false, inherit_mode: "auto", status: "active",
    asset_count: 0, prompt_count: 0, editable: true, children_count: 0, ...patch,
  };
}

function paths(branches: AssetTagBranch[]): string[] {
  return branches.flatMap(branch => [branch.path, ...paths(branch.children)]);
}

describe("asset tag hierarchy", () => {
  const tags = [
    tag("people", "角色"), tag("lead", "主角", "people"),
    tag("hero", "主角", "lead", { aliases: [{ id: "alias", tag_id: "hero", alias: "Hero" }] }),
    tag("places", "场景", "", { sort_order: 1 }), tag("place-lead", "主角", "places"),
  ];

  it("preserves sorted roots, arbitrary depth and distinct paths for duplicate names", () => {
    expect(paths(assetTagBranches([...tags].reverse()))).toEqual([
      "角色", "角色 / 主角", "角色 / 主角 / 主角", "场景", "场景 / 主角",
    ]);
  });

  it("keeps required non-asset ancestors but prunes unrelated prompt-only branches", () => {
    const result = assetTagBranches([
      tag("context", "提示词父类", "", { asset_enabled: false }),
      tag("child", "素材", "context"),
      tag("prompt", "无关提示词", "", { asset_enabled: false }),
      tag("prompt-child", "无关子类", "context", { asset_enabled: false }),
    ]);
    expect(paths(result)).toEqual(["提示词父类", "提示词父类 / 素材"]);
    expect(result[0].tag.asset_enabled).toBe(false);
    expect(result[0].children[0].tag.asset_enabled).toBe(true);
  });

  it("searches aliases and full paths without losing ancestors or changing the original tree", () => {
    const branches = assetTagBranches(tags);
    const snapshot = JSON.stringify(branches);
    const entries = assetTagEntries(branches);
    expect(searchAssetTagEntries(entries, " hErO ").map(item => item.branch.path)).toEqual(["角色 / 主角 / 主角"]);
    expect(searchAssetTagEntries(entries, "场景 / 主角").map(item => item.branch.path)).toEqual(["场景 / 主角"]);
    expect(searchAssetTagEntries(entries, "角色").map(item => item.branch.path)).toEqual(["角色", "角色 / 主角", "角色 / 主角 / 主角"]);
    expect(entries.find(item => item.branch.tag.id === "hero")?.ancestors.map(item => item.tag.id)).toEqual(["people", "lead"]);
    expect(JSON.stringify(branches)).toBe(snapshot);
  });

  it("returns all branches for empty searches and none for missing matches", () => {
    const branches = assetTagBranches(tags);
    const entries = assetTagEntries(branches);
    expect(searchAssetTagEntries(entries, "  ")).toBe(entries);
    expect(searchAssetTagEntries(entries, "不存在")).toEqual([]);
    expect(assetTagBranches([])).toEqual([]);
  });

  it("does not drop or endlessly recurse through orphaned and cyclic tags", () => {
    const branches = assetTagBranches([tag("orphan", "孤立", "missing"), tag("a", "A", "b"), tag("b", "B", "a")]);
    expect(paths(branches)).toHaveLength(3);
    expect(paths(branches)).toContain("孤立");
    expect(searchAssetTagEntries(assetTagEntries(branches), "B").map(item => item.branch.path)).toEqual(["A / B"]);
  });
});
