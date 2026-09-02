import { describe, expect, it, vi } from "vitest";

import { resolveDirectorRoute } from "./navigation";

describe("Director route compatibility", () => {
  it("preserves canvas handoff parameters and builds a same-origin iframe URL", () => {
    const returnTo = "/canvas/project-1?scope=team#director-node";
    const route = resolveDirectorRoute(
      `?canvasId=project-1&nodeId=director-node&instanceId=director-e2e&scope=team&returnTo=${encodeURIComponent(returnTo)}`,
      "http://localhost:3100",
      vi.fn(() => "unused")
    );

    expect(route).toMatchObject({
      canvasId: "project-1",
      nodeId: "director-node",
      instanceId: "director-e2e",
      returnPath: returnTo,
      hasCanvasTarget: true,
      scope: "team",
    });
    const iframeUrl = new URL(route.directorSrc);
    expect(iframeUrl.origin).toBe("http://localhost:3100");
    expect(iframeUrl.pathname).toBe("/director-desk/index.html");
    expect(Object.fromEntries(iframeUrl.searchParams)).toEqual({
      instanceId: "director-e2e",
      theme: "dark",
      hostOrigin: "http://localhost:3100",
    });
  });

  it("uses the canonical canvas fallback for an unsafe return path", () => {
    const route = resolveDirectorRoute(
      "?canvasId=project%20%2F%201&nodeId=node-1&scope=unexpected&returnTo=https%3A%2F%2Fevil.test",
      "https://studio.example.test",
      () => "generated"
    );

    expect(route.returnPath).toBe("/canvas/project%20%2F%201?scope=personal");
    expect(route.scope).toBe("personal");
  });

  it("keeps identifier length limits and generates the legacy instance prefix", () => {
    const route = resolveDirectorRoute(
      `?canvasId=${"c".repeat(200)}&nodeId=${"n".repeat(200)}`,
      "http://localhost:3100",
      () => "generated-id"
    );

    expect(route.canvasId).toHaveLength(160);
    expect(route.nodeId).toHaveLength(160);
    expect(route.instanceId).toBe("ai-manju-director-generated-id");
    expect(route.returnPath).toBe(`/canvas/${"c".repeat(160)}?scope=personal`);
  });

  it("returns the canvas root when there is no target", () => {
    const route = resolveDirectorRoute(
      "",
      "http://localhost:3100",
      () => "generated-id"
    );

    expect(route.hasCanvasTarget).toBe(false);
    expect(route.returnPath).toBe("/canvas");
  });
});
