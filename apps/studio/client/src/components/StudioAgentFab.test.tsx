// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), fetchAiModels: vi.fn(), requestAiText: vi.fn(),
  user: { id: "qa", username: "QA" },
}));
vi.mock("wouter", () => ({ useLocation: () => ["/skills", mocks.navigate] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/services/api/ai", () => mocks);
vi.mock("./MetaBallOrb", () => ({ default: () => null }));
import StudioAgentFab from "./StudioAgentFab";

describe("studio Agent dialog", () => {
  let root: Root;
  let container: HTMLDivElement;
  const dialog = () => document.querySelector<HTMLElement>(".studio-agent-dialog")!;
  const composer = () => dialog().querySelector("textarea")!;
  const fab = () => container.querySelector<HTMLButtonElement>(".studio-agent-fab")!;
  async function click(selector: string) {
    await act(async () => document.querySelector<HTMLButtonElement>(selector)!.click());
  }
  async function type(text: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(composer(), text);
      composer().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function open() {
    await act(async () => fab().click());
    await act(async () => vi.dynamicImportSettled());
  }
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    localStorage.clear();
    mocks.navigate.mockReset();
    mocks.fetchAiModels.mockReset().mockResolvedValue({
      textModels: ["provider::gpt-5.6-luna", "provider::plain-model"], agentTextModels: [],
      defaultTextModel: "provider::gpt-5.6-luna", modelLabels: {}, modelProviderNames: {},
    });
    mocks.requestAiText.mockReset().mockResolvedValue({ content: "A real response", toolCalls: [] });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<StudioAgentFab />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("opens in place lazily and sends through the real text request path without canvas tools", async () => {
    expect(mocks.fetchAiModels).not.toHaveBeenCalled();
    await open();
    expect(dialog().hidden).toBe(false);
    expect(fab().getAttribute("aria-expanded")).toBe("true");
    expect(dialog().querySelector("[role=dialog]")).not.toBeNull();
    expect(document.activeElement).toBe(composer());
    await type("Help with my story");
    await click(".agent-send-btn");
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.requestAiText).toHaveBeenCalledTimes(1);
    const request = mocks.requestAiText.mock.calls[0][0];
    expect(request.tools).toBeUndefined();
    expect(request.tool_choice).toBeUndefined();
    expect(request.messages.at(-1).content).toBe("Help with my story");
    expect(request.messages[0].content).toContain("/skills");
    expect(dialog().textContent).toContain("A real response");
    expect(localStorage.getItem("canvas-agent-conversations:v2:qa:personal:studio%3Aqa")).toContain("A real response");
  });

  it("retains messages and drafts on close and reopen, then restores a saved conversation", async () => {
    await open();
    await type("First conversation");
    await click(".agent-send-btn");
    await type("Unsent draft");
    await click(".agent-toolbar-btn[title='关闭对话']");
    expect(dialog().hidden).toBe(true);
    await open();
    expect(composer().value).toBe("Unsent draft");
    expect(dialog().textContent).toContain("A real response");
    expect(mocks.fetchAiModels).toHaveBeenCalledTimes(1);
    await click(".agent-thread-trigger");
    await click(".agent-thread-new");
    expect(dialog().querySelectorAll(".agent-msg")).toHaveLength(0);
    await click(".agent-thread-trigger");
    await click(".agent-thread-item-main");
    expect(dialog().textContent).toContain("A real response");
  });

  it("uses the selected plain text model and closes menus before closing the dialog on Escape", async () => {
    await open();
    await click(".agent-model-selector");
    const models = dialog().querySelectorAll<HTMLButtonElement>(".agent-model-item");
    await act(async () => models[1].click());
    await type("Model choice");
    await click(".agent-send-btn");
    expect(mocks.requestAiText.mock.calls[0][0].model).toBe("provider::plain-model");
    await click(".agent-thread-trigger");
    await act(async () => composer().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(dialog().querySelector(".agent-thread-menu")).toBeNull();
    expect(dialog().hidden).toBe(false);
    await act(async () => composer().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(dialog().hidden).toBe(true);
  });

  it("does not execute unexpected canvas tool calls or pretend they succeeded", async () => {
    mocks.requestAiText.mockResolvedValueOnce({ content: "", toolCalls: [{ id: "call", function: { name: "canvas_create_node", arguments: "{}" } }] });
    await open();
    await type("A request");
    await click(".agent-send-btn");
    expect(dialog().querySelector(".agent-msg-error")?.textContent).toContain("未执行");
    expect(mocks.requestAiText).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("shows request errors and keeps the dialog usable for another attempt", async () => {
    mocks.requestAiText.mockRejectedValueOnce(new Error("Network unavailable"));
    await open();
    await type("Try a request");
    await click(".agent-send-btn");
    expect(dialog().querySelector(".agent-msg-error")?.textContent).toContain("Network unavailable");
    await type("Try again");
    await click(".agent-send-btn");
    expect(dialog().textContent).toContain("A real response");
    expect(mocks.requestAiText).toHaveBeenCalledTimes(2);
  });
});
