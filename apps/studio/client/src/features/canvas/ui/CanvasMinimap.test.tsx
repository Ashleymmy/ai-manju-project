// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CanvasMinimapModel } from "../domain/minimap";
import { CanvasMinimap } from "./CanvasMinimap";

const model: CanvasMinimapModel = {
  width: 184, height: 122, world: { x: 0, y: 0, width: 1840, height: 1220 },
  viewport: { x: 30, y: 30, width: 50, height: 40 },
  nodes: [{ id: "node", x: 40, y: 35, width: 5, height: 5 }],
};
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let svg: SVGSVGElement;
let capture: number | null;
let screenScale: number;
const navigate = vi.fn();
const parentPointer = vi.fn();
async function render(value = model) {
  await act(async () => root.render(<div onPointerDown={parentPointer}><CanvasMinimap model={value} selectedNodeIds={new Set(["node"])} onNavigate={navigate} /></div>));
}
async function pointer(type: string, x: number, y: number, pointerId = 1, button = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10 + x * screenScale, clientY: 20 + y * screenScale, button });
  Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: pointerId === 1 } });
  await act(async () => svg.dispatchEvent(event));
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("DOMPoint", class {
    constructor(public x: number, public y: number) {}
    matrixTransform(matrix: { a: number; d: number; e: number; f: number }) { return { x: this.x * matrix.a + matrix.e, y: this.y * matrix.d + matrix.f }; }
  });
  navigate.mockClear();
  parentPointer.mockClear();
  screenScale = 1;
  capture = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
  svg = container.querySelector("svg")!;
  Object.assign(svg, {
    getScreenCTM: () => ({ inverse: () => ({ a: 1 / screenScale, d: 1 / screenScale, e: -10 / screenScale, f: -20 / screenScale }) }),
    setPointerCapture: (id: number) => { capture = id; },
    hasPointerCapture: (id: number) => capture === id,
    releasePointerCapture: () => { capture = null; },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each([1, 0.82])("drags from an off-center grab without jumping or misreading CSS scale %s", async scale => {
  screenScale = scale;
  await pointer("pointerdown", 40, 35);
  expect(navigate).not.toHaveBeenCalled();
  expect(capture).toBe(1);
  await pointer("pointermove", 50, 45);
  expect(navigate).toHaveBeenLastCalledWith({ x: 650, y: 600 });
  expect(parentPointer).not.toHaveBeenCalled();
  await pointer("pointerup", 50, 45);
  expect(capture).toBeNull();
  expect(container.querySelector(".is-dragging")).toBeNull();
  navigate.mockClear();
  await pointer("pointermove", 70, 70);
  expect(navigate).not.toHaveBeenCalled();
});

it("retains click-to-center inside and outside the viewport without a second trailing click", async () => {
  await pointer("pointerdown", 40, 35);
  await pointer("pointerup", 40, 35);
  expect(navigate).toHaveBeenLastCalledWith({ x: 400, y: 350 });
  await pointer("pointerdown", 140, 90);
  expect(navigate).toHaveBeenLastCalledWith({ x: 1400, y: 900 });
  await pointer("pointerup", 140, 90);
  navigate.mockClear();
  await act(async () => svg.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(navigate).not.toHaveBeenCalled();
});

it("freezes map coordinates during a drag and continues beyond the map boundary", async () => {
  await pointer("pointerdown", 140, 90);
  await render({ ...model, world: { x: 1000, y: 500, width: 3680, height: 2440 }, nodes: [{ ...model.nodes[0], x: 60 }], viewport: { x: 20, y: 10, width: 25, height: 20 } });
  expect(svg.querySelector("rect.selected")?.getAttribute("x")).toBe("40");
  await pointer("pointermove", 210, 150);
  expect(navigate).toHaveBeenLastCalledWith({ x: 2100, y: 1500 });
  await pointer("pointerup", 210, 150);
  expect(svg.querySelector("rect.selected")?.getAttribute("x")).toBe("60");
});

it.each(["pointercancel", "lostpointercapture", "blur"])("stops dragging on %s", async event => {
  await pointer("pointerdown", 40, 35);
  await pointer("pointermove", 50, 45);
  if (event === "blur") await act(async () => window.dispatchEvent(new Event("blur")));
  else await pointer(event, 50, 45);
  navigate.mockClear();
  await pointer("pointermove", 60, 50);
  expect(navigate).not.toHaveBeenCalled();
  expect(capture).toBeNull();
});

it("ignores right clicks and secondary pointers, and releases capture on unmount", async () => {
  await pointer("pointerdown", 140, 90, 1, 2);
  await pointer("pointerdown", 140, 90, 2);
  expect(navigate).not.toHaveBeenCalled();
  expect(capture).toBeNull();
  await pointer("pointerdown", 40, 35);
  await pointer("pointermove", 70, 70, 2);
  await pointer("pointerup", 70, 70, 2);
  expect(capture).toBe(1);
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => root.render(null));
  expect(capture).toBeNull();
});
