import { defineConfig } from "@playwright/test";
import isolatedConfig from "./playwright.naming.config";

export default defineConfig({
  ...isolatedConfig,
  testMatch: ["video-shelf-mentions.spec.ts"],
  outputDir: "../../../test-results/video-shelf-mentions",
  use: { ...isolatedConfig.use, actionTimeout: 15000 },
});
