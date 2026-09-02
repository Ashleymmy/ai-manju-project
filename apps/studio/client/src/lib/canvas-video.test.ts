import { describe, expect, it, vi } from "vitest";

import type { CanvasGenerationInput } from "./canvas-connections";
import {
  canvasSeedanceVideoReferences,
  hydrateCanvasVideoReferences,
  mergeCanvasVideoReferences,
  videoResultPersistentMetadata,
  type CanvasVideoReferenceHydrators,
} from "./canvas-video";

function blob(content: string, type: string) {
  return new Blob([content], { type });
}

function hydrators(
  overrides: Partial<CanvasVideoReferenceHydrators> = {}
): CanvasVideoReferenceHydrators {
  const assetBlobs: Record<string, Blob> = {
    "asset-image": blob("image", "image/png"),
    "asset-audio": blob("audio", "audio/mpeg"),
  };
  const nodeBlobs: Record<string, Blob> = {
    "node-video": blob("video", "video/mp4"),
    "node-image": blob("node-image", "image/webp"),
  };
  return {
    scope: "team",
    resolveAssetBlob: vi.fn(async input => assetBlobs[input.assetId]),
    resolveNodeBlob: vi.fn(async input => nodeBlobs[input.nodeId]),
    readImageMetadata: vi.fn(async () => ({ width: 1280, height: 720 })),
    readVideoMetadata: vi.fn(async () => ({
      width: 1920,
      height: 1080,
      durationMs: 6_000,
    })),
    readAudioMetadata: vi.fn(async () => ({ durationMs: 4_000 })),
    ...overrides,
  };
}

