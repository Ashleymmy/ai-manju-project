import { defineConfig } from "@playwright/test";
import isolatedConfig from "./playwright.naming.config";

export default defineConfig({
  ...isolatedConfig,
  testMatch: ["canvas-node-label-zoom.spec.ts", "canvas-group-zoom-layout.spec.ts", "canvas-node-readability-names.spec.ts"],
  outputDir: "../../../test-results/canvas-label-zoom",
});
