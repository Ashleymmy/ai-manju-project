// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/errors";

const mocks = vi.hoisted(() => ({
  path: "/register", search: "next=%2Fchat", navigate: vi.fn(), refreshUser: vi.fn(), register: vi.fn(), login: vi.fn(), refetch: vi.fn(),
  health: { data: { public_signup: true }, isPending: false, isFetching: false, isError: false },
}));
vi.mock("wouter", () => ({ useLocation: () => [mocks.path, mocks.navigate], useSearch: () => mocks.search }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, loading: false, refreshUser: mocks.refreshUser }) }));
vi.mock("@/entities/auth", () => ({ getStoredAuthAccount: () => "admin", register: mocks.register, login: mocks.login }));
vi.mock("./model/queries", () => ({ usePublicHealthQuery: () => ({ ...mocks.health, refetch: mocks.refetch }) }));
import AuthView from "./AuthPage";

describe("registration page", () => {
  let root: Root;
  let container: HTMLDivElement;
  async function render() { await act(async () => root.render(<AuthView />)); }
  async function fill(name: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function submit() {
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.clearAllMocks();
    mocks.path = "/register"; mocks.search = "next=%2Fchat";
    mocks.health = { data: { public_signup: true }, isPending: false, isFetching: false, isError: false };
    mocks.register.mockReset().mockResolvedValue({ token: "test-session", user: { id: "member-1", role: "member" } });
    mocks.login.mockReset().mockResolvedValue({ token: "test-session", user: { id: "member-1", role: "member" } });
    mocks.refreshUser.mockResolvedValue(undefined);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  it("offers registration from login and keeps the original destination", async () => {
    mocks.path = "/login"; await render();
    expect(container.querySelector(".auth-register-link")?.getAttribute("href")).toBe("/register?next=%2Fchat");
    mocks.path = "/register"; await render();
    expect(container.querySelector<HTMLInputElement>('[name="account"]')!.value).toBe("");
    expect(container.querySelector(".auth-switch a")?.getAttribute("href")).toBe("/login?next=%2Fchat");
  });

  it("validates password confirmation and allows independent visibility toggles", async () => {
    await render(); await fill("account", "artist01"); await fill("password", "strong-password"); await fill("confirmPassword", "wrong-password");
    await submit();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(container.textContent).toContain("两次输入的密码不一致");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="显示密码"]')!.click());
    expect(container.querySelector<HTMLInputElement>('[name="password"]')!.type).toBe("text");
    expect(container.querySelector<HTMLInputElement>('[name="confirmPassword"]')!.type).toBe("password");
  });

  it("registers once and automatically enters the requested workspace with the returned session", async () => {
    await render(); await fill("displayName", "林叙"); await fill("account", "artist01"); await fill("password", "strong-password"); await fill("confirmPassword", "strong-password");
    let complete!: (value: unknown) => void;
    mocks.register.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    await submit(); await submit();
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledWith({ username: "artist01", password: "strong-password", displayName: "林叙", remember: false });
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    await act(async () => complete({ token: "test-session", user: { role: "member" } }));
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.refreshUser).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith("/chat", { replace: true });
  });

  it("preserves the form when the account already exists", async () => {
    mocks.register.mockRejectedValue(new ApiError("username already exists", 409));
    await render(); await fill("account", "artist01"); await fill("password", "strong-password"); await fill("confirmPassword", "strong-password"); await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("该账号已被使用");
    expect(container.querySelector<HTMLInputElement>('[name="account"]')!.value).toBe("artist01");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("keeps a visible registration page but never submits while signup is unavailable", async () => {
    mocks.health.isPending = true; await render(); await submit();
    expect(container.textContent).toContain("正在确认注册服务");
    mocks.health.isPending = false; mocks.health.data.public_signup = false; await render(); await submit();
    expect(container.textContent).toContain("当前暂未开放注册");
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });
});
