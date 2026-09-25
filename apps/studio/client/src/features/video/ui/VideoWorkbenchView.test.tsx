// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoWorkbenchConversation } from "../repositories/conversationRepository";
import { PROMPT_REFERENCE_DISPLAY } from "../model/promptEditor";

const mocks = vi.hoisted(() => ({
  load: vi.fn(), write: vi.fn(), generate: vi.fn(), poll: vi.fn(), cancel: vi.fn(), assetContent: vi.fn(), warning: vi.fn(),
}));
vi.mock("../repositories/cloudConversationRepository", () => ({ createCloudConversationRepository: () => ({
  load: mocks.load, write: mocks.write, dispose: vi.fn(), isLegacy: () => false,
}) }));
vi.mock("../services/generationGateway", async (original) => ({
  ...(await original<typeof import("../services/generationGateway")>()),
  createVideoGenerationTask: mocks.generate,
  pollVideoGenerationTask: mocks.poll,
  fetchVideoModelCatalog: async () => ({ videoModels: ["sdvideo/seedance-2.0"], defaultVideoModel: "sdvideo/seedance-2.0" }),
}));
vi.mock("@/entities/asset", async (original) => ({
  ...(await original<typeof import("@/entities/asset")>()), getAssetContentObjectUrl: mocks.assetContent,
}));
vi.mock("@/entities/job", async original => ({ ...(await original<typeof import("@/entities/job")>()), cancelJob: mocks.cancel }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: mocks.warning, error: vi.fn(), message: vi.fn() } }));
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render() { await act(async () => root.render(<QueryClientProvider client={queryClient}><VideoWorkbenchView ownerId="owner" /></QueryClientProvider>)); }
async function edit() { await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="重新编辑提示词和参考素材"]')!.click()); }

describe("视频历史消息重新编辑", () => {
  it.each(["succeeded", "failed"] as const)("keeps the original result when cancel returns %s", async status => {
    vi.useFakeTimers();
    const history = conversations();
    Object.assign(history[0].messages[1], { taskId: "job-running", taskProvider: "openai", taskStatus: "running" });
    mocks.load.mockResolvedValue(history);
    mocks.poll.mockResolvedValueOnce({ status: "pending" }).mockResolvedValueOnce(status === "succeeded"
      ? { status: "completed", result: { url: "", assetId: "finished-video", scope: "personal" } }
      : { status: "failed", error: "Original failure" });
    mocks.cancel.mockResolvedValue({ id: "job-running", status });
    await render();
    const signal = mocks.poll.mock.calls[0][2].signal;
    await act(async () => container.querySelector<HTMLButtonElement>(".wb-task-cancel")!.click());
    expect(signal.aborted).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    if (status === "succeeded") expect(container.querySelector('img[src*="finished-video"]')).not.toBeNull();
    else expect(container.textContent).toContain("Original failure");
    expect(container.textContent).not.toContain("任务已取消");
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("does not overwrite a received video with a late canceled reply", async () => {
    vi.useFakeTimers();
    const history = conversations();
    Object.assign(history[0].messages[1], { taskId: "job-running", taskProvider: "openai", taskStatus: "running" });
    mocks.load.mockResolvedValue(history);
    mocks.poll.mockResolvedValueOnce({ status: "pending" }).mockResolvedValueOnce({ status: "completed", result: { url: "", assetId: "finished-video", scope: "personal" } });
    let resolveCancel!: (value: unknown) => void;
    mocks.cancel.mockReturnValue(new Promise(resolve => { resolveCancel = resolve; }));
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>(".wb-task-cancel")!.click());
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    await act(async () => resolveCancel({ id: "job-running", status: "canceled" }));
    expect(container.querySelector('img[src*="finished-video"]')).not.toBeNull();
    expect(container.textContent).not.toContain("任务已取消");
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("reconnects an interrupted poll when cancel returns the completed status", async () => {
    const history = conversations();
    Object.assign(history[0].messages[1], { taskId: "job-running", taskProvider: "openai", taskStatus: "running" });
    mocks.load.mockResolvedValue(history);
    mocks.poll.mockRejectedValueOnce(new Error("poll interrupted"))
      .mockResolvedValueOnce({ status: "completed", result: { url: "", assetId: "finished-video", scope: "personal" } });
    mocks.cancel.mockResolvedValue({ id: "job-running", status: "succeeded" });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>(".wb-task-cancel")!.click());
    expect(mocks.poll).toHaveBeenCalledTimes(2);
    expect(container.querySelector('img[src*="finished-video"]')).not.toBeNull();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("keeps recovering the accepted task beyond 120 polls", async () => {
    vi.useFakeTimers();
    const history = conversations();
    Object.assign(history[0].messages[1], { taskId: "job-running", taskProvider: "openai", taskStatus: "running" });
    mocks.load.mockResolvedValue(history);
    mocks.poll.mockResolvedValue({ status: "pending" });
    await render();
    await act(async () => { await vi.advanceTimersByTimeAsync(125 * 2500); });
    expect(mocks.poll.mock.calls.length).toBeGreaterThan(120);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("continues receiving status after a failed cancellation", async () => {
    vi.useFakeTimers();
    const history = conversations();
    Object.assign(history[0].messages[1], { taskId: "job-running", taskProvider: "openai", taskStatus: "running" });
    mocks.load.mockResolvedValue(history);
    mocks.poll.mockResolvedValueOnce({ status: "pending" }).mockResolvedValueOnce({ status: "failed", error: "server terminal" });
    mocks.cancel.mockRejectedValue(new Error("network unavailable"));
    await render();
    const signal = mocks.poll.mock.calls[0][2].signal;
    await act(async () => container.querySelector<HTMLButtonElement>(".wb-task-cancel")!.click());
    expect(signal.aborted).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(mocks.poll).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("server terminal");
    expect(mocks.generate).not.toHaveBeenCalled();
  });

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
    expect(input.value).toBe(`让\n${PROMPT_REFERENCE_DISPLAY}\n在雨中转身`);
    expect(container.querySelector(".wb-token i")?.textContent).toBe("@图片1");
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
    expect(container.querySelector("textarea")!.value).toBe(`让\n${PROMPT_REFERENCE_DISPLAY}\n在雨中转身`);
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
