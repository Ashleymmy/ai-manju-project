import { defineConfig } from "@playwright/test";
import isolatedConfig from "./playwright.naming.config";

export default defineConfig({
  ...isolatedConfig,
  testMatch: ["tag-creation.spec.ts"],
  outputDir: "../../../test-results/tag-creation",
});
