import { defineConfig } from "@playwright/test";
import isolatedConfig from "./playwright.naming.config";

export default defineConfig({
  ...isolatedConfig,
  testMatch: "canvas-agent-placement.spec.ts",
  outputDir: "../../../.tmp/agent-placement-20260929/browser",
});
