import type { AuthUser, LoginResult } from "./model";
import { clearAuthToken, request, setAuthToken } from "@/shared/api/http";
export const AUTH_ME_TIMEOUT_MS = 8_000;

const AUTH_ACCOUNT_STORAGE_KEY = "ai-manju:auth_account";

export function getStoredAuthAccount() {
  try {
    return window.localStorage.getItem(AUTH_ACCOUNT_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function setStoredAuthAccount(username: string) {
  try {
    if (username)
      window.localStorage.setItem(AUTH_ACCOUNT_STORAGE_KEY, username);
    else window.localStorage.removeItem(AUTH_ACCOUNT_STORAGE_KEY);
  } catch {
    undefined;
  }
}

export async function login(
  username: string,
  password: string,
  remember: boolean
) {
  const result = await request<LoginResult>("/api/auth/login", {
    method: "POST",
    body: { username, password, remember },
  });
  setAuthToken(result.token, remember);
  setStoredAuthAccount(remember ? username : "");
  return result;
}

export async function register(payload: {
  username: string;
  password: string;
  displayName?: string;
  remember?: boolean;
}) {
  const remember = payload.remember ?? false;
  const account = payload.username.trim().toLowerCase();
  const result = await request<LoginResult>("/api/auth/register", {
    method: "POST",
    body: { account, password: payload.password, display_name: payload.displayName?.trim() || undefined, remember },
  });
  setAuthToken(result.token, remember);
  setStoredAuthAccount(remember ? account : "");
  return result;
}

export function getCurrentUser(options: { signal?: AbortSignal } = {}) {
  return request<AuthUser>("/api/auth/me", {
    signal: options.signal,
    timeoutMs: AUTH_ME_TIMEOUT_MS,
  });
}

export function clearStoredAuthSession() {
  clearAuthToken();
}

export async function logout() {
  try {
    await request<void>("/api/auth/logout", { method: "POST" });
  } finally {
    clearAuthToken();
  }
}
