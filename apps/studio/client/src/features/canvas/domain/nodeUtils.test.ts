import { describe, expect, it } from "vitest";

import {
  fragmentMediaFileName,
  fragmentMediaMimeType,
  applyCanvasImageNaturalSize,
  canvasGenerationInputsFromVideoSnapshot,
  fitCanvasImageNodeSize,
  imageResolutionFromNode,
  isAbortError,
  modelFromNode,
  promptTextFromNode,
  qualityFromNode,
  sizeFromNode,
} from "./nodeUtils";
import type { CanvasNodeData } from "./types";

describe("canvas node utilities", () => {
  it("keeps a registered provider asset when the original node was replaced", () => {
    const inputs = canvasGenerationInputsFromVideoSnapshot({
      items: [{
        nodeId: "removed-image",
        type: "image",
        title: "角色图",
        source: "asset",
        providerAssetId: "volcano-person",
        providerAssetType: "Image",
        scope: "personal",
        name: "角色图",
        mime: "image/png",
        bytes: 0,
      }],
    }, []);

    expect(inputs).toEqual([expect.objectContaining({
      type: "image",
      seedanceVolcanoAssets: [{
        volcanoAssetId: "volcano-person",
        name: "角色图",
        assetType: "Image",
      }],
    })]);
  });

  it("keeps editable mentions separate from the resolved request, including a cleared composer", () => {
    const node = {
      kind: "image", content: "图片1 在海边",
      metadata: { prompt: "图片1 在海边", composerContent: "@[node:reference] 在海边" },
    } as CanvasNodeData;
    expect(promptTextFromNode(node)).toBe("@[node:reference] 在海边");
    expect(promptTextFromNode({ ...node, metadata: { ...node.metadata, composerContent: "" } })).toBe("");
    expect(promptTextFromNode({ ...node, metadata: { prompt: "旧提示词" } })).toBe("旧提示词");
  });

  it("recognizes abort errors structurally without relying on a host constructor", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true);
    expect(isAbortError({ message: "请求超时或已取消" })).toBe(true);
    expect(isAbortError(new Error("请求超时或已取消"))).toBe(true);
    expect(isAbortError({ name: "NetworkError", message: "failed" })).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });

  it("preserves fragment media MIME and file naming semantics", () => {
    expect(fragmentMediaMimeType("video")).toBe("video/mp4");
    expect(fragmentMediaMimeType("audio")).toBe("audio/mpeg");
    expect(fragmentMediaMimeType("image")).toBe("image/png");
    expect(fragmentMediaFileName("片段 / 一", "audio", "audio/wav")).toBe(
      "片段 - 一.wav",
    );
  });

  it("fits image nodes to the source aspect instead of the default 4:3 frame", () => {
    expect(fitCanvasImageNodeSize(1024, 1024)).toEqual({ width: 320, height: 320 });
    expect(fitCanvasImageNodeSize(768, 1024)).toEqual({ width: 320, height: 427 });
    expect(fitCanvasImageNodeSize(1920, 1080)).toEqual({ width: 320, height: 180 });

    const defaultFrame = { width: 320, height: 238, metadata: {} };
    const fitted = applyCanvasImageNaturalSize(defaultFrame, 768, 1024);
    expect(fitted).toMatchObject({ width: 320, height: 427, metadata: { naturalWidth: 768, naturalHeight: 1024 } });
    expect(applyCanvasImageNaturalSize(fitted, 768, 1024)).toBe(fitted);

    const userResized = { width: 400, height: 280, metadata: { naturalWidth: 768, naturalHeight: 1024 } };
    expect(applyCanvasImageNaturalSize(userResized, 768, 1024)).toBe(userResized);
  });

  it("defaults canvas image params to 1K, auto size, and low quality", () => {
    const empty = { metadata: {} } as CanvasNodeData;
    expect(imageResolutionFromNode(empty)).toBe("1K");
    expect(sizeFromNode(empty)).toBe("auto");
    expect(qualityFromNode(empty)).toBe("low");
    expect(qualityFromNode({ metadata: { quality: "auto" } } as CanvasNodeData)).toBe("low");
    expect(qualityFromNode({ metadata: { quality: "high" } } as CanvasNodeData)).toBe("high");
    expect(imageResolutionFromNode({ metadata: { imageResolution: "4K" } } as CanvasNodeData)).toBe("4K");
  });

  it("treats retired gpt-image-1 family models saved on nodes as unset", () => {
    const legacy = { metadata: { model: "provider::gpt-image-1.5" } } as CanvasNodeData;
    const legacyV1 = { metadata: { model: "gpt-image-1" } } as CanvasNodeData;
    const current = { metadata: { model: "provider::gpt-image-2" } } as CanvasNodeData;
    expect(modelFromNode(legacy, "fallback-model")).toBe("fallback-model");
    expect(modelFromNode(legacyV1, "fallback-model")).toBe("fallback-model");
    expect(modelFromNode(current, "fallback-model")).toBe("provider::gpt-image-2");
    expect(modelFromNode({ metadata: {} } as CanvasNodeData, "fallback-model")).toBe("fallback-model");
  });
});
