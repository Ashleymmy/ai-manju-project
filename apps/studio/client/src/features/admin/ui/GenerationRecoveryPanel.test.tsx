// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationRecoveryPanel } from "./GenerationRecoveryPanel";
import { fetchGenerationRecovery, resumeGenerationRecovery, type GenerationRecoveryRow } from "../services/generationRecoveryApi";

vi.mock("../services/generationRecoveryApi", async importOriginal => ({
  ...await importOriginal<typeof import("../services/generationRecoveryApi")>(),
  fetchGenerationRecovery: vi.fn(), resumeGenerationRecovery: vi.fn(),
}));

function row(overrides: Partial<GenerationRecoveryRow> = {}): GenerationRecoveryRow {
  return {
    id: "job-original", user_id: "user-1", workspace_id: "workspace-1", type: "video.generate", status: "queued",
    queue_phase: "video_recovery_pending", provider_id: "provider-1", model: "video-model", checkpoint_phase: "provider_accepted",
    checkpoint_revision: 7, provider_task_id: "upstream-1", can_resume: true, reason: "已有上游任务，可继续查询", updated_at: "2026-09-25T10:00:00Z", recovery_requested: false,
    ...overrides,
  };
}
const page = (items = [row()], total = items.length, offset = 0) => ({ items, total, limit: 10, offset });

