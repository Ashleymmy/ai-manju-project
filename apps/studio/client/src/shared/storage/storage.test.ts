import { describe, expect, it } from "vitest";

import {
  createLocalForageStorageAdapter,
  createWebStorageAdapter,
  getLocalStorageAdapter,
  getSessionStorageAdapter,
  type LocalForageStorageAdapter,
} from ".";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

class MemoryLocalForage implements LocalForageStorageAdapter {
  private readonly values = new Map<string, unknown>();

  async clear() {
    this.values.clear();
  }
  async getItem<T>(key: string) {
    return (this.values.get(key) as T | undefined) ?? null;
  }
  async keys() {
    return Array.from(this.values.keys());
  }
  async removeItem(key: string) {
    this.values.delete(key);
  }
  async setItem<T>(key: string, value: T) {
    this.values.set(key, value);
    return value;
  }
}

describe("storage adapters", () => {
  it("passes web storage keys and values through without namespacing or serialization", () => {
    const backend = new MemoryStorage();
    const storage = createWebStorageAdapter(backend);

    storage.setItem("ai-manju:auth_token", "token-value");
    expect(backend.getItem("ai-manju:auth_token")).toBe("token-value");
    expect(storage.getItem("ai-manju:auth_token")).toBe("token-value");
    expect(storage.key(0)).toBe("ai-manju:auth_token");
    expect(storage.length).toBe(1);

    storage.removeItem("ai-manju:auth_token");
    expect(backend.length).toBe(0);
  });

  it("keeps local and session backends explicitly injectable", () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    const localAdapter = getLocalStorageAdapter(local);
    const sessionAdapter = getSessionStorageAdapter(session);

    localAdapter.setItem("same-key", "local");
    sessionAdapter.setItem("same-key", "session");

    expect(local.getItem("same-key")).toBe("local");
    expect(session.getItem("same-key")).toBe("session");
  });

  it("passes LocalForage keys and structured values through unchanged", async () => {
    const backend = new MemoryLocalForage();
    const storage = createLocalForageStorageAdapter(backend);
    const value = { revision: 7, items: ["node-1"] };

    await expect(storage.setItem("history", value)).resolves.toBe(value);
    await expect(storage.getItem("history")).resolves.toBe(value);
    await expect(storage.keys()).resolves.toEqual(["history"]);

    await storage.clear();
    await expect(storage.getItem("history")).resolves.toBeNull();
  });
});
