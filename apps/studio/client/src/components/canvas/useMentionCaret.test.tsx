// @vitest-environment jsdom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMentionCaret } from "./useMentionCaret";

describe("mention caret at atomic thumbnail boundaries", () => {
  let root: Root;
  let container: HTMLDivElement;

  function Harness() {
    const textarea = useRef<HTMLTextAreaElement>(null);
    const overlay = useRef<HTMLDivElement>(null);
    const value = "\u2005\u3000\u3000\u2005".repeat(2);
    const { caret } = useMentionCaret(textarea, overlay, value, true);
    return <>
      <textarea ref={textarea} defaultValue={value} />
      <div ref={overlay} data-overlay style={{ fontSize: 12, lineHeight: "20px" }}>
        <span data-mention-chip data-mention-start="0" data-mention-end="4"><span>{value.slice(0, 4)}</span></span>
        <span data-mention-chip data-mention-start="4" data-mention-end="8"><span>{value.slice(4)}</span></span>
        <span data-mention-layer />
        {caret ? <span data-caret style={caret} /> : null}
      </div>
    </>;
  }

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    // Chromium reports no client rect for a collapsed Range beside inline-flex chips.
    vi.spyOn(document, "createRange").mockImplementation(() => ({
      setStart: vi.fn(), setEnd: vi.fn(), collapse: vi.fn(), getClientRects: () => [],
    }) as unknown as Range);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  for (const scale of [0.5, 1, 1.5]) {
    it.each([0, 4, 8])(`paints offset %i beside the actual chip at scale ${scale}, including scroll`, async offset => {
      const textarea = container.querySelector("textarea")!;
      const overlay = container.querySelector<HTMLElement>("[data-overlay]")!;
      const chips = container.querySelectorAll<HTMLElement>("[data-mention-chip]");
      Object.defineProperty(textarea, "offsetWidth", { value: 200 });
      Object.defineProperty(textarea, "clientHeight", { value: 100 });
      Object.defineProperty(textarea, "scrollHeight", { value: 200 });
      Object.defineProperty(overlay, "offsetWidth", { value: 200 });
      textarea.scrollTop = overlay.scrollTop = 20;
      textarea.scrollLeft = overlay.scrollLeft = 5;
      vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 200, 200 * scale, 100 * scale));
      chips.forEach((chip, index) => vi.spyOn(chip, "getBoundingClientRect")
        .mockReturnValue(new DOMRect(100 + (12 + index * 30) * scale, 200 + 6 * scale, 30 * scale, 20 * scale)));
      await act(async () => {
        textarea.focus();
        textarea.setSelectionRange(offset, offset);
        document.dispatchEvent(new Event("selectionchange"));
      });
      const caret = container.querySelector<HTMLElement>("[data-caret]");
      expect(caret).not.toBeNull();
      expect(parseFloat(caret!.style.left)).toBe(17 + offset / 4 * 30);
      expect(parseFloat(caret!.style.top)).toBe(26);
      expect(parseFloat(caret!.style.height)).toBe(20);
      expect(parseFloat(caret!.style.width)).toBeCloseTo(2 / scale);
    });
  }
});
