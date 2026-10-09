// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CanvasGenerationHistoryItem } from "../domain/generationHistory";
import { CanvasGenerationHistoryDialog } from "./CanvasGenerationHistoryDialog";

let root: Root;
let container: HTMLDivElement;
const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");

function item(nodeId: string, previewUrl: string, generatedAt: string): CanvasGenerationHistoryItem {
  return {
    nodeId, kind: "image", title: nodeId, prompt: "prompt", model: "", generatedAt, previewUrl,
    assetId: "", seed: nodeId, size: "", seconds: "", typeLabel: "图片生成", modeLabel: "文生图",
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  if (scrollToDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollTo", scrollToDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  vi.unstubAllGlobals();
});

const applyButton = () => Array.from(document.querySelectorAll<HTMLButtonElement>(".canvas-generation-history-detail button"))
  .find(button => button.textContent?.includes("应用到画布"))!;

it("explains unloadable history media, blocks applying it and lets the user reload", async () => {
  const onApply = vi.fn();
  await act(async () => root.render(<CanvasGenerationHistoryDialog
    open
    items={[item("gone", "blob:expired-session", "2026-09-20T12:00:00Z"), item("ok", "data:image/png;base64,AA==", "2026-09-19T12:00:00Z")]}
    onOpenChange={vi.fn()}
    onApply={onApply}
  />));
  const broken = Array.from(document.querySelectorAll<HTMLImageElement>(".canvas-generation-history-dialog img"))
    .filter(img => img.getAttribute("src") === "blob:expired-session");
  expect(broken).toHaveLength(2);
  await act(async () => broken.forEach(img => img.dispatchEvent(new Event("error"))));

  expect(document.querySelector(".canvas-generation-history-grid .canvas-generation-history-unavailable")?.textContent).toContain("图片无法加载");
  const hero = document.querySelector(".canvas-generation-history-hero")!;
  expect(hero.textContent).toContain("原文件可能已删除");
  expect(applyButton().disabled).toBe(true);
  expect(applyButton().title).toContain("暂不能应用到画布");
  const refresh = document.querySelector<HTMLButtonElement>(".canvas-generation-history-refresh")!;
  expect(refresh.textContent).toContain("1 项未显示");
  expect(refresh.classList.contains("has-failures")).toBe(true);

  await act(async () => hero.querySelector<HTMLButtonElement>("button")!.click());
  expect(document.querySelectorAll('.canvas-generation-history-dialog img[src="blob:expired-session"]')).toHaveLength(2);
  expect(applyButton().disabled).toBe(false);
  expect(refresh.textContent).toBe("刷新");

  const okTile = Array.from(document.querySelectorAll<HTMLButtonElement>(".canvas-generation-history-grid > button"))
    .find(button => button.title === "ok")!;
  await act(async () => okTile.click());
  await act(async () => applyButton().click());
  expect(onApply).toHaveBeenCalledWith("ok");
});

it("gives visible feedback when refreshing previews that were already fine", async () => {
  vi.useFakeTimers();
  try {
    await act(async () => root.render(<CanvasGenerationHistoryDialog open items={[item("ok", "data:image/png;base64,AA==", "2026-09-20T12:00:00Z")]} onOpenChange={vi.fn()} onApply={vi.fn()} />));
    const refresh = document.querySelector<HTMLButtonElement>(".canvas-generation-history-refresh")!;
    const tile = document.querySelector(".canvas-generation-history-grid img");

    await act(async () => refresh.click());
    expect(refresh.textContent).toBe("刷新中…");
    expect(refresh.disabled).toBe(true);
    expect(refresh.classList.contains("is-refreshing")).toBe(true);
    expect(document.querySelector(".canvas-generation-history-grid img")).not.toBe(tile);

    await act(async () => vi.advanceTimersByTime(700));
    expect(refresh.textContent).toBe("已刷新");
    expect(refresh.classList.contains("is-done")).toBe(true);

    await act(async () => vi.advanceTimersByTime(1500));
    expect(refresh.textContent).toBe("刷新");
    expect(refresh.disabled).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it("copies a canvas image only after it has fully downloaded", async () => {
  const url = "http://localhost/api/assets/a/content";
  const live = document.createElement("img");
  live.src = url;
  Object.defineProperty(live, "naturalWidth", { configurable: true, value: 320 });
  Object.defineProperty(live, "naturalHeight", { configurable: true, value: 188 });
  Object.defineProperty(live, "complete", { configurable: true, value: false });
  document.body.append(live);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,copied");
  const render = () => root.render(<CanvasGenerationHistoryDialog open items={[item("a", url, "2026-09-20T12:00:00Z")]} onOpenChange={vi.fn()} onApply={vi.fn()} />);
  const tileSrc = () => document.querySelector(".canvas-generation-history-grid img")?.getAttribute("src");
  try {
    await act(async () => render());
    expect(tileSrc()).toBe(url);

    Object.defineProperty(live, "complete", { configurable: true, value: true });
    await act(async () => document.querySelector<HTMLButtonElement>(".canvas-generation-history-refresh")!.click());
    expect(tileSrc()).toBe("data:image/jpeg;base64,copied");
  } finally {
    live.remove();
    vi.restoreAllMocks();
  }
});
