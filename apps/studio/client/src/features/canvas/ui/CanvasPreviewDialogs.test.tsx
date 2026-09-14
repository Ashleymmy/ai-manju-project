// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasNodeData } from "@/features/canvas/domain/types";
import { CanvasImagePreviewDialog } from "./CanvasPreviewDialogs";

const node: CanvasNodeData = {
  id: "image-a", kind: "image", title: "测试图片", content: "",
  x: 0, y: 0, width: 320, height: 238,
  metadata: { naturalWidth: 9999, naturalHeight: 9999, bytes: 33792 },
};

describe("canvas image preview resolution", () => {
  let root: Root;
  let container: HTMLDivElement;

  async function render(current = node, source = "/image-a.png") {
    await act(async () => root.render(<CanvasImagePreviewDialog
      node={current} source={source} siblings={[current]} selectedNodeId={current.id}
      previews={{}} modelLabel="测试模型" creatorLabel="测试用户"
      onSelectNode={vi.fn()} onSetBatchPrimary={vi.fn()} onDetachBatchChild={vi.fn()}
      onDownload={vi.fn()} onClose={vi.fn()}
    />));
  }

  function image() { return document.querySelector<HTMLImageElement>(".canvas-image-preview-stage > img")!; }
  function resolution() {
    return Array.from(document.querySelectorAll(".preview-detail-rows > div"))
      .find(row => row.querySelector("span")?.textContent === "分辨率")?.querySelector("b")?.textContent;
  }
  async function load(target: HTMLImageElement, width: number, height: number) {
    Object.defineProperties(target, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: width },
      naturalHeight: { configurable: true, value: height },
    });
    await act(async () => target.dispatchEvent(new Event("load")));
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(false);
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

  it("shows decoded pixel dimensions above file size, ignoring canvas size and stale metadata", async () => {
    await render();
    expect(resolution()).toBe("—");
    await load(image(), 640, 960);
    expect(resolution()).toBe("640 × 960 px");
    const labels = Array.from(document.querySelectorAll(".preview-detail-rows > div > span"), item => item.textContent);
    expect(labels.indexOf("分辨率")).toBe(labels.indexOf("文件大小") - 1);
  });

  it.each(["image-b", "image-a"])("clears stale dimensions when selecting or replacing %s", async nextId => {
    await render();
    const previousImage = image();
    await load(previousImage, 640, 960);
    await render({ ...node, id: nextId }, "/image-b.png");
    expect(resolution()).toBe("—");
    expect(image()).not.toBe(previousImage);
    await load(previousImage, 100, 100);
    expect(resolution()).toBe("—");
    await load(image(), 1280, 720);
    expect(resolution()).toBe("1280 × 720 px");
  });

  it("reads already loaded cached images without waiting for another load event", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(2048);
    vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(1024);
    await render();
    expect(resolution()).toBe("2048 × 1024 px");
  });

  it("does not invent a resolution for failed or undecodable images", async () => {
    await render();
    await load(image(), 0, 0);
    expect(resolution()).toBe("—");
    await load(image(), 640, 960);
    await act(async () => image().dispatchEvent(new Event("error")));
    expect(resolution()).toBe("—");
  });

  it("only shows apply action for a batch child and detaches it before closing", async () => {
    const child = { ...node, id: "image-child", metadata: { ...node.metadata, batchRootId: "image-root" } };
    const onDetachBatchChild = vi.fn();
    const onClose = vi.fn();
    await act(async () => root.render(<CanvasImagePreviewDialog
      node={child} source="/image-child.png" siblings={[child]} selectedNodeId={child.id}
      previews={{}} modelLabel="测试模型" creatorLabel="测试用户"
      onSelectNode={vi.fn()} onSetBatchPrimary={vi.fn()} onDetachBatchChild={onDetachBatchChild}
      onDownload={vi.fn()} onClose={onClose}
    />));
    const apply = Array.from(document.querySelectorAll("button")).find(button => button.textContent?.includes("应用到画布"));
    expect(apply).toBeTruthy();
    await act(async () => { apply!.click(); });
    expect(onDetachBatchChild).toHaveBeenCalledWith(child);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not show a misleading apply action for an image already on canvas", async () => {
    await render();
    expect(Array.from(document.querySelectorAll("button")).some(button => button.textContent?.includes("应用到画布"))).toBe(false);
  });
});
