import { describe, expect, it } from "vitest";
import { canvasImageGenerationSettings, canvasImageGenerationSettingsIssue } from "./imageGenerationSettings";
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

  it("applies an editing tool's ratio override without losing resolution or detail", () => {
    expect(canvasImageGenerationSettings(node({ imageResolution: "4K", size: "1:1", quality: "high" }), "2:1"))
      .toEqual({ imageResolution: "4K", size: "3840x1920", quality: "high" });
  });
});
