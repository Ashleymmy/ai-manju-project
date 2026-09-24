// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetchAiModels: vi.fn(), requestAiText: vi.fn(), readAgentDocument: vi.fn(), sendLocalAgentTurn: vi.fn(), createLocalAgentSseClient: vi.fn(), error: vi.fn() }));
vi.mock("@/services/api/ai", () => ({ fetchAiModels: mocks.fetchAiModels, requestAiText: mocks.requestAiText }));
vi.mock("@/features/canvas/agent/readDocument", () => ({ readAgentDocument: mocks.readAgentDocument }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, warning: vi.fn(), success: vi.fn() } }));
vi.mock("@/features/canvas/agent", async original => ({ ...await original<object>(), sendLocalAgentTurn: mocks.sendLocalAgentTurn, createLocalAgentSseClient: mocks.createLocalAgentSseClient }));
import AgentPanel from "./AgentPanel";

let root: Root;
let container: HTMLDivElement;
const draft = () => container.querySelector('[aria-label="待发送文件"]');
async function render(projectId = "documents", mode: "canvas" | "studio" = "canvas") {
  await act(async () => root.render(mode === "studio"
    ? <AgentPanel projectId={projectId} mode="studio" open onClose={vi.fn()} />
    : <AgentPanel projectId={projectId} mode="canvas" open onClose={vi.fn()} snapshot={{ projectId, title: "Files", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }} canUndoOps={false} onApplyOps={vi.fn()} onExecuteWorkspaceTool={vi.fn()} onUndoOps={vi.fn()} />));
}
async function click(selector: string) { await act(async () => container.querySelector<HTMLButtonElement>(selector)!.click()); }
async function attach(names: string[]) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: names.map(name => new File(["fixture"], name)) });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function type(text: string) {
  await act(async () => {
    const input = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  localStorage.clear();
  mocks.error.mockReset();
  mocks.fetchAiModels.mockReset().mockResolvedValue({ textModels: ["test"], agentTextModels: ["test"], defaultTextModel: "test", modelLabels: {}, modelProviderNames: {} });
  mocks.requestAiText.mockReset().mockResolvedValue({ content: "已读取正文", toolCalls: [] });
  mocks.readAgentDocument.mockReset().mockImplementation(async file => `正文：${file.name}`);
  mocks.sendLocalAgentTurn.mockReset().mockResolvedValue({ threadId: "local-thread" });
  mocks.createLocalAgentSseClient.mockReset().mockImplementation(({ callbacks }) => { callbacks.onHello(); return { close: vi.fn() }; });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it.each(["canvas", "studio"] as const)("sends actual document text in %s, remembers it in follow-ups and saved history", async mode => {
  await render("documents", mode);
  await attach(["剧本.docx", "角色.xls", "需求.txt"]);
  expect(draft()?.querySelectorAll(".agent-document")).toHaveLength(3);
  expect(container.querySelector("textarea")?.value).toBe("");
  await click('[aria-label="发送"]');
  const request = JSON.stringify(mocks.requestAiText.mock.calls[0][0].messages.at(-1));
  for (const name of ["剧本.docx", "角色.xls", "需求.txt"]) expect(request).toContain(`正文：${name}`);
  expect(draft()).toBeNull();
  expect(container.querySelector('[aria-label="消息文件"]')).not.toBeNull();
  expect(localStorage.getItem("canvas-agent-conversations:documents")).toContain("正文：剧本.docx");
  await type("接着细化第二幕");
  await click('[aria-label="发送"]');
  expect(JSON.stringify(mocks.requestAiText.mock.calls[1][0].messages)).toContain("正文：角色.xls");
});

it("blocks pending/error files; removing them permits sending without missing attachments", async () => {
  let reject!: (error: Error) => void;
  mocks.readAgentDocument.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  await render();
  await type("阅读附件");
  await attach(["坏文件.docx"]);
  expect(container.querySelector<HTMLButtonElement>('[aria-label="发送"]')?.disabled).toBe(true);
  await act(async () => reject(new Error("文件损坏")));
  expect(draft()?.textContent).toContain("文件损坏");
  await click('[aria-label="发送"]');
  expect(mocks.requestAiText).not.toHaveBeenCalled();
  await click('[aria-label="移除文件：坏文件.docx"]');
  await click('[aria-label="发送"]');
  expect(mocks.requestAiText).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(mocks.requestAiText.mock.calls[0])).not.toContain("坏文件");
});

it.each(["remove", "project", "conversation", "unmount"])("cancels late parsing on %s", async action => {
  let resolve!: (value: string) => void;
  mocks.readAgentDocument.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await render(); await attach(["slow.docx"]);
  const signal = mocks.readAgentDocument.mock.calls[0][1] as AbortSignal;
  if (action === "remove") await click('[aria-label="移除文件：slow.docx"]');
  if (action === "project") await render("another");
  if (action === "conversation") { await click('[title="切换对话"]'); await click(".agent-thread-new"); }
  if (action === "unmount") await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
  await act(async () => resolve("must not appear"));
  expect(draft()).toBeNull();
  expect(container.textContent).not.toContain("must not appear");
});

it("enforces both file-count and combined text budgets", async () => {
  await render();
  await attach(Array.from({ length: 6 }, (_, i) => `${i}.txt`));
  expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("5 个"));
  expect(mocks.readAgentDocument).not.toHaveBeenCalled();
  mocks.readAgentDocument.mockResolvedValue("a".repeat(60_000));
  await attach(["a.txt", "b.txt", "c.txt"]);
  expect(draft()?.querySelectorAll(".is-ready")).toHaveLength(2);
  expect(draft()?.textContent).toContain("120,000");
});

it("exposes document upload in the global Agent and previews without interpreting HTML", async () => {
  mocks.readAgentDocument.mockResolvedValue('<script>alert("unsafe")</script>');
  await render("documents", "studio");
  await click(".agent-icon-btn");
  expect(container.querySelector(".agent-plus-menu")?.textContent).toContain("上传附件");
  await attach(["hello.txt"]);
  expect(draft()?.querySelector("script")).toBeNull();
  expect(draft()?.querySelector("pre")?.textContent).toContain("<script>");
});

it("does not copy a previous project's saved documents into a new project", async () => {
  await render("first");
  await attach(["private.txt"]);
  await click('[aria-label="发送"]');
  await render("second");
  expect(localStorage.getItem("canvas-agent-conversations:second")).toBeNull();
  expect(localStorage.getItem("canvas-agent-conversations:first")).toContain("正文：private.txt");
});
