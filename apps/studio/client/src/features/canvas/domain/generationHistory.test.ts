import { describe, expect, it } from "vitest";

import {
  appendCanvasGenerationRevision,
  buildCanvasGenerationHistoryMonth,
  canvasGenerationHistoryDayKey,
  canvasGenerationHistoryItemId,
  cloneCanvasNodeFromGenerationHistory,
  cloneCanvasNodeFromGenerationRevision,
  collectCanvasGenerationHistory,
  formatCanvasGenerationClock,
  groupCanvasGenerationHistory,
  parseCanvasGenerationHistoryItemId,
} from "./generationHistory";
import type { CanvasNodeData } from "./types";

function node(id: string, values: Partial<CanvasNodeData> = {}): CanvasNodeData {
  return {
    id,
    kind: "image",
    title: id,
    content: "",
    x: 0,
    y: 0,
    width: 320,
    height: 238,
    ...values,
  };
}

describe("collectCanvasGenerationHistory", () => {
  it.each(["loading", "error"] as const)("重新生成处于 %s 时仍能取回旧图", status => {
    const previous = node("image", {
      metadata: { status: "success", assetId: "asset-old", prompt: "旧提示词" },
    });
    const revisions = appendCanvasGenerationRevision(previous, "old");
    const items = collectCanvasGenerationHistory([{
      ...previous,
      metadata: { ...previous.metadata, status, generationRevisions: revisions },
    }], { "asset-old": "blob:old" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      nodeId: canvasGenerationHistoryItemId("image", "old"),
      assetId: "asset-old",
      previewUrl: "blob:old",
      prompt: "旧提示词",
    });
  });

  it("收集已完成的图片和视频，跳过占位、进行中的任务和历史插入副本", () => {
    const items = collectCanvasGenerationHistory([
      node("idle"),
      node("loading", { metadata: { status: "loading", assetId: "a" } }),
      node("failed", { metadata: { status: "error", assetId: "broken" } }),
      node("copy", { metadata: { status: "success", assetId: "asset-copy", appliedFromHistory: true } }),
      node("image-1", {
        title: "夜景",
        metadata: {
          status: "success",
          assetId: "asset-image",
          prompt: "雨夜街道",
          model: "seedream",
          generatedAt: "2026-09-10T08:12:00.000Z",
          seed: 42,
          size: "16:9",
        },
      }),
      node("video-1", {
        kind: "video",
        title: "运镜",
        metadata: {
          status: "success",
          assetId: "asset-video",
          prompt: "缓慢推近",
          generatedAt: "2026-09-09T12:00:00.000Z",
          seconds: "5",
        },
      }),
    ], { "asset-image": "blob:image", "asset-video": "blob:video" });

    expect(items.map(item => item.nodeId)).toEqual(["image-1", "video-1"]);
    expect(items[0]).toMatchObject({
      kind: "image",
      prompt: "雨夜街道",
      seed: "42",
      typeLabel: "图片生成",
      modeLabel: "文生图",
      previewUrl: "blob:image",
    });
    expect(items[1]).toMatchObject({
      kind: "video",
      typeLabel: "视频生成",
      modeLabel: "文生视频",
      seconds: "5",
    });
  });

  it("折叠批次的子图也会进入历史，资产创建时间可补日期", () => {
    const items = collectCanvasGenerationHistory([
      node("root", {
        metadata: { isBatchRoot: true, batchChildIds: ["child"], assetId: "asset-root", status: "success" },
      }),
      node("child", {
        metadata: { batchRootId: "root", assetId: "asset-child", status: "success" },
      }),
    ], {}, [
      { id: "asset-child", created_at: "2026-08-30T03:04:00.000Z" },
    ]);
    expect(items.map(item => item.nodeId)).toEqual(["child", "root"]);
    expect(items[0]?.generatedAt).toBe("2026-08-30T03:04:00.000Z");
  });

  it("被覆盖的旧图会作为独立历史记录保留", () => {
    const items = collectCanvasGenerationHistory([
      node("live", {
        title: "新图",
        metadata: {
          status: "success",
          assetId: "asset-new",
          prompt: "新提示词",
          generatedAt: "2026-09-10T10:00:00.000Z",
          generationRevisions: [{
            id: "rev-old",
            kind: "image",
            title: "旧图",
            prompt: "旧提示词",
            assetId: "asset-old",
            generatedAt: "2026-09-09T08:00:00.000Z",
            typeLabel: "图片生成",
            modeLabel: "文生图",
          }],
        },
      }),
    ], { "asset-new": "blob:new", "asset-old": "blob:old" });
    expect(items.map(item => [item.nodeId, item.assetId, item.previewUrl])).toEqual([
      ["live", "asset-new", "blob:new"],
      [canvasGenerationHistoryItemId("live", "rev-old"), "asset-old", "blob:old"],
    ]);
    expect(parseCanvasGenerationHistoryItemId(items[1]!.nodeId)).toEqual({
      nodeId: "live",
      revisionId: "rev-old",
    });
  });
});

