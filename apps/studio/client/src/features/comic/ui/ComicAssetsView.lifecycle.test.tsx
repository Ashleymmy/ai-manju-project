// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComicAsset, ComicAssetProject, ComicBatchDetail, ComicProjectDetail } from "@/entities/comic";

const mocks = vi.hoisted(() => ({
  token: "account-one",
  projects: { data: [] as ComicAssetProject[], refetch: vi.fn(), error: null },
  text: { data: { models: ["provider::text"], defaultModel: "provider::text" }, refetch: vi.fn(), error: null },
  images: { data: { models: ["provider::image"], defaultModel: "provider::image" }, error: null },
  batch: { data: null as ComicBatchDetail | null, refetch: vi.fn(), error: null, isFetching: false },
  load: vi.fn(), latestBatch: vi.fn(), rename: vi.fn(), removeProject: vi.fn(),
  createAsset: vi.fn(), removeAsset: vi.fn(), saveAsset: vi.fn(), preview: vi.fn(),
  optimize: vi.fn(), approve: vi.fn(), bulkApprove: vi.fn(),
  createBatch: vi.fn(), control: vi.fn(), retryItem: vi.fn(), retryFailed: vi.fn(),
  history: vi.fn(), resumeAnalysis: vi.fn(),
  success: vi.fn(), error: vi.fn(), warning: vi.fn(),
}));

vi.mock("@/shared/api/http", async original => ({
  ...await original<object>(), getAuthToken: () => mocks.token,
}));
vi.mock("@/entities/comic", async original => ({
  ...await original<object>(), listComicAnalysisHistory: mocks.history, resumeComicAnalysis: mocks.resumeAnalysis,
}));
vi.mock("../model/queries", () => ({
  useComicProjectsQuery: () => mocks.projects,
  useComicTextModelsQuery: () => mocks.text,
  useComicImageModelsQuery: () => mocks.images,
  useComicFoldersQuery: () => ({ data: [] }),
  useComicReferenceAssetsQuery: () => ({ data: [] }),
  useComicBatchQuery: () => mocks.batch,
}));
vi.mock("../controllers/project", () => ({
  loadComicProject: mocks.load, renameComicProject: mocks.rename,
  removeComicProject: mocks.removeProject, downloadComicSource: vi.fn(),
  createEmptyComicProject: vi.fn(),
}));
vi.mock("../controllers/assets", () => ({
  createComicProjectAsset: mocks.createAsset, removeComicProjectAsset: mocks.removeAsset,
  saveComicAssetDraft: mocks.saveAsset, loadComicPromptTemplate: mocks.preview,
  optimizeComicAssetPrompt: mocks.optimize, approveComicAssetPrompt: mocks.approve,
  approveComicAssetPrompts: mocks.bulkApprove,
}));
vi.mock("../controllers/batch", () => ({
  loadLatestComicBatch: mocks.latestBatch, createComicGenerationBatch: mocks.createBatch,
  changeComicBatchState: mocks.control, retryComicGenerationItem: mocks.retryItem,
  retryFailedComicGenerationItems: mocks.retryFailed,
}));
vi.mock("sonner", () => ({ toast: {
  success: mocks.success, error: mocks.error, warning: mocks.warning, info: vi.fn(), message: vi.fn(),
} }));
vi.mock("@/features/member", () => ({ GenerationPrice: () => <span>报价</span> }));
// Keep the parent handlers under test; child polling/image loading is unrelated
// to which project owns a completed operation.
vi.mock("./ComicBatchPanel", () => ({ ComicBatchPanel: (props: {
  detail: ComicBatchDetail; busy: boolean;
  onControl: (action: "pause" | "resume" | "stop") => void;
  onRetryFailed: () => void; onRetryItem: (id: string) => void;
}) => <section data-testid="batch" data-batch={props.detail.batch.id} data-status={props.detail.batch.status}>
  <span>{props.detail.batch.id}</span>
  <button disabled={props.busy} onClick={() => props.onControl("pause")}>暂停测试批次</button>
  <button disabled={props.busy} onClick={props.onRetryFailed}>重试失败测试项</button>
  <button disabled={props.busy} onClick={() => props.onRetryItem("item-old")}>重试测试单项</button>
</section> }));

