// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ listUserSeedanceAssets: vi.fn(), uploadUserSeedanceAsset: vi.fn() }));
vi.mock("@/entities/asset", async (original) => ({ ...(await original<typeof import("@/entities/asset")>()), ...api }));
import SeedanceAssetPanel from "./SeedanceAssetPanel";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("上传注册后轮询状态，仅 Active 素材允许引用", async () => {
  const pending = { id: "one", name: "hero.png", status: "Processing", asset_type: "Image", volcano_asset_id: "" };
  api.listUserSeedanceAssets.mockResolvedValue({ items: [], total: 0 });
  api.uploadUserSeedanceAsset.mockResolvedValue(pending);
  await act(async () => root.render(<SeedanceAssetPanel scope="personal" />));
  await act(async () => vi.advanceTimersByTimeAsync(260));
  expect(container.textContent).toContain("上传并注册拟真人");
  api.listUserSeedanceAssets.mockResolvedValue({ items: [pending], total: 1 });
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(["image"], "hero.png", { type: "image/png" });
  Object.defineProperty(input, "files", { value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(api.uploadUserSeedanceAsset).toHaveBeenCalledWith(file, "personal");
  expect(container.querySelector<HTMLButtonElement>(".wb-seedance-thumb")!.disabled).toBe(true);
  expect(container.textContent).not.toContain("asset://undefined");
  api.listUserSeedanceAssets.mockResolvedValue({ items: [{ ...pending, status: "Active", volcano_asset_id: "remote-one" }], total: 1 });
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(container.querySelector<HTMLButtonElement>(".wb-seedance-thumb")!.disabled).toBe(false);
  expect(container.textContent).toContain("asset://remote-one");
});

it("renders image and video material cards from thumbnails without fetching originals", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  api.listUserSeedanceAssets.mockResolvedValue({ items: ["Image", "Video"].map((asset_type, index) => ({
    id: String(index), name: asset_type, status: "Active", asset_type, volcano_asset_id: `registered-${index}`,
    source_url: `/api/sd-video/volcano/assets/${index}/content?scope=team`,
  })), total: 2 });
  await act(async () => root.render(<SeedanceAssetPanel scope="team" />));
  await act(async () => vi.advanceTimersByTimeAsync(260));
  const images = container.querySelectorAll("img");
  expect(images).toHaveLength(2);
  for (const img of images) {
    expect(img.src).toContain("/thumbnail?scope=team");
    expect(img.getAttribute("loading")).toBe("lazy");
  }
  expect(container.querySelector("video")).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});
