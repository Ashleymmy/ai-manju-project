// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GenerationPrice, CreditBalance } from "./GenerationPrice";
import { fetchGenerationQuote, fetchMemberOverview } from "../services/memberApi";

vi.mock("../services/memberApi", () => ({ fetchGenerationQuote: vi.fn(), fetchMemberOverview: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe("creation credits", () => {
  it("shows automatic image fallback plus per-image references as one charge", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(fetchGenerationQuote).mockResolvedValue({ credits: 90, params: { pricing_source: "image_auto_fallback", base_per_image: 50, reference_count: 2, reference_per_image: 20 } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div"); const root = createRoot(container);
    const render = (compact = false) => root.render(<QueryClientProvider client={client}><GenerationPrice model="gpt-image-1.5" size="auto" quality="auto" references={2} tasks={2} compact={compact} /></QueryClientProvider>);
    await act(async () => { render(); await new Promise(r => setTimeout(r, 20)); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(container.textContent).toBe("预计 180 积分 · 自动规格");
    expect(container.querySelector("span")?.title).toContain("基础价 50 + 2 张参考图 × 20");
    await act(async () => render(true));
    expect(container.textContent).toBe("180");
    await act(async () => root.unmount()); client.clear();
  });
  it("re-quotes parameters without showing the previous cost, and sums independent jobs", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(fetchGenerationQuote).mockResolvedValue({ credits: 23, params: { pricing_source: "membership_price_sheet" } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div"); const root = createRoot(container);
    const render = (quality: string) => root.render(<QueryClientProvider client={client}><GenerationPrice model="gpt-image-1.5" size="2048x2048" quality={quality} tasks={2} /></QueryClientProvider>);
    await act(async () => { render("low"); await new Promise(r => setTimeout(r, 10)); });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(container.textContent).toContain("46");
    vi.mocked(fetchGenerationQuote).mockReturnValue(new Promise(() => {}));
    await act(async () => render("high"));
    expect(container.textContent).toContain("报价中"); expect(container.textContent).not.toContain("46");
    await act(async () => root.unmount()); client.clear();
  });
  it("shows available balance, excluding frozen credits, and free agent needs no query", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(fetchMemberOverview).mockResolvedValue({ permanent_available: 100, limited_available: 25, permanent_frozen: 50 } as Awaited<ReturnType<typeof fetchMemberOverview>>);
    const client = new QueryClient(); const container = document.createElement("div"); const root = createRoot(container);
    await act(async () => { root.render(<QueryClientProvider client={client}><CreditBalance /><GenerationPrice kind="free" /></QueryClientProvider>); await new Promise(r => setTimeout(r, 10)); });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(container.textContent).toContain("125"); expect(container.textContent).toContain("免费");
    expect(fetchGenerationQuote).not.toHaveBeenCalled();
    await act(async () => root.unmount()); client.clear();
  });

  it("renders the compact generation toolbar price as an icon and value", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(fetchGenerationQuote).mockResolvedValue({ credits: 19, params: { pricing_source: "membership_price_sheet" } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div"); const root = createRoot(container);
    await act(async () => { root.render(<QueryClientProvider client={client}><GenerationPrice compact model="gpt-image-2" size="1024x1024" quality="low" /></QueryClientProvider>); await new Promise(r => setTimeout(r, 20)); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(container.textContent).toContain("19");
    expect(container.querySelector(".generation-price-compact svg")).not.toBeNull();
    expect(container.textContent).not.toContain("预计");
    await act(async () => root.unmount()); client.clear();
  });

  it("quotes video presence and shows the combined output rate without adding it twice", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(fetchGenerationQuote).mockResolvedValue({ credits: 3300, params: { pricing_source: "membership_price_sheet", base_per_second: 195, reference_per_second: 135, per_second: 330 } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div"); const root = createRoot(container);
    const render = (seconds: string, compact = false) => root.render(<QueryClientProvider client={client}><GenerationPrice kind="video" model="seedance-2.5" resolution="720p" seconds={seconds} referenceVideos={1} compact={compact} /></QueryClientProvider>);
    await act(async () => { render("10"); await new Promise(r => setTimeout(r, 20)); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(fetchGenerationQuote).toHaveBeenCalledWith("video.generate", expect.objectContaining({ duration: 10, content: [{ type: "video_url" }] }), expect.any(AbortSignal));
    expect(container.textContent).toContain("3,300");
    expect(container.querySelector("span")?.title).toContain("195 + 附加 135 = 330");
    vi.mocked(fetchGenerationQuote).mockResolvedValue({ credits: 9900, params: { pricing_source: "automatic_video_reservation", billing_mode: "actual_video_duration", reserve_duration_sec: 30, base_per_second: 195, reference_per_second: 135, per_second: 330 } });
    await act(async () => { render("-1"); await new Promise(r => setTimeout(r, 20)); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(container.textContent).toBe("预冻结 9,900 积分 · 按实际时长结算");
    expect(container.querySelector("span")?.title).toContain("最长 30 秒");
    expect(container.querySelector("span")?.title).toContain("195 + 附加 135 = 330");
    expect(container.querySelector("span")?.title).toContain("提交时的价格");
    expect(container.querySelector("span")?.title).toContain("剩余冻结积分自动释放");
    await act(async () => render("-1", true));
    expect(container.textContent).toBe("预冻结 9,900");
    await act(async () => root.unmount()); client.clear();
  });

  it("uses the server's automatic-duration reserve across independent tasks without inventing reference fees", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(fetchGenerationQuote).mockResolvedValue({ credits: 123, params: { billing_mode: "actual_video_duration", reserve_duration_sec: 15, per_second: 12 } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div"); const root = createRoot(container);
    await act(async () => { root.render(<QueryClientProvider client={client}><GenerationPrice kind="video" model="video-fast" seconds={-1} tasks={2} /></QueryClientProvider>); await new Promise(r => setTimeout(r, 20)); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(container.textContent).toBe("预冻结 246 积分 · 按实际时长结算");
    expect(container.querySelector("span")?.title).toContain("最长 15 秒");
    expect(container.querySelector("span")?.title).not.toContain("附加费");
    expect(fetchGenerationQuote).toHaveBeenCalledWith("video.generate", expect.objectContaining({ duration: -1, content: [] }), expect.any(AbortSignal));
    await act(async () => root.unmount()); client.clear();
  });
});
