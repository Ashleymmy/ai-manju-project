import { clearAuthToken, request, setAuthToken } from "./request";

export type AuthUser = { id: string; username: string; display_name?: string; role: "super_admin" | "member"; status: string };
export type LoginResult = { token: string; user: AuthUser };

export async function login(username: string, password: string, remember: boolean) {
  const result = await request<LoginResult>("/api/auth/login", { method: "POST", body: { username, password, remember } });
  setAuthToken(result.token, remember);
  return result;
}

export function register(payload: { username: string; password: string; displayName?: string }) {
  return request<AuthUser>("/api/auth/register", { method: "POST", body: payload });
}

export function getCurrentUser() { return request<AuthUser>("/api/auth/me"); }

export async function logout() {
  try { await request<void>("/api/auth/logout", { method: "POST" }); } finally { clearAuthToken(); }
}
