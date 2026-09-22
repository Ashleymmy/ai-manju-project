import { describe, expect, it } from "vitest";
import { modelDisplayName, modelName, modelOptions, resolveModel, videoModelOptions } from "./modelSelection";

describe("shared generation model selection", () => {
  it("keeps video accounts selectable even with identical model IDs or aliases", () => {
    const company = "company::doubao-seedance-2-0-fast-260128";
    const mobile = "mobile::doubao-seedance-2-0-fast-260128";
    const names = { [company]: "火山", [mobile]: "ChinaMobil" };
    expect(videoModelOptions([company, mobile, mobile], company, { [mobile]: "c20f" }, names)).toEqual([
      { value: company, label: "doubao-seedance-2-0-fast-260128 · 火山" },
      { value: mobile, label: "c20f · ChinaMobil" },
    ]);
    expect(videoModelOptions([company, mobile], company, { [company]: "Fast", [mobile]: "Fast" }, names)).toEqual([
      { value: company, label: "Fast · 火山" }, { value: mobile, label: "Fast · ChinaMobil" },
    ]);
    expect(videoModelOptions([mobile], company, { [mobile]: "c20f" })).toEqual([
      { value: company, label: "doubao-seedance-2-0-fast-260128（当前不可用）", disabled: true }, { value: mobile, label: "c20f" },
    ]);
  });
  it("uses the selected provider's alias regardless of catalog order without changing routing", () => {
    const models = ["company::doubao-seedance-2-0-260128", "mobile::doubao-seedance-2-0-260128"];
    const labels = { [models[0]]: "Company 2.0", [models[1]]: " c20 " };
    for (const ordered of [models, [...models].reverse()]) {
      expect(modelOptions(ordered, models[1], labels)).toEqual([{ value: models[1], label: "c20" }]);
    }
    expect(modelName(models[1])).toBe("doubao-seedance-2-0-260128");
    expect(modelDisplayName("third::doubao-seedance-2-0-260128", labels)).toBe("doubao-seedance-2-0-260128");
    expect(modelDisplayName(models[1], { [models[1]]: " " })).toBe("doubao-seedance-2-0-260128");
    expect(modelOptions(["a::model-a", "b::model-b"], "", { "a::model-a": "same", "b::model-b": "same" })).toHaveLength(2);
  });
  it("shows configured names for opaque endpoint IDs while preserving routing values", () => {
    const models = ["official::ep-25", "official::ep-fast"];
    const labels = { [models[0]]: "Seedance 2.5", [models[1]]: "Seedance 2.0 Fast" };
    expect(modelOptions(models, models[1], labels)).toEqual(models.map(value => ({ value, label: labels[value] })));
    expect(modelDisplayName(models[1], labels)).toBe("Seedance 2.0 Fast");
  });
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
