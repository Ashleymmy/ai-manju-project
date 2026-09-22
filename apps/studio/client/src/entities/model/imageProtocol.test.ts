import { afterEach, describe, expect, it } from "vitest";
import { imageModelSupportsDetail, replaceImageModelProtocols } from "./imageProtocol";
import { canvasImageGenerationSettings } from "@/features/canvas/domain/imageGenerationSettings";
import type { CanvasNodeData } from "@/features/canvas/domain/types";

afterEach(() => replaceImageModelProtocols(undefined));
describe("image detail capabilities", () => {
  it("keeps provider-specific overrides and replaces stale catalogs", () => {
    replaceImageModelProtocols({ "a::gemini-image": "openai_images", "b::gemini-image": "openai_chat_completions", "c::opaque": "gemini_generate_content" });
    expect(imageModelSupportsDetail("a::gemini-image")).toBe(true);
    expect(imageModelSupportsDetail("b::gemini-image")).toBe(false);
    expect(imageModelSupportsDetail("c::opaque")).toBe(false);
    replaceImageModelProtocols({});
    expect(imageModelSupportsDetail("a::gemini-image")).toBe(false);
    expect(imageModelSupportsDetail("gpt-image-2")).toBe(true);
  });
  it("normalizes saved Gemini quality and the effective default model without changing pixel requests", () => {
    const node = { metadata: { model: "sx::gemini-3-pro-image", quality: "high", size: "1:1", imageResolution: "2K" } } as CanvasNodeData;
    expect(canvasImageGenerationSettings(node)).toEqual({ size: "2048x2048", imageResolution: "2K", quality: "auto" });
    expect(canvasImageGenerationSettings(node, undefined, "gpt-image-2").quality).toBe("high");
    expect(node.metadata?.quality).toBe("high");
  });
});
