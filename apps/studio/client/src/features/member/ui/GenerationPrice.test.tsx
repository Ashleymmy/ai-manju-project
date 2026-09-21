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
});
