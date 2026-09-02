import { describe, expect, it } from "vitest";

import {
  canvasAudioMimeType,
  normalizeCanvasAudioGenerationConfig,
} from "./audioConfig";

describe("canvas audio config", () => {
  it("keeps the established normalization contract without importing the HTTP client", () => {
    expect(normalizeCanvasAudioGenerationConfig({
      model: " tts ",
      voice: "nova",
      format: "wav",
      speed: "9",
      instructions: " speak softly ",
    })).toEqual({
      model: "tts",
      voice: "nova",
      format: "wav",
      speed: "4",
      instructions: "speak softly",
    });
    expect(normalizeCanvasAudioGenerationConfig({
      model: "tts",
      voice: "unknown",
      format: "unknown",
      speed: "invalid",
    })).toMatchObject({ voice: "alloy", format: "mp3", speed: "1" });
    expect(canvasAudioMimeType("opus")).toBe("audio/opus");
    expect(canvasAudioMimeType("unknown")).toBe("audio/mpeg");
  });
});
