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
  images: { "gpt-image-2.5-flare": { "1k": [5, 10, 35, 60, 130] }, "gpt-image-1.5": { "2k": [22.5, 135, 540] } },
  videos: { "seedance-1.5-pro": { "720p": [20, 45, 0] }, "seedance-2.5": { "720p": [195, 195, 135] } },
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
    expect(container.textContent).not.toContain("参考视频附加费");
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
});
