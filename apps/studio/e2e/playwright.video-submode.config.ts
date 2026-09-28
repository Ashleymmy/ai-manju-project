import { defineConfig } from "@playwright/test";
import isolatedConfig from "./playwright.naming.config";

export default defineConfig({
  ...isolatedConfig,
  testMatch: ["canvas-video-submode.spec.ts"],
  outputDir: "../../../test-results/canvas-video-submode",
});
