import { describe, expect, it } from "vitest";

import {
  applyAssetNameToLinkedNodes,
  applySyncedAssetNameToLinkedNodes,
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

  it("normalizes provider names received from library sync events", () => {
    const nodes = [
      node({ id: "a", title: "旧名", imageAssetId: "asset-1", metadata: { prompt: "水果摊" } }),
      node({ id: "b", title: "provider_0.png", imageAssetId: "asset-2", metadata: { canvasOrigin: "imported" } }),
      node({ id: "c", kind: "video", title: "旧视频", imageAssetId: "asset-3" }),
    ];
    const next = applySyncedAssetNameToLinkedNodes(nodes, "asset-1", "provider_0.png");
    expect(next[0]?.title).toBe("水果摊");
    expect(next[1]?.title).toBe("provider_0.png");
    expect(applySyncedAssetNameToLinkedNodes(next, "asset-3", "镜头.mp4")[2]?.title).toBe("镜头.mp4");
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

  it("does not restore image extensions when synchronizing generated titles", () => {
    const nodes = [node({ id: "a", title: "水果摊", imageAssetId: "asset-1" })];
    const result = reconcileLinkedAssetNames(nodes, { "asset-1": "水果摊.PNG" }, "personal");
    expect(result.nodes).toBe(nodes);
    expect(result.pushes).toEqual([]);
  });

  it("replaces old provider filenames with a prompt summary on sync", () => {
    const nodes = [node({
      id: "a", title: "provider_0.png", imageAssetId: "asset-1", metadata: { prompt: "街边水果摊" },
    })];
    const result = reconcileLinkedAssetNames(nodes, { "asset-1": "provider_0.png" }, "personal");
    expect(result.nodes[0]?.title).toBe("街边水果摊");
    expect(reconcileLinkedAssetNames(result.nodes, { "asset-1": "provider_0.png" }, "personal").nodes)
      .toBe(result.nodes);
  });

  it("keeps imported filenames and batch summaries while syncing other images", () => {
    const nodes = [
      node({ id: "a", title: "provider_0.png", imageAssetId: "imported", metadata: { canvasOrigin: "imported" } }),
      node({ id: "root", title: "批量图片 2/2", imageAssetId: "root-asset", metadata: { isBatchRoot: true } }),
      node({ id: "child", title: "水果摊 · 2", imageAssetId: "child-asset", metadata: { batchRootId: "root" } }),
    ];
    const result = reconcileLinkedAssetNames(nodes, {
      imported: "provider_0.png", "root-asset": "provider_0.png", "child-asset": "provider_0.png",
    }, "personal");
    expect(result.nodes).toBe(nodes);
    expect(result.pushes).toEqual([{ assetId: "child-asset", name: "水果摊 · 2", scope: "personal" }]);
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
