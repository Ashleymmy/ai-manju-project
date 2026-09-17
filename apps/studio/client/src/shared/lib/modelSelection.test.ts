import { describe, expect, it } from "vitest";
import { modelDisplayName, modelName, modelOptions, resolveModel } from "./modelSelection";

describe("shared generation model selection", () => {
  it("uses managed model names without merging distinct SD-video routes", () => {
    const models = ["sdvideo/seedance-2.0", "sdvideo/seedance-2.0-ark", "sdvideo/vidu-q3"];
    const labels = { [models[0]]: "Seedance 2.0", [models[1]]: "Seedance 2.0 · 火山方舟官方", [models[2]]: "Vidu Q3" };
    expect(modelOptions(models, models[1], labels)).toEqual([
      { value: models[0], label: labels[models[0]] },
      { value: models[1], label: labels[models[1]] },
      { value: models[2], label: labels[models[2]] },
    ]);
    expect(modelDisplayName(models[1], labels)).toBe("Seedance 2.0 · 火山方舟官方");
    expect(modelDisplayName("sdvideo/custom-new-model")).toBe("custom-new-model");
    expect(modelOptions(models, "", { [models[0]]: "同名", [models[1]]: "同名" })).toHaveLength(3);
    expect(resolveModel(models, models[1])).toBe(models[1]);
  });
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
