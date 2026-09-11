import { describe, expect, it } from "vitest";

import { creationModeTabActive, creationModeTabs } from "./StudioLayout";

describe("studio creation navigation", () => {
  it("keeps a return path from the workbench to script chat", () => {
    expect(creationModeTabs.map((tab) => tab.href)).toEqual([
      "/dashboard",
      "/video",
      "/image",
      "/chat",
    ]);
  });

  it("treats / and /chat as the script desk", () => {
    expect(creationModeTabActive("/chat", "/chat")).toBe(true);
    expect(creationModeTabActive("/chat", "/")).toBe(true);
    expect(creationModeTabActive("/chat", "/dashboard")).toBe(false);
    expect(creationModeTabActive("/dashboard", "/dashboard")).toBe(true);
  });
});
