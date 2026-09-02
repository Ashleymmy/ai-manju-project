import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildModelProviderPayload,
  fetchAdminMonitoring,
  fetchModelProviderModels,
  mergeProviderModels,
  testModelProvider,
  type ModelProviderConfig,
} from "./adminApi";
import { clearProviderSensitiveInputState } from "../model/provider";
import { adminTabFromLocation } from "../model/routes";
import {
  buildSeedanceAssetListParams,
  paginateSeedanceAssets,
} from "../model/seedance";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const provider: ModelProviderConfig = {
  id: "",
  name: "  Wan Provider  ",
  preset_id: "aliyun_yike",
  provider_type: "aliyun_yike",
  mode: "openai_compatible",
  base_url: " https://example.com ",
  auth_type: "auto_api_key",
  text_model: "text-main",
  image_model: "image-disabled",
  video_model: "video-main",
  audio_model: "",
  capabilities: ["text", "video", "audio", "text"],
  models_by_capability: {
    text: ["text-alt", "text-main"],
    image: ["image-disabled"],
    video: ["video-main"],
  },
  default_for: ["text", "image", "audio"],
  model_aliases: { " text-main ": " 主模型 ", empty: " " },
  model_protocols: { " image-disabled ": "auto" },
  endpoint_overrides: { " video_create ": " /videos ", empty: " " },
  extra_headers: { " X-Tenant ": " team-a ", empty: " " },
  timeout_ms: 999_999,
  max_concurrency: 20,
  enabled: true,
};

function apiResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: status < 400, data }), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-Id": "admin-request" },
  });
}

describe("admin provider API", () => {
  beforeEach(() => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tests and loads models for an unsaved provider through the singleton endpoints", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(apiResponse({ ok: true, text_ok: true }))
      .mockResolvedValueOnce(apiResponse({ audio_models: ["voice-v1"] }));
    const payload = buildModelProviderPayload(provider);

    await expect(testModelProvider(payload)).resolves.toMatchObject({ ok: true, text_ok: true });
    await expect(fetchModelProviderModels(payload)).resolves.toMatchObject({ audio_models: ["voice-v1"] });

    const [testUrl, testOptions] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const [modelsUrl, modelsOptions] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit];
    expect(new URL(testUrl).pathname).toBe("/api/admin/model-provider/test");
    expect(new URL(modelsUrl).pathname).toBe("/api/admin/model-provider/models");
    expect(testOptions.method).toBe("POST");
    expect(modelsOptions.method).toBe("POST");
  });

  it("cleans credentials, maps and disabled capabilities before submitting", () => {
    const payload = buildModelProviderPayload(provider, {
      apiKey: " secret-key ",
      secrets: { " asset_key ": " asset-secret ", empty: " " },
    });

    expect(payload).toMatchObject({
      id: undefined,
      name: "Wan Provider",
      base_url: "https://example.com",
      capabilities: ["text", "video", "audio"],
      text_model: "text-main",
      image_model: "",
      video_model: "video-main",
      audio_model: "",
      default_for: ["text"],
      endpoint_overrides: { video_create: "/videos" },
      extra_headers: { "X-Tenant": "team-a" },
      api_key: "secret-key",
      secrets: { asset_key: "asset-secret" },
      timeout_ms: 600_000,
      max_concurrency: 8,
    });
    expect(payload.models_by_capability?.image).toBeUndefined();
    expect(payload.model_protocols).toEqual({});
  });

  it("merges pulled models without replacing manual entries and fills the audio default", () => {
    const merged = mergeProviderModels(provider, {
      text_models: ["text-pulled"],
      audio_models: ["voice-v1", "voice-v2"],
      default_audio_model: "voice-v2",
    });

    expect(merged.models_by_capability?.text).toEqual(["text-alt", "text-main", "text-pulled"]);
    expect(merged.models_by_capability?.audio).toEqual(["voice-v1", "voice-v2"]);
    expect(merged.audio_model).toBe("voice-v2");
    expect(merged.text_model).toBe("text-main");
  });

  it("normalizes partial monitoring responses into safe page defaults", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({
      health: { db: "postgres", db_ok: true },
      summary: { total_requests: 3 },
    }));

    const monitoring = await fetchAdminMonitoring(168);

    expect(monitoring.window.hours).toBe(168);
    expect(monitoring.health).toMatchObject({ db: "postgres", db_ok: true, storage: "-" });
    expect(monitoring.summary).toMatchObject({ total_requests: 3, error_requests: 0, total_units: 0 });
    expect(monitoring.storage_stats).toEqual({ users: 0, projects: 0, snapshots: 0, assets: 0, ai_requests: 0 });
    expect(monitoring.users).toEqual([]);
    expect(monitoring.models).toEqual([]);
    expect(monitoring.recent).toEqual([]);
    expect(monitoring.logs).toEqual([]);
  });
});

describe("admin route mapping", () => {
  it("uses monitoring as the default admin landing page and preserves deep links", () => {
    expect(adminTabFromLocation("/admin", "")).toBe("monitoring");
    expect(adminTabFromLocation("/admin", "#monitoring")).toBe("monitoring");
    expect(adminTabFromLocation("/admin/users", "")).toBe("users");
    expect(adminTabFromLocation("/admin/model-provider", "")).toBe("providers");
    expect(adminTabFromLocation("/admin/announcements", "")).toBe("announcements");
    expect(adminTabFromLocation("/admin/seedance-assets", "")).toBe("seedance");
  });

  it("clears temporary credentials before a provider context switch", () => {
    const setApiKey = vi.fn();
    const setProviderSecrets = vi.fn();
    const setProviderTestResult = vi.fn();

    clearProviderSensitiveInputState(setApiKey, setProviderSecrets, setProviderTestResult);

    expect(setApiKey).toHaveBeenCalledWith("");
    expect(setProviderSecrets).toHaveBeenCalledWith({});
    expect(setProviderTestResult).toHaveBeenCalledWith(null);
  });
});

describe("admin Seedance asset list", () => {
  it("normalizes the production filters and raises the fetch window to 100", () => {
    expect(buildSeedanceAssetListParams({
      search: "  demo asset  ",
      status: "Active",
      type: "Video",
      tagId: "tag-1",
    })).toEqual({ search: "demo asset", status: "Active", type: "Video", tag_id: "tag-1", limit: 100 });
    expect(buildSeedanceAssetListParams({ search: "   " })).toEqual({ limit: 100 });
  });

  it("paginates loaded assets by ten and clamps invalid pages", () => {
    const items = Array.from({ length: 23 }, (_, index) => `asset-${index + 1}`);
    expect(paginateSeedanceAssets(items, 2)).toEqual({
      items: items.slice(10, 20),
      page: 2,
      pageCount: 3,
    });
    expect(paginateSeedanceAssets(items, 99).page).toBe(3);
    expect(paginateSeedanceAssets([], 4)).toEqual({ items: [], page: 1, pageCount: 1 });
  });
});
