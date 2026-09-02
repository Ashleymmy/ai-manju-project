import { describe, expect, it, vi } from "vitest";

import {
  hydrateCanvasVideoReferences,
  type CanvasVideoReferenceHydrators,
} from "./canvas-video";

describe("legacy canvas video compatibility", () => {
  it("keeps createFile optional for callers of the old module path", async () => {
    const hydrators: CanvasVideoReferenceHydrators = {
      scope: "personal",
      resolveAssetBlob: vi.fn(async () => null),
      resolveNodeBlob: vi.fn(async () => new Blob(["image"], { type: "image/png" })),
      readImageMetadata: vi.fn(async () => ({ width: 100, height: 100 })),
      readVideoMetadata: vi.fn(async () => ({ width: 100, height: 100, durationMs: 1_000 })),
      readAudioMetadata: vi.fn(async () => ({ durationMs: 1_000 })),
    };

    const result = await hydrateCanvasVideoReferences([
      {
        nodeId: "image-1",
        type: "image",
        title: "参考.png",
        content: "blob:reference",
      },
    ], hydrators);

    expect(result.references.images[0].file).toBeInstanceOf(File);
  });
});
