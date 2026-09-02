import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTag, createWorkspaceTag, listAssetTagDetails, listTagPrompts, updateTag } from "./tags";

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

  it("queries tag-bound prompts with descendants included", async () => {
    await listTagPrompts("team", "tag-1", true);

    const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const requestUrl = new URL(url);
    expect(requestUrl.pathname).toBe("/api/tags/tag-1/prompts");
    expect(requestUrl.searchParams.get("scope")).toBe("team");
    expect(requestUrl.searchParams.get("include_descendants")).toBe("true");
  });

  it("loads asset tag details from the asset-scoped route", async () => {
    await listAssetTagDetails("personal", "asset-9");

    const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const requestUrl = new URL(url);
    expect(requestUrl.pathname).toBe("/api/assets/asset-9/tags");
    expect(requestUrl.searchParams.get("scope")).toBe("personal");
  });

  it("sends the full editable tag field set on update", async () => {
    await updateTag("personal", "tag-1", {
      name: "赛博",
      description: "霓虹与雨",
      asset_enabled: true,
      prompt_enabled: false,
      inherit_mode: "manual",
      status: "archived",
      sort_order: 7,
    });

    const [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/api/tags/tag-1");
    expect(options.method).toBe("PUT");
    expect(JSON.parse(String(options.body))).toEqual({
      name: "赛博",
      description: "霓虹与雨",
      asset_enabled: true,
      prompt_enabled: false,
      inherit_mode: "manual",
      status: "archived",
      sort_order: 7,
    });
  });

  it("creates tags with selectable usage and scope_type", async () => {
    await createTag("personal", {
      name: "仅提示词",
      parent_id: "tag-root",
      asset_enabled: false,
      prompt_enabled: true,
      inherit_mode: "never",
      scope_type: "user",
    });

    const [, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(options.body))).toEqual({
      name: "仅提示词",
      parent_id: "tag-root",
      asset_enabled: false,
      prompt_enabled: true,
      inherit_mode: "never",
      scope_type: "user",
    });
  });
});
