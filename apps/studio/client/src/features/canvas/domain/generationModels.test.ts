import { describe, expect, it } from "vitest";
import { canvasGenerationModelOptions } from "./generationModels";

describe("canvas generation model choices", () => {
  it("shows each real model once and hides supplier names", () => {
    expect(canvasGenerationModelOptions(["first::gpt-image-2", "other::gpt-image-2", "first::gpt-image-1.5"])).toEqual([
      { value: "first::gpt-image-2", label: "gpt-image-2" },
      { value: "first::gpt-image-1.5", label: "gpt-image-1.5" },
    ]);
  });

  it("keeps an existing canvas selection when its supplier is no longer first", () => {
    expect(canvasGenerationModelOptions(["first::gpt-image-2"], "saved::gpt-image-2")).toEqual([
      { value: "saved::gpt-image-2", label: "gpt-image-2" },
    ]);
  });
});
