import { afterEach, describe, expect, it } from "vitest";
import { replaceVideoModelProtocols } from "@/entities/model/videoProtocol";
import { replaceVideoModelCapabilities } from "@/entities/model/videoCapabilities";
import { validateVideoGenerationReferences, videoReferenceLimitsForModel, type VideoGenerationReferences } from "./generationGateway";

const seedance25 = "official::doubao-seedance-2-5-260628";
const seedance20 = "official::doubao-seedance-2-0-260128";

function references(images = 0, videos = 0, audios = 0, durationMs = 3000): VideoGenerationReferences {
  const file = (name: string, type: string) => {
    const value = new File(["reference"], name, { type });
    return { id: name, name, file: value, mime: type, bytes: value.size };
  };
  return {
    images: Array.from({ length: images }, (_, i) => ({ ...file(`${i}.png`, "image/png"), kind: "image", width: 1280, height: 720 })),
    videos: Array.from({ length: videos }, (_, i) => ({ ...file(`${i}.mp4`, "video/mp4"), kind: "video", width: 1280, height: 720, durationMs })),
    audios: Array.from({ length: audios }, (_, i) => ({ ...file(`${i}.mp3`, "audio/mpeg"), kind: "audio", durationMs })),
  };
}

afterEach(() => { replaceVideoModelProtocols({}); replaceVideoModelCapabilities({}); });

describe("Seedance model-specific reference contracts", () => {
  it.each([seedance25, "sdvideo/seedance-2.5", "proxy::seedance_2_5", "seedance-2.5-pro"])(
    "%s accepts all reference types at the official 2.5 boundary", model => {
      expect(() => validateVideoGenerationReferences(references(30, 10, 10), model)).not.toThrow();
    },
  );

  it.each([
    [31, 0, 0, "参考图片最多 30 张"],
    [0, 11, 0, "参考视频最多 10 个"],
    [0, 0, 11, "参考音频最多 10 个"],
  ] as const)("rejects count overflow (%i/%i/%i)", (images, videos, audios, message) => {
    expect(() => validateVideoGenerationReferences(references(images, videos, audios), seedance25)).toThrow(message);
  });

  it("allows audio-only 2.5 references and preserves the 2.0 combination rule", () => {
    expect(() => validateVideoGenerationReferences(references(0, 0, 1, 30_000), seedance25)).not.toThrow();
    expect(() => validateVideoGenerationReferences(references(0, 0, 1), seedance20)).toThrow("参考音频不能单独使用");
  });

  it("checks single clip and separate audio/video total durations", () => {
    expect(() => validateVideoGenerationReferences(references(0, 1, 1, 30_000), seedance25)).not.toThrow();
    expect(() => validateVideoGenerationReferences(references(0, 1, 0, 30_001), seedance25)).toThrow("2-30 秒");
    expect(() => validateVideoGenerationReferences(references(0, 0, 1, 1999), seedance25)).toThrow("2-30 秒");
    expect(() => validateVideoGenerationReferences(references(0, 2, 0, 16_000), seedance25)).toThrow("参考视频总时长不能超过 30 秒");
    expect(() => validateVideoGenerationReferences(references(0, 0, 2, 16_000), seedance25)).toThrow("参考音频总时长不能超过 30 秒");
  });

  it("preserves 2.0 counts and 15s durations", () => {
    expect(() => validateVideoGenerationReferences(references(9, 3, 3, 5000), seedance20)).not.toThrow();
    expect(() => validateVideoGenerationReferences(references(10), seedance20)).toThrow("参考图片最多 9 张");
    expect(() => validateVideoGenerationReferences(references(1, 4), seedance20)).toThrow("参考视频最多 3 个");
    expect(() => validateVideoGenerationReferences(references(1, 0, 4), seedance20)).toThrow("参考音频最多 3 个");
    expect(() => validateVideoGenerationReferences(references(1, 1, 0, 15_001), seedance20)).toThrow("2-15 秒");
    expect(() => validateVideoGenerationReferences(references(1, 0, 2, 8000), seedance20)).toThrow("参考音频总时长不能超过 15 秒");
  });

  it("uses explicit provider-scoped endpoint limits instead of friendly labels", () => {
    replaceVideoModelProtocols({ "a::ep-test": "seedance", "b::ep-test": "seedance", "c::ep-test": "openai" }, {
      "a::ep-test": "seedance 2.5", "b::ep-test": "Seedance 2.0", "c::ep-test": "Seedance 2.5",
      [seedance20]: "Seedance 2.5",
    });
    expect(() => validateVideoGenerationReferences(references(30, 10, 10), "a::ep-test")).toThrow();
    replaceVideoModelCapabilities({ "a::ep-test": { references: { images: 30, videos: 10, audios: 10, audio_only: true, media_max_duration_ms: 30_000, media_max_total_duration_ms: 30_000 } } });
    expect(() => validateVideoGenerationReferences(references(30, 10, 10), "a::ep-test")).not.toThrow();
    for (const model of ["b::ep-test", "c::ep-test", seedance20, "wan3.0-video", "seedance-2.50"]) {
      expect(videoReferenceLimitsForModel(model).images).toBe(9);
    }
    replaceVideoModelProtocols({ "a::ep-test": "seedance" }, { "a::ep-test": "Seedance 2.0" });
    expect(videoReferenceLimitsForModel("a::ep-test").images).toBe(30);
    replaceVideoModelCapabilities({});
    replaceVideoModelProtocols({});
    expect(videoReferenceLimitsForModel("a::ep-test").images).toBe(9);
  });

  it("does not infer durations from image count and reports actual named audio duration", () => {
    replaceVideoModelCapabilities({ [seedance20]: { references: { images: 40, videos: 3, audios: 3, audio_only: true, media_min_duration_ms: 1000, media_max_duration_ms: 12000, media_max_total_duration_ms: 20000 } } });
    expect(videoReferenceLimitsForModel(seedance20).mediaMaxDurationMs).toBe(12000);
    expect(() => validateVideoGenerationReferences(references(0, 0, 1, 12001), seedance20)).toThrow('参考音频1“0.mp3”时长需要在 1-12 秒之间，当前为 12.00 秒');
    expect(() => validateVideoGenerationReferences(references(0, 0, 1, 1000), seedance20)).not.toThrow();
  });

  it("keeps OpenAI limits and counts registered assets without requiring local files", () => {
    expect(() => validateVideoGenerationReferences(references(7), "openai::video")).not.toThrow();
    expect(() => validateVideoGenerationReferences(references(8), "openai::video")).toThrow("最多支持 7 张");
    const refs = references(30, 10, 10);
    for (const ref of [...refs.images, ...refs.videos, ...refs.audios]) {
      delete ref.file;
      ref.url = `asset://${ref.kind}-${ref.id}`;
    }
    expect(() => validateVideoGenerationReferences(refs, seedance25)).not.toThrow();
    refs.images.push(refs.images[0]);
    expect(() => validateVideoGenerationReferences(refs, seedance25)).toThrow("参考图片最多 30 张");
  });
});
