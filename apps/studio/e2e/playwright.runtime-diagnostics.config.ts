import { defineConfig, devices } from "@playwright/test";

// Controlled responses; no paid-provider setup or production data.
export default defineConfig({
  testDir: ".",
  testMatch: "runtime-diagnostics.spec.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: "list",
  outputDir:
    process.env.MONITORING_QA_OUTPUT_DIR ||
    "../../../.tmp/runtime-diagnostics-20260928/browser",
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3100",
    screenshot: "only-on-failure",
  },
});
