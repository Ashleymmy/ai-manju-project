import { describe, expect, it } from "vitest";
import { canvasImageAutoReferenceSize, canvasImageGenerationSettings, canvasImageGenerationSettingsIssue } from "./imageGenerationSettings";
import type { CanvasMentionReference } from "./mentions";
import { toImageSizeValue } from "./nodeUtils";
import type { CanvasNodeData, CanvasNodeMetadata } from "./types";

const node = (metadata: CanvasNodeMetadata) => ({ metadata, width: 80, height: 600 } as CanvasNodeData);
const ratios = ["1:1", "2:1", "4:3", "3:4", "5:4", "4:5", "3:2", "2:3", "21:9", "9:21", "16:9", "9:16", "panorama"];

describe("canvas image generation settings", () => {
  it("blocks saved unavailable resolutions without silently replacing the requested setting", () => {
    for (const imageResolution of ["2K", "4K"]) {
      const saved = node({ imageResolution });
      expect(canvasImageGenerationSettingsIssue(saved)).toContain(`暂不支持 ${imageResolution}`);
      expect(saved.metadata?.imageResolution).toBe(imageResolution);
    }
    expect(canvasImageGenerationSettingsIssue(node({ imageResolution: "1K" }))).toBe("");
    expect(canvasImageGenerationSettingsIssue(node({}))).toBe("");
  });

  it.each([
    ["1K", "1280x720"], ["2K", "2560x1440"], ["4K", "3840x2160"],
  ])("sends a distinct pixel size for %s independent of detail quality", (imageResolution, size) => {
    for (const quality of ["low", "medium", "high"]) {
      expect(canvasImageGenerationSettings(node({ imageResolution, size: "16:9", quality })))
        .toEqual({ imageResolution, size, quality });
    }
  });

  it.each(ratios)("preserves the %s selection within API limits at every resolution", size => {
    expect(toImageSizeValue(size)).toBe(size);
    let previousPixels = 0;
    for (const imageResolution of ["1K", "2K", "4K"]) {
      const request = canvasImageGenerationSettings(node({ imageResolution, size, quality: "high" }));
      const [width, height] = request.size.split("x").map(Number);
      expect(width % 16).toBe(0);
      expect(height % 16).toBe(0);
      expect(Math.max(width, height)).toBeLessThanOrEqual(3840);
      expect(Math.max(width, height) / Math.min(width, height)).toBeLessThanOrEqual(3);
      expect(width * height).toBeGreaterThanOrEqual(655360);
      expect(width * height).toBeLessThanOrEqual(8294400);
      expect(width * height).toBeGreaterThan(previousPixels);
      const [rw, rh] = (size === "panorama" ? "3:1" : size).split(":").map(Number);
      expect(width * rh).toBe(height * rw);
      previousPixels = width * height;
    }
  });

  it("applies resolution in auto mode using bitmap dimensions, with a square fallback", () => {
    expect(canvasImageGenerationSettings(node({ size: "auto", imageResolution: "4K", quality: "high" })).size).toBe("2880x2880");
    expect(canvasImageGenerationSettings(node({ size: "auto", imageResolution: "4K", naturalWidth: 1920, naturalHeight: 1080 })).size).toBe("3840x2160");
    expect(canvasImageGenerationSettings(node({ size: "auto", imageResolution: "4K", requestedImageSize: "2160x3840" })).size).toBe("2160x3840");
    expect(canvasImageGenerationSettings(node({ size: "auto", imageResolution: "4K", naturalWidth: Infinity, naturalHeight: 0 })).size).toBe("2880x2880");
  });

  it("follows the reference image in auto mode before the node's own bitmap", () => {
    const portrait = { width: 1080, height: 1920 };
    expect(canvasImageGenerationSettings(node({ size: "auto" }), undefined, undefined, portrait).size).toBe("768x1360");
    expect(canvasImageGenerationSettings(node({ size: "auto", naturalWidth: 1024, naturalHeight: 1024 }), undefined, undefined, portrait).size).toBe("768x1360");
    expect(canvasImageGenerationSettings(node({ size: "16:9" }), undefined, undefined, portrait).size).toBe("1280x720");
    expect(canvasImageGenerationSettings(node({ size: "auto" }), undefined, undefined, { width: 0, height: 0 }).size).toBe("1024x1024");
  });

  it("resolves the auto reference from the first @-referenced image in prompt order", () => {
    const target = { id: "target", kind: "image", metadata: { size: "auto", prompt: "@[node:text] @[node:wide] @[node:tall]" } } as CanvasNodeData;
    const nodes = [
      target,
      { id: "wide", kind: "image", metadata: { naturalWidth: 1920, naturalHeight: 1080 } },
      { id: "tall", kind: "image", metadata: { naturalWidth: 1080, naturalHeight: 1920 } },
      { id: "pending", kind: "image", metadata: {} },
    ] as CanvasNodeData[];
    const reference = (nodeId: string, kind: "image" | "text") => ({ key: `node:${nodeId}`, nodeId, kind } as CanvasMentionReference);
    const references = [reference("text", "text"), reference("tall", "image"), reference("wide", "image"), reference("pending", "image")];
    expect(canvasImageAutoReferenceSize(target, references, nodes)).toEqual({ width: 1920, height: 1080 });
    expect(canvasImageAutoReferenceSize({ ...target, metadata: { ...target.metadata, size: "1:1" } }, references, nodes)).toBeUndefined();
    expect(canvasImageAutoReferenceSize({ ...target, metadata: { size: "auto", prompt: "@[node:pending]" } }, references, nodes)).toBe("unknown");
    expect(canvasImageAutoReferenceSize({ ...target, metadata: { size: "auto", prompt: "无引用" } }, references, nodes)).toBeUndefined();
  });

  it("applies an editing tool's ratio override without losing resolution or detail", () => {
    expect(canvasImageGenerationSettings(node({ imageResolution: "4K", size: "1:1", quality: "high" }), "2:1"))
      .toEqual({ imageResolution: "4K", size: "3840x1920", quality: "high" });
  });
});
