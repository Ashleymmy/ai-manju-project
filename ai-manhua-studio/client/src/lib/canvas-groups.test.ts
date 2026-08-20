import { describe, expect, it } from "vitest";

import { createCanvasGroup, normalizeCanvasGroups, removeNodesFromCanvasGroups, resizeCanvasGroup } from "./canvas-groups";

const nodes = [
  { id: "a", x: 100, y: 80, width: 200, height: 120 },
  { id: "b", x: 360, y: 140, width: 180, height: 160 },
  { id: "c", x: 720, y: 90, width: 140, height: 100 },
];

describe("canvas groups", () => {
  it("creates a padded production-style frame around at least two nodes", () => {
    expect(createCanvasGroup(nodes, ["a"], "group-1")).toBeNull();
    expect(createCanvasGroup(nodes, ["a", "b"], "group-1", "镜头组")).toEqual({
      id: "group-1",
      title: "镜头组",
      nodeIds: ["a", "b"],
      position: { x: 72, y: 34 },
      width: 496,
      height: 294,
      color: "#7dd3fc",
    });
  });

  it("normalizes persisted groups and removes missing node ids", () => {
    expect(normalizeCanvasGroups([{
      id: "group-1",
      title: "已保存",
      nodeIds: ["a", "missing", "b"],
      position: { x: 10, y: 20 },
      width: 500,
      height: 320,
      color: "#ff0000",
    }], nodes)).toEqual([{
      id: "group-1",
      title: "已保存",
      nodeIds: ["a", "b"],
      position: { x: 10, y: 20 },
      width: 500,
      height: 320,
      color: "#ff0000",
    }]);
    expect(normalizeCanvasGroups([{
      id: "group-2",
      nodeIds: ["a", "missing"],
    }], nodes)[0].nodeIds).toEqual(["a"]);
  });

  it("keeps remaining group members when nodes are deleted", () => {
    const group = createCanvasGroup(nodes, ["a", "b"], "group-1")!;
    expect(removeNodesFromCanvasGroups([group], ["a"])[0].nodeIds).toEqual(["b"]);
    expect(removeNodesFromCanvasGroups([group], ["a", "b"])).toEqual([]);
  });

  it("resizes from all corners while preserving the opposite edge", () => {
    const group = { id: "g", title: "组", nodeIds: ["a"], position: { x: 100, y: 80 }, width: 400, height: 300, color: "#fff" };
    expect(resizeCanvasGroup(group, "bottom-right", 60, 40)).toMatchObject({ position: { x: 100, y: 80 }, width: 460, height: 340 });
    expect(resizeCanvasGroup(group, "top-left", 60, 40)).toMatchObject({ position: { x: 160, y: 120 }, width: 340, height: 260 });
    expect(resizeCanvasGroup(group, "top-left", 500, 500)).toMatchObject({ position: { x: 240, y: 200 }, width: 260, height: 180 });
  });
});
