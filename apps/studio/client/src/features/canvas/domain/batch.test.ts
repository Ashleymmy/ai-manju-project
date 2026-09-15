import { describe, expect, it } from "vitest";
import { swapImageBatchPrimary } from "./batch";
import { completeGeneratedImageTarget } from "./generation";
import type { GeneratedImage } from "@/features/image";
import type { CanvasNodeData } from "./types";

function imageNode(id: string, extra: Partial<CanvasNodeData> = {}): CanvasNodeData {
  return {
    id,
    kind: "image",
    title: id,
    content: id,
    x: 0,
    y: 0,
    width: 320,
    height: 238,
    imageAssetId: `asset-${id}`,
    metadata: { status: "success", assetId: `asset-${id}`, ...extra.metadata },
    ...extra,
  };
}

describe("image batch primary", () => {
  it("swaps the primary payload with the selected child without duplicating either image", () => {
    const nodes = [
      imageNode("root", { metadata: { isBatchRoot: true, batchChildIds: ["child"] } }),
      imageNode("child", { metadata: { batchRootId: "root" } }),
    ];

    const next = swapImageBatchPrimary(nodes, "root", "child");
    const root = next.find((node) => node.id === "root")!;
    const child = next.find((node) => node.id === "child")!;
    expect(root.imageAssetId).toBe("asset-child");
    expect(child.imageAssetId).toBe("asset-root");
    expect(root.metadata?.ownAssetId).toBe("asset-child");
    expect(root.metadata?.primaryImageId).toBeUndefined();
  });

  it("keeps all four slot assets when results complete out of order", () => {
    const nodes = [
      imageNode("root", { metadata: { isBatchRoot: true, batchChildIds: ["a", "b", "c"], count: 4, status: "loading" } }),
      imageNode("a", { metadata: { batchRootId: "root", status: "loading" } }),
      imageNode("b", { metadata: { batchRootId: "root", status: "loading" } }),
      imageNode("c", { metadata: { batchRootId: "root", status: "loading" } }),
    ];
    const results: Record<string, GeneratedImage> = {
      root: { id: "r", assetId: "asset-r", src: "" },
      a: { id: "a", assetId: "asset-a", src: "" },
      b: { id: "b", assetId: "asset-b", src: "" },
      c: { id: "c", assetId: "asset-c", src: "" },
    };
    let next = nodes;
    for (const id of ["b", "root", "c", "a"]) {
      next = completeGeneratedImageTarget(next, id, results[id], "prompt");
    }
    expect(next.filter((node) => node.metadata?.status === "success").map((node) => node.imageAssetId)).toEqual([
      "asset-r", "asset-a", "asset-b", "asset-c",
    ]);
  });
});
