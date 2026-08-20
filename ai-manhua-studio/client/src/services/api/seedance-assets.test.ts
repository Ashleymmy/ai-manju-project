import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureSeedanceAssetsActive,
  listSeedanceAssetMentions,
  seedanceAssetRef,
} from "./seedance-assets";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function apiResponse(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Seedance asset API", () => {
  beforeEach(() => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(apiResponse({ items: [], total: 0 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads mention assets with the production query contract", async () => {
    await listSeedanceAssetMentions({ search: "人物 A", tag_id: "tag-1", limit: 100 });

    const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const target = new URL(url);
    expect(target.pathname).toBe("/api/ai/seedance-assets/mentions");
    expect(target.searchParams.get("search")).toBe("人物 A");
    expect(target.searchParams.get("tag_id")).toBe("tag-1");
    expect(target.searchParams.get("limit")).toBe("100");
  });

  it("validates selected assets and builds the canonical asset reference", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({ active: true }));

    await ensureSeedanceAssetsActive(["volcano-asset"]);

    const [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/api/ai/seedance-assets/ensure-active");
    expect(options.method).toBe("POST");
    expect(JSON.parse(String(options.body))).toEqual({ asset_ids: ["volcano-asset"] });
    expect(seedanceAssetRef({ volcano_asset_id: "volcano-asset" })).toBe("asset://volcano-asset");
  });
});
