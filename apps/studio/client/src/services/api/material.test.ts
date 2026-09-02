import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMaterialAsset,
  ensureMaterialAssetsActive,
  getVisualValidateResult,
  materialAssetFromResponse,
  materialBytedToken,
  materialH5Link,
} from "./material";

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

describe("Seedance material API", () => {
  beforeEach(() => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => apiResponse({ ok: true })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the production material routes and request bodies", async () => {
    await createMaterialAsset({ GroupId: "group-1", Name: "人物 A" });
    await getVisualValidateResult("token / 1");
    await ensureMaterialAssetsActive(["asset-1"]);

    const calls = vi.mocked(fetch).mock.calls as Array<[string, RequestInit]>;
    expect(new URL(calls[0][0]).pathname).toBe("/api/ai/materials");
    expect(calls[0][1].method).toBe("POST");
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ GroupId: "group-1", Name: "人物 A" });
    expect(new URL(calls[1][0]).searchParams.get("BytedToken")).toBe("token / 1");
    expect(new URL(calls[2][0]).pathname).toBe("/api/ai/materials/ensure-active");
    expect(JSON.parse(String(calls[2][1].body))).toEqual({ asset_ids: ["asset-1"] });
  });

  it("extracts nested asset, token and H5 values without assuming one response shape", () => {
    const response = {
      Result: {
        Asset: { AssetID: "asset-1", AssetName: "人物 A", Status: "Active" },
        BytedToken: "token-1",
        H5Link: "https://example.com/validate",
      },
    };

    expect(materialAssetFromResponse(response)).toMatchObject({ id: "asset-1", name: "人物 A", status: "Active" });
    expect(materialBytedToken(response)).toBe("token-1");
    expect(materialH5Link(response)).toBe("https://example.com/validate");
  });
});
