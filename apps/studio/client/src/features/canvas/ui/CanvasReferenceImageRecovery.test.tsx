// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiUrl, setAuthToken } from "@/shared/api/http";
import type { CanvasNodeData } from "../domain/types";
import { CanvasIncomingMediaStrip } from "./CanvasIncomingMediaStrip";
import { CanvasImagePreviewDialog } from "./CanvasPreviewDialogs";
import { CanvasGenerationHistoryDialog } from "./CanvasGenerationHistoryDialog";

let root: Root;
let container: HTMLDivElement;
const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
const nodes: CanvasNodeData[] = ["a", "b"].map(id => ({
  id, kind: "image", title: id, content: "", x: 0, y: 0, width: 320, height: 240, imageAssetId: id,
}));
const previews = Object.fromEntries(nodes.map(node => [node.id, apiUrl(`/api/assets/${node.id}/content`, { scope: "personal", thumbnail: 320 })]));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  sessionStorage.clear();
  setAuthToken("preview-test-token", false);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/png" } })));
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => "blob:recovered-preview");
    static revokeObjectURL = vi.fn();
  });
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function recover(selector: string, count: number) {
  const images = Array.from(document.querySelectorAll<HTMLImageElement>(selector));
  expect(images).toHaveLength(count);
  await act(async () => images.forEach(img => img.dispatchEvent(new Event("error"))));
  expect(images.every(img => img.getAttribute("src") === "blob:recovered-preview")).toBe(true);
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("thumbnail=320"), expect.objectContaining({ headers: { Authorization: "Bearer preview-test-token" } }));
}

it("recovers connected media without breaking preview clicks or nesting buttons", async () => {
  const preview = vi.fn();
  await act(async () => root.render(<CanvasIncomingMediaStrip nodeId="b" nodes={nodes} edges={[{ id: "a-b", from: "a", to: "b" }]} previews={previews} onPreview={preview} onAdd={vi.fn()} />));
  await recover(".canvas-incoming-ref-slot img", 1);
  await act(async () => container.querySelector<HTMLButtonElement>(".canvas-incoming-ref-slot")!.click());
  expect(preview).toHaveBeenCalledWith("a");
  expect(container.querySelector("button button")).toBeNull();
});

it("recovers sibling thumbnails while leaving the already-authenticated original alone", async () => {
  await act(async () => root.render(<CanvasImagePreviewDialog node={nodes[0]} source="blob:original" siblings={nodes} selectedNodeId="a" previews={previews} modelLabel="" creatorLabel="" onSelectNode={vi.fn()} onSetBatchPrimary={vi.fn()} onDetachBatchChild={vi.fn()} onDownload={vi.fn()} onClose={vi.fn()} />));
  await recover(".preview-detail-thumbs img", 2);
  expect(document.querySelector(".canvas-image-preview-stage > img")?.getAttribute("src")).toBe("blob:original");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("recovers history images before falling back to an empty history thumbnail", async () => {
  await act(async () => root.render(<CanvasGenerationHistoryDialog open items={nodes.map(node => ({
    nodeId: node.id, kind: "image", title: node.title, prompt: "prompt", model: "", generatedAt: "2026-09-20T12:00:00Z",
    previewUrl: previews[node.id], assetId: node.id, seed: node.id, size: "", seconds: "", typeLabel: "image", modeLabel: "image",
  }))} onOpenChange={vi.fn()} onApply={vi.fn()} />));
  await recover(".canvas-generation-history-dialog img", 3);
});
