#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROUTE_ORCHESTRATOR_LINE_LIMIT = 500;
const CANVAS_WORKSPACE_LINE_LIMIT = 250;
const CHAT_INITIAL_GZIP_LIMIT = 185_760;
const ROUTE_CHUNK_RAW_LIMIT = 500_000;
const CANVAS_CHUNK_RAW_LIMIT = 500_000;
const SHARED_INITIAL_CSS_RAW_LIMIT = 190_040;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultStudioRoot = path.resolve(scriptDirectory, "..");

function parseOptions(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.set("help", "true");
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new Error(`未知参数：${argument}`);
    }
    const separator = argument.indexOf("=");
    if (separator > 2) {
      options.set(argument.slice(2, separator), argument.slice(separator + 1));
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`参数 ${argument} 缺少值`);
    }
    options.set(argument.slice(2), value);
    index += 1;
  }
  return options;
}

function printHelp() {
  console.log(`用法：node apps/studio/quality/check-bundle-budgets.mjs [选项]

选项：
  --manifest <path>     Vite manifest 路径（默认 apps/studio/dist/public/.vite/manifest.json）
  --dist-dir <path>     Vite 产物根目录（默认从 manifest 路径推导）
  --source-root <path>  Studio client/src 路径（主要用于定向 fixture 自测）
  --help                显示帮助
`);
}

const cliOptions = parseOptions(process.argv.slice(2));
if (cliOptions.has("help")) {
  printHelp();
  process.exit(0);
}

const require = createRequire(import.meta.url);
let ts;
try {
  ts = require("typescript");
} catch (error) {
  console.error(
    `[bundle-budget] 无法加载 TypeScript；请先安装 workspace 依赖：${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exit(2);
}

const sourceRoot = path.resolve(
  cliOptions.get("source-root") ?? path.join(defaultStudioRoot, "client", "src")
);
const clientRoot = path.dirname(sourceRoot);
const manifestPath = path.resolve(
  cliOptions.get("manifest") ??
    process.env.STUDIO_VITE_MANIFEST ??
    path.join(defaultStudioRoot, "dist", "public", ".vite", "manifest.json")
);
const manifestDirectory = path.dirname(manifestPath);
const inferredDistRoot =
  path.basename(manifestDirectory).toLowerCase() === ".vite"
    ? path.dirname(manifestDirectory)
    : manifestDirectory;
const distRoot = path.resolve(cliOptions.get("dist-dir") ?? inferredDistRoot);

const failures = [];
const passes = [];

function verify(label, callback) {
  try {
    const detail = callback();
    passes.push(`${label}${detail ? `：${detail}` : ""}`);
  } catch (error) {
    failures.push(
      `${label}：${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function toPosix(filePath) {
  return filePath.replaceAll("\\", "/");
}

function pathKey(filePath) {
  const normalized = toPosix(path.resolve(filePath));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function relativeSourcePath(filePath) {
  return toPosix(path.relative(sourceRoot, filePath));
}

function countLines(contents) {
  if (contents.length === 0) return 0;
  const newlineCount = contents.match(/\r\n|\r|\n/g)?.length ?? 0;
  return newlineCount + (/\r\n$|\r$|\n$/.test(contents) ? 0 : 1);
}

function isProductionSource(fileName) {
  return (
    /\.(?:cts|mts|tsx?)$/.test(fileName) &&
    !/\.(?:test|spec)\.(?:cts|mts|tsx?)$/.test(fileName) &&
    !/\.d\.(?:cts|mts|tsx?)$/.test(fileName)
  );
}

function collectFiles(directory, predicate) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectFiles(entryPath, predicate);
      return entry.isFile() && predicate(entry.name) ? [entryPath] : [];
    })
    .sort((left, right) => left.localeCompare(right));
}

function resolveCandidates(candidatePath) {
  const extension = path.extname(candidatePath).toLowerCase();
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    const stem = candidatePath.slice(0, -extension.length);
    return [`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`];
  }
  if (extension) return [candidatePath];
  return [
    `${candidatePath}.ts`,
    `${candidatePath}.tsx`,
    `${candidatePath}.mts`,
    `${candidatePath}.cts`,
    path.join(candidatePath, "index.ts"),
    path.join(candidatePath, "index.tsx"),
    path.join(candidatePath, "index.mts"),
    path.join(candidatePath, "index.cts"),
  ];
}

