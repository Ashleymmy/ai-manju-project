import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");
const postcss = require(
  path.resolve(repositoryRoot, "node_modules/.pnpm/postcss@8.5.15/node_modules/postcss/lib/postcss.js"),
);
const selectorParser = require(
  path.resolve(
    repositoryRoot,
    "node_modules/.pnpm/postcss-selector-parser@7.1.4/node_modules/postcss-selector-parser/dist/index.js",
  ),
);

const sourcePath = path.resolve(repositoryRoot, "apps/web/src/app/globals.css");
const targetPath = path.resolve(
  import.meta.dirname,
  "..",
  "client/src/features/production-canvas/production-canvas.css",
);
const source = await readFile(sourcePath, "utf8");
const root = postcss.parse(source, { from: sourcePath });
const applyDeclarations = new Map([
  ["border-border outline-ring/50", [
    ["border-color", "var(--border)"],
    ["outline-color", "color-mix(in oklab, var(--ring) 50%, transparent)"],
  ]],
  ["bg-background text-foreground", [
    ["background-color", "var(--background)"],
    ["color", "var(--foreground)"],
  ]],
  ["font-sans", [["font-family", "var(--font-sans, sans-serif)"]]],
]);

root.walkAtRules((atRule) => {
  if (["import", "custom-variant", "theme"].includes(atRule.name)) {
    atRule.remove();
    return;
  }
  if (atRule.name === "apply") {
    const declarations = applyDeclarations.get(atRule.params.trim());
    if (!declarations) throw new Error(`Unsupported @apply rule: ${atRule.params}`);
    for (const [prop, value] of declarations) {
      atRule.parent.insertBefore(atRule, postcss.decl({ prop, value }));
    }
    atRule.remove();
  }
});

root.walkRules((rule) => {
  let parent = rule.parent;
  while (parent) {
    if (parent.type === "atrule" && /keyframes$/i.test(parent.name)) return;
    parent = parent.parent;
  }

  if (rule.selector.trim() === ":root") {
    rule.selector = ".production-canvas-scope";
    return;
  }

  rule.selector = selectorParser((selectors) => {
    selectors.each((selector) => {
      selector.walkClasses((classNode) => {
        if (classNode.value === "studio-shell") {
          classNode.value = "production-canvas-root";
        }
      });
      selector.prepend(selectorParser.combinator({ value: " " }));
      selector.prepend(selectorParser.className({ value: "production-canvas-scope" }));
    });
  }).processSync(rule.selector);
});

root.prepend(
  postcss.parse(`
/* Generated from apps/web/src/app/globals.css for the vendored production Canvas. */
.production-canvas-scope,
.production-canvas-theme,
.production-canvas-root {
  height: 100%;
  min-height: 0;
  width: 100%;
}

.production-canvas-scope {
  display: flex;
  flex: 1 1 0;
  overflow: hidden;
  position: relative;
}

.production-canvas-theme {
  color: var(--studio-ink);
  flex: 1 1 0;
  font-family: var(--font-sans, sans-serif);
  overflow: hidden;
}

.production-canvas-root {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.production-canvas-root > .ant-app {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  min-height: 0;
  width: 100%;
}
`),
);

await writeFile(targetPath, root.toString(), "utf8");
console.log(targetPath);
