import { describe, expect, it } from "vitest";

import {
  emptyWorkbenchReferences,
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
      "provider::doubao-seedance-2-5-pro",
    );

    expect(result.accepted.map((item) => item.id)).toEqual(
      candidates.slice(0, 9).map((item) => item.id),
    );
    expect(result.rejected).toMatchObject([
      { name: "image-10.png", reason: "参考图片最多 9 张" },
    ]);
  });
});
