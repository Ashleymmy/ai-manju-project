import { useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import type { AuthUser } from "@/services/api";

type AuthGuardProps = {
  children: ReactNode;
  requiredRole?: "super_admin" | "member";
};

export function authNextFromLocation(location: string, hash = "") {
  const safeLocation = location.startsWith("/") && !location.startsWith("//") ? location : "/canvas";
  const safeHash = hash.startsWith("#") && !safeLocation.includes("#") ? hash : "";
  return `${safeLocation}${safeHash}`;
}

export function loginRedirectForLocation(location: string, hash = "") {
  return `/login?next=${encodeURIComponent(authNextFromLocation(location, hash))}`;
}

export function defaultAuthPathForRole(role: AuthUser["role"]) {
  return role === "super_admin" ? "/admin" : "/canvas";
}

export function authGuardRedirectTarget(params: {
  loading: boolean;
  user: AuthUser | null;
  requiredRole?: AuthGuardProps["requiredRole"];
  location: string;
  hash?: string;
}) {
  if (params.loading) return null;
  if (!params.user) return loginRedirectForLocation(params.location, params.hash || "");
  if (params.requiredRole && params.user.role !== params.requiredRole) return "/canvas?auth=forbidden";
  return null;
}

export default function AuthGuard({ children, requiredRole }: AuthGuardProps) {
  const { user, loading } = useAuth();
  const [location, navigate] = useLocation();
  const redirectTarget = authGuardRedirectTarget({
    loading,
    user,
    requiredRole,
    location,
    hash: typeof window === "undefined" ? "" : window.location.hash,
  });

  useEffect(() => {
    if (redirectTarget) navigate(redirectTarget, { replace: true });
  }, [navigate, redirectTarget]);

  if (loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", background: "#0f1117",
        color: "#666", fontSize: 13, fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
        gap: 10,
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: "50%", background: "#E9513E",
          display: "inline-block", opacity: 0.9,
        }} />
        连接工作区…
      </div>
    );
  }

  if (redirectTarget || !user) return null;
  return <>{children}</>;
}
