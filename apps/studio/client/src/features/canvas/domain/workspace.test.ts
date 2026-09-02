import { describe, expect, it } from "vitest";

import {
  canvasListHref,
  canvasProjectHref,
  isWorkspaceScope,
  projectScopeFromServer,
  scopeFromCanvasSearch,
  workspaceScopeValue,
} from "./workspace";

describe("canvas workspace scope", () => {
  it("accepts only canonical personal and team scopes", () => {
    expect(isWorkspaceScope("personal")).toBe(true);
    expect(isWorkspaceScope("team")).toBe(true);
    expect(isWorkspaceScope("public")).toBe(false);
    expect(workspaceScopeValue("team")).toBe("team");
    expect(workspaceScopeValue(null)).toBeUndefined();
  });

  it("keeps scope in Canvas deep links and server fallback", () => {
    expect(scopeFromCanvasSearch("scope=team&tab=jobs")).toBe("team");
    expect(scopeFromCanvasSearch("?scope=unknown")).toBe("personal");
    expect(canvasProjectHref("p / 1", "team")).toBe("/canvas/p%20%2F%201?scope=team");
    expect(canvasListHref("personal")).toBe("/canvas?scope=personal");
    expect(projectScopeFromServer({ scope: "team" }, "personal")).toBe("team");
    expect(projectScopeFromServer({ scope: "legacy" }, "personal")).toBe("personal");
  });
});
