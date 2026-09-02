import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { comicQueryKeys } from "@/entities/comic";

import { COMIC_BATCH_POLL_INTERVAL_MS } from "./model/constants";

const comicRoot = path.dirname(fileURLToPath(import.meta.url));

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(entryPath);
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return [];
    if (/\.(?:test|spec)\.tsx?$/.test(entry.name)) return [];
    return [entryPath];
  });
}

describe("Comic feature boundary", () => {
  it("loads the feature-owned page instead of the legacy page", () => {
    const routeSource = readFileSync(
      path.join(comicRoot, "ComicPage.tsx"),
      "utf8"
    );
    expect(routeSource).toContain('from "./ui/ComicAssetsView"');
    expect(routeSource).not.toContain("RealFeatureViews");
    expect(routeSource).not.toContain("@/pages/");
  });

  it("does not import the global API barrel from Comic production code", () => {
    const violations = productionSources(comicRoot).flatMap(filePath => {
      const source = readFileSync(filePath, "utf8");
      return /from\s+["']@\/services\/api(?:["'/])/.test(source)
        ? [path.relative(comicRoot, filePath)]
        : [];
    });
    expect(violations).toEqual([]);
  });

  it("keeps a route-only public export", () => {
    expect(readFileSync(path.join(comicRoot, "index.ts"), "utf8").trim()).toBe(
      'export { default } from "./ComicPage";'
    );
  });

  it("keeps scope-aware query identities and three-second batch polling", () => {
    expect(comicQueryKeys.projects("personal")).toEqual([
      "comic",
      "projects",
      "personal",
    ]);
    expect(comicQueryKeys.batch("team", "batch-1")).toEqual([
      "comic",
      "batch",
      "team",
      "batch-1",
    ]);
    expect(comicQueryKeys.batch("personal", "batch-1")).not.toEqual(
      comicQueryKeys.batch("team", "batch-1")
    );
    expect(COMIC_BATCH_POLL_INTERVAL_MS).toBe(3_000);
  });
});
