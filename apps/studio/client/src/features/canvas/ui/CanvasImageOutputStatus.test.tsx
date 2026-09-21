// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasNodeData } from "../domain/types";
import { CanvasImageOutputStatus } from "./CanvasImageOutputStatus";

describe("actual image output dimensions", () => {
  afterEach(() => vi.unstubAllGlobals());
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
