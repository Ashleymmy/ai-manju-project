import { describe, expect, it } from "vitest";
import { canvasImageRequestPrompt } from "./outputRequirements";

describe("canvas output requirements", () => {
  it("reinforces the selected pixels without changing the user's editable prompt", () => {
    const input = {
      prompt: "四个苹果",
      sourceType: "canvas",
      size: "1024x1024",
    };
    expect(canvasImageRequestPrompt(input)).toContain(
      "1024×1024 像素（宽×高）"
    );
    expect(canvasImageRequestPrompt(input)).toContain("不要沿用参考图的宽高比");
    expect(input.prompt).toBe("四个苹果");
    const prompt = canvasImageRequestPrompt(input);
    expect(canvasImageRequestPrompt({ ...input, prompt })).toBe(prompt);
  });

  it("leaves automatic sizing and other image workflows unchanged", () => {
    for (const input of [
      { prompt: "画面", sourceType: "canvas", size: "auto" },
      { prompt: "画面", sourceType: "canvas", size: "0x1024" },
      { prompt: "画面", sourceType: "image_workbench", size: "1024x1024" },
    ])
      expect(canvasImageRequestPrompt(input)).toBe("画面");
  });
});
