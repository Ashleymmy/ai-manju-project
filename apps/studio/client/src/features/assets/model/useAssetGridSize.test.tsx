// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
}));
vi.mock("@/features/settings", () => ({
  settingsQueryKeys: { preferences: () => ["settings", "preferences"] },
  updatePreferences: settings.updatePreferences,
  usePreferencesQuery: () => useQuery({ queryKey: ["settings", "preferences"], queryFn: settings.getPreferences }),
}));

import { ASSET_GRID_SIZE, ASSET_GRID_VIEWPORT, assetGridViewportHeight, savedAssetGridColumns, useAssetGridSize } from "./useAssetGridSize";

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;
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
// react-query batches notifications through setTimeout(0), so pending timers are drained explicitly.
async function drainQueryUpdates() {
  for (let pass = 0; pass < 3; pass += 1) await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}
async function render() {
  await act(async () => root.render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>));
  await drainQueryUpdates();
}
async function click(index: number) {
  await act(async () => button(index).click());
}
async function settleSave() {
  await act(async () => { await vi.advanceTimersByTimeAsync(ASSET_GRID_SIZE.saveDelayMs); });
  await drainQueryUpdates();
}
function savedColumns(value?: number) {
  settings.getPreferences.mockResolvedValue({ canvas: value === undefined ? {} : { assetGridColumns: value } });
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  settings.getPreferences.mockReset();
  settings.updatePreferences.mockReset();
  settings.updatePreferences.mockImplementation(async (payload: { canvas: object }) => ({ canvas: payload.canvas }));
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); queryClient.clear(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("opens at four columns when the user has never chosen a column count", async () => {
  savedColumns();
  await render();
  await width(1058);
  expect(columns()).toBe(4);
  await settleSave();
  expect(settings.updatePreferences).not.toHaveBeenCalled();
});

it("restores the column count saved in the user's preferences", async () => {
  savedColumns(6);
  await render();
  await width(1058);
  expect(columns()).toBe(6);
});

it("adapts the saved density to available space without overwriting the preference", async () => {
  savedColumns(8);
  await render();
  await width(1058);
  expect(columns()).toBe(8);
  await width(420);
  expect(columns()).toBe(3);
  expect(button(0).disabled).toBe(true);
  await width(1058);
  expect(columns()).toBe(8);
  await width(90);
  expect(columns()).toBe(3);
  expect(button(0).disabled).toBe(true);
  expect(button(1).disabled).toBe(true);
  await settleSave();
  expect(settings.updatePreferences).not.toHaveBeenCalled();
});

it("saves a deliberate change to the account once rapid clicks settle", async () => {
  savedColumns();
  await render();
  await width(1058);
  await click(0);
  await click(0);
  await click(0);
  expect(columns()).toBe(7);
  expect(settings.updatePreferences).not.toHaveBeenCalled();
  await settleSave();
  expect(settings.updatePreferences).toHaveBeenCalledTimes(1);
  expect(settings.updatePreferences).toHaveBeenCalledWith({ canvas: { assetGridColumns: 7 } });
  expect(queryClient.getQueryData(["settings", "preferences"])).toEqual({ canvas: { assetGridColumns: 7 } });
  expect(container.querySelector("section")!.style.getPropertyValue("--asset-grid-columns")).toBe("7");
});

it("zooms from the visible column count", async () => {
  savedColumns(8);
  await render();
  await width(600);
  expect(columns()).toBe(4);
  await click(1);
  expect(columns()).toBe(3);
  await settleSave();
  expect(settings.updatePreferences).toHaveBeenCalledWith({ canvas: { assetGridColumns: 3 } });
});

it("flushes a pending choice when the library unmounts", async () => {
  savedColumns();
  await render();
  await width(1058);
  await click(0);
  await act(async () => root.unmount());
  expect(settings.updatePreferences).toHaveBeenCalledWith({ canvas: { assetGridColumns: 5 } });
  root = createRoot(container);
});

it("keeps the in-session choice when saving fails", async () => {
  savedColumns();
  settings.updatePreferences.mockRejectedValue(new Error("offline"));
  await render();
  await width(1058);
  await click(0);
  await settleSave();
  expect(columns()).toBe(5);
});

it.each([undefined, null, "6", 2, 9, 4.5])("ignores an invalid saved preference %s", value => {
  expect(savedAssetGridColumns(value)).toBeNull();
});

it("sizes the viewport to three four-column rows at any zoom level", async () => {
  savedColumns();
  await render();
  await width(800);
  const section = container.querySelector("section")!;
  const expected = `${assetGridViewportHeight(800)}px`;
  expect(columns()).toBe(4);
  expect(section.style.getPropertyValue("--asset-grid-viewport-height")).toBe(expected);
  await click(0);
  expect(columns()).toBe(5);
  expect(section.style.getPropertyValue("--asset-grid-viewport-height")).toBe(expected);
  await width(1200);
  expect(section.style.getPropertyValue("--asset-grid-viewport-height")).not.toBe(expected);
});

it("computes three rows of 4-column cards plus gaps", () => {
  // 498px wide: card 117px, media (117 - 2) / 1.16 ≈ 99.14px, row ≈ 151.14px.
  expect(assetGridViewportHeight(498)).toBe(Math.max(ASSET_GRID_VIEWPORT.minHeight, Math.ceil(151.1379 * 3 + 20)));
  expect(assetGridViewportHeight(498, 4)).toBe(Math.max(ASSET_GRID_VIEWPORT.minHeight, Math.ceil(151.1379 * 3 + 24)));
  expect(assetGridViewportHeight(100)).toBe(ASSET_GRID_VIEWPORT.minHeight);
});
