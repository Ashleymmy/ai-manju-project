// @vitest-environment jsdom

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startAssetMediaDownload } from "./api";

let clicked: HTMLAnchorElement | null = null;

beforeEach(() => {
  clicked = null;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    clicked = this;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it("downloads through the server stream with the download flag instead of buffering the file", () => {
  startAssetMediaDownload("asset_1", "team");
  expect(clicked).not.toBeNull();
  expect(clicked!.href).toContain("/api/assets/asset_1/content");
  expect(clicked!.href).toContain("scope=team");
  expect(clicked!.href).toContain("download=1");
  expect(clicked!.download).toBe("");
  expect(document.body.contains(clicked)).toBe(false);
});
