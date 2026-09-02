import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { createStudioQueryClient } from "./providers/QueryProvider";

type ArchitectureLayer = "app" | "features" | "entities" | "shared";
type ReferenceKind =
  "dynamic-import" | "export" | "import" | "import-type" | "require";

interface ModuleReference {
  candidatePath: string | null;
  column: number;
  isWildcardExport: boolean;
  kind: ReferenceKind;
  line: number;
  specifier: string;
  targetPath: string | null;
}

interface ProductionModule {
  filePath: string;
  references: ModuleReference[];
  relativePath: string;
}

const architectureLayers = new Set<ArchitectureLayer>([
  "app",
  "features",
  "entities",
  "shared",
]);
const layerRank: Record<ArchitectureLayer, number> = {
  app: 3,
  features: 2,
  entities: 1,
  shared: 0,
};
const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const presentationDirectories = new Set([
  "components",
  "page",
  "pages",
  "render",
  "renders",
  "routes",
  "ui",
  "view",
  "views",
]);

function toPosix(filePath: string) {
  return filePath.replaceAll(path.sep, "/");
}

function pathKey(filePath: string) {
  const normalized = toPosix(path.resolve(filePath));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isProductionTypeScriptFile(fileName: string) {
  return (
    (fileName.endsWith(".ts") || fileName.endsWith(".tsx")) &&
    !/\.(?:test|spec)\.tsx?$/.test(fileName) &&
    !/\.d\.tsx?$/.test(fileName)
  );
}

function collectProductionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectProductionFiles(entryPath);
      return entry.isFile() && isProductionTypeScriptFile(entry.name)
        ? [entryPath]
        : [];
    })
    .sort((left, right) => left.localeCompare(right));
}

function internalCandidatePath(importerPath: string, specifier: string) {
  const cleanSpecifier = specifier.split(/[?#]/, 1)[0];
  if (cleanSpecifier.startsWith("@/")) {
    return path.resolve(sourceRoot, cleanSpecifier.slice(2));
  }
  if (cleanSpecifier.startsWith(".")) {
    return path.resolve(path.dirname(importerPath), cleanSpecifier);
  }
  return null;
}

function resolutionCandidates(candidatePath: string) {
  const extension = path.extname(candidatePath).toLowerCase();
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    const withoutExtension = candidatePath.slice(0, -extension.length);
    return [`${withoutExtension}.ts`, `${withoutExtension}.tsx`];
  }
  if (extension) return [candidatePath];
  return [
    `${candidatePath}.ts`,
    `${candidatePath}.tsx`,
    path.join(candidatePath, "index.ts"),
    path.join(candidatePath, "index.tsx"),
  ];
}

function referenceLocation(sourceFile: ts.SourceFile, node: ts.Node) {
  const { character, line } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile)
  );
  return { column: character + 1, line: line + 1 };
}

function extractModuleSpecifiers(sourceFile: ts.SourceFile) {
  const references: Array<{
    isWildcardExport: boolean;
    kind: ReferenceKind;
    node: ts.StringLiteralLike;
    specifier: string;
  }> = [];

  const addReference = (
    node: ts.Expression | ts.TypeNode | undefined,
    kind: ReferenceKind,
    isWildcardExport = false
  ) => {
    if (node && ts.isStringLiteralLike(node)) {
      references.push({ isWildcardExport, kind, node, specifier: node.text });
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      addReference(node.moduleSpecifier, "import");
    } else if (ts.isExportDeclaration(node)) {
      addReference(
        node.moduleSpecifier,
        "export",
        !node.exportClause || ts.isNamespaceExport(node.exportClause)
      );
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addReference(node.moduleReference.expression, "import");
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument)
    ) {
      addReference(node.argument.literal, "import-type");
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addReference(node.arguments[0], "dynamic-import");
      } else if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require"
      ) {
        addReference(node.arguments[0], "require");
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return references;
}