function internalCandidate(importerPath, specifier) {
  const cleanSpecifier = specifier.split(/[?#]/, 1)[0];
  if (cleanSpecifier.startsWith("@/")) {
    return path.resolve(sourceRoot, cleanSpecifier.slice(2));
  }
  if (cleanSpecifier.startsWith(".")) {
    return path.resolve(path.dirname(importerPath), cleanSpecifier);
  }
  return null;
}

function sourceReferences(filePath, contents) {
  const sourceFile = ts.createSourceFile(
    filePath,
    contents,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const references = [];
  const add = (node, kind) => {
    if (node && ts.isStringLiteralLike(node)) {
      references.push({ kind, specifier: node.text });
    }
  };
  const visit = node => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const typeOnly = clause?.isTypeOnly || (
        clause?.namedBindings &&
        ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.length > 0 &&
        clause.namedBindings.elements.every(element => element.isTypeOnly)
      );
      if (!typeOnly) add(node.moduleSpecifier, "static");
    } else if (ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier, "static");
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression, "static");
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument)
    ) {
      add(node.argument.literal, "static");
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        add(node.arguments[0], "dynamic");
      } else if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require"
      ) {
        add(node.arguments[0], "static");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

function loadSourceModules() {
  assert(existsSync(sourceRoot), `源码目录不存在：${sourceRoot}`);
  const files = collectFiles(sourceRoot, isProductionSource);
  const knownFiles = new Map(
    files.map(filePath => [pathKey(filePath), filePath])
  );
  const modules = new Map();
  for (const filePath of files) {
    const contents = readFileSync(filePath, "utf8");
    const references = sourceReferences(filePath, contents).map(reference => {
      const candidate = internalCandidate(filePath, reference.specifier);
      const target = candidate
        ? (resolveCandidates(candidate)
            .map(item => knownFiles.get(pathKey(item)))
            .find(Boolean) ?? null)
        : null;
      return { ...reference, target };
    });
    modules.set(pathKey(filePath), {
      contents,
      filePath,
      relativePath: relativeSourcePath(filePath),
      references,
    });
  }
  return { knownFiles, modules };
}

let sourceGraph;
verify("加载生产源码依赖图", () => {
  sourceGraph = loadSourceModules();
  return `${sourceGraph.modules.size} 个模块`;
});

function findSourceFile(relativeCandidates, basename) {
  assert(sourceGraph, "源码依赖图未加载");
  for (const relativeCandidate of relativeCandidates) {
    const candidate = sourceGraph.knownFiles.get(
      pathKey(path.resolve(sourceRoot, relativeCandidate))
    );
    if (candidate) return candidate;
  }
  const matches = [...sourceGraph.modules.values()]
    .filter(module => path.basename(module.filePath) === basename)
    .map(module => module.filePath);
  assert(
    matches.length === 1,
    matches.length === 0
      ? `找不到 ${basename}`
      : `${basename} 不唯一：${matches.map(relativeSourcePath).join(", ")}`
  );
  return matches[0];
}

verify("route orchestrator 行数", () => {
  const filePath = findSourceFile(
    ["app/routes/AppRouter.tsx", "app/routes/RouteOrchestrator.tsx"],
    "AppRouter.tsx"
  );
  const lines = countLines(readFileSync(filePath, "utf8"));
  assert(
    lines <= ROUTE_ORCHESTRATOR_LINE_LIMIT,
    `${relativeSourcePath(filePath)} 为 ${lines} 行，限制 ${ROUTE_ORCHESTRATOR_LINE_LIMIT} 行`
  );
  return `${relativeSourcePath(filePath)} ${lines}/${ROUTE_ORCHESTRATOR_LINE_LIMIT} 行`;
});

verify("CanvasWorkspaceView 行数", () => {
  const filePath = findSourceFile(
    [
      "features/canvas/CanvasWorkspaceView.tsx",
      "features/canvas/ui/CanvasWorkspaceView.tsx",
      "pages/CanvasWorkspaceView.tsx",
    ],
    "CanvasWorkspaceView.tsx"
  );
  const lines = countLines(readFileSync(filePath, "utf8"));
  assert(
    lines <= CANVAS_WORKSPACE_LINE_LIMIT,
    `${relativeSourcePath(filePath)} 为 ${lines} 行，限制 ${CANVAS_WORKSPACE_LINE_LIMIT} 行`
  );
  return `${relativeSourcePath(filePath)} ${lines}/${CANVAS_WORKSPACE_LINE_LIMIT} 行`;
});

function dependencyCycles(modules) {
  const state = new Map();
  const stack = [];
  const cycles = new Map();
  const record = targetKey => {
    const start = stack.indexOf(targetKey);
    const keys = [...stack.slice(start), targetKey];
    const paths = keys.map(key => modules.get(key)?.relativePath ?? key);
    const members = paths.slice(0, -1);
    const canonical = members
      .map((_, index) =>
        [...members.slice(index), ...members.slice(0, index)].join(" -> ")
      )
      .sort()[0];
    cycles.set(canonical, paths.join(" -> "));
  };
  const visit = moduleKey => {
    state.set(moduleKey, "visiting");
    stack.push(moduleKey);
    const targets = [
      ...new Set(
        (modules.get(moduleKey)?.references ?? [])
          .map(reference => reference.target && pathKey(reference.target))
          .filter(Boolean)
      ),
    ].sort();
    for (const target of targets) {
      if (state.get(target) === "visiting") record(target);
      else if (!state.has(target)) visit(target);
    }
    stack.pop();
    state.set(moduleKey, "done");
  };
  for (const moduleKey of [...modules.keys()].sort()) {
    if (!state.has(moduleKey)) visit(moduleKey);
  }
  return [...cycles.values()];
}

verify("生产依赖环", () => {
  assert(sourceGraph, "源码依赖图未加载");
  const cycles = dependencyCycles(sourceGraph.modules);
  assert(
    cycles.length === 0,
    `发现 ${cycles.length} 个依赖环：\n${cycles.slice(0, 10).join("\n")}`
  );
  return "0 个";
});

verify("page/render 层直连 transport", () => {
  assert(sourceGraph, "源码依赖图未加载");
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
  const violations = [];
  for (const module of sourceGraph.modules.values()) {
    if (
      !module.relativePath
        .split("/")
        .some(part => presentationDirectories.has(part))
    ) {
      continue;
    }
    for (const reference of module.references) {
      const targetRelative = reference.target
        ? relativeSourcePath(reference.target)
        : "";
      if (
        targetRelative === "shared/api/http/index.ts" ||
        targetRelative.startsWith("shared/api/http/") ||
        /^@\/shared\/api\/http(?:\/|$)/.test(reference.specifier) ||
        targetRelative === "services/api/request.ts" ||
        /^@\/services\/api\/request(?:\.[^/]+)?$/.test(reference.specifier)
      ) {
        violations.push(`${module.relativePath} -> ${reference.specifier}`);
      }
    }
  }
  assert(
    violations.length === 0,
    `发现 ${violations.length} 条直连：\n${violations.join("\n")}`
  );
  return "0 条";
});

verify("全局 API barrel", () => {
  const candidates = [
    "services/api/index.ts",
    "services/api/index.tsx",
    "services/api.ts",
    "services/api.tsx",
  ].filter(relativePath => existsSync(path.resolve(sourceRoot, relativePath)));
  assert(
    candidates.length === 0,
    `仍存在 ${candidates.join(", ")}；请改由 entity/feature 公共出口提供领域 API`
  );
  return "不存在";
});

function loadManifest() {
  assert(
    existsSync(manifestPath),
    `找不到 ${manifestPath}；请先使用 Vite manifest 构建 Studio`
  );
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert(
    parsed && typeof parsed === "object" && !Array.isArray(parsed),
    "Manifest 顶层必须为对象"
  );
  const entries = new Map(Object.entries(parsed));
  assert(entries.size > 0, "Manifest 为空");
  return entries;
}

let manifest;
verify("加载 Vite manifest", () => {
  manifest = loadManifest();
  return `${manifest.size} 个条目`;
});

function manifestIdentity(key) {
  const entry = manifest.get(key) ?? {};
  return [key, entry.src, entry.name, entry.file]
    .filter(value => typeof value === "string")
    .map(value => toPosix(value))
    .join(" | ");
}

function manifestAssetPath(assetPath) {
  assert(
    typeof assetPath === "string" && assetPath.length > 0,
    "Manifest 产物路径无效"
  );
  const resolved = path.resolve(distRoot, assetPath);
  const relative = path.relative(distRoot, resolved);
  assert(
    relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
    `Manifest 产物越出 dist：${assetPath}`
  );
  assert(existsSync(resolved), `Manifest 指向的产物不存在：${resolved}`);
  assert(statSync(resolved).isFile(), `Manifest 产物不是文件：${resolved}`);
  return resolved;
}

function findManifestEntry() {
  const entries = [...manifest.entries()].filter(([, value]) => value?.isEntry);
  assert(entries.length > 0, "Manifest 中没有 isEntry 条目");
  return (entries.find(([key, value]) =>
    [key, value?.src].some(item =>
      /(?:^|\/)index\.html$/i.test(toPosix(item ?? ""))
    )
  ) ?? entries[0])[0];
}

function manifestKeyForSource(sourceFile) {
  const expected = toPosix(path.relative(clientRoot, sourceFile));
  const exact = [...manifest.entries()].filter(([key, value]) =>
    [key, value?.src].some(item => toPosix(item ?? "") === expected)
  );
  if (exact.length === 1) return exact[0][0];
  const suffix = [...manifest.entries()].filter(([key, value]) =>
    [key, value?.src].some(item => toPosix(item ?? "").endsWith(`/${expected}`))
  );
  const matches = exact.length > 0 ? exact : suffix;
  if (matches.length === 0) {
    const basename = path.basename(expected, path.extname(expected));
    const byEntryName = [...manifest.entries()].filter(([, value]) =>
      value?.name === basename && (value?.isEntry || value?.isDynamicEntry)
    );
    if (byEntryName.length === 1) return byEntryName[0][0];
  }
  assert(
    matches.length === 1,
    matches.length === 0
      ? `Manifest 中找不到源码入口 ${expected}`
      : `Manifest 中源码入口 ${expected} 不唯一：${matches.map(([key]) => key).join(", ")}`
  );
  return matches[0][0];
}

function walkManifest(startKeys, includeDynamic) {
  const parents = new Map();
  const visited = new Set();
  const queue = [...startKeys];
  for (const key of startKeys) parents.set(key, null);
  while (queue.length > 0) {
    const key = queue.shift();
    if (visited.has(key)) continue;
    visited.add(key);
    const entry = manifest.get(key);
    assert(entry, `Manifest 引用了缺失条目：${key}`);
    const edges = [
      ...(entry.imports ?? []).map(target => ({ kind: "import", target })),
      ...(includeDynamic ? (entry.dynamicImports ?? []) : []).map(target => ({
        kind: "import()",
        target,
      })),
    ];
    for (const edge of edges) {
      assert(manifest.has(edge.target), `${key} 引用了缺失条目 ${edge.target}`);
      if (!parents.has(edge.target))
        parents.set(edge.target, { from: key, kind: edge.kind });
      if (!visited.has(edge.target)) queue.push(edge.target);
    }
  }
  return { parents, visited };
}

function manifestChain(parents, target) {
  const chain = [];
  let current = target;
  while (current) {
    const parent = parents.get(current);
    chain.push({ key: current, edge: parent?.kind ?? null });
    current = parent?.from ?? null;
  }
  return chain
    .reverse()
    .map(
      (item, index) =>
        `${index > 0 ? `${item.edge} ` : ""}${manifestIdentity(item.key)}`
    )
    .join(" -> ");
}

function findRouteFile() {
  return findSourceFile(
    ["app/routes/routes.ts", "app/routes/routes.tsx"],
    "routes.ts"
  );
}

function routeDefinitions() {
  const routeFile = findRouteFile();
  const contents = readFileSync(routeFile, "utf8");
  const sourceFile = ts.createSourceFile(
    routeFile,
    contents,
    ts.ScriptTarget.Latest,
    true,
    routeFile.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const loaderBindings = new Map();
  const findImport = node => {
    let specifier = null;
    const visit = child => {
      if (specifier) return;
      if (
        ts.isCallExpression(child) &&
        child.expression.kind === ts.SyntaxKind.ImportKeyword &&
        ts.isStringLiteralLike(child.arguments[0])
      ) {
        specifier = child.arguments[0].text;
        return;
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
    return specifier;
  };
  const property = (object, name) =>
    object.properties.find(item => {
      if (
        !ts.isPropertyAssignment(item) &&
        !ts.isShorthandPropertyAssignment(item)
      )
        return false;
      const propertyName = item.name;
      return (
        (ts.isIdentifier(propertyName) ||
          ts.isStringLiteralLike(propertyName)) &&
        propertyName.text === name
      );
    });
  const firstPass = node => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const specifier = findImport(node.initializer);
      if (specifier) loaderBindings.set(node.name.text, specifier);
    }
    ts.forEachChild(node, firstPass);
  };
  firstPass(sourceFile);

  const routes = [];
  const visit = node => {
    if (ts.isObjectLiteralExpression(node)) {
      const pathProperty = property(node, "path");
      const loaderProperty = property(node, "loader");
      const pathInitializer =
        pathProperty && ts.isPropertyAssignment(pathProperty)
          ? pathProperty.initializer
          : null;
      const loaderInitializer =
        loaderProperty && ts.isPropertyAssignment(loaderProperty)
          ? loaderProperty.initializer
          : loaderProperty && ts.isShorthandPropertyAssignment(loaderProperty)
            ? loaderProperty.name
            : null;
      if (
        pathInitializer &&
        ts.isStringLiteralLike(pathInitializer) &&
        loaderInitializer
      ) {
        const specifier =
          (ts.isIdentifier(loaderInitializer)
            ? loaderBindings.get(loaderInitializer.text)
            : null) ?? findImport(loaderInitializer);
        if (specifier)
          routes.push({ path: pathInitializer.text, routeFile, specifier });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert(
    routes.length > 0,
    `${relativeSourcePath(routeFile)} 中未解析到声明式 lazy route`
  );
  return routes;
}

function resolveRouteSource(route) {
  const candidate = internalCandidate(route.routeFile, route.specifier);
  assert(candidate, `路由 ${route.path} 使用了不可解析入口 ${route.specifier}`);
  const target = resolveCandidates(candidate)
    .map(item => sourceGraph.knownFiles.get(pathKey(item)))
    .find(Boolean);
  assert(target, `路由 ${route.path} 找不到源码入口 ${route.specifier}`);
  return target;
}

let routeEntries;
verify("声明式路由 Manifest 映射", () => {
  assert(sourceGraph && manifest, "源码图或 Manifest 未加载");
  routeEntries = routeDefinitions().map(route => {
    const sourceFile = resolveRouteSource(route);
    return {
      ...route,
      sourceFile,
      manifestKey: manifestKeyForSource(sourceFile),
    };
  });
  return `${routeEntries.length} 条 lazy route`;
});

function uniqueAssetFiles(keys, selector) {
  const assets = new Map();
  for (const key of keys) {
    const entry = manifest.get(key);
    for (const asset of selector(entry)) {
      const filePath = manifestAssetPath(asset);
      assets.set(pathKey(filePath), filePath);
    }
  }
  return [...assets.values()];
}

function formatBytes(bytes) {
  return `${bytes.toLocaleString("en-US")} B`;
}

verify("/chat 初始 gzip 与隔离依赖图", () => {
  assert(manifest && routeEntries, "Manifest 路由映射未加载");
  const entryKey = findManifestEntry();
  const chat = routeEntries.find(route => route.path === "/chat");
  assert(chat, "声明式路由中缺少 /chat");
  const graph = walkManifest([entryKey, chat.manifestKey], false);
  const scripts = uniqueAssetFiles(graph.visited, entry =>
    typeof entry?.file === "string" && entry.file.endsWith(".js")
      ? [entry.file]
      : []
  );
  const gzipBytes = scripts.reduce(
    (total, filePath) =>
      total + gzipSync(readFileSync(filePath), { level: 9 }).length,
    0
  );
  assert(
    gzipBytes <= CHAT_INITIAL_GZIP_LIMIT,
    `${formatBytes(gzipBytes)}，限制 ${formatBytes(CHAT_INITIAL_GZIP_LIMIT)}；文件：${scripts
      .map(filePath => toPosix(path.relative(distRoot, filePath)))
      .join(", ")}`
  );
  const forbidden = /(?:^|\/)features\/(canvas|video|admin|director)(?:\/|$)/i;
  const contamination = [...graph.visited].filter(key =>
    forbidden.test(manifestIdentity(key))
  );
  assert(
    contamination.length === 0,
    `发现隔离 feature：\n${contamination
      .map(key => manifestChain(graph.parents, key))
      .join("\n")}`
  );
  return `${formatBytes(gzipBytes)}/${formatBytes(CHAT_INITIAL_GZIP_LIMIT)}，无 Canvas/Video/Admin/Director`;
});

verify("非 Canvas route chunk raw", () => {
  assert(manifest && routeEntries, "Manifest 路由映射未加载");
  const candidates = new Map(
    routeEntries
      .filter(item => !item.path.startsWith("/canvas"))
      .map(route => [route.manifestKey, route.path])
  );
  for (const [manifestKey] of manifest) {
    const match = manifestIdentity(manifestKey).match(
      /(?:^|\/)src\/features\/([^/]+)\/index\.(?:ts|tsx)(?:\s|\||$)/i
    );
    if (match && match[1].toLowerCase() !== "canvas") {
      candidates.set(manifestKey, `feature:${match[1].toLowerCase()}`);
    }
  }
  const checked = new Map();
  for (const [manifestKey, label] of candidates) {
    if (checked.has(manifestKey)) continue;
    const filePath = manifestAssetPath(manifest.get(manifestKey)?.file);
    if (!filePath.endsWith(".js")) continue;
    const bytes = statSync(filePath).size;
    assert(
      bytes <= ROUTE_CHUNK_RAW_LIMIT,
      `${label} (${manifestKey}) 为 ${formatBytes(bytes)}，限制 ${formatBytes(ROUTE_CHUNK_RAW_LIMIT)}`
    );
    checked.set(manifestKey, bytes);
  }
  assert(checked.size > 0, "没有可检查的非 Canvas route chunk");
  return `${checked.size} 个 chunk 均不超过 ${formatBytes(ROUTE_CHUNK_RAW_LIMIT)}`;
});

verify("Canvas 主 chunk raw", () => {
  assert(manifest && routeEntries, "Manifest 路由映射未加载");
  const canvas =
    routeEntries.find(route => route.path === "/canvas/:id") ??
    routeEntries.find(route => route.path === "/canvas");
  assert(canvas, "声明式路由中缺少 Canvas route");
  const filePath = manifestAssetPath(manifest.get(canvas.manifestKey)?.file);
  const bytes = statSync(filePath).size;
  assert(
    bytes <= CANVAS_CHUNK_RAW_LIMIT,
    `${canvas.manifestKey} 为 ${formatBytes(bytes)}，限制 ${formatBytes(CANVAS_CHUNK_RAW_LIMIT)}`
  );
  return `${formatBytes(bytes)}/${formatBytes(CANVAS_CHUNK_RAW_LIMIT)}`;
});

verify("shared 初始 CSS raw", () => {
  assert(manifest, "Manifest 未加载");
  const entryKey = findManifestEntry();
  const graph = walkManifest([entryKey], false);
  const styles = uniqueAssetFiles(graph.visited, entry =>
    Array.isArray(entry?.css) ? entry.css : []
  );
  const bytes = styles.reduce(
    (total, filePath) => total + statSync(filePath).size,
    0
  );
  assert(styles.length > 0, "入口静态依赖图中没有 CSS 产物");
  assert(
    bytes <= SHARED_INITIAL_CSS_RAW_LIMIT,
    `${formatBytes(bytes)}，限制 ${formatBytes(SHARED_INITIAL_CSS_RAW_LIMIT)}；文件：${styles
      .map(filePath => toPosix(path.relative(distRoot, filePath)))
      .join(", ")}`
  );
  return `${formatBytes(bytes)}/${formatBytes(SHARED_INITIAL_CSS_RAW_LIMIT)}`;
});

const lazyTargetMatchers = {
  Agent: relativePath =>
    /(?:^|\/)features\/canvas\/agent(?:\/|$)/i.test(relativePath) ||
    /(?:^|\/)AgentPanel(?:Slot)?\.[^.]+$/i.test(relativePath),
  重型弹窗: relativePath =>
    /(?:^|\/)(?:Prompt|Skill|Storyboard)[^/]*Dialog\.[^.]+$/i.test(
      relativePath
    ) ||
    /(?:^|\/)Canvas(?:ImageMask|ImageAnnotation|SeedanceMaterial|SeedanceAsset|AssetPicker|Preview)[^/]*Dialog\.[^.]+$/i.test(
      relativePath
    ),
};

function walkSource(rootFile, includeDynamic) {
  const rootKey = pathKey(rootFile);
  const parents = new Map([[rootKey, null]]);
  const visited = new Set();
  const queue = [rootKey];
  while (queue.length > 0) {
    const key = queue.shift();
    if (visited.has(key)) continue;
    visited.add(key);
    const module = sourceGraph.modules.get(key);
    assert(module, `源码图缺少 ${key}`);
    for (const reference of module.references) {
      if (
        !reference.target ||
        (!includeDynamic && reference.kind === "dynamic")
      )
        continue;
      const targetKey = pathKey(reference.target);
      if (!parents.has(targetKey)) {
        parents.set(targetKey, { from: key, kind: reference.kind });
      }
      if (!visited.has(targetKey)) queue.push(targetKey);
    }
  }
  return { parents, visited };
}

function sourceChain(parents, targetKey) {
  const chain = [];
  let current = targetKey;
  while (current) {
    const parent = parents.get(current);
    chain.push({
      path: sourceGraph.modules.get(current)?.relativePath ?? current,
      edge: parent?.kind === "dynamic" ? "import()" : parent ? "import" : null,
      filePath: sourceGraph.modules.get(current)?.filePath ?? null,
    });
    current = parent?.from ?? null;
  }
  return chain.reverse();
}

verify("Agent 与重型弹窗 lazy load", () => {
  assert(
    sourceGraph && manifest && routeEntries,
    "源码图、Manifest 或路由映射未加载"
  );
  const canvas =
    routeEntries.find(route => route.path === "/canvas/:id") ??
    routeEntries.find(route => route.path === "/canvas");
  assert(canvas, "声明式路由中缺少 Canvas route");
  const staticSource = walkSource(canvas.sourceFile, false);
  const fullSource = walkSource(canvas.sourceFile, true);
  const fullManifest = walkManifest([canvas.manifestKey], true);
  const staticManifest = walkManifest([canvas.manifestKey], false);
  const summaries = [];

  for (const [label, matcher] of Object.entries(lazyTargetMatchers)) {
    const candidates = [...fullSource.visited].filter(key => {
      const module = sourceGraph.modules.get(key);
      return module && matcher(module.relativePath);
    });
    assert(candidates.length > 0, `Canvas 依赖图中没有找到 ${label} 稳定入口`);
    const eager = candidates.filter(key => staticSource.visited.has(key));
    assert(
      eager.length === 0,
      `${label} 被静态引入：\n${eager
        .map(key =>
          sourceChain(staticSource.parents, key)
            .map(
              (item, index) => `${index > 0 ? `${item.edge} ` : ""}${item.path}`
            )
            .join(" -> ")
        )
        .join("\n")}`
    );

    const boundaryFiles = new Map();
    for (const candidate of candidates) {
      const chain = sourceChain(fullSource.parents, candidate);
      const boundaryIndex = chain.findIndex(item => item.edge === "import()");
      assert(
        boundaryIndex >= 0,
        `${label} 缺少 import() 边界：${chain.map(item => item.path).join(" -> ")}`
      );
      const boundary = chain[boundaryIndex];
      boundaryFiles.set(pathKey(boundary.filePath), boundary.filePath);
    }

    for (const boundaryFile of boundaryFiles.values()) {
      const boundaryKey = manifestKeyForSource(boundaryFile);
      assert(
        fullManifest.visited.has(boundaryKey),
        `${label} 源码边界 ${relativeSourcePath(boundaryFile)} 未出现在 Canvas 构建依赖图`
      );
      assert(
        !staticManifest.visited.has(boundaryKey),
        `${label} 构建后落入 Canvas 静态图：${manifestChain(
          staticManifest.parents,
          boundaryKey
        )}`
      );
      const chain = manifestChain(fullManifest.parents, boundaryKey);
      assert(chain.includes("import()"), `${label} 构建图没有动态边：${chain}`);
    }
    summaries.push(`${label} ${boundaryFiles.size} 个 lazy boundary`);
  }
  return summaries.join("；");
});

for (const pass of passes) console.log(`[bundle-budget] PASS ${pass}`);
if (failures.length > 0) {
  console.error(`[bundle-budget] FAIL 共 ${failures.length} 项`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`[bundle-budget] 全部 ${passes.length} 项验收通过`);
}
