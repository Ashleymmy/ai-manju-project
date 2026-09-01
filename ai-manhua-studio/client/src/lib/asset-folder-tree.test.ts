import { describe, expect, it } from "vitest";

import { collectFolderSubtreeIds, flattenFolderTree, folderPathLabel, type FolderLike } from "./asset-folder-tree";

function folder(id: string, parentId = "", name = id, sortOrder = 0): FolderLike {
  return { id, parent_id: parentId, name, sort_order: sortOrder };
}

describe("asset folder tree", () => {
  it("flattens folders into depth-first order sorted by sort_order then name", () => {
    const folders = [
      folder("b", "", "乙", 2),
      folder("a", "", "甲", 1),
      folder("a1", "a", "甲-子2", 2),
      folder("a0", "a", "甲-子1", 1),
      folder("a0x", "a0", "孙"),
    ];
    const rows = flattenFolderTree(folders);
    expect(rows.map((row) => row.folder.id)).toEqual(["a", "a0", "a0x", "a1", "b"]);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 1, 0]);
  });

  it("treats folders with a missing parent as roots", () => {
    const rows = flattenFolderTree([folder("orphan", "ghost", "孤儿"), folder("root")]);
    expect(rows.map((row) => [row.folder.id, row.depth])).toEqual([["orphan", 0], ["root", 0]]);
  });

  it("collects subtree ids including the root itself", () => {
    const folders = [folder("a"), folder("a1", "a"), folder("a2", "a"), folder("a1x", "a1"), folder("b")];
    const subtree = collectFolderSubtreeIds(folders, "a");
    expect([...subtree].sort()).toEqual(["a", "a1", "a1x", "a2"]);
    expect(subtree.has("b")).toBe(false);
  });

  it("returns an empty set for empty root", () => {
    expect(collectFolderSubtreeIds([folder("a")], "").size).toBe(0);
  });

  it("builds path labels and survives parent cycles", () => {
    const folders = [folder("a", "b", "甲"), folder("b", "a", "乙"), folder("c", "a", "丙")];
    expect(folderPathLabel(folders, "c")).toBe("乙 / 甲 / 丙");
    expect(folderPathLabel([folder("x")], "x")).toBe("x");
    expect(folderPathLabel([], "missing")).toBe("");
  });
});
