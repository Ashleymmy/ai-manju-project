const staticLegacyStudioRoutes: Record<string, string> = {
  "/v2-home": "/",
  "/v2-projects": "/projects",
  "/v2-canvas": "/canvas",
  "/v2-assets": "/assets",
  "/v2-prompts": "/prompts",
  "/v2-settings": "/settings",
  "/v2-queue": "/queue",
  "/v2-image": "/image",
  "/v2-video": "/video",
  "/v2-preview": "/",
};

export const legacyStudioRoutePaths = Object.keys(staticLegacyStudioRoutes);

export function legacyStudioRouteTarget(location: string) {
  const [pathname, ...queryParts] = location.split("?");
  const query = queryParts.join("?");
  let target = staticLegacyStudioRoutes[pathname];

  if (!target && pathname.startsWith("/v2-canvas/")) {
    const projectId = pathname.slice("/v2-canvas/".length);
    if (projectId && !projectId.includes("/")) target = `/canvas/${projectId}`;
  }

  if (!target) return null;
  return query ? `${target}?${query}` : target;
}

export function tagDeepLinkTarget(pathname: string, search = "") {
  const tagId = decodeURIComponent(pathname.split("/")[2] || "");
  if (!tagId) return "/tags";

  const query = new URLSearchParams(search);
  query.set("tag_id", tagId);
  return `/tags?${query.toString()}`;
}
