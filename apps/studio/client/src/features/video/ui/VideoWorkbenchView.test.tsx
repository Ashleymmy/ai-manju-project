// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoWorkbenchConversation } from "../repositories/conversationRepository";

const mocks = vi.hoisted(() => ({
  load: vi.fn(), write: vi.fn(), generate: vi.fn(), assetContent: vi.fn(), warning: vi.fn(),
}));
vi.mock("../repositories/cloudConversationRepository", () => ({ createCloudConversationRepository: () => ({
  load: mocks.load, write: mocks.write, dispose: vi.fn(), isLegacy: () => false,
}) }));
vi.mock("../services/generationGateway", async (original) => ({
  ...(await original<typeof import("../services/generationGateway")>()),
  createVideoGenerationTask: mocks.generate,
  fetchVideoModelCatalog: async () => ({ videoModels: ["sdvideo/seedance-2.0"], defaultVideoModel: "sdvideo/seedance-2.0" }),
}));
vi.mock("@/entities/asset", async (original) => ({
  ...(await original<typeof import("@/entities/asset")>()), getAssetContentObjectUrl: mocks.assetContent,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: mocks.warning, error: vi.fn() } }));
vi.mock("./MediaPickerDialog", () => ({ MediaPickerDialog: () => null }));
vi.mock("./ToolkitPanel", () => ({ ToolkitPanel: () => null }));
vi.mock("./ParamsBar", () => ({ ParamsBar: ({ config }: { config: { seconds: string } }) => <output data-testid="duration">{config.seconds}</output> }));
vi.mock("./ConversationSidebar", () => ({ ConversationSidebar: ({ onSelect }: { onSelect: (id: string) => void }) => <button onClick={() => onSelect("other")}>切换对话</button> }));
import VideoWorkbenchView from "./VideoWorkbenchView";

let root: Root;
let container: HTMLDivElement;
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const originalText = "让 @[ref:hero] 在雨中转身";
function conversations(): VideoWorkbenchConversation[] {
  return [{ id: "conversation", title: "原任务", createdAt: 1, updatedAt: 1, messages: [
    { id: "user", role: "user", text: originalText, createdAt: 1, attachments: [
      { id: "hero", kind: "image", role: "reference", name: "拟真人", mime: "image/png", bytes: 1, assetRef: "asset://registered-hero", previewUrl: "https://example.test/hero.png", token: "@图片1" },
      { id: "first", kind: "image", role: "first_frame", name: "首帧", mime: "image/png", bytes: 1, assetId: "first-image" },
    ] },
    { id: "system", role: "system", text: "让 图片1 在雨中转身", createdAt: 2, taskStatus: "failed", config: { model: "sdvideo/seedance-2.0", size: "16:9", resolution: "720p", seconds: "10", generateAudio: true, watermark: false } },
  ] }, { id: "other", title: "另一个对话", createdAt: 1, updatedAt: 1, messages: [] }];
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("image")));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  URL.revokeObjectURL = vi.fn();
  mocks.load.mockResolvedValue(conversations());
  mocks.write.mockResolvedValue(undefined);
  mocks.assetContent.mockResolvedValue("blob:reference");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
async function render() { await act(async () => root.render(<QueryClientProvider client={queryClient}><VideoWorkbenchView ownerId="owner" /></QueryClientProvider>)); }
async function edit() { await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="重新编辑提示词和参考素材"]')!.click()); }

describe("视频历史消息重新编辑", () => {
  it("历史视频使用可续签的媒体地址，不预先读取整段 Blob", async () => {
    const history = conversations();
    history[0].messages = [{ id: "video", role: "system", text: "已完成", createdAt: 2, taskStatus: "succeeded", resultAssetId: "asset-video", resultScope: "personal" }];
    mocks.load.mockResolvedValue(history);
    await render();
    const src = container.querySelector("img")!.getAttribute("src")!;
    expect(src).toContain("poster=1");
    expect(container.querySelector("video")).toBeNull();
    expect(src).toContain("/api/assets/asset-video/content?scope=personal");
    expect(src).not.toContain("access_token");
    expect(mocks.assetContent).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("点击回填描述、参考、首帧和原参数并聚焦，不发起任务或改写历史", async () => {
    await render();
    await edit();
    const input = container.querySelector("textarea")!;
    expect(input.value).toBe(originalText);
    expect(input.disabled).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(container.querySelector('[data-testid="duration"]')!.textContent).toBe("10");
    expect(container.querySelector(".wb-shelf-item")!.getAttribute("title")).toContain("拟真人");
    expect(container.querySelector(".wb-frame-filled img")!.getAttribute("src")).toBe("blob:reference");
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("个别素材读取失败仍可编辑描述和可用素材", async () => {
    mocks.assetContent.mockRejectedValue(new Error("media unavailable"));
    await render();
    await edit();
    expect(container.querySelector("textarea")!.value).toBe(originalText);
    expect(container.querySelector("textarea")!.disabled).toBe(false);
    expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining("首帧"));
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("恢复过程中切换对话，旧结果不会回填到新对话", async () => {
    await render();
    let resolve!: (url: string) => void;
    mocks.assetContent.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
    await edit();
    await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "切换对话")!.click());
    await act(async () => resolve("blob:late"));
    expect(container.querySelector("textarea")!.value).toBe("");
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
