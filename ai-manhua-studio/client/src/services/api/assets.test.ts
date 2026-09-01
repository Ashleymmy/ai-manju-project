import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bindAssetTags,
  getAssetLibrary,
  removeAssetTag,
  resyncAssetInheritedTags,
  updateAssetFolder,
  updateAssetMetadata,
} from "./assets";

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

describe("asset API client", () => {
  beforeEach(() => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(apiResponse({ items: [], total: 0, page: 1, page_size: 30 }))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serializes the library query contract (scope, tags, smart view, dates)", async () => {
    await getAssetLibrary("team", {
      keyword: "雨",
      smartView: "favorite",
      type: "image",
      category: "character",
      sourceType: "canvas",
      tagIds: ["t1", "t2"],
      tagMatch: "or",
      includeTagDescendants: true,
      createdFrom: "2026-01-01T00:00:00.000Z",
      createdTo: "2026-01-31T23:59:59.000Z",
      page: 2,
      pageSize: 30,
      sort: "name_asc",
    });

    const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const target = new URL(url);
    expect(target.pathname).toBe("/api/assets/library");
    expect(target.searchParams.get("scope")).toBe("team");
    expect(target.searchParams.get("keyword")).toBe("雨");
    expect(target.searchParams.get("smart_view")).toBe("favorite");
    expect(target.searchParams.get("tag_ids")).toBe("t1,t2");
    expect(target.searchParams.get("tag_match")).toBe("or");
    expect(target.searchParams.get("include_tag_descendants")).toBe("true");
    expect(target.searchParams.get("created_from")).toBe("2026-01-01T00:00:00.000Z");
    expect(target.searchParams.get("page")).toBe("2");
    expect(target.searchParams.get("sort")).toBe("name_asc");
  });

  it("omits empty filters from the library query", async () => {
    await getAssetLibrary("personal", { keyword: "", smartView: "", tagIds: [] });

    const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const target = new URL(url);
    expect(target.searchParams.get("keyword")).toBeNull();
    expect(target.searchParams.get("smart_view")).toBeNull();
    expect(target.searchParams.get("tag_ids")).toBeNull();
    expect(target.searchParams.get("scope")).toBe("personal");
  });

  it("sends metadata updates with name/category/tag payloads", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({ id: "a1" }));
    await updateAssetMetadata("a1", { name: "新名字", category: "character", tag_ids: ["t1"] }, "personal");

    const [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/api/assets/a1/metadata");
    expect(options.method).toBe("PUT");
    expect(JSON.parse(String(options.body))).toEqual({ name: "新名字", category: "character", tag_ids: ["t1"] });
  });

  it("binds, removes and resyncs asset tags against the asset-scoped routes", async () => {
    await bindAssetTags("a1", ["t1", "t2"], "team");
    let [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/api/assets/a1/tags");
    expect(options.method).toBe("POST");
    expect(JSON.parse(String(options.body))).toEqual({ tag_ids: ["t1", "t2"] });
    expect(new URL(url).searchParams.get("scope")).toBe("team");

    await removeAssetTag("a1", "t1", "personal");
    [url, options] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/api/assets/a1/tags/t1");
    expect(options.method).toBe("DELETE");

    await resyncAssetInheritedTags("a1", "personal");
    [url, options] = vi.mocked(fetch).mock.calls[2] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/api/assets/a1/tags/resync-inherited");
    expect(options.method).toBe("POST");
  });

  it("updates folder name, parent and sort order", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({ id: "f1" }));
    await updateAssetFolder("f1", { name: "角色", parent_id: "f0", sort_order: 3 }, "personal");

    const [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/api/asset-folders/f1");
    expect(options.method).toBe("PUT");
    expect(JSON.parse(String(options.body))).toEqual({ name: "角色", parent_id: "f0", sort_order: 3 });
  });
});
