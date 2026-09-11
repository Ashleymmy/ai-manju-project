import { describe, expect, it } from "vitest";

import {
  IMAGE_WORKBENCH_SIZE_OPTIONS,
  nearestWorkbenchSizeOption,
  resolveImageWorkbenchRequestOptions,
  snapPixelSizeForModel,
  workbenchPixelDimensions,
  workbenchRequestSize,
  type ImageWorkbenchSizeOption,
} from "./image-workbench-options";

describe("image workbench request options", () => {
  it.each([
    "auto",
    "1:1",
    "3:2",
    "2:3",
    "4:3",
    "3:4",
    "16:9",
    "9:16",
  ] satisfies ImageWorkbenchSizeOption[])("keeps the base ratio %s", (size) => {
    expect(resolveImageWorkbenchRequestOptions(size, "low")).toEqual({ size, quality: "low" });
  });

  it.each([
    ["1:1(2x)", "1:1"],
    ["16:9(2x)", "16:9"],
    ["9:16(2x)", "9:16"],
  ] satisfies Array<[ImageWorkbenchSizeOption, string]>)("maps %s to %s with medium quality", (size, expectedSize) => {
    expect(resolveImageWorkbenchRequestOptions(size, "auto")).toEqual({ size: expectedSize, quality: "medium" });
  });

  it.each([
    ["16:9(4k)", "16:9"],
    ["9:16(4k)", "9:16"],
  ] satisfies Array<[ImageWorkbenchSizeOption, string]>)("maps %s to %s with high quality", (size, expectedSize) => {
    expect(resolveImageWorkbenchRequestOptions(size, "low")).toEqual({ size: expectedSize, quality: "high" });
  });

  it("covers every size rendered by the workbench", () => {
    expect(IMAGE_WORKBENCH_SIZE_OPTIONS).toHaveLength(13);
  });

  it("turns ratio presets into the pixel sizes the API actually consumes", () => {
    expect(workbenchPixelDimensions("16:9", "auto")).toEqual({ width: 1824, height: 1024 });
    expect(workbenchPixelDimensions("9:16", "auto")).toEqual({ width: 1024, height: 1824 });
    expect(workbenchPixelDimensions("1:1", "auto")).toEqual({ width: 1024, height: 1024 });
    expect(workbenchPixelDimensions("3:2", "auto")).toEqual({ width: 1536, height: 1024 });
    expect(workbenchPixelDimensions("16:9", "medium")).toEqual({ width: 2720, height: 1536 });
    expect(workbenchPixelDimensions("16:9(2x)", "auto")).toEqual({ width: 2720, height: 1536 });
    expect(workbenchPixelDimensions("auto", "auto")).toBeNull();
  });

  it("sends explicit pixels for a selected ratio instead of a decorative label", () => {
    expect(workbenchRequestSize("16:9", 1024, 1024, false)).toBe("1024x1024");
    expect(workbenchRequestSize("16:9", 1824, 1024)).toBe("1824x1024");
    expect(workbenchRequestSize("auto", 1824, 1024)).toBe("auto");
  });

  it("snaps gpt-image-1 family sizes to the three official presets", () => {
    expect(snapPixelSizeForModel("provider::gpt-image-1", { width: 1824, height: 1024 })).toEqual({
      width: 1536,
      height: 1024,
    });
    expect(snapPixelSizeForModel("gpt-image-2", { width: 1824, height: 1024 })).toEqual({
      width: 1824,
      height: 1024,
    });
  });

  it("maps a landscape frame back to 16:9", () => {
    expect(nearestWorkbenchSizeOption(1824, 1024)).toBe("16:9");
    expect(nearestWorkbenchSizeOption(1024, 1824)).toBe("9:16");
  });
});
