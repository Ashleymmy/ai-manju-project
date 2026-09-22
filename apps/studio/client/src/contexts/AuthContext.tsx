import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Context,
  type ReactNode,
} from "react";

import {
  clearStoredAuthSession,
  getCurrentUser,
  logout as logoutApi,
  type AuthUser,
} from "@/entities/auth";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
};

/**
 * Keep the auth context stable if Vite reloads a lazy route module while the
 * app is still mounted. Without this registry, the provider and a consumer
 * can end up using different Context instances and the consumer reports that
 * it is outside of AuthProvider even though the provider is in the tree.
 */
type AuthContextRegistry = typeof globalThis & {
  __aiManjuAuthContext?: Context<AuthContextValue | null>;
};

const authContextRegistry = globalThis as AuthContextRegistry;
const AuthContext =
  authContextRegistry.__aiManjuAuthContext ??
  (authContextRegistry.__aiManjuAuthContext =
    createContext<AuthContextValue | null>(null));

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const userIdRef = useRef<string | null | undefined>(undefined);
  const refreshSeqRef = useRef(0);
  const refreshControllerRef = useRef<AbortController | null>(null);

  const refreshUser = useCallback(async () => {
    const seq = ++refreshSeqRef.current;
    refreshControllerRef.current?.abort();
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    setLoading(true);
    try {
      const u = await getCurrentUser({ signal: controller.signal });
      if (seq !== refreshSeqRef.current) return;
      if (userIdRef.current !== u.id) {
        queryClient.clear();
      }
      userIdRef.current = u.id;
      setUser(u);
    } catch {
      if (seq !== refreshSeqRef.current) return;
      queryClient.clear();
      userIdRef.current = null;
      clearStoredAuthSession();
      setUser(null);
    } finally {
      if (seq === refreshSeqRef.current) {
        refreshControllerRef.current = null;
        setLoading(false);
      }
    }
  }, [queryClient]);

  useEffect(() => {
    void refreshUser();
    const handleUnauthorized = () => {
      refreshSeqRef.current += 1;
      refreshControllerRef.current?.abort();
      refreshControllerRef.current = null;
      queryClient.clear();
      userIdRef.current = null;
      clearStoredAuthSession();
      setUser(null);
      setLoading(false);
    };
    window.addEventListener("ai-manju:auth-unauthorized", handleUnauthorized);
    return () => {
      refreshSeqRef.current += 1;
      refreshControllerRef.current?.abort();
      refreshControllerRef.current = null;
      window.removeEventListener("ai-manju:auth-unauthorized", handleUnauthorized);
    };
  }, [queryClient, refreshUser]);

  const logout = useCallback(async () => {
    refreshSeqRef.current += 1;
    refreshControllerRef.current?.abort();
    refreshControllerRef.current = null;
    await logoutApi().catch(() => undefined);
    queryClient.clear();
    userIdRef.current = null;
    clearStoredAuthSession();
    setUser(null);
    setLoading(false);
  }, [queryClient]);

  return (
    <AuthContext.Provider value={{ user, loading, refreshUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
