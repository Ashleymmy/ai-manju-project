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
  it("describes a larger rounded original without claiming it failed or requesting regeneration", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(<CanvasImageOutputStatus node={{
        kind: "image",
        metadata: { status: "success", requestedImageSize: "1280x720", naturalWidth: 1672, naturalHeight: 941 },
      } as CanvasNodeData} />));
      expect(container.textContent).toContain("1672 × 941 px");
      expect(container.textContent).toContain("1280 × 720 px");
      expect(container.textContent).toContain("未缩放或裁剪");
      expect(container.textContent).not.toMatch(/未达到|重新生成/);
      expect(container.querySelector('[role="alert"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
  it("reports a landscape return for a square request, using submitted rather than edited settings", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    const node = {
      kind: "image",
      metadata: {
        status: "success",
        size: "16:9",
        requestedImageSize: "1024x1024",
        naturalWidth: 1536,
        naturalHeight: 1024,
      },
    } as CanvasNodeData;
    try {
      await act(async () =>
        root.render(<CanvasImageOutputStatus node={node} />)
      );
      expect(container.textContent).toContain("1536 × 1024 px");
      expect(container.textContent).toContain("1024 × 1024 px");
      expect(container.textContent).toContain("原图已保留");
      await act(async () =>
        root.render(
          <CanvasImageOutputStatus
            node={{
              ...node,
              metadata: { ...node.metadata, naturalWidth: 1024 },
            }}
          />
        )
      );
      expect(container.textContent).toBe("");
      await act(async () =>
        root.render(
          <CanvasImageOutputStatus
            node={{
              ...node,
              metadata: { ...node.metadata, status: "loading" },
            }}
          />
        )
      );
      expect(container.textContent).toBe("");
    } finally {
      await act(async () => root.unmount());
    }
  });
});
