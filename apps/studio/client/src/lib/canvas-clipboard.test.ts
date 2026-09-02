import { describe, expect, it } from "vitest";

import { createCanvasClipboard, pasteCanvasClipboard } from "./canvas-clipboard";

const nodes = [
  { id: "a", title: "A", x: 0, y: 0, width: 100, height: 80, metadata: { nested: { value: 1 }, sourceNodeId: "b", batchChildIds: ["b", "c"] } },
  { id: "b", title: "B", x: 140, y: 20, width: 80, height: 60, metadata: { nested: { value: 2 }, sourceNodeId: "c" } },
  { id: "c", title: "C", x: 400, y: 0, width: 80, height: 60, metadata: { nested: { value: 3 } } },
];
const edges = [
  { id: "a-b", from: "a", to: "b" },
  { id: "b-c", from: "b", to: "c" },
  { id: "x-a", from: "x", to: "a" },
];

describe("canvas clipboard", () => {
  it("deep clones selected nodes and keeps only internal edges", () => {
    const clipboard = createCanvasClipboard(nodes, edges, ["a", "b"], "personal:project-1");

    expect(clipboard?.nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(clipboard?.edges).toEqual([edges[0]]);
    clipboard!.nodes[0].metadata.nested.value = 99;
    expect(nodes[0].metadata.nested.value).toBe(1);
  });

  it("rejects an empty selection and cross-project paste", () => {
    expect(createCanvasClipboard(nodes, edges, [], "personal:project-1")).toBeNull();
    const clipboard = createCanvasClipboard(nodes, edges, ["a"], "personal:project-1");
    expect(pasteCanvasClipboard(clipboard, "team:project-2", { x: 0, y: 0 }, () => "new-a")).toBeNull();
  });

  it("rebuilds node ids, centers the fragment, and remaps only internal edges", () => {
    const clipboard = createCanvasClipboard(nodes, edges, ["a", "b"], "personal:project-1");
    const ids = ["new-a", "new-b"];
    const pasted = pasteCanvasClipboard(clipboard, "personal:project-1", { x: 500, y: 300 }, () => ids.shift()!);

    expect(pasted?.nodes).toMatchObject([
      { id: "new-a", title: "A 副本", x: 390, y: 260, metadata: { sourceNodeId: "new-b", batchChildIds: ["new-b"] } },
      { id: "new-b", title: "B 副本", x: 530, y: 280, metadata: { nested: { value: 2 } } },
    ]);
    expect(pasted?.edges).toEqual([{ id: "new-a:new-b", from: "new-a", to: "new-b" }]);
    expect(pasted?.idMap.get("a")).toBe("new-a");
  });
});
