// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptPreset } from "@/entities/prompt";
import { MAX_PROMPT_PRESET_FILE_BYTES, parsePromptPresetFile, serializePromptPresetFile } from "@/features/prompts/model/presetTransfer";

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), system: vi.fn(), download: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("@/features/settings", () => ({ getPreferences: mocks.get, updatePreferences: mocks.save }));
vi.mock("@/entities/prompt", () => ({ listAllSystemPrompts: mocks.system }));
vi.mock("file-saver", () => ({ saveAs: mocks.download }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error, info: mocks.info } }));
import PromptLibraryDialog from "./PromptLibraryDialog";

const imported: PromptPreset = {
  id: "imported", title: "电影光影", prompt: "傍晚海边\n保持人物造型", tags: ["风景"], priority: "high",
  sort_order: 1, createdAt: "2026-09-20", updatedAt: "2026-09-20",
};
const existing = { ...imported, id: "existing", title: "原有预设", prompt: "雨后街道" };

describe("canvas prompt library file transfer", () => {
  let root: Root;
  let container: HTMLDivElement;
  let stored: PromptPreset[];
  const onSelect = vi.fn();
  const onOpenChange = vi.fn();
  const button = (text: string) => [...document.querySelectorAll("button")].find(item => item.textContent?.trim() === text)!;
  const input = () => document.querySelector<HTMLInputElement>('input[aria-label="导入提示词预设文件"]')!;
  const rows = () => [...document.querySelectorAll(".preset-item b")].map(item => item.textContent);
  async function render(open = true) {
    await act(async () => root.render(<PromptLibraryDialog open={open} onOpenChange={onOpenChange} onSelect={onSelect} />));
  }
  async function chooseFile(text: string, size?: number) {
    const file = new File([text], "预设.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => text });
    if (size) Object.defineProperty(file, "size", { value: size });
    await act(async () => {
      Object.defineProperty(input(), "files", { configurable: true, value: [file] });
      input().dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  const readBlob = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    stored = [existing];
    mocks.system.mockResolvedValue([]);
    mocks.get.mockImplementation(async () => ({ canvas: { promptPresets: stored } }));
    mocks.save.mockImplementation(async payload => { stored = payload.canvas.promptPresets; return payload; });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("imports through the picker, persists, deduplicates, reopens and applies the preset to a node", async () => {
    await render();
    const click = vi.spyOn(input(), "click");
    await act(async () => button("一键导入").click());
    expect(click).toHaveBeenCalledOnce();
    await chooseFile(serializePromptPresetFile([imported]));
    expect(mocks.save).toHaveBeenCalledWith({ canvas: { promptPresets: [existing, imported] } });
    expect(rows()).toEqual(expect.arrayContaining([existing.title, imported.title]));
    await act(async () => button("使用预设").click());
    expect(onSelect).toHaveBeenCalledWith(imported.prompt);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await render(false);
    await render();
    expect(rows()).toContain(imported.title);
    await chooseFile(serializePromptPresetFile([imported]));
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.info).toHaveBeenCalledWith("文件中的预设已存在，无需重复导入");
    expect(input().value).toBe("");
  });

  it("downloads a full round-trippable library even while search filters the list", async () => {
    stored = [existing, imported];
    await render();
    const search = document.querySelector<HTMLInputElement>('input[placeholder="搜索标题、正文或标签"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, existing.title);
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(rows()).toEqual([existing.title]);
    await act(async () => button("一键导出").click());
    expect(mocks.download).toHaveBeenCalledOnce();
    const [blob, name] = mocks.download.mock.calls[0];
    expect(name).toMatch(/^提示词预设-\d{4}-\d{2}-\d{2}\.json$/);
    expect(parsePromptPresetFile(await readBlob(blob))).toEqual([existing, imported]);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([
    ["{broken", undefined, "有效的 JSON"],
    [serializePromptPresetFile([imported]), MAX_PROMPT_PRESET_FILE_BYTES + 1, "2 MB"],
  ])("rejects invalid or oversized files without saving", async (text, size, message) => {
    await render();
    await chooseFile(text, size);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(rows()).toEqual([existing.title]);
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining(message));
    expect(button("一键导入").disabled).toBe(false);
  });

  it("locks edits while saving and retains existing presets after failure so the same file can retry", async () => {
    await render();
    let reject!: (error: Error) => void;
    mocks.save.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    await chooseFile(serializePromptPresetFile([imported]));
    expect(button("导入中…").disabled).toBe(true);
    expect(button("新建预设").disabled).toBe(true);
    expect(document.querySelector<HTMLTextAreaElement>(".prompt-library-personal-editor textarea")?.disabled).toBe(true);
    await chooseFile(serializePromptPresetFile([imported]));
    expect(mocks.save).toHaveBeenCalledOnce();
    await act(async () => reject(new Error("保存失败")));
    expect(rows()).toEqual([existing.title]);
    expect(mocks.success).not.toHaveBeenCalled();
    await chooseFile(serializePromptPresetFile([imported]));
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(rows()).toContain(imported.title);
  });

  it("blocks import when personal preferences fail to load even if the public library loads", async () => {
    mocks.get.mockRejectedValueOnce(new Error("读取失败"));
    await render();
    expect(button("一键导入").disabled).toBe(true);
    expect(button("一键导出").disabled).toBe(true);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("读取失败");
    await act(async () => button("重新加载").click());
    expect(button("一键导入").disabled).toBe(false);
    expect(rows()).toEqual([existing.title]);
  });

  it("allows importing into an empty library and refuses to export incomplete drafts", async () => {
    stored = [];
    await render();
    expect(button("一键导出").disabled).toBe(true);
    expect(button("一键导入").disabled).toBe(false);
    await chooseFile(serializePromptPresetFile([imported]));
    expect(stored).toEqual([imported]);
    await act(async () => button("新建预设").click());
    await act(async () => button("一键导出").click());
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
  });
});
