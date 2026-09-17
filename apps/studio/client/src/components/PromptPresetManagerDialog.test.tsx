// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptPreset } from "@/entities/prompt";
import { serializePromptPresetFile } from "@/features/prompts/model/presetTransfer";

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("@/features/settings", () => ({ getPreferences: mocks.get, updatePreferences: mocks.save }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error, info: mocks.info } }));
import PromptPresetManagerDialog from "./PromptPresetManagerDialog";

const imported: PromptPreset = {
  id: "imported", title: "导入的电影预设", prompt: "傍晚海边", tags: ["风景"], priority: "high",
  sort_order: 1, createdAt: "2026-09-16", updatedAt: "2026-09-16",
};
const existing = { ...imported, id: "existing", title: "原有预设", prompt: "雨后街道" };

describe("prompt preset import dialog", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onPresetsChange = vi.fn();
  const button = (text: string) => [...document.querySelectorAll("button")].find(item => item.textContent?.trim() === text)!;
  const input = () => document.querySelector<HTMLInputElement>('input[aria-label="导入提示词预设文件"]')!;
  const rows = () => [...document.querySelectorAll(".preset-manager-item b")].map(item => item.textContent);
  async function render() {
    await act(async () => root.render(<PromptPresetManagerDialog open onOpenChange={vi.fn()} onPresetsChange={onPresetsChange} />));
  }
  async function chooseFile(text: string) {
    const file = new File([text], "提示词预设.json", { type: "application/json" });
    // jsdom's File does not implement Blob.text().
    Object.defineProperty(file, "text", { value: async () => text });
    await act(async () => {
      Object.defineProperty(input(), "files", { configurable: true, value: [file] });
      input().dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.get.mockResolvedValue({ canvas: { promptPresets: [existing] } });
    mocks.save.mockImplementation(async payload => payload);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it("opens the file picker, merges and persists the export file, then updates canvas presets", async () => {
    await render();
    const click = vi.spyOn(input(), "click");
    await act(async () => button("一键导入").click());
    expect(click).toHaveBeenCalledOnce();
    await chooseFile(serializePromptPresetFile([imported]));
    expect(mocks.save).toHaveBeenCalledWith({ canvas: { promptPresets: [existing, imported] } });
    expect(rows()).toEqual(expect.arrayContaining([existing.title, imported.title]));
    expect(document.querySelector<HTMLInputElement>(".preset-manager-editor input")?.value).toBe(imported.title);
    expect(onPresetsChange).toHaveBeenCalledWith([existing, imported]);
    expect(mocks.success).toHaveBeenCalledWith("已导入 1 条预设");
    expect(input().value).toBe("");

    await chooseFile(serializePromptPresetFile([imported]));
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.info).toHaveBeenCalledWith("文件中的预设已存在，无需重复导入");
  });

  it("reports an invalid file without changing or saving existing presets", async () => {
    await render();
    await chooseFile("{bad");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("有效的 JSON"));
    expect(rows()).toEqual([existing.title]);
    expect(button("一键导入").disabled).toBe(false);
    expect(onPresetsChange).not.toHaveBeenCalled();
  });

  it("blocks repeated imports while saving and retains existing presets on failure for a same-file retry", async () => {
    await render();
    let reject!: (error: Error) => void;
    mocks.save.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    await chooseFile(serializePromptPresetFile([imported]));
    expect(button("导入中…").disabled).toBe(true);
    expect(button("新建").disabled).toBe(true);
    expect(document.querySelector<HTMLTextAreaElement>(".preset-manager-editor textarea")?.disabled).toBe(true);
    await chooseFile(serializePromptPresetFile([imported]));
    expect(mocks.save).toHaveBeenCalledOnce();
    await act(async () => reject(new Error("保存失败，请重试")));
    expect(rows()).toEqual([existing.title]);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(onPresetsChange).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith("保存失败，请重试");
    await chooseFile(serializePromptPresetFile([imported]));
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(rows()).toContain(imported.title);
  });

  it("does not allow an import when the existing presets could not be loaded", async () => {
    mocks.get.mockRejectedValueOnce(new Error("读取失败"));
    await render();
    expect(button("一键导入").disabled).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
