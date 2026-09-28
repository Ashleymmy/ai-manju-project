import { defineConfig } from "@playwright/test";
import isolatedConfig from "./playwright.naming.config";

export default defineConfig({
  ...isolatedConfig,
  testMatch: ["canvas-video-audio-default.spec.ts"],
  outputDir: "../../../test-results/canvas-video-ratio",
});
