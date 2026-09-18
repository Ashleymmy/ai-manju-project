// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  listModelProviderPresets: vi.fn(),
  listModelProviders: vi.fn(),
  updateModelProvider: vi.fn(),
  createModelProvider: vi.fn(),
}));

vi.mock("../services/adminApi", async importOriginal => ({
  ...(await importOriginal<typeof import("../services/adminApi")>()),
  listModelProviderPresets: serviceMocks.listModelProviderPresets,
  listModelProviders: serviceMocks.listModelProviders,
  updateModelProvider: serviceMocks.updateModelProvider,
  createModelProvider: serviceMocks.createModelProvider,
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
    serviceMocks.listModelProviders.mockReset().mockImplementation(async () => [
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
    serviceMocks.updateModelProvider
      .mockReset()
      .mockImplementation(async (id, payload) => ({ ...payload, id }));
    serviceMocks.createModelProvider
      .mockReset()
      .mockImplementation(async payload => ({
        ...payload,
        id: "new-provider",
      }));
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

  it("clears sensitive inputs when a deep-equal provider list is reloaded", async () => {
    await render(true);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    await act(async () => {
      latest.setApiKey("temporary-api-key");
      latest.setProviderSecrets({ asset_key: "temporary-asset-key" });
    });

    await act(async () => {
      await latest.reload();
    });

    expect(serviceMocks.listModelProviders).toHaveBeenCalledTimes(2);
    expect(latest.apiKey).toBe("");
    expect(latest.providerSecrets).toEqual({});
    expect(latest.providerTestResult).toBeNull();
  });
  it("card toggles target their own provider and never send editor credentials", async () => {
    await render(true);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const first = latest.providers[0];
    await act(async () => {
      latest.setApiKey("unsaved-editor-key");
      latest.setProviderSecrets({ asset_key: "unsaved-editor-secret" });
    });
    const second = {
      ...first,
      id: "provider-2",
      name: "Second",
      enabled: false,
    };
    await act(async () => {
      expect(await latest.toggleProvider(second)).toBe(true);
    });
    expect(serviceMocks.updateModelProvider).toHaveBeenCalledWith(
      "provider-2",
      expect.objectContaining({ enabled: true })
    );
    const payload = serviceMocks.updateModelProvider.mock.calls[0][1];
    expect(JSON.stringify(payload)).not.toContain("unsaved-editor");
    expect(serviceMocks.createModelProvider).not.toHaveBeenCalled();
  });

  it("a copied provider saves as a new record even when another provider was selected", async () => {
    await render(true);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const original = latest.providers[0];
    await act(async () => {
      expect(
        await latest.saveProvider({ ...original, id: "", name: "Copy" })
      ).toBe(true);
    });
    expect(serviceMocks.createModelProvider).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Copy" })
    );
    expect(serviceMocks.updateModelProvider).not.toHaveBeenCalled();
  });
});
