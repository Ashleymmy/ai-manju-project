import { describe, expect, it } from "vitest";
import type { PromptPreset } from "@/entities/prompt";
import { mergePromptPresetImport, parsePromptPresetFile, serializePromptPresetFile } from "./presetTransfer";

const preset: PromptPreset = {
  id: "preset-1", title: "电影光影", prompt: "雨夜街道\n保持人物造型 🎬", tags: ["电影", "夜景"],
  priority: "pinned", sort_order: 7, createdAt: "2026-09-16T00:00:00Z", updatedAt: "2026-09-16T01:00:00Z",
};

describe("prompt preset file transfer", () => {
  it("reads the existing export format and preserves text, tags, priority, order and timestamps", () => {
    const oldExport = JSON.stringify({ app: "ai-manju-studio", version: 1, exportedAt: "2026-09-16", presets: [preset] });
    expect(parsePromptPresetFile(oldExport)).toEqual([preset]);
    expect(parsePromptPresetFile(`\uFEFF${serializePromptPresetFile([preset])}`)).toEqual([preset]);
  });

  it.each([
    ["broken JSON", "{bad", "有效的 JSON"],
    ["unrelated JSON", JSON.stringify({ presets: [preset] }), "文件格式不正确"],
    ["future version", JSON.stringify({ app: "ai-manju-studio", version: 2, presets: [preset] }), "版本"],
    ["empty file", serializePromptPresetFile([]), "没有可导入"],
    ["invalid row", serializePromptPresetFile([preset, { ...preset, prompt: "" }]), "第 2 条"],
    ["invalid tags", JSON.stringify({ app: "ai-manju-studio", version: 1, presets: [{ ...preset, tags: "tag" }] }), "第 1 条"],
  ])("rejects %s before saving anything", (_name, file, message) => {
    expect(() => parsePromptPresetFile(file)).toThrow(message);
  });

  it("does not overwrite an edited preset with the same ID and deduplicates repeat imports", () => {
    const existing = { ...preset, prompt: "我修改后的提示词" };
    const merged = mergePromptPresetImport([existing], [preset, { ...preset, id: "other-id" }]);
    expect(merged.added).toBe(1);
    expect(merged.skipped).toBe(1);
    expect(merged.presets[0]).toEqual(existing);
    expect(merged.presets[1]).toMatchObject({ ...preset, id: merged.firstImportedId });
    expect(merged.firstImportedId).not.toBe(preset.id);
    expect(mergePromptPresetImport(merged.presets, [preset])).toMatchObject({ added: 0, skipped: 1 });
  });

  it("checks the combined limit after removing duplicates", () => {
    const existing = Array.from({ length: 100 }, (_, i) => ({ ...preset, id: `id-${i}`, title: `预设 ${i}` }));
    expect(mergePromptPresetImport(existing, [existing[0]])).toMatchObject({ added: 0, skipped: 1 });
    expect(() => mergePromptPresetImport(existing, [preset])).toThrow("100 条上限");
    expect(existing).toHaveLength(100);
  });

  it("rejects content that the server would truncate, using Unicode character lengths", () => {
    expect(parsePromptPresetFile(serializePromptPresetFile([{ ...preset, prompt: "🎬".repeat(4000) }]))[0].prompt).toHaveLength(8000);
    expect(() => parsePromptPresetFile(serializePromptPresetFile([{ ...preset, prompt: "字".repeat(4001) }]))).toThrow("正文 4000 字");
  });

  it("keeps unfinished existing drafts from being silently removed by a save", () => {
    const draft = { ...preset, id: "draft", prompt: "" };
    expect(() => mergePromptPresetImport([draft], [preset])).toThrow("请先完善");
    expect(draft.prompt).toBe("");
  });
});
