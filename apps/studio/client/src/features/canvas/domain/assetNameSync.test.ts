import { describe, expect, it } from "vitest";

import {
  applyAssetNameToLinkedNodes,
  collectLinkedAssetRefs,
  looksLikeGeneratedAssetName,
  reconcileLinkedAssetNames,
} from "./assetNameSync";
import type { CanvasNodeData } from "./types";

function node(partial: Partial<CanvasNodeData> & Pick<CanvasNodeData, "id">): CanvasNodeData {
  return {
    kind: "image",
    title: "",
    content: "",
    x: 0,
    y: 0,
    width: 200,
    height: 160,
    ...partial,
  };
}

describe("linked canvas / library asset names", () => {
  it("treats provider/screenshot filenames as generated", () => {
    expect(looksLikeGeneratedAssetName("provider_0.png")).toBe(true);
    expect(looksLikeGeneratedAssetName("ScreenShot_2026-09-02_151523_163.png")).toBe(true);
    expect(looksLikeGeneratedAssetName("水果摊")).toBe(false);
  });

  it("renames every node that points at the same asset", () => {
    const nodes = [
      node({ id: "a", title: "旧名", imageAssetId: "asset-1" }),
      node({ id: "b", title: "另一张", imageAssetId: "asset-2" }),
      node({ id: "c", title: "副本", metadata: { assetId: "asset-1" } }),
    ];
    const next = applyAssetNameToLinkedNodes(nodes, "asset-1", "水果摊");
    expect(next.map(item => item.title)).toEqual(["水果摊", "另一张", "水果摊"]);
  });

  it("pushes a human canvas title onto a generated library name", () => {
    const nodes = [
      node({ id: "a", title: "水果摊", imageAssetId: "asset-1", metadata: { assetScope: "personal" } }),
    ];
    const result = reconcileLinkedAssetNames(nodes, { "asset-1": "provider_0.png" }, "personal");
    expect(result.pushes).toEqual([{ assetId: "asset-1", name: "水果摊", scope: "personal" }]);
    expect(result.nodes[0]?.title).toBe("水果摊");
  });

  it("pulls a library rename onto stale canvas titles", () => {
    const nodes = [
      node({ id: "a", title: "水果摊", imageAssetId: "asset-1" }),
    ];
    const result = reconcileLinkedAssetNames(nodes, { "asset-1": "果铺夜景" }, "team");
    expect(result.pushes).toEqual([]);
    expect(result.nodes[0]?.title).toBe("果铺夜景");
  });

  it("collects unique asset ids with per-node scopes", () => {
    const refs = collectLinkedAssetRefs([
      node({ id: "a", imageAssetId: "asset-1", metadata: { assetScope: "team" } }),
      node({ id: "b", metadata: { assetId: "asset-1", assetScope: "team" } }),
      node({ id: "c", imageAssetId: "asset-2" }),
    ], "personal");
    expect(refs).toEqual([
      { assetId: "asset-1", scope: "team" },
      { assetId: "asset-2", scope: "personal" },
    ]);
  });
});
