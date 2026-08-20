import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_ME_TIMEOUT_MS, getCurrentUser, type AuthUser } from "../services/api/auth";
import { authGuardRedirectTarget, authNextFromLocation, defaultAuthPathForRole, loginRedirectForLocation } from "./AuthGuard";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const member: AuthUser = {
  id: "user-1",
  username: "member",
  role: "member",
  status: "active",
};

describe("auth guard routing", () => {
  it("保留受保护页面的路径、查询和 hash", () => {
    expect(authNextFromLocation("/admin/users?page=2", "#team")).toBe("/admin/users?page=2#team");
    expect(loginRedirectForLocation("/canvas/project-1?scope=team", "#node-2")).toBe("/login?next=%2Fcanvas%2Fproject-1%3Fscope%3Dteam%23node-2");
    expect(authNextFromLocation("https://evil.test/admin", "#x")).toBe("/canvas#x");
    expect(authNextFromLocation("//evil.test/admin", "#x")).toBe("/canvas#x");
  });

  it("未登录和角色越权时返回生产等价重定向", () => {
    expect(authGuardRedirectTarget({ loading: true, user: null, requiredRole: "super_admin", location: "/admin" })).toBeNull();
    expect(authGuardRedirectTarget({ loading: false, user: null, location: "/admin?tab=users", hash: "#audit" })).toBe("/login?next=%2Fadmin%3Ftab%3Dusers%23audit");
    expect(authGuardRedirectTarget({ loading: false, user: member, requiredRole: "super_admin", location: "/admin" })).toBe("/canvas?auth=forbidden");
    expect(authGuardRedirectTarget({ loading: false, user: member, requiredRole: "member", location: "/canvas" })).toBeNull();
    expect(defaultAuthPathForRole("super_admin")).toBe("/admin");
    expect(defaultAuthPathForRole("member")).toBe("/canvas");
  });
});

describe("auth /me request contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("8 秒后中止登录态恢复请求", async () => {
    let requestSignal: AbortSignal | null = null;
    vi.mocked(fetch).mockImplementation((_url, options) => new Promise<Response>((_resolve, reject) => {
      requestSignal = options?.signal as AbortSignal;
      requestSignal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));

    const result = getCurrentUser();
    const rejection = expect(result).rejects.toMatchObject({ status: 0 });
    await vi.advanceTimersByTimeAsync(AUTH_ME_TIMEOUT_MS - 1);
    expect(requestSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await rejection;
    expect(requestSignal?.aborted).toBe(true);
  });

  it("透传外部 AbortSignal", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | null = null;
    vi.mocked(fetch).mockImplementation((_url, options) => new Promise<Response>((_resolve, reject) => {
      requestSignal = options?.signal as AbortSignal;
      requestSignal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));

    const result = getCurrentUser({ signal: controller.signal });
    const rejection = expect(result).rejects.toMatchObject({ status: 0 });
    controller.abort();

    await rejection;
    expect(requestSignal?.aborted).toBe(true);
  });
});
