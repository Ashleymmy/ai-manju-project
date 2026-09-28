import { defineConfig } from "@playwright/test";
import isolatedConfig from "./playwright.naming.config";

export default defineConfig({
  ...isolatedConfig,
  use: { ...isolatedConfig.use, launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } },
  testMatch: ["asset-transfer-tasks.spec.ts", "canvas-import-task-entry.spec.ts", "asset-bulk-details.spec.ts", "asset-tag-hierarchy.spec.ts"],
  outputDir: "../../../test-results/asset-transfer-tasks",
});
