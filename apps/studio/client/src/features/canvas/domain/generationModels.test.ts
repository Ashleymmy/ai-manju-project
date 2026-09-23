import { describe, expect, it } from "vitest";
import { canvasGenerationModelOptions, canvasModelName, canvasVideoModelOptions, pickDefaultCanvasVideoModel } from "./generationModels";

describe("canvas generation model choices", () => {
  it("defaults to the available yuntu Seedance Fast entry over the saved global preference", () => {
    const models = ["mobile::fast", "yuntu::mini", "yuntu::fast"];
    const labels = { [models[0]]: "chinaMobil Fast", [models[1]]: "yuntu Seedance 2.0 Mini", [models[2]]: "yuntu Seedance Fast" };
    expect(pickDefaultCanvasVideoModel(models, labels, {}, models[1])).toBe(models[2]);
  });

  it("retains the exact supplier when the provider and model names are separate", () => {
    const models = ["other::fast", "yuntu-provider::fast"];
    const labels = Object.fromEntries(models.map(model => [model, "Seedance Fast"]));
    expect(pickDefaultCanvasVideoModel(models, labels, { [models[0]]: "other", [models[1]]: "yuntu" })).toBe(models[1]);
  });

  it("only selects available models and falls back when yuntu Fast is absent", () => {
    const labels = { "removed::fast": "yuntu Seedance Fast" };
    expect(pickDefaultCanvasVideoModel(["first", "preferred"], labels, {}, "preferred")).toBe("preferred");
    expect(pickDefaultCanvasVideoModel(["first"], labels, {}, "removed::fast")).toBe("first");
    expect(pickDefaultCanvasVideoModel([], labels)).toBe("");
  });

  it("shows ChinaMobil aliases on the node chip and menu while retaining full selectors", () => {
    const labels = {
      "mobile::doubao-seedance-2-0-260128": "c20",
      "mobile::doubao-seedance-2-0-fast-260128": "c20f",
      "mobile::doubao-seedance-2-0-mini-260615": "c20m",
      "mobile::doubao-seedance-2-5-260628": "c25",
    };
    const models = Object.keys(labels);
    const legacy = models.map(value => value.replace("mobile::", "legacy::"));
    for (const [value, label] of Object.entries(labels)) {
      expect(canvasModelName(value, labels)).toBe(label);
      const options = canvasVideoModelOptions([...legacy, ...models], legacy[0], labels);
      expect(options).toHaveLength(8);
      expect(options).toContainEqual({ value, label });
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
