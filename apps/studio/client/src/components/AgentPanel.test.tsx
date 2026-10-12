// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchAiModels: vi.fn(), requestAiText: vi.fn() }));
vi.mock("@/services/api/ai", () => mocks);

import AgentPanel from "./AgentPanel";

// The server pins a single text model, so the catalog carries exactly one entry.
const catalog = {
  textModels: ["provider::deepseek-v4-flash"],
  agentTextModels: ["provider::deepseek-v4-flash"],
  defaultTextModel: "provider::deepseek-v4-flash",
  modelLabels: {}, modelProviderNames: {},
};
const snapshot = {
  projectId: "chat-project", title: "模型交接测试", nodes: [], connections: [],
  selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 },
};

describe("AgentPanel pinned text model", () => {
  let root: Root;
  let container: HTMLDivElement;

  async function render(initialPrompt = "雨夜追逐") {
    await act(async () => root.render(
      <AgentPanel userId="agent-test-user" projectId={snapshot.projectId} open onClose={vi.fn()} snapshot={snapshot}
        canUndoOps={false} onApplyOps={vi.fn()} onExecuteWorkspaceTool={vi.fn()} onUndoOps={vi.fn()}
        initialPrompt={initialPrompt} />
    ));
  }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    localStorage.clear();
    mocks.fetchAiModels.mockReset().mockResolvedValue(catalog);
    mocks.requestAiText.mockReset().mockResolvedValue({ content: "收到", toolCalls: [] });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("waits for the catalog and sends exactly once using the server's model", async () => {
    let resolveCatalog!: (value: typeof catalog) => void;
    mocks.fetchAiModels.mockReturnValueOnce(new Promise(resolve => { resolveCatalog = resolve; }));
    await render();
    expect(mocks.requestAiText).not.toHaveBeenCalled();
    await act(async () => resolveCatalog(catalog));
    expect(mocks.requestAiText).toHaveBeenCalledTimes(1);
    expect(mocks.requestAiText.mock.calls[0][0]).toMatchObject({ model: "provider::deepseek-v4-flash", tool_choice: "required" });
    await render();
    expect(mocks.requestAiText).toHaveBeenCalledTimes(1);
  });

  it("offers no model picker", async () => {
    await render("");
    expect(container.querySelector(".agent-model-selector, .agent-model-menu")).toBeNull();
    expect(container.textContent).not.toMatch(/选择模型|如何选择模型|更多模型|精选推荐/);
  });

  it("names the pinned model in the status line but never the admin fallback", async () => {
    await render("");
    expect(container.querySelector(".agent-activity")?.textContent).toBe("在线 Agent 可用 · deepseek-v4-flash");
    await act(async () => root.unmount());
    root = createRoot(container);
    mocks.fetchAiModels.mockResolvedValueOnce({ ...catalog, textModels: ["admin::gpt-5.6-sol"], agentTextModels: ["admin::gpt-5.6-sol"], defaultTextModel: "admin::gpt-5.6-sol" });
    await render("");
    expect(container.querySelector(".agent-activity")?.textContent).toBe("在线 Agent 可用");
  });

  it("keeps the prompt and reports a missing Agent model", async () => {
    mocks.fetchAiModels.mockResolvedValueOnce({ ...catalog, textModels: [], agentTextModels: [], defaultTextModel: "" });
    await render();
    expect(mocks.requestAiText).not.toHaveBeenCalled();
    expect(container.textContent).toContain("雨夜追逐");
    expect(container.textContent).toContain("没有支持 Agent 工具调用的文本模型");
  });

  it("keeps a pending server request busy and displays only its final failure", async () => {
    let rejectRequest!: (error: Error) => void;
    mocks.requestAiText.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectRequest = reject; }));
    await render();
    expect(container.querySelector(".agent-stop-btn")).not.toBeNull();
    expect(container.textContent).not.toContain("当前模型暂时不可用");
    await act(async () => rejectRequest(new Error("当前模型暂时不可用，请稍后重试")));
    expect(container.querySelector(".agent-stop-btn")).toBeNull();
    expect(container.textContent?.match(/当前模型暂时不可用/g)).toHaveLength(1);
    expect(mocks.requestAiText).toHaveBeenCalledTimes(1);
  });

  it("shows when an online request is waiting behind the generation admission lane", async () => {
    mocks.requestAiText.mockImplementationOnce((_body: unknown, _signal: AbortSignal | undefined, onWaiting?: (waiting: boolean) => void) => {
      onWaiting?.(true);
      return new Promise(() => undefined);
    });
    await render();
    expect(container.textContent).toContain("模型并发繁忙，已进入队列");
  });
});
