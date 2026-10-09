// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasNodeData } from "../domain/types";
import { CanvasImageOutputStatus } from "./CanvasImageOutputStatus";

describe("actual image output dimensions", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("renders a friendly alert for an old saved size mismatch", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(<CanvasImageOutputStatus node={{ kind: "image", metadata: {
        status: "error", errorDetails: "图片尺寸不符合所选参数：要求 2560×1440 px，实际返回 1672×941 px。",
      } } as CanvasNodeData} />));
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("本次图片未达到所选规格");
      expect(container.innerHTML).not.toMatch(/2560|1672|实际返回/);
    } finally {
      await act(async () => root.unmount());
    }
  });
  it("shows nothing for a successful output whose size differs from the request", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      for (const metadata of [
        { status: "success", requestedImageSize: "1280x720", naturalWidth: 320, naturalHeight: 180 },
        { status: "success", requestedImageSize: "1024x1024", naturalWidth: 1536, naturalHeight: 1024 },
        { status: "loading", requestedImageSize: "1024x1024", naturalWidth: 1536, naturalHeight: 1024 },
      ]) {
        await act(async () => root.render(<CanvasImageOutputStatus node={{ kind: "image", metadata } as CanvasNodeData} />));
        expect(container.textContent).toBe("");
      }
    } finally {
      await act(async () => root.unmount());
    }
  });
});
