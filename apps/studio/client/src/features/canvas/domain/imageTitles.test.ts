import { describe, expect, it } from "vitest";
import { looksLikeGeneratedAssetName } from "./imageTitles";

describe("generated asset filename detection", () => {
  it.each(["provider_0.png", "provider_1.Png", "generated-image.webp", "image_123.jpg", ""])(
    "recognizes provider filenames without using a prompt: %s", name => {
      expect(looksLikeGeneratedAssetName(name)).toBe(true);
    },
  );
  it.each(["水果摊 v1.2.PNG", "苹果1", "测试image-1"])("retains descriptive names: %s", name => {
    expect(looksLikeGeneratedAssetName(name)).toBe(false);
  });
});
