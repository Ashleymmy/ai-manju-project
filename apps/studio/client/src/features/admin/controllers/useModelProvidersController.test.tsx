// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  listModelProviderPresets: vi.fn(),
  listModelProviders: vi.fn(),
}));

vi.mock("../services/adminApi", async importOriginal => ({
  ...(await importOriginal<typeof import("../services/adminApi")>()),
  listModelProviderPresets: serviceMocks.listModelProviderPresets,
  listModelProviders: serviceMocks.listModelProviders,
}));

import {
  useModelProvidersController,
  type ModelProvidersController,
} from "./useModelProvidersController";

describe("model provider controller secrets", () => {
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let root: Root;
  let latest: ModelProvidersController;

  function Harness({ active }: { active: boolean }) {
    latest = useModelProvidersController(active);
    return null;
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    serviceMocks.listModelProviders.mockReset().mockResolvedValue([
      {
        id: "provider-1",
        name: "Provider One",
        mode: "openai_compatible",
        base_url: "https://example.com",
        auth_type: "bearer",
        text_model: "text-v1",
        timeout_ms: 30_000,
        max_concurrency: 1,
        enabled: true,
      },
    ]);
    serviceMocks.listModelProviderPresets.mockReset().mockResolvedValue([]);
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

  async function render(active: boolean) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness active={active} />
        </QueryClientProvider>
      );
    });
  }

  it("clears API keys and preset secrets when the provider form is left", async () => {
    await render(true);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(latest.providers).toHaveLength(1);

    await act(async () => {
      latest.setApiKey("temporary-api-key");
      latest.setProviderSecrets({ asset_key: "temporary-asset-key" });
    });
    expect(latest.apiKey).toBe("temporary-api-key");
    expect(latest.providerSecrets).toEqual({
      asset_key: "temporary-asset-key",
    });

    await render(false);

    expect(latest.apiKey).toBe("");
    expect(latest.providerSecrets).toEqual({});
    expect(latest.providerTestResult).toBeNull();
  });
});
