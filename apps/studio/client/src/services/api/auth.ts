import { clearAuthToken, request, setAuthToken } from "./request";

export type AuthUser = { id: string; username: string; display_name?: string; role: "super_admin" | "member"; status: string };
export type LoginResult = { token: string; user: AuthUser };
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
    if (username) window.localStorage.setItem(AUTH_ACCOUNT_STORAGE_KEY, username);
  } catch {
    undefined;
  }
}

export async function login(username: string, password: string, remember: boolean) {
  const result = await request<LoginResult>("/api/auth/login", { method: "POST", body: { username, password, remember } });
  setAuthToken(result.token, remember);
  setStoredAuthAccount(username);
  return result;
}

export function register(payload: { username: string; password: string; displayName?: string }) {
  return request<AuthUser>("/api/auth/register", { method: "POST", body: payload });
}

export function getCurrentUser(options: { signal?: AbortSignal } = {}) {
  return request<AuthUser>("/api/auth/me", { signal: options.signal, timeoutMs: AUTH_ME_TIMEOUT_MS });
}

export function clearStoredAuthSession() {
  clearAuthToken();
}

export async function logout() {
  try { await request<void>("/api/auth/logout", { method: "POST" }); } finally { clearAuthToken(); }
}
