import { describe, expect, it } from "vitest";
import { generatedImageTitle } from "./imageTitles";
import { imageFileName } from "./nodeUtils";

describe("generated canvas image titles", () => {
  it.each([
    "provider_0.png",
    "provider_1.Png",
    "generated-image.webp",
    "image_123.jpg",
    "",
  ])("replaces the default filename %s with a readable prompt", name => {
    expect(generatedImageTitle(name, "  街边水果摊\n暖色光线  ")).toBe(
      "街边水果摊"
    );
  });

  it("keeps descriptive names and meaningful dots while removing image suffixes", () => {
    expect(generatedImageTitle(" 水果摊 v1.2.PNG ", "其他提示词")).toBe(
      "水果摊 v1.2"
    );
    expect(generatedImageTitle("水果摊 v1.2", "其他提示词")).toBe(
      "水果摊 v1.2"
    );
  });

  it("omits reference IDs, shortens long prompts safely, and numbers batch variants", () => {
    expect(
      generatedImageTitle(
        "provider_0.png",
        "@[node:private-id] 街边   水果摊",
        1
      )
    ).toBe("街边 水果摊 · 2");
    expect(generatedImageTitle("provider_0.png", "🍎".repeat(30))).toBe(
      `${"🍎".repeat(24)}…`
    );
    expect(
      generatedImageTitle("provider_0.png", "@[asset:private-id]", 2)
    ).toBe("生成图片 · 3");
    expect(
      generatedImageTitle("provider_0.png", "https://example.test/image.png")
    ).toBe("生成图片");
  });

  it("retains a proper file extension for downloaded images", () => {
    const title = generatedImageTitle("provider_0.Png", "街边水果摊");
    expect(imageFileName(title, "image/png")).toBe("街边水果摊.png");
    expect(imageFileName(title, "image/jpeg")).toBe("街边水果摊.jpg");
  });
});
