import { defineConfig, devices } from "@playwright/test";

// Layout and request-wiring checks use fixture responses, never user data.
export default defineConfig({
  testDir: ".",
  testMatch: "admin-report-layout.spec.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: "list",
  outputDir: "../../../.tmp/admin-report-layout-20260929/browser",
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3100",
    viewport: { width: 1920, height: 1080 },
    screenshot: "only-on-failure",
  },
});
