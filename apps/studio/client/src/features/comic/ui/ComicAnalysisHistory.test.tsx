// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComicAnalysisDetail, ComicAnalysisHistoryPage } from "@/entities/comic";

const mocks = vi.hoisted(() => ({ list: vi.fn(), resume: vi.fn(), token: "first-account" }));
vi.mock("@/entities/comic", async original => ({ ...await original<object>(), listComicAnalysisHistory: mocks.list, resumeComicAnalysis: mocks.resume }));
vi.mock("@/shared/api/http", async original => ({ ...await original<object>(), getAuthToken: () => mocks.token }));
import { ComicAnalysisHistory } from "./ComicAnalysisHistory";

const item = { id: "server-only-session", title: "原剧本", source_file_name: "原文件.txt", status: "active" as const, created_at: "2026-09-26T00:00:00Z", expires_at: "2026-10-03T00:00:00Z" };
const detail = { session: item, revisions: [] } as unknown as ComicAnalysisDetail;

describe("server analysis discovery", () => {
  let root: Root, container: HTMLDivElement;
  const onRecovered = vi.fn();
  const button = (text: string) => [...container.querySelectorAll("button")].find(value => value.textContent === text)!;
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.clearAllMocks(); sessionStorage.clear(); localStorage.clear(); mocks.token = "first-account";
    mocks.list.mockResolvedValue({ items: [item] }); mocks.resume.mockResolvedValue(detail);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<ComicAnalysisHistory scope="personal" onRecovered={onRecovered} />));
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  it("finds a server task without any saved browser identity and restores it explicitly", async () => {
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.resume).not.toHaveBeenCalled();
    await act(async () => button("找回分析记录").click());
    expect(container.textContent).toContain("原剧本");
    expect(mocks.resume).not.toHaveBeenCalled();
    await act(async () => button("继续查看").click());
    expect(mocks.resume).toHaveBeenCalledWith(item.id, "personal", expect.any(AbortSignal));
    expect(onRecovered).toHaveBeenCalledWith(detail, expect.any(AbortSignal));
    expect(container.textContent).not.toContain("原剧本");
  });

  it("loads older records rather than silently limiting discovery to one page", async () => {
    mocks.list.mockResolvedValueOnce({ items: [item], next_cursor: "next-page" } as ComicAnalysisHistoryPage)
      .mockResolvedValueOnce({ items: [{ ...item, id: "older", title: "更早剧本" }] });
    await act(async () => button("找回分析记录").click());
    await act(async () => button("更早的记录").click());
    expect(mocks.list).toHaveBeenNthCalledWith(2, "personal", "next-page", expect.any(AbortSignal));
    expect(container.textContent).toContain("原剧本"); expect(container.textContent).toContain("更早剧本");
  });

  it("closing the panel aborts reads and ignores a late result", async () => {
    let finish!: (value: ComicAnalysisDetail) => void;
    mocks.resume.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => button("找回分析记录").click());
    await act(async () => button("继续查看").click());
    const signal = mocks.resume.mock.calls[0][2] as AbortSignal;
    await act(async () => button("收起记录").click());
    expect(signal.aborted).toBe(true);
    await act(async () => finish(detail));
    expect(onRecovered).not.toHaveBeenCalled();
  });

  it("never shows another account's late task response", async () => {
    let finish!: (value: ComicAnalysisDetail) => void;
    mocks.resume.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => button("找回分析记录").click());
    await act(async () => button("继续查看").click());
    mocks.token = "second-account";
    await act(async () => finish(detail));
    expect(onRecovered).not.toHaveBeenCalled();
  });

  it("unmounting on project navigation aborts outstanding status reads", async () => {
    let finish!: (value: ComicAnalysisDetail) => void;
    mocks.resume.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => button("找回分析记录").click());
    await act(async () => button("继续查看").click());
    const signal = mocks.resume.mock.calls[0][2] as AbortSignal;
    await act(async () => root.render(<p>another project</p>));
    expect(signal.aborted).toBe(true);
    await act(async () => finish(detail));
    expect(onRecovered).not.toHaveBeenCalled();
  });

  it("aborts an outstanding list request when the panel closes", async () => {
    let finish!: (value: ComicAnalysisHistoryPage) => void;
    mocks.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => button("找回分析记录").click());
    const signal = mocks.list.mock.calls[0][2] as AbortSignal;
    await act(async () => button("收起记录").click());
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ items: [item] }));
    expect(container.textContent).not.toContain("原剧本");
  });

  it("clears the previous space and aborts its recovery when scope changes without a remount", async () => {
    mocks.resume.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => button("找回分析记录").click());
    await act(async () => button("继续查看").click());
    const signal = mocks.resume.mock.calls[0][2] as AbortSignal;
    await act(async () => root.render(<ComicAnalysisHistory scope="team" onRecovered={onRecovered} />));
    expect(signal.aborted).toBe(true);
    expect(container.textContent).not.toContain("原剧本");
    await act(async () => button("找回分析记录").click());
    expect(mocks.list).toHaveBeenLastCalledWith("team", undefined, expect.any(AbortSignal));
  });

  it("allows recovery again after token renewal ends the previous read", async () => {
    let finish!: (value: ComicAnalysisDetail) => void;
    mocks.resume.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => button("找回分析记录").click());
    await act(async () => button("继续查看").click());
    mocks.token = "renewed-token";
    await act(async () => finish(detail));
    expect(onRecovered).not.toHaveBeenCalled();
    await act(async () => button("找回分析记录").click());
    expect(button("继续查看").disabled).toBe(false);
    await act(async () => button("继续查看").click());
    expect(onRecovered).toHaveBeenCalledOnce();
  });

  it("propagates closing through the recovered-project load callback", async () => {
    let finish!: () => void;
    const applied = vi.fn();
    onRecovered.mockImplementationOnce(async (_detail, signal: AbortSignal) => {
      await new Promise<void>(resolve => { finish = resolve; });
      if (!signal.aborted) applied();
    });
    await act(async () => button("找回分析记录").click());
    await act(async () => button("继续查看").click());
    const signal = onRecovered.mock.calls[0][1] as AbortSignal;
    await act(async () => button("收起记录").click());
    expect(signal.aborted).toBe(true);
    await act(async () => finish());
    expect(applied).not.toHaveBeenCalled();
  });

  it("does not append a stale older page after refreshing the list", async () => {
    let finish!: (value: ComicAnalysisHistoryPage) => void;
    mocks.list.mockResolvedValueOnce({ items: [item], next_cursor: "older" })
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce({ items: [{ ...item, id: "new", title: "新列表" }] });
    await act(async () => button("找回分析记录").click());
    await act(async () => button("更早的记录").click());
    await act(async () => button("找回分析记录").click());
    expect((mocks.list.mock.calls[1][2] as AbortSignal).aborted).toBe(true);
    await act(async () => finish({ items: [{ ...item, id: "old", title: "过期分页" }] }));
    expect(container.textContent).toContain("新列表");
    expect(container.textContent).not.toContain("过期分页");
  });
});
