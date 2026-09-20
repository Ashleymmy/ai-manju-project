// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasAgentExecutionResult, CanvasAgentSnapshot } from "@/lib/canvas-agent";

const mocks = vi.hoisted(() => ({ fetchAiModels: vi.fn(), requestAiText: vi.fn() }));
vi.mock("@/services/api/ai", () => mocks);

import AgentPanel from "./AgentPanel";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const reply = (content: string) => ({ content, toolCalls: [] });
const toolReply = {
  content: "准备创建文本",
  toolCalls: ["first", "second"].map(id => ({
    id, type: "function", function: { name: "canvas_create_text_node", arguments: JSON.stringify({ text: id }) },
  })),
};
const snapshot: CanvasAgentSnapshot = {
  projectId: "interruption-project", title: "插话测试", nodes: [], connections: [],
  selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 },
};
const completedSnapshot: CanvasAgentSnapshot = {
  ...snapshot, nodes: [{ id: "created-node", type: "text", title: "已创建的文本", position: { x: 0, y: 0 }, width: 200, height: 120 }],
};

describe("AgentPanel interjections", () => {
  let root: Root;
  let container: HTMLDivElement;
  let onApplyOps: ReturnType<typeof vi.fn>;
  const textarea = () => container.querySelector("textarea")!;
  const sendButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="发送"]')!;
  const userMessages = () => [...container.querySelectorAll(".agent-msg-user p")].map(item => item.textContent);

  async function render(projectSnapshot = snapshot) {
    await act(async () => root.render(
      <AgentPanel projectId={projectSnapshot.projectId} open onClose={vi.fn()} snapshot={projectSnapshot}
        canUndoOps={false} onApplyOps={onApplyOps} onExecuteWorkspaceTool={vi.fn()} onUndoOps={vi.fn()} />
    ));
  }
  async function type(text: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea(), text);
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function key(options: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...options });
    await act(async () => textarea().dispatchEvent(event));
    return event;
  }
  async function send(text: string) {
    await type(text);
    await act(async () => sendButton().click());
  }
  async function approve() {
    await act(async () => container.querySelector<HTMLButtonElement>(".agent-pending-actions .vermilion-button")!.click());
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    localStorage.clear();
    mocks.fetchAiModels.mockReset().mockResolvedValue({
      agentTextModels: ["provider::gpt-5.5"], defaultTextModel: "provider::gpt-5.5", modelLabels: {}, modelProviderNames: {},
    });
    mocks.requestAiText.mockReset().mockResolvedValue(reply("收到补充"));
    onApplyOps = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("accepts Enter interjections with context, aborts the old request and ignores its late response", async () => {
    const first = deferred<ReturnType<typeof reply>>();
    const second = deferred<ReturnType<typeof reply>>();
    mocks.requestAiText.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await render();
    await send("规划分镜");
    expect(textarea().disabled).toBe(false);
    expect(container.querySelector(".agent-stop-btn")).not.toBeNull();
    await type("改成雨夜场景");
    expect(sendButton().disabled).toBe(false);
    await key();
    expect(mocks.requestAiText).toHaveBeenCalledTimes(2);
    expect(mocks.requestAiText.mock.calls[0][1].aborted).toBe(true);
    expect(mocks.requestAiText.mock.calls[1][1].aborted).toBe(false);
    expect(JSON.stringify(mocks.requestAiText.mock.calls[1][0].messages)).toContain("规划分镜");
    expect(JSON.stringify(mocks.requestAiText.mock.calls[1][0].messages)).toContain("改成雨夜场景");
    expect(userMessages()).toEqual(["规划分镜", "改成雨夜场景"]);
    expect(textarea().value).toBe("");
    await act(async () => first.resolve(reply("过时的回复")));
    expect(container.textContent).not.toContain("过时的回复");
    expect(container.querySelector(".agent-stop-btn")).not.toBeNull();
    await act(async () => second.resolve(reply("雨夜分镜")));
    expect(container.textContent).toContain("雨夜分镜");
    expect(container.querySelector(".agent-stop-btn")).toBeNull();
  });

  it("ignores an old failure while the new request is still running", async () => {
    const first = deferred<ReturnType<typeof reply>>();
    const second = deferred<ReturnType<typeof reply>>();
    mocks.requestAiText.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await render();
    await send("原要求");
    await send("补充要求");
    await act(async () => first.reject(new Error("旧请求失败")));
    expect(container.textContent).not.toContain("旧请求失败");
    expect(container.querySelector(".agent-stop-btn")).not.toBeNull();
    await act(async () => second.resolve(reply("新回复")));
    expect(container.textContent).toContain("新回复");
  });

  it("does not send empty input, Shift+Enter or the Enter used to confirm Chinese input", async () => {
    mocks.requestAiText.mockReturnValueOnce(new Promise(() => undefined));
    await render();
    await send("原要求");
    await key();
    await type("补充要求");
    expect((await key({ shiftKey: true })).defaultPrevented).toBe(false);
    expect((await key({ isComposing: true })).defaultPrevented).toBe(false);
    expect((await key({ keyCode: 229 })).defaultPrevented).toBe(false);
    expect(mocks.requestAiText).toHaveBeenCalledTimes(1);
    expect(textarea().value).toBe("补充要求");
  });

  it("accepts a change of instruction while awaiting tool approval without executing the old tools", async () => {
    mocks.requestAiText.mockResolvedValueOnce(toolReply);
    await render();
    await send("创建文本");
    expect(container.querySelector(".agent-pending-tool")).not.toBeNull();
    expect(textarea().disabled).toBe(false);
    await send("先不要创建，解释一下");
    expect(container.querySelector(".agent-pending-tool")).toBeNull();
    expect(onApplyOps).not.toHaveBeenCalled();
    expect(mocks.requestAiText).toHaveBeenCalledTimes(2);
    expect(userMessages()).toEqual(["创建文本", "先不要创建，解释一下"]);
  });

  it("finishes an in-flight canvas operation once, skips remaining tools and retains all rapid interjections", async () => {
    const execution = deferred<CanvasAgentExecutionResult>();
    onApplyOps.mockReturnValueOnce(execution.promise);
    mocks.requestAiText.mockResolvedValueOnce(toolReply);
    await render();
    await send("创建文本");
    await approve();
    expect(onApplyOps).toHaveBeenCalledTimes(1);
    await send("改成雨夜");
    await send("再加上追逐");
    expect(userMessages()).toEqual(["创建文本", "改成雨夜", "再加上追逐"]);
    expect(mocks.requestAiText).toHaveBeenCalledTimes(1);
    expect(textarea().disabled).toBe(false);
    await act(async () => execution.resolve({ snapshot: completedSnapshot, generationResults: [] }));
    expect(onApplyOps).toHaveBeenCalledTimes(1);
    expect(mocks.requestAiText).toHaveBeenCalledTimes(2);
    const context = JSON.stringify(mocks.requestAiText.mock.calls[1][0].messages);
    expect(context).toContain("改成雨夜");
    expect(context).toContain("再加上追逐");
    expect(context).toContain("created-node");
    expect(context).toContain("画布工具结果");
    expect(container.textContent).toContain("指令已中断，后续工具未执行");
    expect(container.textContent).toContain("收到补充");
  });

  it("keeps the stop action and preserves the unsent draft", async () => {
    const first = deferred<ReturnType<typeof reply>>();
    mocks.requestAiText.mockReturnValueOnce(first.promise);
    await render();
    await send("原要求");
    await type("还没写完的补充");
    await act(async () => container.querySelector<HTMLButtonElement>(".agent-stop-btn")!.click());
    expect(mocks.requestAiText.mock.calls[0][1].aborted).toBe(true);
    expect(textarea().value).toBe("还没写完的补充");
    expect(container.textContent).toContain("已中断当前指令");
    await act(async () => first.resolve(reply("过时的回复")));
    expect(container.textContent).not.toContain("过时的回复");
    await act(async () => sendButton().click());
    expect(mocks.requestAiText).toHaveBeenCalledTimes(2);
  });

  it("cancels a follow-up waiting for a tool when stopped", async () => {
    const execution = deferred<CanvasAgentExecutionResult>();
    onApplyOps.mockReturnValueOnce(execution.promise);
    mocks.requestAiText.mockResolvedValueOnce(toolReply);
    await render();
    await send("创建文本");
    await approve();
    await send("追加要求");
    await act(async () => container.querySelector<HTMLButtonElement>(".agent-stop-btn")!.click());
    await act(async () => execution.resolve({ snapshot: completedSnapshot, generationResults: [] }));
    expect(mocks.requestAiText).toHaveBeenCalledTimes(1);
    expect(onApplyOps).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".agent-stop-btn")).toBeNull();
    expect(userMessages()).toContain("追加要求");
  });

  it("does not leak an old tool result or queued interjection into a different project", async () => {
    const execution = deferred<CanvasAgentExecutionResult>();
    onApplyOps.mockReturnValueOnce(execution.promise);
    mocks.requestAiText.mockResolvedValueOnce(toolReply);
    await render();
    await send("创建文本");
    await approve();
    await send("旧项目的补充");
    const nextSnapshot = { ...snapshot, projectId: "another-project" };
    await render(nextSnapshot);
    await act(async () => execution.resolve({ snapshot: completedSnapshot, generationResults: [] }));
    expect(container.querySelector(".agent-msg-tool")).toBeNull();
    expect(userMessages()).toEqual([]);
    expect(mocks.requestAiText).toHaveBeenCalledTimes(1);
    await send("新项目的要求");
    const context = JSON.stringify(mocks.requestAiText.mock.calls[1][0].messages);
    expect(context).toContain("another-project");
    expect(context).not.toContain("created-node");
    expect(context).not.toContain("旧项目的补充");
  });
});
