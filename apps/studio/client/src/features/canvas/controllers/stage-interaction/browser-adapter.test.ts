// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createBrowserCanvasStageInteractionAdapter } from "./browser-adapter";

afterEach(() => {
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

it("moves focus and clears stale editor selections before the next native paste", () => {
  const editor = document.createElement("textarea");
  const overlay = document.createElement("span");
  overlay.textContent = "Previous prompt";
  const stage = document.createElement("section");
  stage.tabIndex = -1;
  document.body.append(editor, overlay, stage);
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(overlay);
  window.getSelection()?.addRange(range);
  const focus = vi.spyOn(stage, "focus");

  createBrowserCanvasStageInteractionAdapter().focusStage(stage);

  expect(document.activeElement).toBe(stage);
  expect(window.getSelection()?.rangeCount).toBe(0);
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
});

it("ignores an unmounted stage", () => {
  expect(() => createBrowserCanvasStageInteractionAdapter().focusStage(null)).not.toThrow();
});
