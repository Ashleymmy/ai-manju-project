import { describe, expect, it } from "vitest";

import { isCanvasHotkeyEditingTarget } from "./hotkeyTarget";

describe("canvas hotkey target adapter", () => {
  it("detects editable and interactive targets that should ignore canvas shortcuts", () => {
    const OriginalElement = globalThis.Element;
    class MockElement {
      constructor(private readonly match: string[] = []) {}
      closest(selector: string) {
        return this.match.some((item) => selector.includes(item)) ? this : null;
      }
    }

    try {
      // @ts-expect-error test shim
      globalThis.Element = MockElement;
      const editable = new MockElement(["[contenteditable='true']"]);
      const nested = new MockElement(["[contenteditable='true']"]);
      const canvasUi = new MockElement(["[data-canvas-ui]"]);
      const canvasNoZoom = new MockElement(["[data-canvas-no-zoom]"]);
      const input = new MockElement(["input"]);
      const textarea = new MockElement(["textarea"]);
      const select = new MockElement(["select"]);
      const button = new MockElement(["button"]);
      const plain = new MockElement();

      expect(isCanvasHotkeyEditingTarget(editable)).toBe(true);
      expect(isCanvasHotkeyEditingTarget(nested)).toBe(true);
      expect(isCanvasHotkeyEditingTarget(canvasUi)).toBe(true);
      expect(isCanvasHotkeyEditingTarget(canvasNoZoom)).toBe(true);
      expect(isCanvasHotkeyEditingTarget(input)).toBe(true);
      expect(isCanvasHotkeyEditingTarget(textarea)).toBe(true);
      expect(isCanvasHotkeyEditingTarget(select)).toBe(true);
      expect(isCanvasHotkeyEditingTarget(button)).toBe(true);
      expect(isCanvasHotkeyEditingTarget(plain)).toBe(false);
      expect(isCanvasHotkeyEditingTarget(null)).toBe(false);
    } finally {
      // @ts-expect-error test shim
      globalThis.Element = OriginalElement;
    }
  });
});
