import { defineConfig } from "@playwright/test";
import isolatedConfig from "./playwright.naming.config";

export default defineConfig({
  ...isolatedConfig,
  testMatch: ["asset-tag-hierarchy.spec.ts", "asset-bulk-details.spec.ts"],
  outputDir: "../../../test-results/asset-tag-hierarchy",
});
