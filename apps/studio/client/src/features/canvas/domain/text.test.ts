import { describe, expect, it } from "vitest";

import {
  buildCanvasTextRequestMessages,
  canvasTextComposerValue,
  canvasTextDisplayValue,
  canvasTextRequestPrompt,
  isGeneratedCanvasText,
  updateCanvasNodeComposer,
  updateCanvasTextDisplay,
} from "./text";

describe("canvas text semantics", () => {
  it("keeps generated text separate from its next composer prompt", () => {
    const node = {
      kind: "text",
      content: "生成结果",
      metadata: {
        content: "生成结果",
        prompt: "上一次请求",
        composerContent: "改成更简洁的版本",
        status: "success",
      },
    };

    expect(canvasTextDisplayValue(node)).toBe("生成结果");
    expect(canvasTextComposerValue(node)).toBe("改成更简洁的版本");
    expect(canvasTextRequestPrompt(node, canvasTextComposerValue(node))).toBe(
      "请根据要求修改以下文本。\n\n原文：\n生成结果\n\n修改要求：\n改成更简洁的版本",
    );
  });

  it("does not treat a new text node placeholder as an existing generated result", () => {
    const node = {
      kind: "text",
      content: "在这里填写要生成的画面提示词。",
      metadata: { content: "在这里填写要生成的画面提示词。", status: "idle" },
    };

    expect(isGeneratedCanvasText(node)).toBe(false);
    expect(canvasTextComposerValue(node)).toBe("在这里填写要生成的画面提示词。");
    expect(canvasTextRequestPrompt(node, "生成一段旁白")).toBe("生成一段旁白");
  });

  it("builds true multimodal messages when canvas images are connected", () => {
    expect(buildCanvasTextRequestMessages("描述参考图", [])).toEqual([
      { role: "user", content: "描述参考图" },
    ]);
    expect(buildCanvasTextRequestMessages("描述参考图", ["data:image/png;base64,one", "data:image/jpeg;base64,two"])).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "描述参考图" },
          { type: "input_image", image_url: { url: "data:image/png;base64,one" } },
          { type: "input_image", image_url: { url: "data:image/jpeg;base64,two" } },
        ],
      },
    ]);
  });

  it("updates the composer without overwriting a generated result", () => {
    const node = {
      kind: "text",
      content: "保留的结果",
      metadata: { content: "保留的结果", prompt: "旧要求", status: "success" },
    };

    const updated = updateCanvasNodeComposer(node, "新的修改要求");
    expect(updated.content).toBe("保留的结果");
    expect(updated.metadata.content).toBe("保留的结果");
    expect(updated.metadata.prompt).toBe("新的修改要求");
    expect(updated.metadata.composerContent).toBe("新的修改要求");
  });

  it("updates generated text without overwriting its composer prompt", () => {
    const node = {
      kind: "text",
      content: "旧结果",
      metadata: {
        content: "旧结果",
        prompt: "保留的请求",
        composerContent: "保留的修改要求",
        status: "success",
      },
    };

    const updated = updateCanvasTextDisplay(node, "人工修订结果");
    expect(updated.content).toBe("人工修订结果");
    expect(updated.metadata.content).toBe("人工修订结果");
    expect(updated.metadata.prompt).toBe("保留的请求");
    expect(updated.metadata.composerContent).toBe("保留的修改要求");
  });

  it("keeps result and composer fields separate after a generated result is cleared", () => {
    const node = {
      kind: "text",
      content: "",
      metadata: {
        content: "",
        prompt: "保留的请求",
        composerContent: "继续修改",
        status: "success",
      },
    };

    expect(isGeneratedCanvasText(node)).toBe(true);
    expect(canvasTextDisplayValue(node)).toBe("");
    expect(canvasTextComposerValue(node)).toBe("继续修改");
  });
});
