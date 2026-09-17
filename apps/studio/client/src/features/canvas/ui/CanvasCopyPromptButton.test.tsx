// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { CanvasCopyPromptButton } from "./CanvasCopyPromptButton";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let originalCommand: typeof document.execCommand;
const prompt = "[文本1]\n生成一个冬天雪景：雪山、松林与湖泊。\n  保留缩进";
async function render(text = prompt) {
  await act(async () => root.render(<CanvasCopyPromptButton text={text} />));
}
async function click() { await act(async () => container.querySelector("button")!.click()); }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  originalCommand = document.execCommand;
  Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  if (originalCommand) Object.defineProperty(document, "execCommand", { configurable: true, value: originalCommand });
  else Reflect.deleteProperty(document, "execCommand");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("copies the current full prompt, confirms success, and resets feedback when its text changes", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await render();
  await click();
  expect(writeText).toHaveBeenCalledWith(prompt);
  expect(toast.success).toHaveBeenCalledWith("提示词已复制");
  expect(container.querySelector("button")!.title).toContain("已复制");
  await render("新提示词");
  expect(container.querySelector("button")!.title).toBe("一键复制提示词内容");
  await click();
  expect(writeText).toHaveBeenLastCalledWith("新提示词");
});

it.each([false, true])("uses the compatibility copy when async clipboard is missing or rejected (%s)", async rejected => {
  vi.stubGlobal("navigator", rejected ? { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } } : {});
  const copyCommand = vi.fn(() => {
    expect((document.activeElement as HTMLTextAreaElement).value).toBe(prompt);
    return true;
  });
  Object.defineProperty(document, "execCommand", { configurable: true, value: copyCommand });
  await render();
  container.querySelector("button")!.focus();
  await click();
  expect(copyCommand).toHaveBeenCalledWith("copy");
  expect(toast.success).toHaveBeenCalledWith("提示词已复制");
  expect(document.querySelector("textarea")).toBeNull();
  expect(document.activeElement).toBe(container.querySelector("button"));
});

it("reports copy failure instead of falsely claiming success or leaving an inert button", async () => {
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
  await render();
  await click();
  expect(toast.error).toHaveBeenCalledWith("复制失败，请选中提示词后按 Ctrl+C 复制");
  expect(toast.success).not.toHaveBeenCalled();
  expect(container.querySelector("button")!.disabled).toBe(false);
});

it("explains an empty prompt without writing to the clipboard", async () => {
  const writeText = vi.fn();
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await render("  \n  ");
  await click();
  expect(toast.info).toHaveBeenCalledWith("当前节点没有提示词");
  expect(writeText).not.toHaveBeenCalled();
});
