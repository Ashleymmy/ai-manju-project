// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { getAsset, getAssetLibrary } from "@/entities/asset";
import { useAssetLibraryPageQuery } from "./queries";

vi.mock("@/entities/asset", async importOriginal => ({
  ...await importOriginal<typeof import("@/entities/asset")>(),
  getAsset: vi.fn(),
  getAssetLibrary: vi.fn(),
}));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("opens off-page linked details without adding a 51st card or dropping a paginated asset", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const items = Array.from({ length: 50 }, (_, index) => ({ id: `asset-${index}`, type: "image", name: `图片 ${index}` }));
  const linked = { id: "off-page", type: "video", name: "链接中的视频" };
  vi.mocked(getAssetLibrary).mockResolvedValue({ items, total: 101 } as Awaited<ReturnType<typeof getAssetLibrary>>);
  vi.mocked(getAsset).mockResolvedValue(linked as Awaited<ReturnType<typeof getAsset>>);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = document.createElement("div");
  const root = createRoot(element);
  function Harness() {
    const result = useAssetLibraryPageQuery("personal", "all", { page: 1, pageSize: 50 }, 0, "off-page");
    return <output>{result.data ? JSON.stringify(result.data) : "loading"}</output>;
  }
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
    await vi.waitFor(async () => {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
      expect(element.textContent).not.toBe("loading");
    });
    const result = JSON.parse(element.textContent!);
    expect(result.items).toEqual(items);
    expect(result.items).toHaveLength(50);
    expect(result.total).toBe(101);
    expect(result.linkedAsset).toEqual(linked);
    expect(result.deepLinkMissing).toBe(false);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