describe("groupCanvasGenerationHistory", () => {
  it("按本地日历把记录分成今天、昨天和具体日期", () => {
    const now = new Date(2026, 8, 10, 16, 0, 0);
    const groups = groupCanvasGenerationHistory([
      {
        nodeId: "a",
        kind: "image",
        title: "a",
        prompt: "",
        model: "",
        generatedAt: new Date(2026, 8, 10, 9, 8, 4).toISOString(),
        previewUrl: "",
        assetId: "",
        seed: "a",
        size: "",
        seconds: "",
        typeLabel: "图片生成",
        modeLabel: "文生图",
      },
      {
        nodeId: "b",
        kind: "image",
        title: "b",
        prompt: "",
        model: "",
        generatedAt: new Date(2026, 8, 9, 18, 0, 0).toISOString(),
        previewUrl: "",
        assetId: "",
        seed: "b",
        size: "",
        seconds: "",
        typeLabel: "图片生成",
        modeLabel: "文生图",
      },
      {
        nodeId: "c",
        kind: "video",
        title: "c",
        prompt: "",
        model: "",
        generatedAt: new Date(2026, 8, 10, 10, 0, 0).toISOString(),
        previewUrl: "",
        assetId: "",
        seed: "c",
        size: "",
        seconds: "",
        typeLabel: "视频生成",
        modeLabel: "文生视频",
      },
      {
        nodeId: "d",
        kind: "image",
        title: "d",
        prompt: "",
        model: "",
        generatedAt: new Date(2026, 7, 30, 11, 0, 0).toISOString(),
        previewUrl: "",
        assetId: "",
        seed: "d",
        size: "",
        seconds: "",
        typeLabel: "图片生成",
        modeLabel: "文生图",
      },
    ], "image", now);

    expect(groups.map(group => [group.label, group.items.map(item => item.nodeId)])).toEqual([
      ["今天", ["a"]],
      ["昨天", ["b"]],
      ["8月30日 周日", ["d"]],
    ]);
  });
});

describe("formatCanvasGenerationClock", () => {
  it("缩略图时间显示时分秒", () => {
    expect(formatCanvasGenerationClock(new Date(2026, 8, 10, 9, 8, 4).toISOString())).toBe("09:08:04");
  });
});

