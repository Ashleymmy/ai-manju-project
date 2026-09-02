import { describe, expect, it } from "vitest";

import { legacyStudioRouteTarget, tagDeepLinkTarget } from "./studio-route-aliases";

describe("legacy studio route aliases", () => {
  it.each([
    ["/v2-home", "/"],
    ["/v2-projects", "/projects"],
    ["/v2-canvas", "/canvas"],
    ["/v2-assets", "/assets"],
    ["/v2-prompts", "/prompts"],
    ["/v2-settings", "/settings"],
    ["/v2-queue", "/queue"],
    ["/v2-image", "/image"],
    ["/v2-video", "/video"],
    ["/v2-preview", "/"],
  ])("maps %s to %s", (source, target) => {
    expect(legacyStudioRouteTarget(source)).toBe(target);
  });

  it("preserves a canvas id and query parameters", () => {
    expect(legacyStudioRouteTarget("/v2-canvas/project%20alpha?scope=team&rail=collapsed"))
      .toBe("/canvas/project%20alpha?scope=team&rail=collapsed");
  });

  it("rejects unknown and malformed legacy routes", () => {
    expect(legacyStudioRouteTarget("/v2-unknown")).toBeNull();
    expect(legacyStudioRouteTarget("/v2-canvas/a/b")).toBeNull();
  });
});

describe("tag deep links", () => {
  it("maps the route parameter into tag_id while preserving other query parameters", () => {
    expect(
      tagDeepLinkTarget(
        "/tags/tag%20alpha",
        "scope=team&tag_id=old",
        "#library"
      )
    ).toBe("/tags?scope=team&tag_id=tag+alpha#library");
  });

  it("falls back to the tag library when the route parameter is absent", () => {
    expect(tagDeepLinkTarget("/tags/", "scope=team")).toBe("/tags");
  });
});
