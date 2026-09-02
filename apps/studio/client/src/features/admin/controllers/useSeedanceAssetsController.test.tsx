// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const assetMocks = vi.hoisted(() => ({
  getSeedanceAssetReadiness: vi.fn(),
  listAdminSeedanceAssets: vi.fn(),
  listSeedanceAssetTags: vi.fn(),
}));

vi.mock("@/entities/asset", async importOriginal => ({
  ...(await importOriginal<typeof import("@/entities/asset")>()),
  getSeedanceAssetReadiness: assetMocks.getSeedanceAssetReadiness,
  listAdminSeedanceAssets: assetMocks.listAdminSeedanceAssets,
  listSeedanceAssetTags: assetMocks.listSeedanceAssetTags,
}));

import {
  useSeedanceAssetsController,
  type SeedanceAssetsController,
} from "./useSeedanceAssetsController";

const readiness = (providerId: string) => ({
  provider_configured: true,
  provider_id: providerId,
  upload_registration_available: true,
  public_asset_base_url_configured: true,
});

const assetList = (id: string) => ({
  items: [
    {
      id,
      volcano_asset_id: `${id}-remote`,
      name: id,
      asset_type: "Image",
      status: "active",
    },
  ],
  total: 1,
});

describe("Seedance assets controller queries", () => {
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let root: Root;
  let latest: SeedanceAssetsController;

  function Harness() {
    latest = useSeedanceAssetsController();
    return null;
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    assetMocks.getSeedanceAssetReadiness
      .mockReset()
      .mockResolvedValue(readiness("provider-initial"));
    assetMocks.listAdminSeedanceAssets
      .mockReset()
      .mockImplementation(async params =>
        assetList(params?.search ? `asset-${params.search}` : "asset-initial")
      );
    assetMocks.listSeedanceAssetTags.mockReset().mockResolvedValue({
      items: [{ id: "tag-initial", name: "Initial" }],
    });
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
      },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>
      );
    });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }

  it("sends one list request when applying filters", async () => {
    await render();
    assetMocks.listAdminSeedanceAssets.mockClear();

    await act(async () => {
      await latest.loadAssets({ search: "filtered" });
    });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(assetMocks.listAdminSeedanceAssets).toHaveBeenCalledTimes(1);
    expect(assetMocks.listAdminSeedanceAssets).toHaveBeenCalledWith(
      expect.objectContaining({ search: "filtered" })
    );
    expect(latest.assets[0]?.id).toBe("asset-filtered");
  });

  it("updates successful refresh results when one Seedance request fails", async () => {
    await render();
    assetMocks.getSeedanceAssetReadiness.mockResolvedValueOnce(
      readiness("provider-refreshed")
    );
    assetMocks.listAdminSeedanceAssets.mockRejectedValueOnce(
      new Error("asset list unavailable")
    );
    assetMocks.listSeedanceAssetTags.mockResolvedValueOnce({
      items: [{ id: "tag-refreshed", name: "Refreshed" }],
    });

    await act(async () => {
      await latest.reload();
    });

    expect(latest.assets[0]?.id).toBe("asset-initial");
    expect(latest.readiness?.provider_id).toBe("provider-refreshed");
    expect(latest.tags).toEqual([
      { id: "tag-refreshed", name: "Refreshed" },
    ]);
  });
});
