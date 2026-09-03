import { lazy, type ComponentType, type LazyExoticComponent } from "react";

import { legacyStudioRoutePaths } from "@/lib/studio-route-aliases";

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
  return { ...route, Component: lazy(route.loader) };
}

const authLoader = () => import("@/features/auth");
const chatLoader = () => import("@/features/chat");
const legacyRedirectLoader = () => import("./LegacyRedirectPage");

const primaryRoutes: AppRoute[] = [
  defineAppRoute({ id: "auth-login", path: "/login", loader: authLoader, permission: "public", layout: "none" }),
  defineAppRoute({ id: "auth-v2-login", path: "/v2-login", loader: authLoader, permission: "public", layout: "none" }),
  defineAppRoute({ id: "auth-register", path: "/register", loader: authLoader, permission: "public", layout: "none" }),
  defineAppRoute({ id: "chat-root", path: "/", loader: chatLoader, permission: "public", layout: "none" }),
  defineAppRoute({ id: "chat", path: "/chat", loader: chatLoader, permission: "public", layout: "none" }),
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
  defineAppRoute({ id: "profile", path: "/profile", loader: () => import("@/features/profile"), permission: "authenticated", layout: "studio" }),
  defineAppRoute({ id: "queue", path: "/queue", loader: () => import("@/features/queue"), permission: "authenticated", layout: "studio" }),
  defineAppRoute({ id: "settings", path: "/settings", loader: () => import("@/features/settings"), permission: "authenticated", layout: "studio" }),
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
