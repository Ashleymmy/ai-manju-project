import { lazy, type ComponentType, type LazyExoticComponent } from "react";

import { legacyStudioRoutePaths } from "@/lib/studio-route-aliases";
import { loadRouteModule } from "./loadRouteModule";

export type RoutePermission = "public" | "authenticated" | "super_admin";
export type RouteLayout = "none" | "studio" | "canvas";
export type AppRouteModule = { default: ComponentType };

export type AppRoute = {
  id: string;
  path: string;
  loader: () => Promise<AppRouteModule>;
  permission: RoutePermission;
  layout: RouteLayout;
  Component: LazyExoticComponent<ComponentType>;
};

function defineAppRoute(route: Omit<AppRoute, "Component">): AppRoute {
  return { ...route, Component: lazy(() => loadRouteModule(route.loader)) };
}

const authLoader = () => import("@/features/auth");
/* [暂时隐藏] 聊天台主页：页面代码完整保留在 features/chat，恢复时取消下方 /chat 路由的注释即可
const chatLoader = () => import("@/features/chat"); */
const legacyRedirectLoader = () => import("./LegacyRedirectPage");

const primaryRoutes: AppRoute[] = [
  defineAppRoute({ id: "provider-hub", path: "/admin/model-hub", loader: () => import("@/features/admin/ui/ProviderHubPage"), permission: "super_admin", layout: "none" }),
  defineAppRoute({ id: "auth-login", path: "/login", loader: authLoader, permission: "public", layout: "none" }),
  defineAppRoute({ id: "auth-v2-login", path: "/v2-login", loader: authLoader, permission: "public", layout: "none" }),
  defineAppRoute({ id: "auth-register", path: "/register", loader: authLoader, permission: "public", layout: "none" }),
  defineAppRoute({ id: "home", path: "/", loader: () => import("./HomeRedirectPage"), permission: "public", layout: "none" }),
  // [暂时隐藏] 聊天台主页路由（不要删除）：defineAppRoute({ id: "chat", path: "/chat", loader: chatLoader, permission: "public", layout: "none" }),
  defineAppRoute({ id: "legacy-v2-canvas-id", path: "/v2-canvas/:id", loader: legacyRedirectLoader, permission: "public", layout: "none" }),
  defineAppRoute({ id: "tag-deep-link", path: "/tags/:tagId", loader: () => import("./TagRedirectPage"), permission: "authenticated", layout: "none" }),
  defineAppRoute({ id: "canvas-project", path: "/canvas/:id", loader: () => import("@/features/canvas/CanvasPage"), permission: "authenticated", layout: "canvas" }),
  defineAppRoute({ id: "canvas", path: "/canvas", loader: () => import("@/features/canvas/CanvasPage"), permission: "authenticated", layout: "canvas" }),
  defineAppRoute({ id: "dashboard", path: "/dashboard", loader: () => import("@/features/dashboard"), permission: "authenticated", layout: "studio" }),
  defineAppRoute({ id: "projects", path: "/projects", loader: () => import("@/features/projects"), permission: "authenticated", layout: "studio" }),
  defineAppRoute({ id: "director", path: "/director", loader: () => import("@/features/director"), permission: "authenticated", layout: "studio" }),
  defineAppRoute({ id: "comic", path: "/comic-assets", loader: () => import("@/features/comic"), permission: "authenticated", layout: "studio" }),
  defineAppRoute({ id: "image", path: "/image", loader: () => import("@/features/image"), permission: "authenticated", layout: "studio" }),
  defineAppRoute({ id: "video", path: "/video", loader: () => import("@/features/video"), permission: "authenticated", layout: "studio" }),
  defineAppRoute({ id: "assets", path: "/assets", loader: () => import("@/features/assets"), permission: "authenticated", layout: "studio" }),
  defineAppRoute({ id: "tags", path: "/tags", loader: () => import("@/features/tags"), permission: "authenticated", layout: "studio" }),
  defineAppRoute({ id: "prompts", path: "/prompts", loader: () => import("@/features/prompts"), permission: "authenticated", layout: "studio" }),
  defineAppRoute({ id: "skills", path: "/skills", loader: () => import("@/features/skills"), permission: "authenticated", layout: "studio" }),
  defineAppRoute({ id: "profile", path: "/profile", loader: () => import("@/features/member"), permission: "authenticated", layout: "studio" }),
  defineAppRoute({ id: "queue", path: "/queue", loader: () => import("@/features/queue"), permission: "authenticated", layout: "studio" }),
  defineAppRoute({ id: "settings", path: "/settings", loader: () => import("@/features/settings"), permission: "authenticated", layout: "studio" }),
  defineAppRoute({ id: "member", path: "/member", loader: () => import("@/features/member"), permission: "authenticated", layout: "studio" }),
  defineAppRoute({ id: "member-plans", path: "/member/plans", loader: () => import("@/features/member"), permission: "authenticated", layout: "studio" }),
  defineAppRoute({ id: "member-usage", path: "/member/usage", loader: () => import("@/features/member"), permission: "authenticated", layout: "studio" }),
  defineAppRoute({ id: "member-invite", path: "/member/invite", loader: () => import("@/features/member"), permission: "authenticated", layout: "studio" }),
  defineAppRoute({ id: "member-gifts", path: "/member/gifts", loader: () => import("@/features/member"), permission: "authenticated", layout: "studio" }),
  defineAppRoute({ id: "member-pricing", path: "/member/pricing", loader: () => import("@/features/member"), permission: "authenticated", layout: "studio" }),
];

const legacyRoutes = legacyStudioRoutePaths.map((path, index) =>
  defineAppRoute({
    id: `legacy-${index}-${path}`,
    path,
    loader: legacyRedirectLoader,
    permission: "public",
    layout: "none",
  })
);

const adminRoutes = [
  "/admin/users",
  "/admin/model-provider",
  "/admin/announcements",
  "/admin/seedance-assets",
  // WP-M7 会员系统后台 8 模块（features/admin/model/routes.ts 同步维护）
  "/admin/member-users",
  "/admin/credit-ledger",
  "/admin/orders",
  "/admin/consumptions",
  "/admin/plans-config",
  "/admin/model-prices",
  "/admin/dashboard",
  "/admin/invites",
  "/admin/audit-logs",
  "/admin",
].map((path, index) =>
  defineAppRoute({
    id: `admin-${index}`,
    path,
    loader: () => import("@/features/admin"),
    permission: "super_admin",
    layout: "studio",
  })
);

export const appRoutes = [...primaryRoutes, ...legacyRoutes, ...adminRoutes];
