// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getAssetContentBlob } from "@/entities/asset";
import type { CanvasNodeData } from "../domain/types";
import { useCanvasOriginalImage } from "./useCanvasOriginalImage";

vi.mock("@/entities/asset", () => ({ getAssetContentBlob: vi.fn() }));
const node: CanvasNodeData = { id: "a", kind: "image", title: "image", content: "", x: 0, y: 0, width: 320, height: 320, imageAssetId: "original-a", metadata: { assetScope: "team", bytes: 999999 } };
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let current: ReturnType<typeof useCanvasOriginalImage>;
function Probe({ value }: { value?: CanvasNodeData }) {
  current = useCanvasOriginalImage(value, "personal");
  return <img src={current.source || undefined} />;
}
async function render(value?: CanvasNodeData) {
  await act(async () => root.render(<Probe value={value} />));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(getAssetContentBlob).mockReset();
  vi.stubGlobal("fetch", vi.fn());
  let sequence = 0;
  vi.stubGlobal("URL", Object.assign(class extends URL {}, {
    createObjectURL: vi.fn(() => `blob:original-${++sequence}`), revokeObjectURL: vi.fn(),
  }));
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("loads only the selected original, reads its bytes and releases it when closed", async () => {
  vi.mocked(getAssetContentBlob).mockResolvedValue(new Blob(["original-image"], { type: "image/png" }));
  await render();
  expect(getAssetContentBlob).not.toHaveBeenCalled();
  await render(node);
  expect(getAssetContentBlob).toHaveBeenCalledWith("original-a", "team", undefined, expect.any(AbortSignal));
  expect(current).toMatchObject({ source: "blob:original-1", bytes: 14, loading: false, error: "" });
  await render();
  expect(current.source).toBe("");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:original-1");
});

it("ignores a late original after switching images and aborts old requests", async () => {
  let finish!: (blob: Blob) => void;
  vi.mocked(getAssetContentBlob).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  vi.mocked(getAssetContentBlob).mockResolvedValueOnce(new Blob(["second"]));
  await render(node);
  const signal = vi.mocked(getAssetContentBlob).mock.calls[0][3]!;
  expect(current.loading).toBe(true);
  await render({ ...node, id: "b", imageAssetId: "original-b" });
  expect(signal.aborted).toBe(true);
  await act(async () => finish(new Blob(["stale"])));
  expect(current).toMatchObject({ source: "blob:original-1", bytes: 6 });
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
});

it("reports original failure without presenting a thumbnail as the original and supports retry", async () => {
  vi.mocked(getAssetContentBlob).mockRejectedValueOnce(new Error("unavailable"));
  await render({ ...node, imageSrc: "blob:old-thumbnail" });
  expect(current).toMatchObject({ source: "", bytes: undefined, loading: false, error: "原图加载失败，请重试" });
  vi.mocked(getAssetContentBlob).mockResolvedValueOnce(new Blob(["retry"]));
  await act(async () => current.retry());
  expect(current).toMatchObject({ source: "blob:original-1", bytes: 5, error: "" });
});

it("loads a legacy direct original without using canvas previews or stale byte metadata", async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, blob: async () => new Blob(["direct"]) } as Response);
  await render({ ...node, imageAssetId: undefined, imageSrc: "data:image/png;base64,original" });
  expect(getAssetContentBlob).not.toHaveBeenCalled();
  expect(current).toMatchObject({ source: "blob:original-1", bytes: 6 });
});
