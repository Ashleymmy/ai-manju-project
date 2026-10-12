import { describe, expect, it } from "vitest";
import { canvasNicknameRows, changedCanvasNicknameCount, normalizeCanvasNicknames, parseCanvasNicknameDraft } from "./canvasNicknames";

// [画布别名]
describe("admin canvas nicknames", () => {
  it("groups catalog selectors by real model ID and keeps administrator display names", () => {
    const rows = canvasNicknameRows({
      image_models: ["a::gpt-image-2", "b::gpt-image-2", "a::gpt-image-1", "a::ep-flare"],
      video_models: ["sdvideo/seedance-2.0"],
      model_labels: { "a::ep-flare": "Flare", "sdvideo/seedance-2.0": "Seedance 2.0" },
      model_provider_names: { "a::gpt-image-2": "新 Provider", "b::gpt-image-2": "测试1", "a::ep-flare": "新 Provider", "sdvideo/seedance-2.0": "SD-video" },
    });
    expect(rows.image).toEqual([
      { id: "ep-flare", providers: ["新 Provider"], displayName: "Flare" },
      { id: "gpt-image-2", providers: ["新 Provider", "测试1"], displayName: "gpt-image-2" },
    ]);
    expect(rows.video).toEqual([{ id: "sdvideo/seedance-2.0", providers: ["SD-video"], displayName: "Seedance 2.0" }]);
    expect(rows.audio).toEqual([]);
  });

  it("counts edits against the saved table and drops blank nicknames on save", () => {
    const saved = normalizeCanvasNicknames({ "gpt-image-2": "image2", retired: "old", broken: 3 });
    expect(saved).toEqual({ "gpt-image-2": "image2", retired: "old" });
    const draft = { ...saved, "gpt-image-2": " image2 ", "ep-flare": "flare", retired: " " };
    expect(changedCanvasNicknameCount(draft, saved)).toBe(2);
    expect(parseCanvasNicknameDraft(draft)).toEqual({ "gpt-image-2": "image2", "ep-flare": "flare" });
    expect(() => parseCanvasNicknameDraft({ "gpt-image-2": "名".repeat(33) })).toThrow("不能超过 32 个字符");
  });
});
