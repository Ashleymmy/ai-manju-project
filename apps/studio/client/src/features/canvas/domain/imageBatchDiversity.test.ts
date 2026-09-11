import { describe, expect, it } from "vitest";

import {
  canvasImageBatchSlot,
  diversifyCanvasBatchImagePrompt,
  randomImageGenerationSeed,
} from "./imageBatchDiversity";
import type { CanvasNodeData } from "./types";

function node(partial: Partial<CanvasNodeData> & Pick<CanvasNodeData, "id">): CanvasNodeData {
  return {
    kind: "image",
    title: "",
    content: "",
    x: 0,
    y: 0,
    width: 320,
    height: 238,
    ...partial,
  };
}

describe("canvas batch image diversity", () => {
  it("keeps a single-image prompt unchanged", () => {
    expect(diversifyCanvasBatchImagePrompt("四个不一样的苹果", 0, 1)).toBe("四个不一样的苹果");
  });

  it("makes each batch slot a distinct request prompt", () => {
    const prompts = [0, 1, 2, 3].map(index => diversifyCanvasBatchImagePrompt("四个不一样的苹果", index, 4, 1000 + index));
    expect(new Set(prompts).size).toBe(4);
    expect(prompts.every(item => item.startsWith("四个不一样的苹果"))).toBe(true);
    expect(prompts[0]).toContain("1/4");
    expect(prompts[0]).toContain("变体 1000");
    expect(prompts[3]).toContain("4/4");
    expect(prompts[3]).toContain("变体 1003");
  });

  it("reads batch slot order from the root child list", () => {
    const nodes = [
      node({ id: "root", metadata: { isBatchRoot: true, count: 4, batchChildIds: ["a", "b", "c"] } }),
      node({ id: "a", metadata: { batchRootId: "root" } }),
      node({ id: "b", metadata: { batchRootId: "root" } }),
      node({ id: "c", metadata: { batchRootId: "root" } }),
    ];
    expect(canvasImageBatchSlot(nodes, "root")).toEqual({ index: 0, count: 4 });
    expect(canvasImageBatchSlot(nodes, "b")).toEqual({ index: 2, count: 4 });
  });

  it("returns a positive seed in the supported range", () => {
    const seed = randomImageGenerationSeed();
    expect(seed).toBeGreaterThan(0);
    expect(seed).toBeLessThanOrEqual(2_147_483_646);
  });
});
