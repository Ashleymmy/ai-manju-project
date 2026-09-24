import { defineConfig } from "@playwright/test";
import isolatedConfig from "./playwright.naming.config";

export default defineConfig({
  ...isolatedConfig,
  testMatch: ["canvas-image-preflight.spec.ts"],
  outputDir: "../../../test-results/canvas-image-preflight",
  use: { ...isolatedConfig.use, actionTimeout: 15000 },
});
