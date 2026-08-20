import { describe, expect, it } from "vitest";

import type { SemanticTag } from "@/services/api/tags";
import { collectTagSubtreeIds, filterTagsWithAncestors, flattenTagTree, semanticTagPath } from "./tag-tree";

function tag(id: string, name: string, parentId = "", sortOrder = 0): SemanticTag {
  return {
    id,
    name,
    parent_id: parentId,
    sort_order: sortOrder,
    aliases: [],
    scope_type: "user",
    description: "",
    asset_enabled: true,
    prompt_enabled: true,
    inherit_mode: "auto",
    status: "active",
    asset_count: 0,
    prompt_count: 0,
    editable: true,
    children_count: 0,
  };
}

describe("tag tree helpers", () => {
  const tags = [
    tag("root", "角色"),
    tag("child", "主角", "root"),
    { ...tag("leaf", "侦探", "child"), aliases: [{ id: "alias", tag_id: "leaf", alias: "detective" }] },
    tag("other", "场景", "", 1),
  ];

  it("递归展开任意深度并保持排序", () => {
    expect(flattenTagTree(tags).map(({ tag: item, depth }) => [item.id, depth])).toEqual([
      ["root", 0],
      ["child", 1],
      ["leaf", 2],
      ["other", 0],
    ]);
  });

  it("搜索命中名称或别名时保留完整祖先链", () => {
    expect(filterTagsWithAncestors(tags, "detective").map((item) => item.id)).toEqual(["root", "child", "leaf"]);
  });

  it("移动门禁收集自身及全部后代", () => {
    expect([...collectTagSubtreeIds(tags, ["child"])]).toEqual(["child", "leaf"]);
  });

  it("生成稳定的层级路径并防止循环", () => {
    expect(semanticTagPath("leaf", tags)).toBe("角色 / 主角 / 侦探");
    const cyclic = [tag("a", "A", "b"), tag("b", "B", "a")];
    expect(flattenTagTree(cyclic)).toHaveLength(2);
    expect(semanticTagPath("a", cyclic)).toBe("B / A");
  });
});
