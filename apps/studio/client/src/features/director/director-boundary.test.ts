import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const directorRoot = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(directorRoot, "../..");

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(entryPath);
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return [];
    if (/\.(?:test|spec)\.tsx?$/.test(entry.name)) return [];
    return [entryPath];
  });
}

describe("Director feature boundary", () => {
  it("loads the feature-owned view instead of the legacy page", () => {
    const routeSource = readFileSync(
      path.join(directorRoot, "DirectorPage.tsx"),
      "utf8"
    );
    expect(routeSource).toContain('from "./ui/DirectorDeskView"');
    expect(routeSource).not.toContain("@/pages/");
  });

  it("keeps the public entry explicit and limited to the route and snapshot adapter", () => {
    const publicEntry = readFileSync(
      path.join(directorRoot, "index.ts"),
      "utf8"
    );
    expect(publicEntry).toContain('export { default } from "./DirectorPage";');
    expect(publicEntry).toContain('from "./model/canvasSnapshot";');
    expect(publicEntry).not.toContain("export *");
  });

  it("keeps legacy Director paths as thin feature forwarders", () => {
    expect(
      readFileSync(
        path.join(sourceRoot, "pages/DirectorDeskView.tsx"),
        "utf8"
      ).trim()
    ).toBe('export { default } from "@/features/director";');

    const canvasForwarder = readFileSync(
      path.join(sourceRoot, "lib/director-canvas.ts"),
      "utf8"
    );
    expect(canvasForwarder).toContain('from "@/features/director";');
    expect(canvasForwarder).not.toContain("function ");
    expect(canvasForwarder).not.toContain("@/services/api");
  });

  it("does not depend on the global API barrel or Canvas implementation", () => {
    const forbidden = [
      "@/services/api",
      "@/pages/DirectorDeskView",
      "@/lib/director-canvas",
      "@/lib/canvas-snapshot-roundtrip",
      "@/features/canvas/",
    ];
    const violations = productionSources(directorRoot).flatMap(filePath => {
      const source = readFileSync(filePath, "utf8");
      return forbidden
        .filter(specifier => source.includes(specifier))
        .map(
          specifier => `${path.relative(directorRoot, filePath)}: ${specifier}`
        );
    });
    expect(violations).toEqual([]);
  });

  it("contains postMessage protocol handling only inside the typed bridge", () => {
    const violations = productionSources(directorRoot).flatMap(filePath => {
      const relativePath = path
        .relative(directorRoot, filePath)
        .replaceAll(path.sep, "/");
      if (relativePath === "bridge/DirectorBridgeClient.ts") return [];
      return readFileSync(filePath, "utf8").includes("postMessage(")
        ? [relativePath]
        : [];
    });
    expect(violations).toEqual([]);
  });
});
