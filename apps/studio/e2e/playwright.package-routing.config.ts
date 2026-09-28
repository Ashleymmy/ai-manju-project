import { defineConfig } from "@playwright/test";
import isolatedConfig from "./playwright.naming.config";

export default defineConfig({
  ...isolatedConfig,
  testMatch: ["asset-package-routing.spec.ts"],
  outputDir: "../../../test-results/asset-package-routing",
});