describe("canvas video references", () => {
  it("maps Seedance material and Volcano assets to asset references", () => {
    expect(canvasSeedanceVideoReferences(
      [{ id: "material-1", name: "授权人物" }],
      [
        { id: "row-image", volcanoAssetId: "volcano-image", name: "人物图", assetType: "Image" },
        { id: "row-video", volcanoAssetId: "volcano-video", name: "动作视频", assetType: "Video" },
      ],
    )).toEqual({
      images: [
        expect.objectContaining({ id: "seedance-material-material-1", kind: "image", url: "asset://material-1", name: "授权人物" }),
        expect.objectContaining({ id: "seedance-volcano-asset-volcano-image", kind: "image", url: "asset://volcano-image", name: "人物图" }),
      ],
      videos: [
        expect.objectContaining({ id: "seedance-volcano-asset-volcano-video", kind: "video", url: "asset://volcano-video", name: "动作视频" }),
      ],
      audios: [],
    });
  });

  it("deduplicates Seedance and connected references by canonical URL", () => {
    const seedance = canvasSeedanceVideoReferences(
      [{ id: "shared" }, { id: "shared" }],
      [],
    );
    const merged = mergeCanvasVideoReferences(seedance, {
      images: [{ ...seedance.images[0], id: "duplicate" }],
      videos: [],
      audios: [],
    });

    expect(merged.images).toHaveLength(1);
    expect(merged.images[0].url).toBe("asset://shared");
  });

  it("preserves typed input order and removes repeated node or asset references", async () => {
    const inputs: CanvasGenerationInput[] = [
      { nodeId: "text-1", type: "text", title: "动作", text: "缓慢推近" },
      {
        nodeId: "image-1",
        type: "image",
        title: "角色参考.png",
        assetId: "asset-image",
      },
      {
        nodeId: "image-duplicate",
        type: "image",
        title: "重复角色.png",
        assetId: "asset-image",
      },
      {
        nodeId: "node-video",
        type: "video",
        title: "运镜参考.mp4",
        content: "blob:temporary-video",
      },
      {
        nodeId: "node-video",
        type: "video",
        title: "重复运镜.mp4",
        content: "blob:duplicate",
      },
      {
        nodeId: "audio-1",
        type: "audio",
        title: "对白.mp3",
        assetId: "asset-audio",
      },
    ];

    const result = await hydrateCanvasVideoReferences(inputs, hydrators());

    expect(result.snapshot.items.map(item => item.nodeId)).toEqual([
      "text-1",
      "image-1",
      "node-video",
      "audio-1",
    ]);
    expect(result.references.images.map(item => item.id)).toEqual(["image-1"]);
    expect(result.references.videos.map(item => item.id)).toEqual([
      "node-video",
    ]);
    expect(result.references.audios.map(item => item.id)).toEqual(["audio-1"]);
  });

  it("rejects media inputs without an asset or node source", async () => {
    await expect(
      hydrateCanvasVideoReferences(
        [{ nodeId: "missing", type: "image", title: "缺失图片" }],
        hydrators()
      )
    ).rejects.toThrow("引用“缺失图片”缺少可读取的媒体内容");
  });

  it("reports missing resolved asset content", async () => {
    await expect(
      hydrateCanvasVideoReferences(
        [
          {
            nodeId: "missing-asset",
            type: "video",
            title: "缺失视频",
            assetId: "asset-missing",
          },
        ],
        hydrators()
      )
    ).rejects.toThrow("引用“缺失视频”的资产内容不存在");
  });

  it("rejects a resolved blob whose MIME category does not match the typed input", async () => {
    await expect(
      hydrateCanvasVideoReferences(
        [
          {
            nodeId: "wrong",
            type: "video",
            title: "错误参考",
            content: "node://wrong",
          },
        ],
        hydrators({
          resolveNodeBlob: vi.fn(async () => blob("image", "image/png")),
        })
      )
    ).rejects.toThrow(
      "引用“错误参考”的媒体类型不匹配：期望视频，实际image/png"
    );
  });

  it("hydrates image, video, and audio files with injected metadata readers", async () => {
    const readers = hydrators();
    const result = await hydrateCanvasVideoReferences(
      [
        {
          nodeId: "node-image",
          type: "image",
          title: "构图.webp",
          content: "node://image",
        },
        {
          nodeId: "node-video",
          type: "video",
          title: "运镜.mp4",
          content: "node://video",
        },
        {
          nodeId: "audio-1",
          type: "audio",
          title: "对白.mp3",
          assetId: "asset-audio",
        },
      ],
      readers
    );

    expect(result.references.images[0]).toMatchObject({
      name: "构图.webp",
      mime: "image/webp",
      width: 1280,
      height: 720,
    });
    expect(result.references.videos[0]).toMatchObject({
      name: "运镜.mp4",
      mime: "video/mp4",
      width: 1920,
      height: 1080,
      durationMs: 6_000,
    });
    expect(result.references.audios[0]).toMatchObject({
      name: "对白.mp3",
      mime: "audio/mpeg",
      durationMs: 4_000,
    });
    expect(result.references.images[0].file).toBeInstanceOf(File);
    expect(readers.readImageMetadata).toHaveBeenCalledWith(
      result.references.images[0].file
    );
    expect(readers.readVideoMetadata).toHaveBeenCalledWith(
      result.references.videos[0].file
    );
    expect(readers.readAudioMetadata).toHaveBeenCalledWith(
      result.references.audios[0].file
    );
  });

  it("creates a retry snapshot without blobs, files, content, or temporary URLs", async () => {
    const result = await hydrateCanvasVideoReferences(
      [
        {
          nodeId: "node-image",
          type: "image",
          title: "参考.webp",
          content: "data:image/webp;base64,temporary",
        },
        {
          nodeId: "node-video",
          type: "video",
          title: "参考.mp4",
          content: "blob:temporary-video",
        },
      ],
      hydrators()
    );
    const serialized = JSON.stringify(result.snapshot);

    expect(serialized).not.toContain("blob:");
    expect(serialized).not.toContain("data:");
    expect(serialized).not.toContain("content");
    expect(serialized).not.toContain("file");
    expect(result.snapshot.items).toEqual([
      expect.objectContaining({
        nodeId: "node-image",
        source: "node",
        scope: "team",
        mime: "image/webp",
        width: 1280,
        height: 720,
      }),
      expect.objectContaining({
        nodeId: "node-video",
        source: "node",
        scope: "team",
        mime: "video/mp4",
        durationMs: 6_000,
      }),
    ]);
  });

  it("whitelists persistent result metadata and drops temporary result URLs", () => {
    const metadata = videoResultPersistentMetadata(
      {
        url: "blob:temporary-result",
        mimeType: "video/webm",
        fileName: "temporary.webm",
        assetId: "temporary-asset",
        scope: "personal",
        ephemeral: true,
      },
      {
        id: "asset-final",
        name: "final.mp4",
        content_type: "video/mp4",
        size: 1234,
        scope: "team",
      }
    );

    expect(metadata).toEqual({
      assetId: "asset-final",
      scope: "team",
      mimeType: "video/mp4",
      bytes: 1234,
      fileName: "final.mp4",
    });
    expect(JSON.stringify(metadata)).not.toContain("blob:");
    expect(metadata).not.toHaveProperty("url");
    expect(metadata).not.toHaveProperty("ephemeral");
  });
});
