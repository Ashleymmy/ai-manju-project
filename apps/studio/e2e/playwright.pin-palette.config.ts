import { defineConfig } from "@playwright/test";
import isolatedConfig from "./playwright.naming.config";

export default defineConfig({
  ...isolatedConfig,
  testMatch: ["canvas-pin-palette.spec.ts"],
  outputDir: "../../../test-results/canvas-pin-palette",
});
