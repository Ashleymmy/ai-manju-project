import { defineConfig } from "@playwright/test";
import isolatedConfig from "./playwright.naming.config";

export default defineConfig({
  ...isolatedConfig,
  testMatch: ["brand-logo-size.spec.ts"],
  outputDir: "../../../test-results/brand-logo-size",
});
