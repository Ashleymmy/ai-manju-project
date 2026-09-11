import { describe, expect, it } from "vitest";

import {
  filterNamedRecords,
  matchStudioCommandPages,
  projectListFrom,
  promptItemsFrom,
  studioCommandPages,
  withWorkspaceScope,
  workspaceScopeFromSearch,
} from "./commandPalette";

describe("command palette catalog", () => {
  it("hides admin routes unless allowed and matches Chinese labels", () => {
    const pages = matchStudioCommandPages(studioCommandPages, "资产库");
    expect(pages.map((page) => page.href)).toEqual(["/assets"]);
    expect(matchStudioCommandPages(studioCommandPages, "").some((page) => page.id === "admin")).toBe(false);
    expect(matchStudioCommandPages(studioCommandPages, "", { includeAdmin: true }).some((page) => page.id === "admin")).toBe(true);
  });

  it("keeps workspace scope on library routes and project/asset deep links", () => {
    expect(workspaceScopeFromSearch("?scope=team")).toBe("team");
    expect(withWorkspaceScope("/assets", "team")).toBe("/assets?scope=team");
    expect(withWorkspaceScope("/assets?asset=abc", "personal")).toBe("/assets?asset=abc&scope=personal");
    expect(withWorkspaceScope("/dashboard", "team")).toBe("/dashboard");
  });

  it("normalizes project payloads and filters by title", () => {
    expect(projectListFrom({ items: [{ id: "p1", title: "夜戏" }] })).toEqual([{ id: "p1", title: "夜戏" }]);
    expect(filterNamedRecords([{ id: "1", title: "水果摊" }, { id: "2", title: "风景" }], "水果")).toEqual([
      { id: "1", title: "水果摊" },
    ]);
    expect(promptItemsFrom({ items: [{ id: "s1", title: "夜戏", category: "镜头" }] })).toEqual([
      { id: "s1", title: "夜戏", category: "镜头" },
    ]);
  });
});
