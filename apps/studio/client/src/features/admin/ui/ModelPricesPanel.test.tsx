// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelCreditPrices } from "@/features/member";
import { ModelPricesPanel } from "./ModelPricesPanel";
import { fetchAdminModelPrices, saveAdminModelPrices } from "../services/adminModelPricesApi";

vi.mock("../services/adminModelPricesApi", () => ({ fetchAdminModelPrices: vi.fn(), saveAdminModelPrices: vi.fn() }));

const prices: ModelCreditPrices = {
  images: { "gpt-image-2.5-flare": { "1k": [5, 10, 35, 60, 130] }, "gpt-image-1.5": { "2k": [22.5, 135, 540] }, "gemini-3-pro-image": { "1k": [50], "2k": [80], "4k": [80] }, "gemini-3.1-flash-image": { "1k": [50], "2k": [80], "4k": [80] } },
  videos: { "seedance-1.5-pro": { "720p": [20, 45, 0] }, "seedance-2.5": { "720p": [195, 195, 135] }, "minimax-h3": { "480p": [30, 30, 30], "768p": [40, 40, 40] }, "wan-3.0": { "1080p": [12, 12, 0] }, "wan-3.0-prime": { "1080p": [12, 12, 0] } },
  qualities: ["low", "medium", "high", "xhigh", "max"], image_reference: 20,
};

describe("model price editor", () => {
  let root: Root, container: HTMLDivElement, client: QueryClient;
  const flush = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const button = (text: string) => [...container.querySelectorAll("button")].find(b => b.textContent?.includes(text))!;
  const input = () => container.querySelector('input[aria-label="gpt-image-2.5-flare 1k 低 · low"]') as HTMLInputElement;
  async function change(element: HTMLInputElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function render(readOnly = false) {
    await act(async () => root.render(<QueryClientProvider client={client}><ModelPricesPanel readOnly={readOnly} /></QueryClientProvider>));
    await flush();
  }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    vi.mocked(fetchAdminModelPrices).mockResolvedValue(structuredClone(prices));
    vi.mocked(saveAdminModelPrices).mockImplementation(async value => ({ key: "model_credit_prices", value }));
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

  it("retains failed edits, saves decimals across model tabs and invalidates member quotes", async () => {
    client.setQueryData(["member", "quote", "test"], { credits: 5 });
    await render();
    await change(input(), "7.5");
    await act(async () => button("视频定价").click());
    expect(container.textContent).toContain("无声"); expect(container.textContent).toContain("有声");
    expect(container.querySelector("thead")?.textContent).not.toContain("参考视频附加费");
    await act(async () => button("图片定价").click());
    expect(input().value).toBe("7.5");
    vi.mocked(saveAdminModelPrices).mockRejectedValueOnce(new Error("保存网络异常"));
    await act(async () => button("保存全部定价").click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("保存网络异常");
    expect(input().value).toBe("7.5");
    await act(async () => button("保存全部定价").click());
    expect(saveAdminModelPrices).toHaveBeenLastCalledWith({ ...prices, images: { ...prices.images, "gpt-image-2.5-flare": { "1k": [7.5,10,35,60,130] } } });
    expect(client.getQueryState(["member", "quote", "test"])?.isInvalidated).toBe(true);
    expect(container.textContent).toContain("已保存");
  });

  it("blocks blank and overprecision values, and restores saved data on discard", async () => {
    await render();
    await change(input(), "");
    await act(async () => button("保存全部定价").click());
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await change(input(), "7.555");
    await act(async () => button("保存全部定价").click());
    expect(saveAdminModelPrices).not.toHaveBeenCalled();
    await act(async () => button("撤销未保存修改").click());
    expect(input().value).toBe("5");
    expect(button("保存全部定价").disabled).toBe(true);
  });

  it("auditors can read all prices but cannot edit or save", async () => {
    await render(true);
    expect(input().disabled).toBe(true);
    expect(button("保存全部定价")).toBeUndefined();
    await act(async () => button("视频定价").click());
    expect(container.textContent).toContain("seedance-1.5-pro");
    expect(saveAdminModelPrices).not.toHaveBeenCalled();
  });

  it("edits H3 480p and explains surcharge per generated second", async () => {
    await render();
    await act(async () => button("视频定价").click());
    const select = container.querySelector("select")!;
    await act(async () => { select.value = "minimax-h3"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    const surcharge = container.querySelector('input[aria-label="minimax-h3 480p 参考视频附加费"]') as HTMLInputElement;
    expect(surcharge.value).toBe("30");
    expect(container.textContent).toContain("× 生成视频秒数");
    expect(container.textContent).toContain("只引用图片、音频时");
    await change(surcharge, "12.5");
    await act(async () => button("保存全部定价").click());
    expect(vi.mocked(saveAdminModelPrices).mock.calls[0][0].videos["minimax-h3"]["480p"]).toEqual([30, 30, 12.5]);
  });

  it("exposes Gemini resolution prices and editable zero Wan 1080p surcharges", async () => {
    await render();
    const select = container.querySelector("select")!;
    for (const name of ["gemini-3-pro-image", "gemini-3.1-flash-image"]) {
      await act(async () => { select.value = name; select.dispatchEvent(new Event("change", { bubbles: true })); });
      expect(container.querySelector("thead")?.textContent).toBe("分辨率按分辨率计价");
      const price = container.querySelector(`input[aria-label="${name} 2k 按分辨率计价"]`) as HTMLInputElement;
      expect(price.value).toBe("80");
      await change(price, "81.5");
    }
    await act(async () => button("视频定价").click());
    for (const name of ["wan-3.0", "wan-3.0-prime"]) {
      await act(async () => { select.value = name; select.dispatchEvent(new Event("change", { bubbles: true })); });
      const price = container.querySelector(`input[aria-label="${name} 1080p 参考视频附加费"]`) as HTMLInputElement;
      expect(price.value).toBe("0");
      await change(price, "2.5");
    }
    await act(async () => button("保存全部定价").click());
    const saved = vi.mocked(saveAdminModelPrices).mock.calls[0][0];
    for (const name of ["gemini-3-pro-image", "gemini-3.1-flash-image"]) expect(saved.images[name]["2k"]).toEqual([81.5]);
    for (const name of ["wan-3.0", "wan-3.0-prime"]) expect(saved.videos[name]["1080p"]).toEqual([12, 12, 2.5]);
    expect(saved.images["gpt-image-2.5-flare"]).toEqual(prices.images["gpt-image-2.5-flare"]);
  });
});
