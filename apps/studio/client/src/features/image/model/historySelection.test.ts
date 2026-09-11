import { describe, expect, it } from "vitest";

import {
  nextHistorySelectAll,
  pruneHistorySelection,
  toggleHistorySelection,
} from "./historySelection";

describe("historySelection", () => {
  it("adds and removes a single history item", () => {
    expect(toggleHistorySelection([], "a")).toEqual(["a"]);
    expect(toggleHistorySelection(["a", "b"], "a")).toEqual(["b"]);
  });

  it("selects every available item, then clears when already complete", () => {
    expect(nextHistorySelectAll(["a"], ["a", "b"])).toEqual(["a", "b"]);
    expect(nextHistorySelectAll(["b", "a"], ["a", "b"])).toEqual([]);
    expect(nextHistorySelectAll(["a"], [])).toEqual([]);
  });

  it("drops selected ids that disappeared from the history list", () => {
    expect(pruneHistorySelection(["a", "gone", "b"], ["b", "a"])).toEqual(["a", "b"]);
    expect(pruneHistorySelection([], ["a"])).toEqual([]);
    const kept = ["a", "b"];
    expect(pruneHistorySelection(kept, ["b", "a"])).toBe(kept);
  });
});
