import { useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";

import { useAuth } from "@/contexts/AuthContext";
import PageLoader from "@/components/PageLoader";
import { isAdminTierRole, type AuthUser } from "@/entities/auth";

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

export function routeLocationWithSearch(location: string, search = "") {
  const locationWithoutHash = location.split("#", 1)[0];
  if (locationWithoutHash.includes("?") || !search) return locationWithoutHash;
  return `${locationWithoutHash}${search.startsWith("?") ? search : `?${search}`}`;
}

export function defaultAuthPathForRole(role: AuthUser["role"]) {
  // 后台三级角色（super/ops/auditor）登录后都落到管理后台；auditor 只读由面板控制。
  return isAdminTierRole(role) ? "/admin" : "/canvas";
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
  if (params.requiredRole && params.user.role !== params.requiredRole) {
    // WP-M7：标 "super_admin" 的后台路由对整个管理三级角色开放（auditor 只读），
    // 写操作由后端 RequireAdmin 403 兜底，前端面板隐藏写按钮。
    if (params.requiredRole === "super_admin" && isAdminTierRole(params.user.role)) return null;
    return "/canvas?auth=forbidden";
  }
  return null;
}

export default function AuthGuard({ children, requiredRole }: AuthGuardProps) {
  const { user, loading } = useAuth();
  const [location, navigate] = useLocation();
  const browserLocation = routeLocationWithSearch(
    location,
    typeof window === "undefined" ? "" : window.location.search
  );
  const redirectTarget = authGuardRedirectTarget({
    loading,
    user,
    requiredRole,
    location: browserLocation,
    hash: typeof window === "undefined" ? "" : window.location.hash,
  });

  useEffect(() => {
    if (redirectTarget) navigate(redirectTarget, { replace: true });
  }, [navigate, redirectTarget]);

  if (loading) {
    return <PageLoader />;
  }

  if (redirectTarget || !user) return null;
  return <>{children}</>;
}
