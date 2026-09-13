// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "admin", username: "admin" } as { id: string; username: string } | null,
  request: vi.fn(),
  createProject: vi.fn(),
  bootstrap: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user, logout: vi.fn() }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/chat", mocks.navigate] }));
vi.mock("@/shared/api/http", () => ({ request: mocks.request }));
vi.mock("@/entities/project", () => ({
  getProjects: async () => [],
  createProject: mocks.createProject,
  setCanvasBootstrap: mocks.bootstrap,
}));
vi.mock("@/features/projects", () => ({
  useProjectCoverUrls: () => ({}), ProjectCard: () => null, projectToCard: vi.fn(),
}));

import ChatPage from "./ChatPage";
import { modelQueryKeys } from "@/entities/model";

const serverCatalog = {
  models: ["provider-a::text", "provider-b::text", "provider-a::gpt-5.5", "provider-a::image", "provider-a::plain-text"],
  text_models: ["provider-a::text", "provider-b::text", "provider-a::gpt-5.5", "provider-a::plain-text"],
  agent_text_models: ["provider-a::text", "provider-b::text", "provider-a::gpt-5.5"],
  default_text_model: "provider-b::text",
  model_labels: { "provider-a::text": "真实模型", "provider-b::text": "真实模型" },
  model_provider_names: { "provider-a::text": "服务商甲", "provider-b::text": "服务商乙" },
};

describe("Chat model selector", () => {
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;

  async function flush() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }
  async function mount() {
    await act(async () => root.render(
      <QueryClientProvider client={queryClient}><ChatPage /></QueryClientProvider>
    ));
    await flush();
  }
  function button(selector: string) {
    return container.querySelector<HTMLButtonElement>(selector)!;
  }
  async function click(selector: string) {
    await act(async () => button(selector).click());
    await flush();
  }
  async function enterPrompt() {
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "雨夜追逐");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.clearAllMocks();
    mocks.user = { id: "admin", username: "admin" };
    mocks.request.mockReset().mockResolvedValue(serverCatalog);
    mocks.createProject.mockResolvedValue({ id: "new-project" });
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows each server model once without supplier labels and hands the selected id to Canvas", async () => {
    await mount();
    expect(mocks.request).toHaveBeenCalledWith("/api/ai/models");
    expect(button(".chat-model-trigger").textContent).toBe("text");
    expect(button(".chat-model-trigger").title).toBe("text");
    await click(".chat-model-trigger");
    expect(Array.from(container.querySelectorAll(".chat-model-menu button")).map(item => item.textContent))
      .toEqual(["text", "gpt-5.5"]);
    expect(container.querySelector(".chat-model-menu")?.textContent).not.toMatch(/服务商|provider-|真实模型|plain-text|image/);
    expect([...container.querySelectorAll<HTMLButtonElement>(".chat-model-menu button")].map(item => item.title))
      .toEqual(["text", "gpt-5.5"]);
    await click('.chat-model-menu button[aria-pressed="false"]');
    await enterPrompt();
    await click(".chat-send");
    expect(mocks.bootstrap).toHaveBeenCalledWith("new-project", "雨夜追逐", "provider-a::gpt-5.5");
    expect(mocks.navigate).toHaveBeenCalledWith("/canvas/new-project?scope=personal");
  });

  it("keeps the same selected model when only its supplier disappears", async () => {
    await mount();
    await click(".chat-model-trigger");
    await click('.chat-model-menu button[aria-pressed="false"]');
    mocks.request.mockResolvedValue({ ...serverCatalog, agent_text_models: ["provider-a::text", "provider-b::gpt-5.5"] });
    await act(async () => { await queryClient.invalidateQueries({ queryKey: modelQueryKeys.all }); });
    await flush();
    expect(button(".chat-model-trigger").textContent).toBe("gpt-5.5");
    await click(".chat-model-trigger");
    expect(container.querySelectorAll(".chat-model-menu button[aria-pressed]")).toHaveLength(2);
    expect(button('.chat-model-menu button[aria-pressed="true"]').textContent).toBe("gpt-5.5");
    await enterPrompt();
    await click(".chat-send");
    expect(mocks.bootstrap).toHaveBeenCalledWith("new-project", "雨夜追逐", "provider-a::gpt-5.5");
  });

  it("keeps the API default supplier behind a merged choice", async () => {
    await mount();
    await enterPrompt();
    await click(".chat-send");
    expect(mocks.bootstrap).toHaveBeenCalledWith("new-project", "雨夜追逐", "provider-b::text");
  });

  it("defaults to Luna and merges suppliers without changing the selected model", async () => {
    mocks.request.mockResolvedValue({
      ...serverCatalog,
      agent_text_models: ["provider-a::gpt-5.5", "provider-a::gpt-5.6-luna", "provider-b::gpt-5.6-luna"],
      default_text_model: "provider-a::gpt-5.5",
      model_labels: { "provider-a::gpt-5.6-luna": "自定义名称 · 供应商" },
      model_provider_names: { "provider-a::gpt-5.6-luna": "新 Provider", "provider-b::gpt-5.6-luna": "其他 Provider" },
    });
    await mount();
    expect(button(".chat-model-trigger").textContent).toBe("gpt-5.6-luna");
    await click(".chat-model-trigger");
    expect([...container.querySelectorAll(".chat-model-menu button[aria-pressed]")].map(item => item.textContent))
      .toEqual(["gpt-5.5", "gpt-5.6-luna"]);
    expect(container.querySelector(".chat-model-menu")?.textContent).not.toMatch(/Provider|供应商|自定义名称/);
    await enterPrompt();
    await click(".chat-send");
    expect(mocks.bootstrap).toHaveBeenCalledWith("new-project", "雨夜追逐", "provider-a::gpt-5.6-luna");
  });

  it("blocks sending on loading, an empty catalog or failure, and recovers on retry", async () => {
    let resolveCatalog!: (value: unknown) => void;
    mocks.request.mockReturnValueOnce(new Promise(resolve => { resolveCatalog = resolve; }));
    await mount();
    await enterPrompt();
    expect(button(".chat-send").disabled).toBe(true);
    await act(async () => resolveCatalog({ models: ["provider::image"], text_models: [] }));
    await flush();
    expect(button(".chat-model-trigger").textContent).toContain("暂无可用");
    expect(button(".chat-send").disabled).toBe(true);

    mocks.request.mockRejectedValue(new Error("offline"));
    await click(".chat-model-trigger");
    expect(container.textContent).toContain("模型获取失败");
    expect(container.querySelectorAll(".chat-model-menu button[aria-pressed]")).toHaveLength(0);
    expect(button(".chat-send").disabled).toBe(true);
    mocks.request.mockResolvedValue(serverCatalog);
    await click(".chat-model-menu button");
    expect(button(".chat-send").disabled).toBe(false);
    expect(container.querySelector("textarea")!.value).toBe("雨夜追逐");
  });

  it("does not fetch or expose model choices before login", async () => {
    mocks.user = null;
    await mount();
    await click(".chat-model-trigger");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(container.textContent).toContain("登录后查看模型");
    expect(container.querySelectorAll(".chat-model-menu button[aria-pressed]")).toHaveLength(0);
  });
});
