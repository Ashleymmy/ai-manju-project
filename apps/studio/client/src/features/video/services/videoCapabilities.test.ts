import { afterEach, describe, expect, it, vi } from "vitest";
import { replaceVideoModelCapabilities, videoOptionAvailable } from "@/entities/model/videoCapabilities";
import { replaceVideoModelDurations } from "@/entities/model/videoDuration";
import { createVideoGenerationTask, normalizeVideoGenerationConfig, validateVideoGenerationReferences } from "./generationGateway";

const base = { model: "sdvideo/seedance-2.0-mini", resolution: "1080p", size: "1:1", seconds: "5", generateAudio: true, watermark: false };
afterEach(() => { replaceVideoModelCapabilities({}); replaceVideoModelDurations({}); vi.unstubAllGlobals(); });

describe("video capability enforcement", () => {
  it("restores old Mini nodes at an available resolution while preserving square output", () => {
    expect(normalizeVideoGenerationConfig(base)).toMatchObject({ size: "1:1", resolution: "720p" });
    expect(videoOptionAvailable(base.model, "resolutions", "1080p")).toBe(false);
  });
  it("rejects raw/stale unsupported submissions before any upload or generation request", async () => {
    replaceVideoModelDurations({ [base.model]: [4, 5, 6] });
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(createVideoGenerationTask(base, "test")).rejects.toThrow("分辨率");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses provider-scoped endpoint metadata without affecting 2.5 or another endpoint", () => {
    replaceVideoModelCapabilities({ "mt::ep-mini": { resolutions: ["480p", "720p"] }, "mt::ep-long": { resolutions: ["480p", "720p", "1080p"] } });
    expect(videoOptionAvailable("mt::ep-mini", "resolutions", "1080p")).toBe(false);
    expect(videoOptionAvailable("mt::ep-long", "resolutions", "1080p")).toBe(true);
    expect(videoOptionAvailable("other::ep-mini", "resolutions", "1080p")).toBe(true);
  });
  it("blocks Wan reference/frame mixtures and unsupported ultrawide ratio", () => {
    const model = "sdvideo/yike-wan3.0-video";
    expect(videoOptionAvailable(model, "ratios", "21:9")).toBe(false);
    const image = { kind: "image" as const, id: "a", name: "a", mime: "image/png", bytes: 1, width: 1, height: 1, url: "asset://test" };
    expect(() => validateVideoGenerationReferences({ images: [{ ...image, role: "first_frame" }, image], videos: [], audios: [] }, model)).toThrow("不能与普通参考素材同时使用");
  });
});
