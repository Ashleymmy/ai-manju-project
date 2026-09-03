import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const canvasRoot = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(canvasRoot, "../..");

function readSource(relativePath: string) {
  return readFileSync(path.join(sourceRoot, relativePath), "utf8");
}

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(entryPath);
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return [];
    if (/\.(?:test|spec)\.tsx?$/.test(entry.name)) return [];
    return [entryPath];
  });
}

describe("Canvas feature boundaries", () => {
  it("keeps image computation, browser IO and text storage in their owning layers", () => {
    const imageDomain = readSource("features/canvas/domain/imageData.ts");
    const imageAdapter = readSource("features/canvas/adapters/imageData.ts");
    const textRepository = readSource(
      "features/canvas/repositories/textAssetsRepository.ts",
    );

    expect(imageDomain).toContain("function moveImageCropRect");
    expect(imageDomain).toContain("function resolveUpscaleSize");
    expect(imageDomain).not.toMatch(/\b(?:document|window)\s*\./);
    expect(imageDomain).not.toMatch(/\bnew\s+(?:Image|File|FileReader)\b/);
    expect(imageAdapter).toContain('from "@/features/canvas/domain/imageData"');
    expect(imageAdapter).toContain('document.createElement("canvas")');
    expect(imageAdapter).toContain("new Image()");
    expect(textRepository).toContain('from "@/shared/storage"');
    expect(textRepository).toContain("crypto.randomUUID()");
  });

  it("keeps legacy image and text modules as implementation-free forwarders", () => {
    for (const relativePath of [
      "lib/canvas-image-data.ts",
      "lib/canvas-text-assets.ts",
    ]) {
      const source = readSource(relativePath);
      expect(source).toContain("Compatibility forwarder");
      expect(source).not.toMatch(/\b(?:async\s+)?function\b/);
      expect(source).not.toMatch(/\b(?:document|localforage|crypto)\b/);
    }
  });

  it("keeps Canvas production consumers off the legacy image and text modules", () => {
    const forbidden = ["@/lib/canvas-image-data", "@/lib/canvas-text-assets"];
    const files = [
      ...productionSources(canvasRoot),
      path.join(sourceRoot, "pages/CanvasWorkspaceView.tsx"),
    ];
    const violations = files.flatMap(filePath => {
      const source = readFileSync(filePath, "utf8");
      return forbidden
        .filter(specifier => source.includes(specifier))
        .map(specifier => `${path.relative(sourceRoot, filePath)}: ${specifier}`);
    });

    expect(violations).toEqual([]);
  });

  it("keeps Canvas presenters free of transport and broad store subscriptions", () => {
    const uiRoot = path.join(canvasRoot, "ui");
    const violations = productionSources(uiRoot).flatMap(filePath => {
      if (filePath.endsWith(`${path.sep}CanvasProvider.tsx`)) return [];
      const source = readFileSync(filePath, "utf8");
      return [
        source.includes("@/services/api") ? "legacy API" : "",
        source.includes("@/shared/api/http") ? "HTTP transport" : "",
        source.includes("useCanvasStore(") ? "store hook" : "",
      ].filter(Boolean).map(reason => `${path.relative(sourceRoot, filePath)}: ${reason}`);
    });

    expect(violations).toEqual([]);
  });
});
