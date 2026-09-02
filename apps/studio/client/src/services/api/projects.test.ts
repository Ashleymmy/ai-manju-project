import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deleteProject } from "./projects";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("project API", () => {
  beforeEach(() => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deletes the canonical project in its workspace scope", async () => {
    await deleteProject("project / 1", "team");

    const [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const requestUrl = new URL(url);
    expect(requestUrl.pathname).toBe("/api/projects/project%20%2F%201");
    expect(requestUrl.searchParams.get("scope")).toBe("team");
    expect(options.method).toBe("DELETE");
  });
});
