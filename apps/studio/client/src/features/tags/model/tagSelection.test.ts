import { expect, it } from "vitest";
import { setTagSelection, toggleTagRange } from "./tagSelection";

it("selects only the visible result and preserves selections hidden by search", () => {
  expect(setTagSelection(["hidden"], ["a", "b"], true)).toEqual(["hidden", "a", "b"]);
  expect(setTagSelection(["hidden", "a", "b"], ["a", "b"], false)).toEqual(["hidden"]);
});
it("selects and deselects contiguous ranges in both directions", () => {
  expect(toggleTagRange([], ["a", "b", "c", "d"], "c", "a", true)).toEqual(["a", "b", "c"]);
  expect(toggleTagRange([], ["a", "b", "c", "d"], "a", "c", true)).toEqual(["a", "b", "c"]);
  expect(toggleTagRange(["a", "b", "c", "d"], ["a", "b", "c", "d"], "c", "a", true)).toEqual(["d"]);
});
it("does not select hidden or read-only IDs and falls back when the anchor is filtered out", () => {
  expect(toggleTagRange([], ["a", "c"], "read-only", "a", true)).toEqual([]);
  expect(toggleTagRange(["hidden"], ["a", "c"], "c", "hidden", true)).toEqual(["hidden", "c"]);
});
