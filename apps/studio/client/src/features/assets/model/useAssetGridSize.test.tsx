// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ASSET_GRID_SIZE, useAssetGridSize } from "./useAssetGridSize";

let root: Root;
let container: HTMLDivElement;
let resize: ResizeObserverCallback;
const disconnect = vi.fn();
function Harness() {
  const sizing = useAssetGridSize();
  return <section ref={sizing.containerRef} style={sizing.gridStyle}>
    <output>{sizing.columns}</output>
    <button disabled={!sizing.canZoomOut} onClick={sizing.zoomOut}>smaller</button>
    <button disabled={!sizing.canZoomIn} onClick={sizing.zoomIn}>larger</button>
  </section>;
}
const columns = () => Number(container.querySelector("output")!.textContent);
const button = (index: number) => container.querySelectorAll("button")[index];
async function width(value: number) {
  await act(async () => resize([{ contentRect: { width: value } } as ResizeObserverEntry], {} as ResizeObserver));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  localStorage.clear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("adapts saved density to available space without overwriting the preference", async () => {
  localStorage.setItem(ASSET_GRID_SIZE.storageKey, "8");
  await act(async () => root.render(<Harness />));
  await width(1058);
  expect(columns()).toBe(8);
  await width(420);
  expect(columns()).toBe(3);
  expect(button(0).disabled).toBe(true);
  expect(localStorage.getItem(ASSET_GRID_SIZE.storageKey)).toBe("8");
  await width(1058);
  expect(columns()).toBe(8);
  await width(90);
  expect(columns()).toBe(3);
  expect(button(0).disabled).toBe(true);
  expect(button(1).disabled).toBe(true);
});

it("zooms from the visible column count and persists a deliberate change", async () => {
  localStorage.setItem(ASSET_GRID_SIZE.storageKey, "8");
  await act(async () => root.render(<Harness />));
  await width(600);
  await act(async () => button(1).click());
  expect(columns()).toBe(3);
  expect(button(1).disabled).toBe(true);
  expect(localStorage.getItem(ASSET_GRID_SIZE.storageKey)).toBe("3");
  await width(1058);
  expect(columns()).toBe(3);
  await act(async () => button(0).click());
  expect(columns()).toBe(4);
  expect(container.querySelector("section")!.style.getPropertyValue("--asset-grid-columns")).toBe("4");
});

it.each(["NaN", "1", "2"])("uses three columns for old or invalid preference %s even when storage writes fail", async saved => {
  localStorage.setItem(ASSET_GRID_SIZE.storageKey, saved);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  await act(async () => root.render(<Harness />));
  await width(1058);
  expect(columns()).toBe(3);
  await act(async () => button(0).click());
  expect(columns()).toBe(4);
});
