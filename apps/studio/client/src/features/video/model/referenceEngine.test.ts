import { describe, expect, it } from "vitest";

import {
  emptyWorkbenchReferences,
  createVolcanoWorkbenchReference,
  generationReferencesFrom,
  planWorkbenchReferenceBatch,
  referencedTokenIds,
  resolvePromptWithTokens,
  storedWorkbenchReferences,
  type WorkbenchImageReference,
} from "./referenceEngine";

function imageReference(
  id: string,
  role: WorkbenchImageReference["role"] = "reference",
): WorkbenchImageReference {
  const file = new File([id], `${id}.png`, { type: "image/png" });
  return {
    id,
    kind: "image",
    source: "local",
    role,
    token: role === "reference" ? `@${id}` : undefined,
    file,
    name: file.name,
    mime: file.type,
    bytes: file.size,
    width: 1280,
    height: 720,
    previewUrl: `blob:${id}`,
    storageKey: `draft:${id}`,
  };
}

describe("video reference engine contracts", () => {
  it("已注册素材保持 asset 引用，鉴权预览不成为生成图片 URL", () => {
    const source = "/api/sd-video/volcano/assets/local-id/content?scope=personal";
    const reference = createVolcanoWorkbenchReference({ id: "local-id", name: "hero", volcano_asset_id: "remote-id", status: "Active", asset_type: "Image", source_url: source });
    expect(reference.previewSourceUrl).toBe(source);
    expect(reference.file).toBeUndefined();
    expect(generationReferencesFrom({ images: [reference as WorkbenchImageReference], videos: [], audios: [] }).images[0].url).toBe("asset://remote-id");
  });
  it("keeps mention tokens stable while resolving only known references", () => {
    const snapshot = emptyWorkbenchReferences();
    snapshot.images.push(imageReference("hero"));

    const prompt = "让 @[ref:hero] 转身，并保留 @[ref:missing]";
    expect(resolvePromptWithTokens(prompt, snapshot)).toBe(
      "让 图片1 转身，并保留 @[ref:missing]",
    );
    expect([...referencedTokenIds(prompt)]).toEqual(["hero", "missing"]);
  });

  it("preserves first/last-frame generation roles but excludes them from history references", () => {
    const reference = imageReference("reference");
    const firstFrame = imageReference("first", "first_frame");
    const snapshot = {
      images: [reference, firstFrame],
      videos: [],
      audios: [],
    };

    expect(generationReferencesFrom(snapshot).images.map((item) => item.role))
      .toEqual([undefined, "first_frame"]);
    expect(storedWorkbenchReferences(snapshot).images.map((item) => item.id))
      .toEqual(["reference"]);
  });

  it("accepts the first nine Seedance images and rejects the tenth", () => {
    const candidates = Array.from({ length: 10 }, (_, index) =>
      imageReference(`image-${index + 1}`),
    );

    const result = planWorkbenchReferenceBatch(
      emptyWorkbenchReferences(),
      candidates,
      "provider::doubao-seedance-2-0-260128",
    );

    expect(result.accepted.map((item) => item.id)).toEqual(
      candidates.slice(0, 9).map((item) => item.id),
    );
    expect(result.rejected).toMatchObject([
      { name: "image-10.png", reason: "参考图片最多 9 张" },
    ]);
  });

  it("2.5 selects thirty images and ten audio clips using the submission policy", () => {
    const images = Array.from({ length: 31 }, (_, index) => imageReference(`image-${index + 1}`));
    const result = planWorkbenchReferenceBatch(emptyWorkbenchReferences(), images, "sdvideo/seedance-2.5");
    expect(result.accepted).toHaveLength(30);
    expect(result.rejected).toMatchObject([{ name: "image-31.png", reason: "参考图片最多 30 张" }]);
    const audios = Array.from({ length: 11 }, (_, index) => {
      const file = new File(["audio"], `audio-${index + 1}.mp3`, { type: "audio/mpeg" });
      return {
        id: file.name, kind: "audio" as const, source: "local" as const, role: "reference" as const,
        name: file.name, mime: file.type, bytes: file.size, file, durationMs: 3000, previewUrl: `blob:${file.name}`,
      };
    });
    const audioResult = planWorkbenchReferenceBatch(emptyWorkbenchReferences(), audios, "sdvideo/seedance-2.5");
    expect(audioResult.accepted).toHaveLength(10);
    expect(audioResult.rejected).toMatchObject([{ name: "audio-11.mp3", reason: "参考音频最多 10 个" }]);
  });
});
