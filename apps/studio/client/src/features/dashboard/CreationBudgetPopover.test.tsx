// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchImageModelCatalog } from "@/entities/model";
import { fetchGenerationQuote } from "@/features/member/services/memberApi";
import { CreationBudgetPopover } from "./CreationBudgetPopover";

vi.mock("@/entities/model", async importOriginal => ({ ...await importOriginal<typeof import("@/entities/model")>(), fetchImageModelCatalog: vi.fn() }));
vi.mock("@/features/member/services/memberApi", () => ({ fetchGenerationQuote: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "budget-test" } }) }));
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
let container: HTMLDivElement;
const exact = { credits: 23, params: { pricing_source: "membership_price_sheet" } };
const text = () => document.body.textContent || "";
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function click(label: string) {
  const button = Array.from(document.querySelectorAll("button")).find(item => item.getAttribute("aria-label") === label || item.textContent === label);
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
  await settle();
}
async function select(index: number, value: string) {
  await act(async () => {
    const element = document.querySelectorAll("select")[index];
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}
async function render(available: number | undefined = 600) {
  await act(async () => root.render(<QueryClientProvider client={client}><CreationBudgetPopover available={available} /></QueryClientProvider>));
  await settle();
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  vi.mocked(fetchImageModelCatalog).mockResolvedValue({ models: ["gpt-image-2", "gemini-3-pro-image"], defaultModel: "gpt-image-2", labels: {}, providerNames: {} });
  vi.mocked(fetchGenerationQuote).mockResolvedValue(exact);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); client.clear(); vi.unstubAllGlobals(); });

it("loads lazily, quotes only explicit selections, and updates after the balance changes", async () => {
  await render();
  expect(fetchImageModelCatalog).not.toHaveBeenCalled();
  await click("灵感还能走多远");
  expect(fetchImageModelCatalog).toHaveBeenCalledTimes(1);
  expect(text()).toContain("按文字生图估算参考图生图的积分消耗不同");
  expect(fetchGenerationQuote).not.toHaveBeenCalled();
  await select(0, "gpt-image-2");
  expect(fetchGenerationQuote).not.toHaveBeenCalled();
  await select(1, "low");
  expect(fetchGenerationQuote).toHaveBeenCalledWith("image.generate", { model: "gpt-image-2", size: "1024x1024", quality: "low", n: 1 }, expect.any(AbortSignal));
  expect(text()).toContain("26张图片");
  await render(46);
  expect(text()).toContain("2张图片");
  await click("关闭创作预估");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("cancels old requests and never displays a previous selection after a late response or quote failure", async () => {
  await render(); await click("灵感还能走多远"); await select(0, "gpt-image-2"); await select(1, "low");
  expect(text()).toContain("26张图片");
  let finish!: (value: typeof exact) => void;
  let signal: AbortSignal | undefined;
  vi.mocked(fetchGenerationQuote).mockImplementationOnce((_kind, _payload, abortSignal) => {
    signal = abortSignal;
    return new Promise(resolve => { finish = resolve; });
  });
  await select(1, "medium");
  expect(text()).toContain("正在获取当前报价");
  expect(text()).not.toContain("26张图片");
  vi.mocked(fetchGenerationQuote).mockRejectedValueOnce(new Error("unavailable"));
  await select(1, "high");
  expect(signal?.aborted).toBe(true);
  await act(async () => finish({ ...exact, credits: 1 })); await settle();
  expect(text()).toContain("报价暂不可用");
  expect(text()).not.toContain("张图片");
  await click("重新报价");
  expect(text()).toContain("26张图片");
  await act(async () => client.invalidateQueries({ queryKey: ["member", "creation-budget"] })); await settle();
  await select(0, "gemini-3-pro-image");
  expect(text()).not.toContain("26张图片");
  expect(Array.from(document.querySelectorAll("select")[1].options).map(option => option.value)).toEqual(["", "auto"]);
});

it("hides cached estimates if a background refresh fails and can recover", async () => {
  await render(); await click("灵感还能走多远"); await select(0, "gpt-image-2"); await select(1, "low");
  vi.mocked(fetchGenerationQuote).mockRejectedValueOnce(new Error("refresh failed"));
  await act(async () => client.invalidateQueries({ queryKey: ["member", "creation-budget"] })); await settle();
  expect(text()).toContain("报价暂不可用");
  expect(text()).not.toContain("26张图片");
  await click("重新报价");
  expect(text()).toContain("26张图片");
});

it("offers retry for a failed model catalog without fabricated options", async () => {
  vi.mocked(fetchImageModelCatalog).mockRejectedValueOnce(new Error("offline"));
  await render(); await click("灵感还能走多远");
  expect(text()).toContain("图片模型暂未能加载");
  expect(fetchGenerationQuote).not.toHaveBeenCalled();
  await click("重新加载");
  expect(text()).toContain("gpt-image-2");
});
