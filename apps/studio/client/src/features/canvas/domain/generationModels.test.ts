import { describe, expect, it } from "vitest";
import { canvasGenerationModelOptions, canvasModelName } from "./generationModels";

describe("canvas generation model choices", () => {
  it("shows ChinaMobil aliases on the node chip and menu while retaining full selectors", () => {
    const labels = {
      "mobile::doubao-seedance-2-0-260128": "c20",
      "mobile::doubao-seedance-2-0-fast-260128": "c20f",
      "mobile::doubao-seedance-2-0-mini-260615": "c20m",
      "mobile::doubao-seedance-2-5-260628": "c25",
    };
    const models = Object.keys(labels);
    for (const [value, label] of Object.entries(labels)) {
      expect(canvasModelName(value, labels)).toBe(label);
      expect(canvasGenerationModelOptions(models, value, labels)).toEqual(Object.entries(labels).map(([value, label]) => ({ value, label })));
    }
  });
  it("shows SD-video names on both the node chip and its choices", () => {
    const model = "sdvideo/seedance-2.0-ark";
    const labels = { [model]: "Seedance 2.0 · 火山方舟官方" };
    expect(canvasModelName(model, labels)).toBe(labels[model]);
    expect(canvasGenerationModelOptions([model], model, labels)).toEqual([{ value: model, label: labels[model] }]);
  });
  it("shows each real model once and hides supplier names", () => {
    expect(canvasGenerationModelOptions(["first::gpt-image-2", "other::gpt-image-2", "first::seedream-4-0"])).toEqual([
      { value: "first::gpt-image-2", label: "gpt-image-2" },
      { value: "first::seedream-4-0", label: "seedream-4-0" },
    ]);
  });

  it("hides retired gpt-image-1 family models even when still configured upstream", () => {
    expect(canvasGenerationModelOptions([
      "provider::gpt-image-1",
      "provider::gpt-image-1.5",
      "provider::gpt-image-2",
    ], "provider::gpt-image-1.5")).toEqual([
      { value: "provider::gpt-image-2", label: "gpt-image-2" },
    ]);
  });

  it("keeps an existing canvas selection when its supplier is no longer first", () => {
    expect(canvasGenerationModelOptions(["first::gpt-image-2"], "saved::gpt-image-2")).toEqual([
      { value: "saved::gpt-image-2", label: "gpt-image-2" },
    ]);
  });
});
