import { describe, expect, it } from "vitest";
import {
  aiUpscaleImageFitLongEdge,
  aiUpscaleImageProblem,
  aiUpscaleVideoProblem,
} from "./imageTool";

describe("AI upscale input limits", () => {
  it("keeps images that already fit Alibaba Cloud limits", () => {
    expect(aiUpscaleImageFitLongEdge(1024, 1024, 2_000_000)).toBeNull();
    expect(aiUpscaleImageFitLongEdge(1920, 1080, 3_000_000)).toBeNull();
  });

  it("shrinks large images so long edge ≤ 1920 and short edge ≤ 1080", () => {
    expect(aiUpscaleImageFitLongEdge(2048, 2048, 1)).toBe(1080);
    expect(aiUpscaleImageFitLongEdge(3840, 2160, 1)).toBe(1920);
    expect(aiUpscaleImageFitLongEdge(1080, 2400, 1)).toBe(1920);
  });

  it("recompresses images over 5MB without changing their size", () => {
    expect(aiUpscaleImageFitLongEdge(1600, 900, 6 * 1024 * 1024)).toBe(1600);
  });

  it("rejects images smaller than 32px", () => {
    expect(aiUpscaleImageProblem(20, 400)).toContain("32");
    expect(aiUpscaleImageProblem(32, 32)).toBe("");
  });

  it("checks video resolution", () => {
    expect(aiUpscaleVideoProblem(1280, 720)).toBe("");
    expect(aiUpscaleVideoProblem(640, 360)).toContain("过低");
    expect(aiUpscaleVideoProblem(2560, 1440)).toContain("超出");
    expect(aiUpscaleVideoProblem(0, 0)).toBe("");
  });
});