describe("buildCanvasGenerationHistoryMonth", () => {
  it("按周日开始排出月份格子，并把当天记录挂到对应日期", () => {
    const weeks = buildCanvasGenerationHistoryMonth([
      {
        nodeId: "a",
        kind: "image",
        title: "a",
        prompt: "",
        model: "",
        generatedAt: new Date(2026, 8, 10, 9, 8, 4).toISOString(),
        previewUrl: "",
        assetId: "",
        seed: "a",
        size: "",
        seconds: "",
        typeLabel: "图片生成",
        modeLabel: "文生图",
      },
      {
        nodeId: "b",
        kind: "image",
        title: "b",
        prompt: "",
        model: "",
        generatedAt: new Date(2026, 7, 30, 11, 0, 0).toISOString(),
        previewUrl: "",
        assetId: "",
        seed: "b",
        size: "",
        seconds: "",
        typeLabel: "图片生成",
        modeLabel: "文生图",
      },
    ], 2026, 8);

    expect(weeks[0]?.map(cell => [cell.day, cell.inMonth, cell.items.map(item => item.nodeId)])).toEqual([
      [30, false, ["b"]],
      [31, false, []],
      [1, true, []],
      [2, true, []],
      [3, true, []],
      [4, true, []],
      [5, true, []],
    ]);
    expect(weeks[1]?.[4]).toMatchObject({
      day: 10,
      inMonth: true,
      isoDate: canvasGenerationHistoryDayKey(new Date(2026, 8, 10, 9, 8, 4).toISOString()),
    });
    expect(weeks[1]?.[4]?.items.map(item => item.nodeId)).toEqual(["a"]);
  });
});

describe("cloneCanvasNodeFromGenerationHistory", () => {
  it("复制为独立节点并去掉批次关系", () => {
    const cloned = cloneCanvasNodeFromGenerationHistory(
      node("child", {
        x: 10,
        y: 20,
        imageAssetId: "asset-1",
        metadata: {
          batchRootId: "root",
          isBatchRoot: false,
          status: "success",
          assetId: "asset-1",
          generatedAt: "2026-09-10T08:12:00.000Z",
          pinColor: "#f00",
          jobId: "job-1",
        },
      }),
      { id: "new-node", x: 100, y: 200 },
    );
    expect(cloned).toMatchObject({
      id: "new-node",
      x: 100,
      y: 200,
      imageAssetId: "asset-1",
    });
    expect(cloned.metadata).toMatchObject({
      status: "success",
      assetId: "asset-1",
      generatedAt: "2026-09-10T08:12:00.000Z",
      appliedFromHistory: true,
    });
    expect(cloned.metadata?.batchRootId).toBeUndefined();
    expect(cloned.metadata?.pinColor).toBeUndefined();
    expect(cloned.metadata?.jobId).toBeUndefined();
  });

  it("可从被覆盖的历史版本还原独立节点", () => {
    const host = node("live", {
      title: "新图",
      imageAssetId: "asset-new",
      metadata: {
        status: "success",
        assetId: "asset-new",
        prompt: "新提示词",
        generationRevisions: [{
          id: "rev-old",
          kind: "image",
          title: "旧图",
          prompt: "旧提示词",
          assetId: "asset-old",
          generatedAt: "2026-09-09T08:00:00.000Z",
          width: 400,
          height: 300,
        }],
      },
    });
    const cloned = cloneCanvasNodeFromGenerationRevision(host, host.metadata!.generationRevisions![0], {
      id: "restored",
      x: 80,
      y: 90,
    });
    expect(cloned).toMatchObject({
      id: "restored",
      title: "旧图",
      imageAssetId: "asset-old",
      width: 400,
      height: 300,
    });
    expect(cloned.metadata).toMatchObject({
      assetId: "asset-old",
      prompt: "旧提示词",
      appliedFromHistory: true,
    });
    expect(cloned.metadata?.generationRevisions).toBeUndefined();
  });
});

describe("appendCanvasGenerationRevision", () => {
  it("把当前图片归档进版本栈且不去重失败", () => {
    const revisions = appendCanvasGenerationRevision(node("live", {
      title: "圣诞",
      imageAssetId: "asset-a",
      metadata: {
        status: "success",
        assetId: "asset-a",
        prompt: "圣诞树",
        generatedAt: "2026-09-10T08:00:00.000Z",
      },
    }), "rev-1");
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      id: "rev-1",
      assetId: "asset-a",
      prompt: "圣诞树",
    });
    const again = appendCanvasGenerationRevision(node("live", {
      imageAssetId: "asset-a",
      metadata: { assetId: "asset-a", generationRevisions: revisions },
    }), "rev-2");
    expect(again).toHaveLength(1);
    expect(again[0]?.id).toBe("rev-1");
  });
});
