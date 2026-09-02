import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const adminRoot = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(adminRoot, "..", "..");

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(entryPath);
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return [];
    if (/\.(?:test|spec)\.tsx?$/.test(entry.name)) return [];
    return [entryPath];
  });
}

describe("Admin feature boundary", () => {
  it("loads the feature-owned workspace instead of the legacy page", () => {
    const pageSource = readFileSync(path.join(adminRoot, "AdminPage.tsx"), "utf8");
    expect(pageSource).toContain('from "./ui/AdminWorkspaceView"');
    expect(pageSource).not.toContain("@/pages/");
  });

  it("keeps one controller and panel boundary for every Admin subdomain", () => {
    for (const relativePath of [
      "controllers/useAdminUsersController.ts",
      "controllers/useModelProvidersController.ts",
      "controllers/useAnnouncementsController.ts",
      "controllers/useMonitoringController.ts",
      "controllers/useSeedanceAssetsController.ts",
      "ui/UsersPanel.tsx",
      "ui/ProvidersPanel.tsx",
      "ui/AnnouncementsPanel.tsx",
      "ui/MonitoringPanel.tsx",
      "ui/SeedanceAssetsPanel.tsx",
    ]) {
      expect(readFileSync(path.join(adminRoot, relativePath), "utf8")).not.toBe("");
    }
  });

  it("does not import the global API barrel from Admin production code", () => {
    const violations = productionSources(adminRoot).flatMap(filePath => {
      const source = readFileSync(filePath, "utf8");
      return /from\s+["']@\/services\/api(?:["'/])/.test(source)
        ? [path.relative(adminRoot, filePath)]
        : [];
    });
    expect(violations).toEqual([]);
  });

  it("keeps a route-only public export and thin compatibility forwarders", () => {
    expect(readFileSync(path.join(adminRoot, "index.ts"), "utf8").trim()).toBe(
      'export { default } from "./AdminPage";'
    );
    expect(
      readFileSync(path.join(sourceRoot, "pages", "AdminWorkspaceView.tsx"), "utf8")
    ).toContain('export { default } from "@/features/admin"');
    expect(
      readFileSync(path.join(sourceRoot, "services", "api", "admin.ts"), "utf8")
    ).toContain('export * from "@/features/admin/services/adminApi"');
  });
});
