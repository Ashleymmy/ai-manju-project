import type { WorkspaceScope } from "@/shared/config";

export const DIRECTOR_SCOPE_OPTIONS: Array<{
  value: WorkspaceScope;
  label: string;
}> = [
  { value: "personal", label: "个人空间" },
  { value: "team", label: "团队空间" },
];

export type DirectorRouteContext = {
  canvasId: string;
  nodeId: string;
  instanceId: string;
  returnPath: string;
  hasCanvasTarget: boolean;
  scope: WorkspaceScope;
  directorSrc: string;
};

export function resolveDirectorRoute(
  search: string,
  origin: string,
  createInstanceId: () => string
): DirectorRouteContext {
  const query = new URLSearchParams(search);
  const canvasId = (query.get("canvasId") || "").trim().slice(0, 160);
  const nodeId = (query.get("nodeId") || "").trim().slice(0, 160);
  const requestedReturnPath = (query.get("returnTo") || "").trim();
  const scope: WorkspaceScope =
    query.get("scope") === "team" ? "team" : "personal";
  const returnPath = requestedReturnPath.startsWith("/canvas/")
    ? requestedReturnPath
    : canvasId
      ? `/canvas/${encodeURIComponent(canvasId)}?scope=${scope}`
      : "/canvas";
  const instanceId =
    (query.get("instanceId") || "").trim().slice(0, 128) ||
    `ai-manju-director-${createInstanceId()}`;
  const url = new URL("/director-desk/index.html", origin);
  url.searchParams.set("instanceId", instanceId);
  url.searchParams.set("theme", "dark");
  url.searchParams.set("hostOrigin", origin);

  return {
    canvasId,
    nodeId,
    instanceId,
    returnPath,
    hasCanvasTarget: Boolean(canvasId && nodeId),
    scope,
    directorSrc: url.toString(),
  };
}