function loadProductionModules() {
  const filePaths = collectProductionFiles(sourceRoot);
  const knownFiles = new Map(
    filePaths.map(filePath => [pathKey(filePath), filePath])
  );
  const modules = filePaths.map<ProductionModule>(filePath => {
    const sourceFile = ts.createSourceFile(
      filePath,
      readFileSync(filePath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const references = extractModuleSpecifiers(sourceFile).map<ModuleReference>(
      reference => {
        const candidatePath = internalCandidatePath(
          filePath,
          reference.specifier
        );
        const targetPath = candidatePath
          ? (resolutionCandidates(candidatePath)
              .map(candidate => knownFiles.get(pathKey(candidate)) ?? null)
              .find((candidate): candidate is string => candidate !== null) ??
            null)
          : null;
        return {
          ...referenceLocation(sourceFile, reference.node),
          candidatePath,
          isWildcardExport: reference.isWildcardExport,
          kind: reference.kind,
          specifier: reference.specifier,
          targetPath,
        };
      }
    );
    return {
      filePath,
      references,
      relativePath: toPosix(path.relative(sourceRoot, filePath)),
    };
  });

  return new Map(modules.map(module => [pathKey(module.filePath), module]));
}

function relativeInternalPath(filePath: string | null) {
  if (!filePath) return null;
  const relativePath = path.relative(sourceRoot, filePath);
  if (
    relativePath === "" ||
    path.isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`)
  ) {
    return null;
  }
  return toPosix(relativePath);
}

function architectureLayer(
  relativePath: string | null
): ArchitectureLayer | null {
  if (!relativePath) return null;
  const [layer] = relativePath.split("/");
  return architectureLayers.has(layer as ArchitectureLayer)
    ? (layer as ArchitectureLayer)
    : null;
}

function formatReference(
  module: ProductionModule,
  reference: ModuleReference,
  message: string
) {
  return `${module.relativePath}:${reference.line}:${reference.column} ${message} (${reference.specifier})`;
}

function findDependencyCycles(modules: Map<string, ProductionModule>) {
  const visitState = new Map<string, "done" | "visiting">();
  const stack: string[] = [];
  const cycles = new Map<string, string[]>();

  const recordCycle = (targetKey: string) => {
    const cycleStart = stack.indexOf(targetKey);
    const cycleKeys = [...stack.slice(cycleStart), targetKey];
    const cyclePaths = cycleKeys.map(
      key => modules.get(key)?.relativePath ?? key
    );
    const members = cyclePaths.slice(0, -1);
    const rotations = members.map((_, index) => [
      ...members.slice(index),
      ...members.slice(0, index),
    ]);
    const canonicalMembers = rotations
      .map(rotation => rotation.join(" -> "))
      .sort((left, right) => left.localeCompare(right))[0];
    cycles.set(canonicalMembers, cyclePaths);
  };

  const visit = (moduleKey: string) => {
    visitState.set(moduleKey, "visiting");
    stack.push(moduleKey);
    const module = modules.get(moduleKey);
    const dependencies = [
      ...new Set(
        module?.references
          .map(
            reference => reference.targetPath && pathKey(reference.targetPath)
          )
          .filter((target): target is string => Boolean(target)) ?? []
      ),
    ].sort((left, right) => left.localeCompare(right));

    for (const dependency of dependencies) {
      const state = visitState.get(dependency);
      if (state === "visiting") recordCycle(dependency);
      else if (!state) visit(dependency);
    }

    stack.pop();
    visitState.set(moduleKey, "done");
  };

  for (const moduleKey of [...modules.keys()].sort((left, right) =>
    left.localeCompare(right)
  )) {
    if (!visitState.has(moduleKey)) visit(moduleKey);
  }

  return [...cycles.values()].map(cycle => cycle.join(" -> "));
}

function layerDirectionViolations(modules: Map<string, ProductionModule>) {
  const violations: string[] = [];
  for (const module of modules.values()) {
    const sourceLayer = architectureLayer(module.relativePath);
    if (!sourceLayer) continue;

    for (const reference of module.references) {
      const targetRelativePath =
        modules.get(reference.targetPath ? pathKey(reference.targetPath) : "")
          ?.relativePath ?? relativeInternalPath(reference.candidatePath);
      const targetLayer = architectureLayer(targetRelativePath);
      if (targetLayer && layerRank[sourceLayer] < layerRank[targetLayer]) {
        violations.push(
          formatReference(
            module,
            reference,
            `${sourceLayer} 不得依赖更高层 ${targetLayer}`
          )
        );
      }
    }
  }
  return violations.sort((left, right) => left.localeCompare(right));
}

function crossFeatureBoundaryViolations(
  modules: Map<string, ProductionModule>
) {
  const violations: string[] = [];
  for (const module of modules.values()) {
    const [, sourceFeature] = module.relativePath.split("/");
    if (!module.relativePath.startsWith("features/") || !sourceFeature)
      continue;

    for (const reference of module.references) {
      const targetModule = reference.targetPath
        ? (modules.get(pathKey(reference.targetPath)) ?? null)
        : null;
      const targetRelativePath =
        targetModule?.relativePath ??
        relativeInternalPath(reference.candidatePath);
      const [targetLayer, targetFeature] = targetRelativePath?.split("/") ?? [];
      if (
        targetLayer !== "features" ||
        !targetFeature ||
        targetFeature === sourceFeature
      )
        continue;

      const publicEntry = `features/${targetFeature}/index.ts`;
      if (targetModule?.relativePath !== publicEntry) {
        violations.push(
          formatReference(
            module,
            reference,
            `跨 feature 依赖必须通过 ${publicEntry}`
          )
        );
      }
    }
  }
  return violations.sort((left, right) => left.localeCompare(right));
}

function isWithinDirectory(directory: string, candidatePath: string) {
  const relativePath = path.relative(directory, candidatePath);
  return (
    relativePath === "" ||
    (!path.isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`))
  );
}

