// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalAgentSseCallbacks } from "@/features/canvas/agent/localSseClient";
import type { CanvasAgentExecutionResult } from "@/lib/canvas-agent";

const testNavigation = vi.hoisted(() => ({ openSettings: undefined as undefined | (() => void) }));

// The retained local-connection screen is currently hidden in navigation. Start
// its existing state here; actual connect/send/switch handlers remain unmodified.
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: ((initial: unknown) => {
    const state = actual.useState(initial === "chat" ? "connect" : initial === "online" ? "local" : initial);
    if (initial === "chat") testNavigation.openSettings = () => state[1]("connect");
    return state;
  }) as typeof actual.useState };
});
const mocks = vi.hoisted(() => ({
  fetchAiModels: vi.fn(), requestAiText: vi.fn(), createLocalAgentSseClient: vi.fn(),
  sendLocalAgentTurn: vi.fn(), postLocalAgentResult: vi.fn(), postLocalAgentState: vi.fn(),
}));
vi.mock("@/services/api/ai", () => ({ fetchAiModels: mocks.fetchAiModels, requestAiText: mocks.requestAiText }));
vi.mock("@/features/canvas/agent", async importOriginal => ({
  ...await importOriginal<typeof import("@/features/canvas/agent")>(),
  createLocalAgentSseClient: mocks.createLocalAgentSseClient,
  sendLocalAgentTurn: mocks.sendLocalAgentTurn,
  postLocalAgentResult: mocks.postLocalAgentResult,
  postLocalAgentState: mocks.postLocalAgentState,
}));
import AgentPanel from "./AgentPanel";

