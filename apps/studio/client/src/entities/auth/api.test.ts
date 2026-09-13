// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthToken } from "@/shared/api/http";
import { getStoredAuthAccount, login, register } from "./api";

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }), { status, headers: { "Content-Type": "application/json" } });
}
const member = { id: "member-1", username: "artist01", display_name: "林叙", role: "member", status: "active" };

describe("registration session contract", () => {
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ token: "new-token", user: member }, 201)));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends the real register fields and installs the returned member session without another login", async () => {
    const result = await register({ username: " Artist01 ", password: "strong-password", displayName: " 林叙 " });
    const [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/api/auth/register");
    expect(JSON.parse(String(options.body))).toEqual({ account: "artist01", password: "strong-password", display_name: "林叙", remember: false });
    expect(result.user).toEqual(member);
    expect(getAuthToken()).toBe("new-token");
    expect(localStorage.getItem("ai-manju:auth_token")).toBeNull();
    expect(sessionStorage.getItem("ai-manju:auth_token")).toBe("new-token");
    expect(getStoredAuthAccount()).toBe("");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("remembers the token and account only when selected", async () => {
    await register({ username: "artist01", password: "strong-password", remember: true });
    expect(localStorage.getItem("ai-manju:auth_token")).toBe("new-token");
    expect(getStoredAuthAccount()).toBe("artist01");
    vi.mocked(fetch).mockResolvedValueOnce(response({ token: "login-token", user: member }));
    await login("artist01", "strong-password", false);
    expect(localStorage.getItem("ai-manju:auth_token")).toBeNull();
    expect(getStoredAuthAccount()).toBe("");
    expect(sessionStorage.getItem("ai-manju:auth_token")).toBe("login-token");
  });

  it("does not install a session when the account is already taken", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response("username already exists", 409));
    await expect(register({ username: "artist01", password: "strong-password" })).rejects.toThrow("username already exists");
    expect(getAuthToken()).toBeNull();
    expect(getStoredAuthAccount()).toBe("");
  });
});
