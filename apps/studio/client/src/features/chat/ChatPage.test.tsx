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
vi.mock("@/entities/project", async importOriginal => ({
  ...await importOriginal<typeof import("@/entities/project")>(),
  createProject: mocks.createProject,
  setCanvasBootstrap: mocks.bootstrap,
}));
vi.mock("@/entities/project/api", async importOriginal => ({
  ...await importOriginal<typeof import("@/entities/project/api")>(),
  getProjectSummaries: async () => [],
}));
vi.mock("@/features/projects", () => ({
  useProjectCoverUrls: () => ({}), ProjectCard: () => null, ProjectListFeedback: () => null, projectToCard: vi.fn(),
}));

import ChatPage from "./ChatPage";

// The server pins a single text model, so the catalog carries exactly one entry.
const serverCatalog = {
  models: ["provider-b::deepseek-v4-flash", "provider-a::image"],
  text_models: ["provider-b::deepseek-v4-flash"],
  agent_text_models: ["provider-b::deepseek-v4-flash"],
  default_text_model: "provider-b::deepseek-v4-flash",
};

describe("Chat composer text model", () => {
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

  it("offers no model choice and hands the server's model to Canvas", async () => {
    await mount();
    expect(mocks.request).toHaveBeenCalledWith("/api/ai/models");
    expect(container.querySelector(".chat-model-trigger, .chat-model-menu")).toBeNull();
    await enterPrompt();
    await click(".chat-send");
    expect(mocks.bootstrap).toHaveBeenCalledWith("new-project", "雨夜追逐", "provider-b::deepseek-v4-flash");
    expect(mocks.navigate).toHaveBeenCalledWith("/canvas/new-project?scope=personal");
  });

  it("blocks sending on loading, an empty catalog or failure, and recovers on retry", async () => {
    let resolveCatalog!: (value: unknown) => void;
    mocks.request.mockReturnValueOnce(new Promise(resolve => { resolveCatalog = resolve; }));
    await mount();
    await enterPrompt();
    expect(button(".chat-send").disabled).toBe(true);
    await act(async () => resolveCatalog({ models: ["provider::image"], text_models: [] }));
    await flush();
    expect(container.textContent).toContain("暂无可用");
    expect(button(".chat-send").disabled).toBe(true);

    mocks.request.mockRejectedValue(new Error("offline"));
    await act(async () => { await queryClient.refetchQueries(); });
    await flush();
    expect(container.textContent).toContain("连接失败");
    expect(button(".chat-send").disabled).toBe(true);
    mocks.request.mockResolvedValue(serverCatalog);
    await click(".chat-model-status button");
    expect(button(".chat-send").disabled).toBe(false);
    expect(container.querySelector("textarea")!.value).toBe("雨夜追逐");
  });

  it("does not fetch models before login", async () => {
    mocks.user = null;
    await mount();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(container.querySelector(".chat-model-status")).toBeNull();
  });
});
