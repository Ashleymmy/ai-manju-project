import { describe, expect, it } from "vitest";

import { createCanvasClipboard, duplicateCanvasNode, pasteCanvasClipboard } from "./clipboard";

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
  it("duplicates the image and settings without sharing nested data or original task relationships", () => {
    const source = {
      ...nodes[0], imageAssetId: "apple-asset", imageSrc: "/apple.png",
      metadata: {
        nested: { value: 1 }, status: "success", prompt: "一个苹果", model: "image-model",
        sourceNodeId: "config-1", batchRootId: "root", batchChildIds: ["child"],
        isBatchRoot: true, batchModelV2: true, batchStatus: "loading", batchErrorDetails: "旧批次错误",
        primaryImageId: "child", ownAssetId: "previous-asset", ownImageSrc: "/previous.png",
        imageBatchExpanded: true, jobId: "original-job", jobProgress: 80,
      },
    };
    const before = structuredClone(source);
    const duplicate = duplicateCanvasNode(source, "new-apple");
    expect(duplicate).toMatchObject({
      id: "new-apple", title: "A副本", imageAssetId: "apple-asset", imageSrc: "/apple.png",
    });
    expect(duplicate.metadata).toEqual({
      nested: { value: 1 }, status: "success", prompt: "一个苹果", model: "image-model", titleEdited: true,
    });
    duplicate.metadata.nested.value = 99;
    expect(source).toEqual(before);
  });

  it("does not leave a duplicate waiting on the original node's running job", () => {
    const source = { ...nodes[0], metadata: { status: "loading", jobId: "running-job", jobProgress: 50 } };
    expect(duplicateCanvasNode(source, "copy").metadata).toEqual({ status: "idle", titleEdited: true });
    expect(source.metadata).toEqual({ status: "loading", jobId: "running-job", jobProgress: 50 });
  });

  it("pastes a single node without any upstream or downstream connections", () => {
    const clipboard = createCanvasClipboard(nodes, edges, ["b"], "personal:project-1");
    const pasted = pasteCanvasClipboard(clipboard, "personal:project-1", { x: 500, y: 300 }, () => "copy-b");
    expect(clipboard?.edges).toEqual([]);
    expect(pasted?.edges).toEqual([]);
    expect(pasted?.nodes[0].metadata).not.toHaveProperty("sourceNodeId");
    expect(edges).toHaveLength(3);
  });

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
      { id: "new-a", title: "A副本", x: 390, y: 260, metadata: { sourceNodeId: "new-b", batchChildIds: ["new-b"] } },
      { id: "new-b", title: "B副本", x: 530, y: 280, metadata: { nested: { value: 2 } } },
    ]);
    expect(pasted?.edges).toEqual([{ id: "new-a:new-b", from: "new-a", to: "new-b" }]);
    expect(pasted?.idMap.get("a")).toBe("new-a");
  });
});
