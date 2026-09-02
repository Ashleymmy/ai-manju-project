import { describe, expect, it } from "vitest";

import {
  IMAGE_WORKBENCH_SIZE_OPTIONS,
  resolveImageWorkbenchRequestOptions,
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
});
