export {
  AUTH_ME_TIMEOUT_MS,
  getStoredAuthAccount,
  setStoredAuthAccount,
  login,
  register,
  getCurrentUser,
  clearStoredAuthSession,
  logout,
} from "@/entities/auth";
export type { AuthUser, LoginResult } from "@/entities/auth";
