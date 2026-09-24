import { describe, expect, it } from "vitest";
import type { Asset } from "@/entities/asset";
import { completeGeneratedAudioTarget, completeGeneratedImageTarget, completeGeneratedVideoTarget } from "./generation";
import { normalizeCanvasAudioGenerationConfig } from "./audioConfig";
import { mediaFileName } from "./nodeUtils";
import { buildCanvasSnapshot, parseCanvasSnapshot } from "./snapshotCodec";
import type { CanvasNodeData } from "./types";

const config = { model: "video-model", size: "16:9", resolution: "720p", seconds: "4", generateAudio: true, watermark: false };

function pending(id: string, kind: Asset["type"]): CanvasNodeData {
  return { id, kind, title: `生成中 ${id}`, content: "", x: 0, y: 0, width: 320, height: 240,
    metadata: { status: "loading", jobId: `job-${id}` } };
}

describe("generated media node names", () => {
  it.each([
    ["image", "png", "image/png"], ["video", "mp4", "video/mp4"], ["audio", "mp3", "audio/mpeg"],
  ] as const)("cleans repeated %s results and persists parentheses without changing downloadable formats", (kind, extension, mime) => {
    let nodes = [pending("a", kind), pending("b", kind), pending("c", kind)];
    for (const id of ["b", "c", "a"]) {
      const asset: Asset = { id: `asset-${id}`, type: kind, name: `作品01.${extension}`, content_type: mime };
      if (kind === "image") nodes = completeGeneratedImageTarget(nodes, id, { id, assetId: asset.id, name: asset.name, src: "", contentType: mime }, "作品01");
      else if (kind === "audio") nodes = completeGeneratedAudioTarget(nodes, id, asset, "作品01", normalizeCanvasAudioGenerationConfig({ model: "audio-model" }), id, "personal");
      else nodes = completeGeneratedVideoTarget(nodes, id, asset, { assetId: asset.id }, "作品01", config, { id: "task", provider: "openai", model: config.model }, id, undefined, "personal");
    }
    expect(nodes.map(node => node.title)).toEqual(["作品01（2）", "作品01", "作品01（1）"]);
    expect(nodes.map(node => node.metadata?.assetId)).toEqual(["asset-a", "asset-b", "asset-c"]);
    expect(nodes.every(node => node.metadata?.status === "success" && !node.metadata.jobId)).toBe(true);
    expect(parseCanvasSnapshot(buildCanvasSnapshot({}, nodes, [], 100, 0, 0))?.nodes.map(node => node.title))
      .toEqual(nodes.map(node => node.title));
    expect(mediaFileName(nodes[0].title, kind, mime)).toBe(`作品01（2）.${extension}`);
  });

  it("numbers unnamed image generations using the same prompt without stripping its digits", () => {
    let nodes = [pending("a", "image"), pending("b", "image"), pending("c", "image")];
    for (const id of ["a", "b", "c"]) {
      nodes = completeGeneratedImageTarget(nodes, id, { id, name: "provider_0.png", assetId: id, src: "" }, "苹果1");
    }
    expect(nodes.map(node => node.title)).toEqual(["苹果1", "苹果1（1）", "苹果1（2）"]);
  });
});
