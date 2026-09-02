import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const domainDirectory = path.dirname(fileURLToPath(import.meta.url));
const forbiddenImports = [
  /^react(?:\/|$)/,
  /^@tanstack\//,
  /^@\/shared\/api(?:\/|$)/,
  /^@\/lib\//,
  /^@\/services\/api(?:\/|$)/,
];
const forbiddenRuntimeDependencies = [
  { label: "browser location or DOM", pattern: /\b(?:document|window)\s*\./ },
  { label: "browser constructor", pattern: /\bnew\s+(?:File|FileReader|Image)\b/ },
  { label: "DOM Element runtime", pattern: /\binstanceof\s+Element\b/ },
  { label: "DOM exception runtime", pattern: /\bDOMException\b/ },
  { label: "ambient random UUID", pattern: /\bcrypto\s*\.\s*randomUUID\s*\(/ },
];

describe("canvas domain boundary", () => {
  it("stays independent from React, Query, HTTP transport, and legacy Canvas modules", () => {
    const violations = readdirSync(domainDirectory)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .flatMap((name) => {
        const source = readFileSync(path.join(domainDirectory, name), "utf8");
        return Array.from(source.matchAll(/\bfrom\s+["']([^"']+)["']/g))
          .map((match) => match[1])
          .filter((specifier) => forbiddenImports.some((rule) => rule.test(specifier)))
          .map((specifier) => `${name}: ${specifier}`);
      });

    expect(violations).toEqual([]);
  });

  it("keeps browser and non-deterministic runtime access in adapters", () => {
    const violations = readdirSync(domainDirectory)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .flatMap((name) => {
        const source = readFileSync(path.join(domainDirectory, name), "utf8");
        return forbiddenRuntimeDependencies
          .filter(({ pattern }) => pattern.test(source))
          .map(({ label }) => `${name}: ${label}`);
      });

    expect(violations).toEqual([]);
  });
});
