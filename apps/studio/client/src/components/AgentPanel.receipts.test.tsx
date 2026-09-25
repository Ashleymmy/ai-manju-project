// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentConversationScopeKey, type AgentTextReceipt } from "@/features/canvas/agent/textReceipt";
import { agentConversationStorageKey, persistAgentConversations } from "@/features/canvas/agent/conversationRepository";

const mocks = vi.hoisted(() => ({ fetchAiModels: vi.fn(), requestAiText: vi.fn() }));
vi.mock("@/services/api/ai", () => mocks);
import AgentPanel from "./AgentPanel";

const owner = { userId: "one", projectId: "project", scope: "personal" as const };
const storageKey = agentConversationStorageKey(agentConversationScopeKey(owner));
const snapshot = { projectId: "project", title: "Test", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
const toolReply = { content: "模型操作建议", toolCalls: [{ id: "tool-1", type: "function", function: { name: "canvas_create_text_node", arguments: '{"text":"hello"}' } }] };
const stored = () => JSON.parse(localStorage.getItem(storageKey) || "[]");
const receipts = () => stored().flatMap((c: { messages: { receipt?: AgentTextReceipt }[] }) => c.messages.flatMap(m => m.receipt ? [m.receipt] : []));

describe("Agent durable reply recovery", () => {
  let root: Root;
  let container: HTMLDivElement;
  let apply: ReturnType<typeof vi.fn>;
  let workspaceTool: ReturnType<typeof vi.fn>;
  async function render(userId = "one", scope: "personal" | "team" = "personal") {
    await act(async () => root.render(<AgentPanel userId={userId} projectId="project" assetScope={scope}
      open onClose={vi.fn()} snapshot={snapshot} canUndoOps={false} onApplyOps={apply}
      onExecuteWorkspaceTool={workspaceTool} onUndoOps={vi.fn()} />));
  }
  async function click(selector: string) { await act(async () => container.querySelector<HTMLButtonElement>(selector)!.click()); }
  async function send(text = "请继续") {
    await act(async () => {
      const input = container.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click('[aria-label="发送"]');
  }
  async function history() {
    await click(".agent-thread-trigger");
    await click(".agent-thread-item-main");
  }
  function seed(overrides: Partial<AgentTextReceipt> = {}) {
    const receipt: AgentTextReceipt = { ...owner, version: 1, key: "original-key", conversationId: "conversation", model: "gone-model", state: "pending", ...overrides };
    persistAgentConversations(agentConversationScopeKey(owner), [{ id: "conversation", title: "原对话", updatedAt: 1,
      messages: [{ id: "original-assistant", role: "assistant", text: "等待回复", receipt }] }]);
  }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    localStorage.clear();
    mocks.fetchAiModels.mockReset().mockResolvedValue({ agentTextModels: ["provider::model"], textModels: ["provider::model"], modelLabels: {}, modelProviderNames: {} });
    mocks.requestAiText.mockReset().mockResolvedValue({ content: "原回复内容", toolCalls: [] });
    apply = vi.fn(); workspaceTool = vi.fn();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("persists the exact scoped receipt before the first paid request", async () => {
    mocks.requestAiText.mockImplementation(async (_body, _signal, _waiting, receipt) => {
      expect(receipts()).toContainEqual(expect.objectContaining({ ...owner, key: receipt.key, state: "pending" }));
      expect(receipt).toEqual({ key: expect.any(String), scope: "personal" });
      return { content: "成功", toolCalls: [] };
    });
    await render(); await send();
    expect(mocks.requestAiText).toHaveBeenCalledTimes(1);
    expect(receipts()[0].state).toBe("received");
  });

  it("saves tools started before applying operations and creates a distinct receipt for the next model step", async () => {
    mocks.fetchAiModels.mockResolvedValue({ agentTextModels: ["provider::model", "provider::second"],
      defaultTextModel: "provider::model", textModels: ["provider::model", "provider::second"], modelLabels: {}, modelProviderNames: {} });
    mocks.requestAiText.mockImplementationOnce(async () => toolReply).mockImplementationOnce(async (body, _signal, _waiting, receipt) => {
      expect(body.model).toBe("provider::second");
      expect(receipts()).toContainEqual(expect.objectContaining({ key: receipt.key, state: "pending", model: "provider::second" }));
      return { content: "工具完成后的回复", toolCalls: [] };
    });
    apply.mockImplementation(async () => {
      expect(receipts()).toContainEqual(expect.objectContaining({ state: "received", tools: "started" }));
      return { snapshot: { ...snapshot, nodes: [{ id: "created", type: "text", position: { x: 0, y: 0 }, width: 200, height: 120 }] }, generationResults: [] };
    });
    await render(); await send("创建文本");
    const firstKey = mocks.requestAiText.mock.calls[0][3].key;
    await click(".agent-model-selector");
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>(".agent-model-item")]
      .find(item => item.textContent?.includes("second"))!.click());
    await click(".agent-pending-actions .vermilion-button");
    expect(apply).toHaveBeenCalledTimes(1);
    expect(mocks.requestAiText).toHaveBeenCalledTimes(2);
    expect(mocks.requestAiText.mock.calls[1][3].key).not.toBe(firstKey);
    expect(mocks.requestAiText.mock.calls[1][3].recoverOnly).toBeUndefined();
    expect(receipts()[0]).toMatchObject({ state: "received", model: "provider::second" });
  });

  it("does not execute approved operations if the tools-started marker cannot be saved", async () => {
    mocks.requestAiText.mockResolvedValue(toolReply);
    await render(); await send("创建文本");
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === storageKey && value.includes('"tools":"started"')) throw new Error("quota");
      return originalSet.call(this, key, value);
    });
    await click(".agent-pending-actions .vermilion-button");
    expect(apply).not.toHaveBeenCalled();
    expect(workspaceTool).not.toHaveBeenCalled();
    expect(mocks.requestAiText).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("对话保存未完成");
    expect(receipts()[0]).toMatchObject({ state: "received", tools: "suggested" });
  });

  it("does not resume started tools on reload", async () => {
    seed({ state: "received", tools: "started" });
    await render(); await history();
    expect(mocks.requestAiText).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(workspaceTool).not.toHaveBeenCalled();
    expect(container.querySelector(".agent-recover-reply")).toBeNull();
    expect(container.querySelector(".agent-pending-actions")).toBeNull();
    expect(container.textContent).toContain("核对画布结果");
  });

  it("stops remaining tools and model steps when the account changes during an operation", async () => {
    let finish!: (value: unknown) => void;
    mocks.requestAiText.mockResolvedValue({ ...toolReply, toolCalls: [toolReply.toolCalls[0],
      { ...toolReply.toolCalls[0], id: "tool-2" }] });
    apply.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await render(); await send("创建两个文本");
    await click(".agent-pending-actions .vermilion-button");
    expect(apply).toHaveBeenCalledTimes(1);
    await render("two");
    await act(async () => finish({ snapshot: { ...snapshot, nodes: [{ id: "created", type: "text", position: { x: 0, y: 0 } }] }, generationResults: [] }));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(mocks.requestAiText).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("画布工具结果");
    expect(receipts()[0]).toMatchObject({ state: "received", tools: "started" });
  });

  it("does not send when persist-before-submit fails", async () => {
    await render();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    await send();
    expect(mocks.requestAiText).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("only retrieves the original reply after reload and never replays tool operations", async () => {
    seed(); mocks.requestAiText.mockResolvedValue(toolReply);
    await render(); await history();
    expect(mocks.requestAiText).not.toHaveBeenCalled();
    await click(".agent-recover-reply");
    expect(mocks.requestAiText).toHaveBeenCalledTimes(1);
    expect(mocks.requestAiText.mock.calls[0][3]).toEqual({ key: "original-key", scope: "personal", recoverOnly: true });
    expect(apply).not.toHaveBeenCalled(); expect(workspaceTool).not.toHaveBeenCalled();
    expect(container.textContent).toContain("模型操作建议");
    expect(container.textContent).toContain("核对画布结果");
    expect(container.querySelector(".agent-tool-confirm")).toBeNull();
  });

  it("retains a delivered reply and stops tool execution when saving the reply fails", async () => {
    mocks.requestAiText.mockImplementation(async () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
      return toolReply;
    });
    await render(); await send();
    expect(container.textContent).toContain("模型操作建议");
    expect(receipts()[0].state).toBe("pending");
    expect(apply).not.toHaveBeenCalled(); expect(workspaceTool).not.toHaveBeenCalled();
    expect(container.querySelector(".agent-recover-reply")).not.toBeNull();
  });

  it.each(["account", "scope"])("does not copy or apply an old reply after %s changes", async change => {
    let resolve!: (response: { content: string; toolCalls: [] }) => void;
    mocks.requestAiText.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await render(); await send();
    const signal = mocks.requestAiText.mock.calls[0][1] as AbortSignal;
    await render(change === "account" ? "two" : "one", change === "scope" ? "team" : "personal");
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ content: "private old reply", toolCalls: [] }));
    expect(container.textContent).not.toContain("private old reply");
    expect(receipts()[0].state).toBe("pending");
    expect(localStorage.getItem(agentConversationStorageKey(agentConversationScopeKey({ ...owner,
      userId: change === "account" ? "two" : "one", scope: change === "scope" ? "team" : "personal" })))).toBeNull();
  });

  it("does not read a forged receipt belonging to a different owner", async () => {
    seed({ userId: "another-user" }); await render(); await history();
    expect(container.querySelector(".agent-recover-reply")).toBeNull();
    expect(mocks.requestAiText).not.toHaveBeenCalled();
  });

  it("keeps missing or uncertain receipts recoverable without issuing a new paid request", async () => {
    seed(); mocks.requestAiText.mockRejectedValue(new Error("original response unavailable"));
    await render(); await history(); await click(".agent-recover-reply");
    expect(receipts()[0].state).toBe("pending");
    await click(".agent-recover-reply");
    expect(mocks.requestAiText.mock.calls.every(call => call[3].recoverOnly && call[3].key === "original-key")).toBe(true);
  });

  it("marks a definitive failure so a deliberate later request can start separately", async () => {
    seed(); mocks.requestAiText.mockRejectedValueOnce({ receiptState: "failed" });
    await render(); await history(); await click(".agent-recover-reply");
    expect(receipts()[0].state).toBe("failed");
    expect(container.querySelector(".agent-recover-reply")).toBeNull();
    await send("新的明确请求");
    expect(mocks.requestAiText.mock.calls[1][3].key).not.toBe("original-key");
    expect(mocks.requestAiText.mock.calls[1][3].recoverOnly).toBeUndefined();
  });
});
