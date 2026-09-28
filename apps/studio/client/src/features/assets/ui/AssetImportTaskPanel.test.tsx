// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ImportTask } from "../model/importTaskStorage";
import { AssetImportTaskPanel } from "./AssetImportTaskPanel";

const state = vi.hoisted(() => ({ task: null as ImportTask | null, preparing: false, error: "" }));
const manager = vi.hoisted(() => ({ pause: vi.fn(), resume: vi.fn(), discard: vi.fn() }));
vi.mock("../model/importTaskManager", () => ({ useImportTask: () => state, importTaskManager: manager }));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.task = null; state.preparing = false; state.error = "";
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function render(status?: ImportTask["status"]) {
  if (status) state.task = { id: "task", owner: "owner", name: "素材包.zip", size: 1024, scope: "personal", status,
    progress: { completed: 2, total: 3, phase: "导入素材", failures: status === "failed" ? [{ name: "未完成素材", error: "上传失败" }] : [] }, warnings: ["提示内容"] };
  await act(async () => root.render(<AssetImportTaskPanel />));
}
const button = (label: string) => Array.from(container.querySelectorAll("button")).find(element => (element.getAttribute("aria-label") || element.textContent) === label)!;

it.each(["running", "paused", "failed", "completed"] as const)("uses a compact export-style row for %s imports", async status => {
  await render(status);
  expect(container.querySelectorAll(".asset-transfer-row")).toHaveLength(1);
  expect(container.querySelector(".asset-transfer-header h3")?.textContent).toBe("导入任务 1");
  expect(container.querySelector(".asset-transfer-row-action .asset-transfer-delete")).not.toBeNull();
  expect(container.querySelector(".asset-import-summary")).toBeNull();
  expect(container.textContent).toContain("2/3 个资产");
  expect(container.textContent).toContain("1 KB");
  expect(container.querySelector("details")?.open).toBe(false);
  if (status === "running") {
    await act(async () => button("暂停导入").click()); expect(manager.pause).toHaveBeenCalledOnce();
  } else if (status !== "completed") {
    await act(async () => button(status === "failed" ? "重试未完成项" : "继续导入").click()); expect(manager.resume).toHaveBeenCalledOnce();
  } else expect(container.querySelector("progress")).toBeNull();
  if (status === "failed") expect(container.textContent).toContain("上传失败");
});

it("requires confirmation and preserves an unfinished task on cancel", async () => {
  await render("paused");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await act(async () => button("删除任务").click());
  expect(manager.discard).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  await act(async () => button("删除任务").click());
  expect(manager.discard).toHaveBeenCalledOnce();
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("已导入的素材会保留"));
});

it("shows empty, saving and storage-error states without losing the fixed shell", async () => {
  await render(); expect(container.textContent).toContain("暂无导入任务");
  state.preparing = true; await render("running");
  expect(button("删除任务").disabled).toBe(true);
  expect(button("暂停导入").disabled).toBe(true);
  state.error = "本地存储暂不可用"; await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(state.error);
});
