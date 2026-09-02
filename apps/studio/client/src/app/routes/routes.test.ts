import { describe, expect, it } from "vitest";

import { legacyStudioRoutePaths } from "@/lib/studio-route-aliases";

import { appRoutes } from "./routes";

describe("declarative Studio routes", () => {
  it("keeps route ids and paths unique", () => {
    expect(new Set(appRoutes.map(route => route.id)).size).toBe(
      appRoutes.length
    );
    expect(new Set(appRoutes.map(route => route.path)).size).toBe(
      appRoutes.length
    );
  });

  it("preserves public entry, auth, and compatibility routes", () => {
    const routes = new Map(appRoutes.map(route => [route.path, route]));
    for (const path of ["/", "/chat", "/login", "/v2-login", "/register"]) {
      expect(routes.get(path)).toMatchObject({
        permission: "public",
        layout: "none",
      });
    }
    for (const path of legacyStudioRoutePaths) {
      expect(routes.get(path)).toMatchObject({
        permission: "public",
        layout: "none",
      });
    }
    expect(routes.get("/v2-canvas/:id")).toMatchObject({
      permission: "public",
      layout: "none",
    });
  });

  it("keeps canvas isolated from the Studio shell", () => {
    const routes = new Map(appRoutes.map(route => [route.path, route]));
    for (const path of ["/canvas", "/canvas/:id"]) {
      expect(routes.get(path)).toMatchObject({
        permission: "authenticated",
        layout: "canvas",
      });
    }
    expect(routes.get("/tags/:tagId")).toMatchObject({
      permission: "authenticated",
      layout: "none",
    });
  });

  it("keeps Studio pages authenticated and admin pages role protected", () => {
    const routes = new Map(appRoutes.map(route => [route.path, route]));
    for (const path of [
      "/dashboard",
      "/projects",
      "/director",
      "/comic-assets",
      "/image",
      "/video",
      "/assets",
      "/tags",
      "/prompts",
      "/skills",
      "/profile",
      "/queue",
      "/settings",
    ]) {
      expect(routes.get(path)).toMatchObject({
        permission: "authenticated",
        layout: "studio",
      });
    }
    for (const path of [
      "/admin",
      "/admin/users",
      "/admin/model-provider",
      "/admin/announcements",
      "/admin/seedance-assets",
    ]) {
      expect(routes.get(path)).toMatchObject({
        permission: "super_admin",
        layout: "studio",
      });
    }
  });

  it("stores a lazy loader on every declared route", () => {
    for (const route of appRoutes) {
      expect(route.loader).toBeTypeOf("function");
      expect(route.Component).toBeTruthy();
    }
  });
});