describe("admin generation recovery", () => {
  let root: Root, container: HTMLDivElement, client: QueryClient;
  const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const button = (text: string) => [...container.querySelectorAll("button")].find(item => item.textContent?.includes(text));
  const resumeButton = (id = "job-original") => container.querySelector(`button[aria-label="恢复原任务 ${id}"]`) as HTMLButtonElement | null;
  async function render(role: string | undefined = "ops_admin", active = true) {
    await act(async () => root.render(<QueryClientProvider client={client}><GenerationRecoveryPanel role={role} active={active} /></QueryClientProvider>));
    await flush();
  }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    vi.mocked(fetchGenerationRecovery).mockResolvedValue(page());
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear(); container.remove(); vi.resetAllMocks(); vi.unstubAllGlobals();
  });

  it.each(["member", "guest", ""])('does not load or expose recovery to role "%s"', async role => {
    await render(role);
    expect(container.textContent).toBe("");
    expect(fetchGenerationRecovery).not.toHaveBeenCalled();
  });

  it("unmounts inactive queries and does not fetch recovery from a hidden panel", async () => {
    await render("super_admin", false);
    expect(fetchGenerationRecovery).not.toHaveBeenCalled();
    await render("super_admin");
    expect(fetchGenerationRecovery).toHaveBeenCalledOnce();
    await render("super_admin", false);
    await act(async () => { await client.invalidateQueries({ queryKey: ["admin", "generation-recovery"] }); window.dispatchEvent(new Event("focus")); });
    expect(fetchGenerationRecovery).toHaveBeenCalledOnce();
    expect(container.textContent).toBe("");
  });

  it("auditors can inspect existing jobs but cannot request recovery", async () => {
    await render("auditor");
    expect(container.textContent).toContain("只读审计账号");
    expect(container.textContent).toContain("job-original");
    expect(resumeButton()).toBeNull();
    expect(resumeGenerationRecovery).not.toHaveBeenCalled();
  });

  it.each(["super_admin", "ops_admin"])("allows %s to request the same task once with its checkpoint revision", async role => {
    const requested = row({ can_resume: false, recovery_requested: true });
    let complete!: (value: GenerationRecoveryRow) => void;
    vi.mocked(resumeGenerationRecovery).mockReturnValue(new Promise(resolve => { complete = resolve; }));
    await render(role);
    expect(container.textContent).toContain("不重新生成，不产生新的生成费用");
    await act(async () => { resumeButton()!.click(); resumeButton()!.click(); });
    expect(resumeGenerationRecovery).toHaveBeenCalledOnce();
    expect(resumeGenerationRecovery).toHaveBeenCalledWith("job-original", 7);
    expect(resumeButton()?.disabled).toBe(true);
    vi.mocked(fetchGenerationRecovery).mockResolvedValue(page([requested]));
    await act(async () => complete(requested));
    await flush();
    expect(fetchGenerationRecovery).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("已请求恢复原任务 job-original");
    expect(resumeButton()?.disabled).toBe(true);
  });

  it("keeps unsafe tasks disabled while permitting receipt inspection approved by the server", async () => {
    vi.mocked(fetchGenerationRecovery).mockResolvedValue(page([
      row({ id: "job-unsafe", can_resume: false, checkpoint_phase: "submission_intent", provider_task_id: "", reason: "没有已确认的任务或可核查回执" }),
      row({ id: "job-receipt", type: "image.generate", queue_phase: "image_submission_uncertain", checkpoint_phase: "submission_intent", provider_task_id: "", reason: "可核查已有提交回执" }),
    ]));
    await render();
    expect(resumeButton("job-unsafe")?.disabled).toBe(true);
    expect(resumeButton("job-receipt")?.disabled).toBe(false);
    expect(container.textContent).toContain("没有已确认的任务或可核查回执");
    expect(resumeGenerationRecovery).not.toHaveBeenCalled();
  });

  it("paginates bounded reads without carrying the prior page into a new action", async () => {
    const records = Array.from({ length: 12 }, (_, index) => row({ id: `job-${index + 1}` }));
    vi.mocked(fetchGenerationRecovery).mockImplementation(async (offset = 0) => page(records.slice(offset, offset + 10), 12, offset));
    await render();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(container.textContent).toContain("共 12 条 · 每页 10 条 · 第 1 / 2 页");
    expect(button("上一页")?.disabled).toBe(true);
    const firstViewport = container.querySelector<HTMLDivElement>(".generation-recovery-table")!;
    firstViewport.scrollTop = 200;
    await act(async () => button("下一页")!.click());
    await flush();
    expect(fetchGenerationRecovery).toHaveBeenLastCalledWith(10, expect.any(AbortSignal));
    expect(container.textContent).toContain("第 2 / 2 页");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(resumeButton("job-1")).toBeNull();
    expect(resumeButton("job-11")).not.toBeNull();
    expect(button("下一页")?.disabled).toBe(true);
    expect(container.querySelector<HTMLDivElement>(".generation-recovery-table")!.scrollTop).toBe(0);
    await act(async () => button("上一页")!.click());
    await flush();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(resumeButton("job-11")).toBeNull();
    expect(container.querySelector<HTMLDivElement>(".generation-recovery-table")!.scrollTop).toBe(0);
    expect(resumeGenerationRecovery).not.toHaveBeenCalled();
  });

  it.each([10, 11])("uses a ten-record page boundary when the total is %i", async total => {
    vi.mocked(fetchGenerationRecovery).mockResolvedValue(page(Array.from({ length: 10 }, (_, index) => row({ id: `job-${index}` })), total));
    await render();
    expect(button("下一页")?.disabled).toBe(total === 10);
    expect(container.textContent).toContain(`第 1 / ${total === 10 ? 1 : 2} 页`);
  });

  it("returns to the remaining page when a refresh removes the last page", async () => {
    const records = Array.from({ length: 12 }, (_, index) => row({ id: `job-${index + 1}` }));
    let total = 12;
    vi.mocked(fetchGenerationRecovery).mockImplementation(async (offset = 0) => page(records.slice(0, total).slice(offset, offset + 10), total, offset));
    await render();
    await act(async () => button("下一页")!.click());
    await flush();
    total = 10;
    await act(async () => button("刷新恢复列表")!.click());
    await flush();
    await flush();
    expect(fetchGenerationRecovery).toHaveBeenLastCalledWith(0, expect.any(AbortSignal));
    expect(container.textContent).toContain("共 10 条 · 每页 10 条 · 第 1 / 1 页");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(button("上一页")?.disabled).toBe(true);
    expect(button("下一页")?.disabled).toBe(true);
  });

  it("shows loading, retryable list failures and an empty result", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(fetchGenerationRecovery).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    await render();
    expect(container.textContent).toContain("正在读取待恢复任务");
    await act(async () => reject(new Error("读取暂时失败")));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("读取暂时失败");
    vi.mocked(fetchGenerationRecovery).mockResolvedValue(page([]));
    await act(async () => button("重新加载恢复列表")!.click());
    await flush();
    expect(container.textContent).toContain("当前没有待恢复任务");
  });

  it("refreshes after a revision conflict and uses the new revision on explicit retry", async () => {
    await render();
    vi.mocked(resumeGenerationRecovery).mockRejectedValueOnce(new Error("任务记录已更新，请刷新"));
    vi.mocked(fetchGenerationRecovery).mockResolvedValue(page([row({ checkpoint_revision: 8 })]));
    await act(async () => resumeButton()!.click());
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("任务记录已更新");
    expect(fetchGenerationRecovery).toHaveBeenCalledTimes(2);
    vi.mocked(resumeGenerationRecovery).mockResolvedValue(row({ checkpoint_revision: 8, recovery_requested: true, can_resume: false }));
    await act(async () => resumeButton()!.click());
    expect(resumeGenerationRecovery).toHaveBeenLastCalledWith("job-original", 8);
  });
});
