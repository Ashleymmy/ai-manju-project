import { defineConfig } from "@playwright/test";
import isolatedConfig from "./playwright.naming.config";

export default defineConfig({
  ...isolatedConfig,
  testMatch: ["loading-layout.spec.ts"],
  outputDir: "../../../test-results/loading-layout",
});
