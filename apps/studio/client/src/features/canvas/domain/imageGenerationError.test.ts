import { describe, expect, it } from "vitest";
import { canvasImageGenerationError } from "./imageGenerationError";

describe("canvas image public errors", () => {
  it("keeps old diagnostic text out of user-visible messages", () => {
    const message = canvasImageGenerationError("图片尺寸不符合所选参数：要求 2560×1440 px，实际返回 1672×941 px。请更换模型或调整参数后重试。\nrequest_id: test");
    expect(message).toBe("本次图片未达到所选规格，请调整参数或更换模型后重试。");
    expect(message).not.toMatch(/2560|1672|request_id/);
  });

  it("supports structured codes while leaving unrelated actionable errors intact", () => {
    expect(canvasImageGenerationError("raw diagnostic", "image_output_unreadable")).toBe("本次图片未能完整生成，请稍后重试或更换模型。");
    for (const message of ["积分不足，请充值", "请先登录", "已停止生成，可重试。"]) {
      expect(canvasImageGenerationError(message)).toBe(message);
    }
  });
});
