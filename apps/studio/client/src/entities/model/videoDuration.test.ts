import { afterEach, expect, it } from "vitest";
import { normalizeVideoDuration, replaceVideoModelDurations, videoModelDurations } from "./videoDuration";

afterEach(() => replaceVideoModelDurations({}));

it("scopes capabilities to exact providers and discards malformed metadata without borrowing limits", () => {
  replaceVideoModelDurations({
    "official::ep-test": [-1, 4, 15, 15, 0, -2, "30", null],
    "other::ep-test": [5, 10],
    bad: "4-30",
  });
  expect(videoModelDurations("official::ep-test")).toEqual([-1, 4, 15]);
  expect(videoModelDurations("other::ep-test")).toEqual([5, 10]);
  expect(videoModelDurations("ep-test")).toEqual([]);
  expect(videoModelDurations("bad")).toEqual([]);
  expect(normalizeVideoDuration("other::ep-test", "7")).toBe("5");
  expect(normalizeVideoDuration("other::ep-test", "-1")).toBe("5");
  replaceVideoModelDurations({ "official::ep-test": [4, 8] });
  expect(videoModelDurations("other::ep-test")).toEqual([]);
  expect(normalizeVideoDuration("unknown", "45")).toBe("45");
});
