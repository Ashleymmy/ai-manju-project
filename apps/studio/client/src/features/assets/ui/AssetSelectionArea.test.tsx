// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetSelectionArea } from "./AssetSelectionArea";

describe("asset drag selection", () => {
  let root: Root;
  let container: HTMLDivElement;
  const clicked = vi.fn();
  function Harness() {
    const [ids, setIds] = useState<string[]>(["c"]);
    return <><output>{ids.join(",")}</output><AssetSelectionArea selectedIds={ids} onSelectionChange={setIds}>
      {["a", "b", "c"].map(id => <article key={id} data-asset-id={id}><input type="checkbox" /><button className="library-asset-preview" onClick={clicked}>{id}</button></article>)}
    </AssetSelectionArea></>;
  }
  async function pointer(target: EventTarget, type: string, x: number, y: number, extra: MouseEventInit = {}) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, ...extra });
    Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: "mouse" } });
    await act(async () => { target.dispatchEvent(event); });
  }
  const selection = () => container.querySelector("output")!.textContent;
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    clicked.mockClear();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<Harness />));
    vi.spyOn(container.querySelector(".asset-selection-area")!, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0 } as DOMRect);
    container.querySelectorAll("article").forEach((card, i) => vi.spyOn(card, "getBoundingClientRect").mockReturnValue({ left: i * 110, right: i * 110 + 100, top: 0, bottom: 100 } as DOMRect));
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("selects intersected cards in reverse direction and suppresses the release click", async () => {
    const button = container.querySelector("button")!;
    await pointer(button, "pointerdown", 190, 90);
    await pointer(window, "pointermove", 10, 10);
    expect(selection()).toBe("a,b");
    await pointer(window, "pointerup", 10, 10);
    await act(async () => button.click());
    expect(clicked).not.toHaveBeenCalled();
    expect(container.querySelector(".asset-selection-rectangle")).toBeNull();
  });
  it("adds to existing selection with Ctrl and restores it on Escape", async () => {
    await pointer(container.querySelector(".asset-selection-area")!, "pointerdown", 0, 0, { ctrlKey: true });
    await pointer(window, "pointermove", 80, 80);
    expect(selection()).toBe("c,a");
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(selection()).toBe("c");
  });
  it("preserves ordinary clicks and ignores checkbox drags", async () => {
    const button = container.querySelector("button")!;
    await pointer(button, "pointerdown", 10, 10);
    await pointer(window, "pointermove", 12, 12);
    await pointer(window, "pointerup", 12, 12);
    await act(async () => button.click());
    expect(clicked).toHaveBeenCalledOnce();
    await pointer(container.querySelector("input")!, "pointerdown", 0, 0);
    await pointer(window, "pointermove", 190, 90);
    expect(selection()).toBe("c");
  });
  it("clears selection when dragging through empty space and restores on pointer cancel", async () => {
    await pointer(container.querySelector(".asset-selection-area")!, "pointerdown", 0, 120);
    await pointer(window, "pointermove", 190, 150);
    expect(selection()).toBe("");
    await pointer(window, "pointercancel", 190, 150);
    expect(selection()).toBe("c");
  });
  it("clears an existing selection when clicking outside the asset grid", async () => {
    await act(async () => document.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 900, clientY: 10 })));
    expect(selection()).toBe("");
  });
  it("keeps an existing selection while using bulk controls", async () => {
    const toolbar = document.createElement("div"); toolbar.className = "asset-bulk-bar"; document.body.append(toolbar);
    await act(async () => toolbar.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(selection()).toBe("c");
    toolbar.remove();
  });
  it("keeps the selection when clicking a marked detail-panel control", async () => {
    const detail = document.createElement("aside"); detail.dataset.keepAssetSelection = "true";
    const control = document.createElement("select"); detail.append(control); document.body.append(detail);
    await act(async () => control.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(selection()).toBe("c");
    detail.remove();
  });
});