import { ComicAssetsView } from "./ComicAssetsView";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function asset(projectId: string, id = `${projectId}-asset`, name = `${projectId}资产`): ComicAsset {
  return {
    id, project_id: projectId, name, code: id, class: "character", state: "初始",
    description: "", visual_description: "设定", change_request: "", source_prompt: "原提示词",
    prompt_template: "", archive_status: "", draft_prompt: "草稿提示词", approved_prompt: "",
    prompt_status: "needs_review", prompt_version: 1, output_version: 0,
  };
}

function project(id: string): ComicProjectDetail {
  return {
    project: { id, title: `${id}项目`, style_preset: "", created_at: "", updated_at: "" },
    assets: [asset(id)],
  };
}

function batch(projectId: string, id = `${projectId}-batch`): ComicBatchDetail {
  return {
    batch: {
      id, project_id: projectId, status: "running", model_selector: "provider::image", model: "image",
      size: "auto", quality: "auto", concurrency: 1, total: 1, pending: 0, active: 1,
      succeeded: 0, failed: 0, canceled: 0, created_at: "", updated_at: "",
    },
    items: [],
  };
}

describe("comic asset view operation ownership", () => {
  let root: Root;
  let container: HTMLDivElement;
  let oldProject: ComicProjectDetail;
  let newProject: ComicProjectDetail;

  function button(text: string, within: ParentNode = container) {
    const found = [...within.querySelectorAll("button")].find(item => item.textContent?.trim() === text);
    expect(found, `button ${text}`).toBeDefined();
    return found!;
  }
  function row(name: string) {
    const found = [...container.querySelectorAll(".comic-asset-row")].find(item => item.querySelector("b")?.textContent === name);
    expect(found, `asset row ${name}`).toBeDefined();
    return found!;
  }
  async function click(text: string, within: ParentNode = container) {
    await act(async () => button(text, within).click());
  }
  async function render() { await act(async () => root.render(<ComicAssetsView />)); }
  async function open(id: string) { await click(`${id}项目`); }
  function expectNewProject() {
    expect(container.querySelector(".batch-header h2")?.textContent).toBe("new项目");
    expect(container.querySelector(".comic-asset-row b")?.textContent).toBe("new资产");
    expect(container.querySelector('[data-testid="batch"]')?.getAttribute("data-batch")).toBe("new-batch");
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(window, "prompt").mockReturnValue("新增资产");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    Element.prototype.scrollIntoView = vi.fn();
    mocks.token = "account-one";
    oldProject = project("old"); newProject = project("new");
    mocks.projects.data = [oldProject.project, newProject.project];
    mocks.projects.refetch.mockResolvedValue({ data: mocks.projects.data });
    mocks.text.refetch.mockResolvedValue({ data: mocks.text.data });
    mocks.load.mockImplementation(async (id: string) => id === "old" ? oldProject : newProject);
    mocks.latestBatch.mockImplementation(async (id: string) => batch(id));
    mocks.batch.data = null;
    mocks.history.mockResolvedValue({ items: [{ id: "recovered-session", title: "待恢复分析", source_file_name: "source.txt", status: "active", created_at: "2026-09-26T00:00:00Z" }] });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it.each([
    ["create asset", "新建资产", "createAsset"],
    ["delete asset", "删除", "removeAsset"],
    ["delete project", "删除项目", "removeProject"],
  ] as const)("does not apply late %s to the newly opened project", async (_name, label, mockName) => {
    const pending = deferred<ComicAsset | undefined>();
    mocks[mockName].mockReturnValueOnce(pending.promise);
    await render(); await open("old"); await click(label);
    expect(mocks[mockName]).toHaveBeenCalledOnce();
    await open("new"); mocks.success.mockClear();
    await act(async () => pending.resolve(asset("old", "old-created", "旧请求新增资产")));
    expectNewProject();
    expect(container.textContent).not.toContain("旧请求新增资产");
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it.each([
    ["save draft", "保存草稿", "saveAsset"],
    ["save and approve", "保存并确认", "saveAsset"],
    ["approve prompt", "确认", "approve"],
    ["bulk approve", "批量确认提示词", "bulkApprove"],
    ["create batch", "创建批量生成", "createBatch"],
    ["control batch", "暂停测试批次", "control"],
    ["retry item", "重试测试单项", "retryItem"],
    ["retry failed", "重试失败测试项", "retryFailed"],
  ] as const)("keeps the new project's pending operation busy after old %s completes", async (_name, label, mockName) => {
    const oldPending = deferred<unknown>();
    const currentPending = deferred<unknown>();
    mocks[mockName].mockReturnValueOnce(oldPending.promise);
    mocks.optimize.mockReturnValueOnce(currentPending.promise);
    if (mockName === "createBatch") oldProject.assets[0].prompt_status = "approved";
    await render(); await open("old");
    if (mockName === "saveAsset") await click("编辑", row("old资产"));
    await click(label);
    expect(mocks[mockName]).toHaveBeenCalledOnce();
    await open("new"); await click("优化", row("new资产"));
    expect(mocks.optimize).toHaveBeenCalledOnce();
    expect(button("编辑", row("new资产")).disabled).toBe(true);
    mocks.success.mockClear();
    const oldAsset = asset("old", "old-asset", "旧请求返回资产");
    const value = mockName === "saveAsset" || mockName === "approve" ? oldAsset
      : mockName === "bulkApprove" ? { results: [{ ok: true, asset: oldAsset }] }
      : batch("old", "late-old-batch");
    await act(async () => oldPending.resolve(value));
    expectNewProject();
    expect(button("编辑", row("new资产")).disabled).toBe(true);
    expect(mocks.success).not.toHaveBeenCalled();
    await act(async () => currentPending.resolve({ asset: asset("new") }));
    expect(button("编辑", row("new资产")).disabled).toBe(false);
  });

  it("ignores a rejected old operation instead of displaying its error over a new project", async () => {
    const pending = deferred<ComicAsset>();
    mocks.createAsset.mockReturnValueOnce(pending.promise);
    await render(); await open("old"); await click("新建资产"); await open("new");
    await act(async () => pending.reject(new Error("旧项目创建失败")));
    expectNewProject();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("does not let a late rename refresh replace the current project", async () => {
    const refresh = deferred<{ data: ComicAssetProject[] }>();
    mocks.rename.mockResolvedValueOnce(undefined);
    mocks.projects.refetch.mockReturnValueOnce(refresh.promise);
    await render(); await open("old"); await click("重命名");
    expect(mocks.projects.refetch).toHaveBeenCalledOnce();
    await open("new"); mocks.success.mockClear();
    await act(async () => refresh.resolve({ data: mocks.projects.data }));
    expectNewProject();
    expect(mocks.load.mock.calls.filter(([id]) => id === "old")).toHaveLength(1);
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("ignores an old project's late latest-batch result", async () => {
    const pending = deferred<ComicBatchDetail>();
    mocks.latestBatch.mockImplementation((id: string) => id === "old" ? pending.promise : Promise.resolve(batch(id)));
    await render(); await open("old"); await open("new");
    await act(async () => pending.resolve(batch("old", "late-old-batch")));
    expectNewProject();
  });

  it("ignores the old project's refresh that was started by batch completion", async () => {
    const pending = deferred<ComicProjectDetail>();
    let oldLoads = 0;
    mocks.load.mockImplementation((id: string) => {
      if (id !== "old") return Promise.resolve(newProject);
      return ++oldLoads === 1 ? Promise.resolve(oldProject) : pending.promise;
    });
    mocks.latestBatch.mockImplementation(async (id: string) => {
      const result = batch(id);
      if (id === "old") result.batch.succeeded = 1;
      return result;
    });
    await render(); await open("old");
    expect(oldLoads).toBe(2);
    await open("new");
    await act(async () => pending.resolve({ ...oldProject, project: { ...oldProject.project, title: "旧项目延迟刷新" } }));
    expectNewProject();
    expect(container.textContent).not.toContain("旧项目延迟刷新");
  });

  it("does not apply an operation result after the authenticated account changes", async () => {
    const pending = deferred<ComicAsset>();
    mocks.createAsset.mockReturnValueOnce(pending.promise);
    await render(); await open("old"); await click("新建资产");
    mocks.token = "account-two";
    await render();
    await act(async () => pending.resolve(asset("old", "previous-account-asset", "旧账号创建资产")));
    expect(container.textContent).not.toContain("旧账号创建资产");
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("keeps a newly created asset editor when an older asset's template preview finishes", async () => {
    const pending = deferred<{ template: string; warnings: string[]; blockers: string[] }>();
    mocks.preview.mockReturnValueOnce(pending.promise);
    mocks.createAsset.mockResolvedValueOnce(asset("old", "new-draft", "新建编辑资产"));
    await render(); await open("old"); await click("模板", row("old资产"));
    await click("新建资产");
    const editor = row("新建编辑资产").querySelector(".comic-prompt-editor") as HTMLTextAreaElement;
    expect(editor).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, "用户正在编辑的新草稿");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mocks.success.mockClear();
    await act(async () => pending.resolve({ template: "旧资产延迟模板", warnings: [], blockers: [] }));
    expect(row("old资产").querySelector(".comic-asset-editor")).toBeNull();
    expect((row("新建编辑资产").querySelector(".comic-prompt-editor") as HTMLTextAreaElement)?.value).toBe("用户正在编辑的新草稿");
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("does not clear a newer busy operation in the same project", async () => {
    const template = deferred<{ template: string; warnings: string[]; blockers: string[] }>();
    const approval = deferred<{ results: Array<{ ok: boolean; asset: ComicAsset }> }>();
    mocks.preview.mockReturnValueOnce(template.promise);
    mocks.bulkApprove.mockReturnValueOnce(approval.promise);
    await render(); await open("old"); await click("模板", row("old资产"));
    // Bulk approval remains available while another row operation is pending.
    await click("批量确认提示词");
    expect(mocks.bulkApprove).toHaveBeenCalledOnce();
    await act(async () => template.resolve({ template: "模板结果", warnings: [], blockers: [] }));
    expect(button("批量确认提示词").disabled).toBe(true);
    expect(button("优化", row("old资产")).disabled).toBe(true);
    await act(async () => approval.resolve({ results: [{ ok: true, asset: asset("old") }] }));
    expect(button("批量确认提示词").disabled).toBe(false);
    expect(button("优化", row("old资产")).disabled).toBe(false);
  });

  it("does not replace a draft typed after requesting its template", async () => {
    const pending = deferred<{ template: string; warnings: string[]; blockers: string[] }>();
    mocks.preview.mockReturnValueOnce(pending.promise);
    await render(); await open("old"); await click("编辑", row("old资产"));
    await click("模板", row("old资产"));
    const editor = row("old资产").querySelector(".comic-prompt-editor") as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, "用户后输入的草稿");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mocks.success.mockClear();
    await act(async () => pending.resolve({ template: "旧模板", warnings: [], blockers: [] }));
    expect((row("old资产").querySelector(".comic-prompt-editor") as HTMLTextAreaElement).value).toBe("用户后输入的草稿");
    expect(mocks.success).not.toHaveBeenCalled();
    expect(button("优化", row("old资产")).disabled).toBe(false);
  });

  it("keeps an older pending operation busy when the newer operation finishes first", async () => {
    const template = deferred<{ template: string; warnings: string[]; blockers: string[] }>();
    const approval = deferred<{ results: Array<{ ok: boolean; asset: ComicAsset }> }>();
    mocks.preview.mockReturnValueOnce(template.promise);
    mocks.bulkApprove.mockReturnValueOnce(approval.promise);
    await render(); await open("old"); await click("模板", row("old资产"));
    await click("批量确认提示词");
    await act(async () => approval.resolve({ results: [{ ok: true, asset: asset("old") }] }));
    expect(button("优化", row("old资产")).disabled).toBe(true);
    await act(async () => template.resolve({ template: "模板结果", warnings: [], blockers: [] }));
    expect(button("优化", row("old资产")).disabled).toBe(false);
  });

  it("does not let a pending latest-batch read replace a newly created batch", async () => {
    const latest = deferred<ComicBatchDetail>();
    const created = deferred<ComicBatchDetail>();
    oldProject.assets[0].prompt_status = "approved";
    mocks.latestBatch.mockReturnValueOnce(latest.promise);
    mocks.createBatch.mockReturnValueOnce(created.promise);
    await render(); await open("old"); await click("创建批量生成");
    await act(async () => created.resolve(batch("old", "newly-created-batch")));
    await act(async () => latest.resolve(batch("old", "outdated-batch")));
    expect(container.querySelector('[data-testid="batch"]')?.getAttribute("data-batch")).toBe("newly-created-batch");
  });

  it("preserves edits made while an earlier save is pending", async () => {
    const saved = deferred<ComicAsset>();
    mocks.saveAsset.mockReturnValueOnce(saved.promise);
    await render(); await open("old"); await click("编辑", row("old资产")); await click("保存草稿");
    const editor = row("old资产").querySelector(".comic-prompt-editor") as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, "保存之后的新修改");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => saved.resolve(asset("old")));
    expect((row("old资产").querySelector(".comic-prompt-editor") as HTMLTextAreaElement).value).toBe("保存之后的新修改");
    expect(button("保存草稿").disabled).toBe(false);
  });

  it("still applies a save that belongs to the current project and editor", async () => {
    const pending = deferred<ComicAsset>();
    mocks.saveAsset.mockReturnValueOnce(pending.promise);
    await render(); await open("old"); await click("编辑", row("old资产")); await click("保存草稿");
    await act(async () => pending.resolve(asset("old", "old-asset", "保存后的资产")));
    expect(row("保存后的资产").querySelector(".comic-asset-editor")).toBeNull();
    expect(button("编辑", row("保存后的资产")).disabled).toBe(false);
    expect(mocks.success).toHaveBeenCalledWith("资产草稿已保存");
  });

  it("still updates the current batch when its control request completes", async () => {
    const pending = deferred<ComicBatchDetail>();
    mocks.control.mockReturnValueOnce(pending.promise);
    await render(); await open("old"); await click("暂停测试批次");
    const updated = batch("old");
    updated.batch.status = "paused";
    await act(async () => pending.resolve(updated));
    expect(container.querySelector('[data-testid="batch"]')?.getAttribute("data-status")).toBe("paused");
    expect(button("暂停测试批次").disabled).toBe(false);
  });

  it("does not open a recovered confirmed project after the history panel closes during its detail load", async () => {
    const pending = deferred<ComicProjectDetail>();
    mocks.resumeAnalysis.mockResolvedValueOnce({ session: { id: "recovered-session", status: "confirmed", project_id: "old" }, revisions: [] });
    await render(); await open("new");
    mocks.load.mockImplementationOnce(() => pending.promise);
    await click("找回分析记录"); await click("继续查看");
    expect(mocks.load).toHaveBeenLastCalledWith("old", "personal");
    await click("收起记录");
    await act(async () => pending.resolve(oldProject));
    expectNewProject();
  });

  it("aborts recovery when the same project is opened again", async () => {
    const pending = deferred<unknown>();
    mocks.resumeAnalysis.mockReturnValueOnce(pending.promise);
    await render(); await open("old"); await click("找回分析记录"); await click("继续查看");
    const signal = mocks.resumeAnalysis.mock.calls[0][2] as AbortSignal;
    await open("old");
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve({ session: { id: "recovered-session", status: "active" }, revisions: [] }));
    expect(container.querySelector(".candidate-review")).toBeNull();
    expect(container.querySelector(".batch-header h2")?.textContent).toBe("old项目");
  });
});