const snapshot = { projectId: "same-project", title: "Canvas", nodes: [], connections: [],
  selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
type Connection = { clientId: string; callbacks: LocalAgentSseCallbacks; close: ReturnType<typeof vi.fn> };

describe("local Agent conversation isolation", () => {
  let root: Root;
  let container: HTMLDivElement;
  let apply: ReturnType<typeof vi.fn>;
  let workspaceTool: ReturnType<typeof vi.fn>;
  let connections: Connection[];
  async function render() {
    await act(async () => root.render(<AgentPanel userId="same-account" projectId={snapshot.projectId} open
      onClose={vi.fn()} snapshot={snapshot} canUndoOps={false} onApplyOps={apply}
      onExecuteWorkspaceTool={workspaceTool} onUndoOps={vi.fn()} />));
  }
  async function click(selector: string) {
    await act(async () => container.querySelector<HTMLButtonElement>(selector)!.click());
  }
  async function connect() {
    await click(".agent-connect .vermilion-button");
    await act(async () => connections.at(-1)!.callbacks.onHello());
  }
  async function send(text: string) {
    await act(async () => {
      const input = container.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click('[aria-label="发送"]');
  }
  async function newConversation() {
    await click(".agent-thread-trigger");
    await click(".agent-thread-new");
    await act(async () => connections.at(-1)!.callbacks.onHello());
  }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    localStorage.clear();
    localStorage.setItem("canvas-agent-token", "synthetic-local-test-token");
    mocks.fetchAiModels.mockReset().mockResolvedValue({ agentTextModels: ["text"], textModels: ["text"], modelLabels: {}, modelProviderNames: {} });
    mocks.requestAiText.mockReset();
    mocks.sendLocalAgentTurn.mockReset().mockResolvedValue({ threadId: "current-thread" });
    mocks.postLocalAgentResult.mockReset().mockResolvedValue(undefined);
    mocks.postLocalAgentState.mockReset().mockResolvedValue(undefined);
    connections = [];
    mocks.createLocalAgentSseClient.mockReset().mockImplementation((input: { clientId: string; callbacks: LocalAgentSseCallbacks }) => {
      const connection = { ...input, close: vi.fn() };
      connections.push(connection);
      return connection;
    });
    apply = vi.fn(); workspaceTool = vi.fn();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it("rejects an old conversation's events and tools after the same account starts a new turn", async () => {
    await render(); await connect(); await send("旧对话");
    const old = connections.at(-1)!;
    await newConversation(); await send("新对话");
    await act(async () => {
      old.callbacks.onAgentEvent({ type: "item.completed", thread_id: "old-thread",
        item: { id: "late-old", type: "agent_message", text: "OLD PRIVATE REPLY" } });
      old.callbacks.onToolCall({ requestId: "old-tool", name: "canvas_create_text_node", input: { text: "old" } });
      old.callbacks.onAgentError("OLD ERROR");
      old.callbacks.onDone();
    });
    expect(container.textContent).not.toContain("OLD PRIVATE REPLY");
    expect(container.textContent).not.toContain("OLD ERROR");
    expect(container.querySelector(".agent-pending-tool")).toBeNull();
    expect(container.querySelector(".agent-stop-btn")).not.toBeNull();
    expect(apply).not.toHaveBeenCalled(); expect(workspaceTool).not.toHaveBeenCalled();
    expect(old.close).toHaveBeenCalledOnce();
    expect(connections.at(-1)!.clientId).not.toBe(old.clientId);
    expect(mocks.sendLocalAgentTurn.mock.calls[1][2].threadId).toBeUndefined();
  });
  it("rotates the client when reopening the same saved chat and ignores the previous connection", async () => {
    await render(); await connect(); await send("保存的对话");
    const old = connections.at(-1)!;
    await act(async () => old.callbacks.onDone());
    await click(".agent-thread-trigger");
    await click(".agent-thread-item-main");
    const current = connections.at(-1)!;
    expect(current.clientId).not.toBe(old.clientId);
    await act(async () => current.callbacks.onHello());
    await send("继续当前对话");
    await act(async () => old.callbacks.onAgentEvent({ type: "item.completed",
      item: { id: "old-response", type: "agent_message", text: "OLD REOPENED CHAT" } }));
    expect(container.textContent).not.toContain("OLD REOPENED CHAT");
    expect(container.querySelector(".agent-stop-btn")).not.toBeNull();
    expect(mocks.sendLocalAgentTurn.mock.calls[1][2].clientId).toBe(current.clientId);
    expect(mocks.sendLocalAgentTurn.mock.calls[1][2].threadId).toBeUndefined();
  });

  it("does not append an already started tool result or clear the new turn when the old operation settles", async () => {
    let finish!: (result: CanvasAgentExecutionResult) => void;
    apply.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await render(); await connect(); await send("原操作");
    const old = connections.at(-1)!;
    await act(async () => old.callbacks.onToolCall({ requestId: "old-running-tool", name: "canvas_create_text_node", input: { text: "old-created" } }));
    await click(".agent-pending-actions .vermilion-button");
    expect(apply).toHaveBeenCalledOnce();
    await newConversation(); await send("新操作");
    await act(async () => finish({ snapshot: { ...snapshot, nodes: [{ id: "old-created", type: "text",
      title: "OLD TOOL RESULT", position: { x: 0, y: 0 }, width: 200, height: 120 }] }, generationResults: [] }));
    expect(apply).toHaveBeenCalledOnce();
    expect(workspaceTool).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("OLD TOOL RESULT");
    expect(container.querySelector(".agent-stop-btn")).not.toBeNull();
    expect(mocks.postLocalAgentResult).toHaveBeenCalledWith(expect.any(String), expect.any(String), old.clientId,
      { requestId: "old-running-tool", error: "用户中断了指令" });
    expect(mocks.sendLocalAgentTurn).toHaveBeenCalledTimes(2);
  });

  it("keeps automatic reconnection within the same chat without replaying a user turn", async () => {
    await render(); await connect(); await send("当前任务");
    const current = connections.at(-1)!;
    await act(async () => current.callbacks.onConnectionError(true));
    expect(container.textContent).toContain("连接断开");
    await act(async () => current.callbacks.onHello());
    await act(async () => {
      current.callbacks.onAgentEvent({ type: "item.completed", thread_id: "current-thread",
        item: { id: "current-response", type: "agent_message", text: "CURRENT RECONNECTED REPLY" } });
      current.callbacks.onDone();
    });
    expect(container.textContent).toContain("CURRENT RECONNECTED REPLY");
    expect(mocks.sendLocalAgentTurn).toHaveBeenCalledOnce();
    expect(connections).toHaveLength(1);
    expect(container.querySelector(".agent-stop-btn")).toBeNull();
  });

  it("uses a fresh connection after explicit disconnect and rejects all disposed connection callbacks", async () => {
    await render(); await connect(); await send("旧连接");
    const old = connections.at(-1)!;
    await act(async () => testNavigation.openSettings!());
    await click(".agent-connect .outline-button");
    expect(old.close).toHaveBeenCalledOnce();
    await connect(); await send("新连接");
    const current = connections.at(-1)!;
    expect(current.clientId).not.toBe(old.clientId);
    await act(async () => {
      old.callbacks.onHello(); old.callbacks.onConnectionError(false); old.callbacks.onDispose?.();
      old.callbacks.onAgentEvent({ type: "item.completed", item: { id: "disposed", type: "agent_message", text: "DISPOSED REPLY" } });
      old.callbacks.onToolCall({ requestId: "disposed-tool", name: "canvas_get_state", input: {} });
      old.callbacks.onDone();
    });
    expect(container.textContent).not.toContain("DISPOSED REPLY");
    expect(container.textContent).not.toContain("连接失败");
    expect(container.querySelector(".agent-stop-btn")).not.toBeNull();
    expect(mocks.postLocalAgentResult).not.toHaveBeenCalled();
    expect(mocks.sendLocalAgentTurn).toHaveBeenCalledTimes(2);
    expect(mocks.sendLocalAgentTurn.mock.calls[1][2]).toMatchObject({ clientId: current.clientId, threadId: undefined });
    expect(mocks.requestAiText).not.toHaveBeenCalled();
  });

});
