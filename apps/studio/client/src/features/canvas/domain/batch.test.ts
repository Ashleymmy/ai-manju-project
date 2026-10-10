import { describe, expect, it } from "vitest";
import { refreshImageBatchRoot, swapImageBatchPrimary } from "./batch";
import { completeGeneratedImageTarget, failGeneratedImageTarget } from "./generation";
import { promptTextFromNode } from "./nodeUtils";
import { ensureUniqueCanvasNodeTitles } from "./nodeTitles";
import { buildCanvasSnapshot, parseCanvasSnapshot } from "./snapshotCodec";
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
    ...extra,
    metadata: { status: "success", assetId: `asset-${id}`, ...extra.metadata },
  };
}

function permutations<T>(items: T[]): T[][] {
  return items.length ? items.flatMap((item, index) =>
    permutations(items.filter((_, otherIndex) => otherIndex !== index)).map(rest => [item, ...rest])) : [[]];
}

describe("image batch primary", () => {
  it("swaps the primary payload with the selected child without duplicating either image", () => {
    const nodes = [
      imageNode("root", { metadata: { isBatchRoot: true, batchChildIds: ["child"], imageResolution: "1K", quality: "low", requestedImageSize: "1024x1024" } }),
      imageNode("child", { metadata: { batchRootId: "root", imageResolution: "4K", quality: "high", requestedImageSize: "3840x2160" } }),
    ];

    const next = swapImageBatchPrimary(nodes, "root", "child");
    const root = next.find((node) => node.id === "root")!;
    const child = next.find((node) => node.id === "child")!;
    expect(root.imageAssetId).toBe("asset-child");
    expect(child.imageAssetId).toBe("asset-root");
    expect(root.metadata?.ownAssetId).toBe("asset-child");
    expect(root.metadata?.primaryImageId).toBeUndefined();
    expect(root.metadata).toMatchObject({ imageResolution: "4K", quality: "high", requestedImageSize: "3840x2160" });
    expect(child.metadata).toMatchObject({ imageResolution: "1K", quality: "low", requestedImageSize: "1024x1024" });
  });

  it.each(permutations(["root", "a", "b", "c"]).map(order => ({ order })))
  ("keeps all four slot assets when results complete in order $order", ({ order }) => {
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
    let next = nodes.map(node => ({ ...node, imageAssetId: undefined, metadata: {
      ...node.metadata, assetId: undefined, jobId: `job-${node.id}`,
    } })) as CanvasNodeData[];
    const completed = new Set<string>();
    for (const id of order) {
      next = completeGeneratedImageTarget(next, id, results[id], "prompt");
      completed.add(id);
      for (const slot of next) {
        expect(slot.imageAssetId).toBe(completed.has(slot.id) ? results[slot.id].assetId : undefined);
        expect(slot.metadata?.status).toBe(completed.has(slot.id) ? "success" : "loading");
        expect(slot.metadata?.jobId).toBe(completed.has(slot.id) ? undefined : `job-${slot.id}`);
      }
      expect(next[0].metadata?.batchStatus).toBe(completed.size === 4 ? "success" : "loading");
    }
    expect(next.filter((node) => node.metadata?.status === "success").map((node) => node.imageAssetId)).toEqual([
      "asset-r", "asset-a", "asset-b", "asset-c",
    ]);
    expect(next.map(node => node.title)).toEqual(["未命名画布image-1", "未命名画布image-2", "未命名画布image-3", "未命名画布image-4"]);
  });

  it("keeps the failed root retryable without duplicating a successful child", () => {
    const root = imageNode("root", { imageAssetId: undefined, metadata: {
      isBatchRoot: true, batchChildIds: ["child"], status: "loading", assetId: undefined, jobId: "job-root",
    } });
    let next = refreshImageBatchRoot([root, imageNode("child", { metadata: { batchRootId: "root" } })], "root");
    expect(next[0].imageAssetId).toBeUndefined();
    expect(next[0].metadata?.jobId).toBe("job-root");
    next = failGeneratedImageTarget(next, "root", "根节点失败");
    expect(next[0]).toMatchObject({ metadata: { status: "error", errorDetails: "根节点失败", batchStatus: "success" } });
    expect(next[0].imageAssetId).toBeUndefined();
    expect(next[1].imageAssetId).toBe("asset-child");
  });

  it("resolves top-level asset IDs and swaps each image's editable references and request metadata", () => {
    const nodes = [
      imageNode("root", { metadata: { isBatchRoot: true, batchChildIds: ["child"], assetId: undefined, prompt: "图片1 白天", composerContent: "@[node:day] 白天", seed: 1 } }),
      imageNode("child", { metadata: { batchRootId: "root", assetId: undefined, prompt: "图片1 夜晚", composerContent: "@[node:night] 夜晚", seed: 2 } }),
    ];
    let next = swapImageBatchPrimary(nodes, "root", "child");
    expect(next[0].metadata?.ownAssetId).toBe("asset-child");
    expect(promptTextFromNode(next[0])).toBe("@[node:night] 夜晚");
    expect(promptTextFromNode(next[1])).toBe("@[node:day] 白天");
    expect(next[0].metadata?.seed).toBe(2);
    expect(next[1].metadata?.seed).toBe(1);
    next = swapImageBatchPrimary(next, "root", "child");
    expect(next.map(node => node.imageAssetId)).toEqual(["asset-root", "asset-child"]);
    expect(next[0].metadata?.ownAssetId).toBe("asset-root");
  });

  it("names the batch root like other generated images instead of writing the batch status", () => {
    let next: CanvasNodeData[] = [
      imageNode("root", { title: "生成中…", imageAssetId: undefined, metadata: {
        isBatchRoot: true, batchChildIds: ["a", "b"], status: "loading", assetId: undefined, jobId: "job-root",
      } }),
      imageNode("a", { title: "生成中 2/3", imageAssetId: undefined, metadata: { batchRootId: "root", status: "loading", assetId: undefined } }),
      imageNode("b", { title: "生成中 3/3", imageAssetId: undefined, metadata: { batchRootId: "root", status: "loading", assetId: undefined } }),
    ];
    for (const id of ["a", "b"]) next = completeGeneratedImageTarget(next, id, { id, assetId: `asset-${id}`, src: "" }, "苹果");
    expect(next[0].title).toBe("生成中…");
    next = completeGeneratedImageTarget(next, "root", { id: "root", assetId: "asset-root", src: "" }, "苹果");
    expect(next[0].metadata?.batchStatus).toBe("success");
    expect(next.map(node => node.title)).toEqual(["未命名画布image-1", "未命名画布image-2", "未命名画布image-3"]);
    expect(next.some(node => node.title.startsWith("批量"))).toBe(false);
  });

  it("returns stored batch status names to automatic names when a snapshot loads", () => {
    const custom = { titleEdited: true, titleMode: "custom" as const };
    const nodes = [
      imageNode("root", { title: "批量图片 4/4-1", metadata: { ...custom, titleBase: "批量图片 4/4", isBatchRoot: true, batchChildIds: ["swapped"], batchModelV2: true } }),
      imageNode("swapped", { title: "批量图片 6/6", metadata: { batchRootId: "root" } }),
      imageNode("copy", { title: "批量图片 6/6副本", metadata: custom }),
      imageNode("failed", { title: "批量生成失败", imageAssetId: undefined, metadata: { status: "error", assetId: undefined } }),
      imageNode("named", { title: "批量图片说明", metadata: { ...custom, titleBase: "批量图片说明" } }),
    ];
    const parsed = parseCanvasSnapshot(buildCanvasSnapshot({}, nodes, [], 100, 0, 0))!;
    const titles = ensureUniqueCanvasNodeTitles(parsed.nodes, [], "苹果").map(node => node.title);
    expect(titles).toEqual(["苹果image-1", "苹果image-2", "苹果image-3", "生成失败", "批量图片说明"]);
  });

  it("does not keep the previous result's pixel size when a generation overwrites a node", () => {
    const nodes = [imageNode("a", { metadata: {
      status: "loading", naturalWidth: 1024, naturalHeight: 1024, requestedImageSize: "1920x1072",
    } })];
    const completed = completeGeneratedImageTarget(nodes, "a", { id: "new", assetId: "asset-new", src: "" }, "苹果");
    expect(completed[0].metadata).toMatchObject({ naturalWidth: 1920, naturalHeight: 1072 });

    const unknown = completeGeneratedImageTarget([imageNode("b", { metadata: {
      status: "loading", naturalWidth: 1024, naturalHeight: 1024, requestedImageSize: undefined,
    } })], "b", { id: "new", assetId: "asset-new", src: "" }, "苹果");
    expect(unknown[0].metadata?.naturalWidth).toBeUndefined();
    expect(unknown[0].metadata?.naturalHeight).toBeUndefined();
  });

  it("shrinks an overwritten result into the arranged frame instead of growing over neighbours", () => {
    const square = [imageNode("a", { width: 320, height: 320, metadata: { status: "loading", requestedImageSize: "720x1280" } })];
    const tall = completeGeneratedImageTarget(square, "a", { id: "new", assetId: "asset-new", src: "" }, "苹果");
    expect(tall[0]).toMatchObject({ width: 180, height: 320 });
    const wide = completeGeneratedImageTarget(
      [{ ...tall[0], metadata: { ...tall[0].metadata, status: "loading", requestedImageSize: "1280x720" } }],
      "a", { id: "next", assetId: "asset-next", src: "" }, "苹果",
    );
    expect(wide[0]).toMatchObject({ width: 320, height: 180 });
  });

  it("does not swap a slot while its generation is pending", () => {
    const nodes = [
      imageNode("root", { metadata: { isBatchRoot: true, batchChildIds: ["child"], status: "loading" } }),
      imageNode("child", { metadata: { batchRootId: "root" } }),
    ];
    expect(swapImageBatchPrimary(nodes, "root", "child")).toBe(nodes);
  });
});