function publicEntryReExportViolations(modules: Map<string, ProductionModule>) {
  const violations: string[] = [];
  for (const module of modules.values()) {
    if (
      path.basename(module.filePath) !== "index.ts" ||
      !architectureLayer(module.relativePath)
    ) {
      continue;
    }

    const entryDirectory = path.dirname(module.filePath);
    for (const reference of module.references) {
      if (
        reference.kind === "export" &&
        reference.candidatePath &&
        !isWithinDirectory(entryDirectory, reference.candidatePath)
      ) {
        violations.push(
          formatReference(
            module,
            reference,
            "公共 index.ts 不得从自身目录外 re-export"
          )
        );
      }
    }
  }
  return violations.sort((left, right) => left.localeCompare(right));
}

function publicEntryWildcardExportViolations(
  modules: Map<string, ProductionModule>
) {
  const violations: string[] = [];
  for (const module of modules.values()) {
    if (
      path.basename(module.filePath) !== "index.ts" ||
      !architectureLayer(module.relativePath)
    ) {
      continue;
    }

    for (const reference of module.references) {
      if (reference.kind === "export" && reference.isWildcardExport) {
        violations.push(
          formatReference(
            module,
            reference,
            "公共 index.ts 禁止 wildcard export"
          )
        );
      }
    }
  }
  return violations.sort((left, right) => left.localeCompare(right));
}

function isPresentationModule(module: ProductionModule) {
  const pathSegments = module.relativePath.toLowerCase().split("/");
  const fileName = pathSegments.at(-1) ?? "";
  return (
    fileName.endsWith(".tsx") ||
    pathSegments.some(segment => presentationDirectories.has(segment)) ||
    /(?:page|view|screen|layout|route)\.ts$/.test(fileName)
  );
}

function importsHttpTransport(reference: ModuleReference) {
  const relativePath = relativeInternalPath(
    reference.targetPath ?? reference.candidatePath
  );
  return relativePath
    ? /^shared\/api\/http(?:[/.]|$)/.test(relativePath)
    : false;
}

function presentationTransportViolations(
  modules: Map<string, ProductionModule>
) {
  const violations: string[] = [];
  for (const module of modules.values()) {
    if (!isPresentationModule(module)) continue;
    for (const reference of module.references) {
      if (importsHttpTransport(reference)) {
        violations.push(
          formatReference(
            module,
            reference,
            "page/render 层不得直接 import shared/api/http transport"
          )
        );
      }
    }
  }
  return violations.sort((left, right) => left.localeCompare(right));
}

describe("Studio architecture boundaries", () => {
  const modules = loadProductionModules();

  it("keeps the production TypeScript dependency graph cycle-free", () => {
    expect(modules.size).toBeGreaterThan(0);
    expect(findDependencyCycles(modules)).toEqual([]);
  });

  it("keeps app -> features -> entities -> shared dependencies one-way", () => {
    expect(layerDirectionViolations(modules)).toEqual([]);
  });

  it("routes cross-feature dependencies through the target public index.ts", () => {
    expect(crossFeatureBoundaryViolations(modules)).toEqual([]);
  });

  it("keeps public index.ts re-exports inside their owning directory", () => {
    expect(publicEntryReExportViolations(modules)).toEqual([]);
  });

  it("keeps public index.ts exports explicit", () => {
    expect(publicEntryWildcardExportViolations(modules)).toEqual([]);
  });

  it("detects wildcard exports in a public entry", () => {
    const entryPath = path.join(sourceRoot, "shared", "fixture", "index.ts");
    const targetPath = path.join(
      sourceRoot,
      "shared",
      "fixture",
      "internal.ts"
    );
    const fixture = new Map<string, ProductionModule>([
      [
        pathKey(entryPath),
        {
          filePath: entryPath,
          relativePath: "shared/fixture/index.ts",
          references: [
            {
              candidatePath: targetPath,
              column: 1,
              isWildcardExport: true,
              kind: "export",
              line: 1,
              specifier: "./internal",
              targetPath,
            },
          ],
        },
      ],
    ]);

    expect(publicEntryWildcardExportViolations(fixture)).toHaveLength(1);
  });

  it("keeps page and render modules independent of the HTTP transport", () => {
    expect(presentationTransportViolations(modules)).toEqual([]);
  });
});

describe("Studio query defaults", () => {
  it("does not retry or refetch queries on window focus", () => {
    const options = createStudioQueryClient().getDefaultOptions();

    expect(options.queries?.retry).toBe(false);
    expect(options.queries?.refetchOnWindowFocus).toBe(false);
    expect(options.mutations?.retry).toBe(false);
  });
});
