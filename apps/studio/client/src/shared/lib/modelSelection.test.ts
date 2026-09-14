import { describe, expect, it } from "vitest";
import { modelName, modelOptions, resolveModel } from "./modelSelection";

describe("shared generation model selection", () => {
  it.each(["gpt-image-2", "wan3.0-video", "tts-1", "gpt-5.6-luna"])("groups %s and preserves a saved supplier", model => {
    const models = [`a::${model}`, `b::${model}`, "a::other"];
    expect(modelOptions(models, `removed::${model}`)).toEqual([
      { value: `removed::${model}`, label: model }, { value: "a::other", label: "other" },
    ]);
    expect(resolveModel(models, `removed::${model}`)).toBe(`removed::${model}`);
    expect(resolveModel(models, "removed::missing")).toBe("");
    expect(modelName(`b::${model}`)).toBe(model);
  });
});
