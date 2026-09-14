// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchAiModels: vi.fn(), requestAiText: vi.fn() }));
vi.mock("@/services/api/ai", () => mocks);

import AgentPanel from "./AgentPanel";

const catalog = {
  agentTextModels: ["provider::gpt-5.6-luna", "provider::chosen-model"],
  defaultTextModel: "provider::gpt-5.6-luna",
  modelLabels: {}, modelProviderNames: {},
};
const snapshot = {
  projectId: "chat-project", title: "模型交接测试", nodes: [], connections: [],
  selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 },
};

describe("AgentPanel chat model handoff", () => {
  let root: Root;
  let container: HTMLDivElement;

  async function render(initialPrompt = "雨夜追逐", initialModel = "provider::chosen-model") {
    await act(async () => root.render(
      <AgentPanel projectId={snapshot.projectId} open onClose={vi.fn()} snapshot={snapshot}
        canUndoOps={false} onApplyOps={vi.fn()} onExecuteWorkspaceTool={vi.fn()} onUndoOps={vi.fn()}
        initialPrompt={initialPrompt} initialModel={initialModel} />
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

  it("waits for the catalog and sends exactly once using the selected provider model", async () => {
    let resolveCatalog!: (value: typeof catalog) => void;
    mocks.fetchAiModels.mockReturnValueOnce(new Promise(resolve => { resolveCatalog = resolve; }));
    await render();
    expect(mocks.requestAiText).not.toHaveBeenCalled();
    await act(async () => resolveCatalog(catalog));
    expect(mocks.requestAiText).toHaveBeenCalledTimes(1);
    expect(mocks.requestAiText.mock.calls[0][0]).toMatchObject({ model: "provider::chosen-model" });
    await render();
    expect(mocks.requestAiText).toHaveBeenCalledTimes(1);
  });

  it("honors a model handed off after the panel has already loaded its default", async () => {
    await render("", "");
    await render();
    expect(mocks.requestAiText).toHaveBeenCalledTimes(1);
    expect(mocks.requestAiText.mock.calls[0][0]).toMatchObject({ model: "provider::chosen-model" });
  });

  it("dismisses its model menu on a stopped canvas pointer event without submitting a request", async () => {
    await render("", "");
    await act(async () => (container.querySelector(".agent-model-selector") as HTMLButtonElement).click());
    expect(container.querySelector(".agent-model-menu")).not.toBeNull();
    const outside = document.createElement("div");
    outside.addEventListener("pointerdown", event => event.stopPropagation());
    container.append(outside);
    await act(async () => outside.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(container.querySelector(".agent-model-menu")).toBeNull();
    expect(mocks.requestAiText).not.toHaveBeenCalled();
  });

  it("keeps the prompt and reports an unavailable selected model without substituting another", async () => {
    await render("雨夜追逐", "provider::removed-model");
    expect(mocks.requestAiText).not.toHaveBeenCalled();
    expect(container.textContent).toContain("雨夜追逐");
    expect(container.textContent).toContain("所选模型已不可用");
  });

  it("shows model names once in both featured and expanded choices without supplier subtitles", async () => {
    const models = [
      "first::gpt-5.6-luna", "backup::gpt-5.6-luna", "first::gpt-6-astra",
      "first::gpt-5.5", "first::gpt-5.4", "backup::gpt-5.4",
    ];
    mocks.fetchAiModels.mockResolvedValueOnce({
      ...catalog, agentTextModels: models, defaultTextModel: "first::gpt-6-astra",
      modelLabels: Object.fromEntries(models.map(model => [model, "供应商自定义别名"])),
      modelProviderNames: Object.fromEntries(models.map(model => [model, "新 Provider"])),
    });
    await render("", "");
    expect(container.querySelector(".agent-model-selector")?.textContent).toBe("gpt-5.6-luna");
    await act(async () => (container.querySelector(".agent-model-selector") as HTMLButtonElement).click());
    expect([...container.querySelectorAll(".agent-model-item")].map(item => item.textContent?.trim())).toEqual([
      "gpt-5.6-luna", "gpt-6-astra", "gpt-5.5",
    ]);
    await act(async () => (container.querySelector(".agent-model-more") as HTMLButtonElement).click());
    const items = [...container.querySelectorAll<HTMLButtonElement>(".agent-model-item")];
    expect(items.map(item => item.textContent?.trim())).toEqual(["gpt-5.6-luna", "gpt-6-astra", "gpt-5.5", "gpt-5.4"]);
    expect(container.querySelector(".agent-model-menu small")).toBeNull();
    expect(container.querySelector(".agent-model-menu")?.textContent).not.toMatch(/Provider|供应商自定义别名|first::|backup::/);
    await act(async () => items.at(-1)!.click());
    expect(container.querySelector(".agent-model-selector")?.textContent).toBe("gpt-5.4");
  });

  it("preserves a selected alternative supplier while showing a single model choice", async () => {
    mocks.fetchAiModels.mockResolvedValueOnce({
      ...catalog, agentTextModels: ["first::gpt-5.6-luna", "backup::gpt-5.6-luna"],
    });
    await render("雨夜追逐", "backup::gpt-5.6-luna");
    expect(mocks.requestAiText).toHaveBeenCalledTimes(1);
    expect(mocks.requestAiText.mock.calls[0][0]).toMatchObject({ model: "backup::gpt-5.6-luna", tool_choice: "required" });
    await act(async () => (container.querySelector(".agent-model-selector") as HTMLButtonElement).click());
    expect(container.querySelectorAll(".agent-model-item")).toHaveLength(1);
    expect(container.querySelector(".agent-model-item.active")?.textContent?.trim()).toBe("gpt-5.6-luna");
  });

  it("lets the backend recover a saved supplier when the same model is still available", async () => {
    await render("雨夜追逐", "removed::gpt-5.6-luna");
    expect(mocks.requestAiText).toHaveBeenCalledTimes(1);
    expect(mocks.requestAiText.mock.calls[0][0].model).toBe("removed::gpt-5.6-luna");
    expect(container.textContent).not.toContain("所选模型已不可用");
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
});
