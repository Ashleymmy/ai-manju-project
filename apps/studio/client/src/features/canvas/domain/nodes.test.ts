import { describe, expect, it } from "vitest";

import {
  imageSrcFromNode,
  normalizeCanvasNode,
  normalizeCanvasNodeKind,
  serializeCanvasNode,
} from "./nodes";

describe("canvas node transforms", () => {
  it("canonicalizes legacy prompt/note types to text", () => {
    expect(normalizeCanvasNodeKind("prompt")).toBe("text");
    expect(normalizeCanvasNodeKind("note")).toBe("text");
    expect(normalizeCanvasNodeKind("unknown")).toBe("text");
  });

  it("keeps prompt text separate from media source metadata", () => {
    const prompt = normalizeCanvasNode({ id: "n-1", kind: "image", metadata: { content: "生成一只猫" } });
    expect(prompt).toMatchObject({ kind: "image", content: "生成一只猫" });
    expect(imageSrcFromNode(prompt!, {})).toBe("");

    const media = normalizeCanvasNode({ id: "n-2", kind: "image", metadata: { content: "https://example.test/a.png" } });
    expect(media).toMatchObject({ content: "", imageSrc: "https://example.test/a.png" });
    expect(imageSrcFromNode(media!, {})).toBe("https://example.test/a.png");
  });

  it("serializes both canonical and legacy fields while retaining extensions", () => {
    const node = normalizeCanvasNode({
      id: "n-1",
      kind: "text",
      content: "hello",
      custom: 42,
      metadata: { customMetadata: true },
    })!;
    expect(serializeCanvasNode(node)).toMatchObject({
      id: "n-1",
      kind: "text",
      type: "text",
      position: { x: 0, y: 0 },
      custom: 42,
      metadata: { customMetadata: true, prompt: "hello" },
    });
  });

  it("updates managed coordinates without dropping nested position extensions", () => {
    const node = normalizeCanvasNode({
      id: "n-position",
      kind: "image",
      position: {
        x: 12,
        y: 34,
        rotation: 15,
        anchor: { x: 0.5, y: 1 },
      },
    })!;

    const serialized = serializeCanvasNode({ ...node, x: 56, y: 78 });

    expect(serialized.position).toEqual({
      x: 56,
      y: 78,
      rotation: 15,
      anchor: { x: 0.5, y: 1 },
    });
  });
});
