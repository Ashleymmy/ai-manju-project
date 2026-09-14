// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  catalog: { data: { models: ["a::gpt-5.6-luna", "b::gpt-5.6-luna", "b::text-real"], defaultModel: "b::text-real", labels: {}, providerNames: {} }, isPending: false, isFetching: false, error: null as Error | null, errorUpdatedAt: 0, refetch: vi.fn() },
  projects: { data: [], refetch: vi.fn(async () => ({ data: [] })), error: null },
  images: { data: null }, folders: { data: [] }, references: { data: [] }, batch: { data: null },
  analyze: vi.fn(), empty: vi.fn(), error: vi.fn(), success: vi.fn(),
}));
vi.mock("../model/queries", () => ({
  useComicTextModelsQuery: () => mocks.catalog, useComicProjectsQuery: () => mocks.projects,
  useComicImageModelsQuery: () => mocks.images, useComicFoldersQuery: () => mocks.folders,
  useComicReferenceAssetsQuery: () => mocks.references, useComicBatchQuery: () => mocks.batch,
}));
vi.mock("../controllers/source", () => ({ analyzeComicSource: mocks.analyze }));
vi.mock("../controllers/project", async importOriginal => ({ ...await importOriginal<object>(), createEmptyComicProject: mocks.empty }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: mocks.success, info: vi.fn() } }));

import { ComicAssetsView } from "./ComicAssetsView";

describe("comic creation uses the real catalog and analysis workflow", () => {
  let root: Root;
  let container: HTMLDivElement;
  const button = (text: string) => [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === text)!;
  async function render() { await act(async () => root.render(<ComicAssetsView />)); }
  async function open() { await render(); await act(async () => button("新建资产项目").click()); }
  async function setTitle(value: string) {
    await act(async () => {
      const input = container.querySelector('[role="dialog"] input[type="text"]') as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function setFile() {
    const file = new File(["人物：林默。"], "剧本.txt", { type: "text/plain" });
    await act(async () => {
      const input = container.querySelector("#script-file-input") as HTMLInputElement;
      Object.defineProperty(input, "files", { configurable: true, value: [file] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return file;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Element.prototype.scrollIntoView = vi.fn();
    mocks.catalog.data.models = ["a::gpt-5.6-luna", "b::gpt-5.6-luna", "b::text-real"];
    mocks.catalog.isPending = false; mocks.catalog.isFetching = false; mocks.catalog.error = null;
    mocks.catalog.refetch.mockResolvedValue({ data: mocks.catalog.data });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  it("loads actual model names once and sends the selected provider-qualified value to analysis", async () => {
    await open();
    expect(mocks.catalog.refetch).toHaveBeenCalledOnce();
    const trigger = container.querySelector('[role="combobox"][aria-label="分析模型"]') as HTMLButtonElement;
    expect(trigger.textContent).toBe("gpt-5.6-luna");
    expect(container.textContent).not.toContain("gpt-5.6-scl");
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect([...document.querySelectorAll('[role="option"]')].map(item => item.textContent)).toEqual(["gpt-5.6-luna", "text-real"]);
    await act(async () => (document.querySelectorAll('[role="option"]')[1] as HTMLElement).click());
    await setTitle("真实分析");
    const file = await setFile();
    let finish!: (value: unknown) => void;
    mocks.analyze.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => button("解析并预览").click());
    expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({ file, title: "真实分析", model: "b::text-real", scope: "personal" }));
    expect(mocks.empty).not.toHaveBeenCalled();
    expect(container.textContent).toContain("正在分析剧本…");
    expect(container.textContent).not.toMatch(/32 秒|17460|49%/);
    expect(button("处理中…").disabled).toBe(true);
    await act(async () => finish({ kind: "analysis", detail: {
      session: { id: "session-test", active_revision_id: "revision-test" },
      revisions: [{ id: "revision-test", revision_no: 1, candidate: { assets: [] } }],
    }, candidateCount: 0, truncated: false }));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector(".candidate-review")).not.toBeNull();
    expect(mocks.success).toHaveBeenCalledWith("已识别 0 项候选资产");
  });

  it.each(["loading", "empty", "error"])("never substitutes sample models when the catalog is %s", async state => {
    if (state === "loading") mocks.catalog.isPending = true;
    if (state === "empty") mocks.catalog.data.models = [];
    if (state === "error") mocks.catalog.error = new Error("unavailable");
    await open(); await setTitle("测试"); await setFile();
    const trigger = container.querySelector('[aria-label="分析模型"]') as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(button("解析并预览").disabled).toBe(true);
    expect(container.textContent).not.toContain("gpt-5.6-scl");
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("retains the form after a real failure without creating an empty project", async () => {
    mocks.analyze.mockRejectedValueOnce(new Error("当前模型暂时不可用"));
    await open(); await setTitle("保留草稿"); await setFile();
    await act(async () => button("解析并预览").click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect((container.querySelector('[role="dialog"] input[type="text"]') as HTMLInputElement).value).toBe("保留草稿");
    expect(container.textContent).toContain("剧本.txt");
    expect(button("解析并预览").disabled).toBe(false);
    expect(mocks.empty).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
  });

  it("creates an empty project only when that mode is explicitly selected", async () => {
    mocks.empty.mockResolvedValueOnce({ id: "project-test" });
    await open();
    await act(async () => button("创建空项目").click());
    await setTitle("空项目");
    await act(async () => [...container.querySelectorAll("button")].filter(item => item.textContent === "创建空项目").at(-1)!.click());
    expect(mocks.empty).toHaveBeenCalledWith({ title: "空项目", stylePreset: "" }, "personal");
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("imports the chosen workbook without requiring a text model", async () => {
    mocks.catalog.data.models = [];
    mocks.analyze.mockResolvedValueOnce({ kind: "project", detail: { project: { id: "imported", title: "资产表" }, assets: [] }, importedCount: 0 });
    await open();
    await act(async () => button("导入资产表").click());
    await setTitle("资产表");
    const file = new File(["workbook"], "资产.xlsx");
    await act(async () => {
      const input = container.querySelector("#workbook-file-input") as HTMLInputElement;
      Object.defineProperty(input, "files", { configurable: true, value: [file] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => [...container.querySelectorAll("button")].filter(item => item.textContent === "导入资产表").at(-1)!.click());
    expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({ file, title: "资产表" }));
    expect(mocks.empty).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
