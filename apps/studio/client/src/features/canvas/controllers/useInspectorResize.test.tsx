// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspectorSizeLimits } from "../domain/inspectorSize";
import { CanvasInspectorResizeHandles } from "../ui/CanvasInspectorResizeHandles";
import { useInspectorResize } from "./useInspectorResize";

describe("inspector resize pointer lifecycle", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onResize = vi.fn();
  function Harness({ nodeId = "first", callback = onResize }: { nodeId?: string; callback?: typeof onResize }) {
    const panelRef = useRef<HTMLElement>(null);
    const resize = useInspectorResize({ panelRef, nodeId, limits: inspectorSizeLimits(1200, 800), onResize: callback });
    return <aside ref={panelRef}><div className="canvas-mention-editor" /><CanvasInspectorResizeHandles onResize={resize} /></aside>;
  }
  const pointer = (target: EventTarget, type: string, x: number, y: number, pointerId = 1) => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, "pointerId", { value: pointerId });
    act(() => { target.dispatchEvent(event); });
  };
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    onResize.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { x: 0, y: 0, left: 0, top: 0, right: 560, bottom: 300, width: 560,
        height: this.classList.contains("canvas-mention-editor") ? 140 : 300, toJSON() {} };
    });
    await act(async () => root.render(<Harness />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("exposes all three handles and stops resizing after pointerup", () => {
    expect(container.querySelectorAll("button")).toHaveLength(3);
    pointer(container.querySelector(".inspector-resize-height")!, "pointerdown", 560, 300);
    pointer(window, "pointermove", 600, 400);
    expect(onResize).toHaveBeenLastCalledWith("first", { width: 560, height: 400 }, "height");
    pointer(window, "pointerup", 600, 420);
    expect(onResize).toHaveBeenLastCalledWith("first", { width: 560, height: 420 }, "height");
    const calls = onResize.mock.calls.length;
    pointer(window, "pointermove", 600, 500);
    expect(onResize).toHaveBeenCalledTimes(calls);
  });
  it.each(["pointercancel", "blur"])("cleans up after %s and ignores other pointers", type => {
    pointer(container.querySelector(".inspector-resize-proportional")!, "pointerdown", 560, 300);
    pointer(window, "pointermove", 616, 330, 2);
    expect(onResize).not.toHaveBeenCalled();
    pointer(window, type, 560, 300);
    pointer(window, "pointermove", 616, 330);
    expect(onResize).not.toHaveBeenCalled();
  });
  it("uses the latest callback during a drag and cancels on selection change", async () => {
    pointer(container.querySelector(".inspector-resize-width")!, "pointerdown", 560, 300);
    const latestCallback = vi.fn();
    await act(async () => root.render(<Harness callback={latestCallback} />));
    pointer(window, "pointermove", 660, 300);
    expect(latestCallback).toHaveBeenLastCalledWith("first", { width: 660, height: 300 }, "width");
    expect(onResize).not.toHaveBeenCalled();
    await act(async () => root.render(<Harness nodeId="second" callback={latestCallback} />));
    pointer(window, "pointermove", 700, 300);
    expect(latestCallback).toHaveBeenCalledTimes(1);
  });
  it("removes global listeners when the panel unmounts", async () => {
    pointer(container.querySelector(".inspector-resize-height")!, "pointerdown", 560, 300);
    await act(async () => root.render(null));
    pointer(window, "pointermove", 560, 450);
    expect(onResize).not.toHaveBeenCalled();
  });
});
