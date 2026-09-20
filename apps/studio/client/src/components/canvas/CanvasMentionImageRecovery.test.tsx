// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiUrl, setAuthToken } from "@/shared/api/http";
import { buildCanvasMentionEditorModel, type CanvasMentionReference } from "@/features/canvas/domain/mentions";
import { CanvasResourceMentionTextarea } from "./CanvasResourceMentionTextarea";

let root: Root;
let container: HTMLDivElement;
const references: CanvasMentionReference[] = Array.from({ length: 24 }, (_, index) => ({
  id: `image-${index}`, key: `node:image-${index}`, source: "node", group: "canvas-node",
  targetId: `image-${index}`, nodeId: `image-${index}`, kind: "image", label: `Image ${index}`,
  title: `Image ${index}`, searchText: "image", active: true, upstreamDistance: 1,
}));
const value = references.map(ref => `@[${ref.key}]`).join(" ") + "\nKeep lighting";
const source = (ref: CanvasMentionReference) => apiUrl(`/api/assets/${ref.id}/content`, { scope: "team", thumbnail: 320 });
const response = () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  sessionStorage.clear();
  setAuthToken("mention-test-token", false);
  vi.stubGlobal("fetch", vi.fn());
  let nextUrl = 0;
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => `blob:mention-${++nextUrl}`);
    static revokeObjectURL = vi.fn();
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("recovers many references independently without rewriting the editor or moving its selection", async () => {
  const pending: ((response: Response) => void)[] = [];
  vi.mocked(fetch).mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  const changed = vi.fn();
  await act(async () => root.render(<CanvasResourceMentionTextarea value={value} references={references} onChange={changed} thumbnailForReference={source} />));
  const editor = container.querySelector("textarea")!;
  const model = buildCanvasMentionEditorModel(value, references);
  await act(async () => {
    editor.focus();
    editor.setSelectionRange(model.segments[4].start, model.segments[8].end, "backward");
  });
  const selection = [editor.selectionStart, editor.selectionEnd, editor.selectionDirection];
  const sizers = Array.from(container.querySelectorAll(".mention-chip-sizer"), item => item.textContent);
  const images = Array.from(container.querySelectorAll<HTMLImageElement>(".mention-chip-thumb"));
  expect(images).toHaveLength(24);
  await act(async () => images.forEach(img => img.dispatchEvent(new Event("error"))));
  expect(fetch).toHaveBeenCalledTimes(24);
  expect(fetch).toHaveBeenCalledWith(source(references[0]), expect.objectContaining({ headers: { Authorization: "Bearer mention-test-token" } }));
  for (const resolve of pending.reverse()) await act(async () => resolve(response()));
  expect(images.every(img => img.src.startsWith("blob:mention-"))).toBe(true);
  expect(container.querySelector("textarea")).toBe(editor);
  expect(document.activeElement).toBe(editor);
  expect(editor.value).toBe(model.displayValue);
  expect([editor.selectionStart, editor.selectionEnd, editor.selectionDirection]).toEqual(selection);
  expect(Array.from(container.querySelectorAll(".mention-chip-sizer"), item => item.textContent)).toEqual(sizers);
  expect(changed).not.toHaveBeenCalled();
  await act(async () => root.render(null));
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(24);
});

it("uses the same compact slot after an unrecoverable image instead of inserting a full-size error panel", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response("missing", { status: 404 }));
  const changed = vi.fn();
  await act(async () => root.render(<CanvasResourceMentionTextarea value="@[node:image-0]" references={references} onChange={changed} thumbnailForReference={source} />));
  const sizer = container.querySelector(".mention-chip-sizer")!.textContent;
  await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector(".mention-chip-thumb.canvas-mention-thumb-icon")).not.toBeNull();
  expect(container.querySelector(".retry-image-error")).toBeNull();
  expect(container.querySelector(".mention-chip-sizer")!.textContent).toBe(sizer);
  expect(changed).not.toHaveBeenCalled();
});
