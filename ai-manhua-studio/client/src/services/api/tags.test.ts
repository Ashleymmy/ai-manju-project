import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkspaceTag } from "./tags";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("tag API", () => {
  beforeEach(() => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { id: "tag-1" },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates asset-enabled tags in the current workspace for personal scope", async () => {
    await createWorkspaceTag("personal", {
      name: "角色",
      asset_enabled: true,
      prompt_enabled: true,
      inherit_mode: "auto",
    });

    const [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const requestUrl = new URL(url);
    expect(requestUrl.pathname).toBe("/api/tags");
    expect(requestUrl.searchParams.get("scope")).toBe("personal");
    expect(JSON.parse(String(options.body))).toMatchObject({
      name: "角色",
      asset_enabled: true,
      prompt_enabled: true,
      scope_type: "workspace",
    });
  });
});
