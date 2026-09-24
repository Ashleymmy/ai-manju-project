import { defineConfig, devices } from "@playwright/test";

// API-isolated UI checks must not run the paid-provider global setup.
export default defineConfig({
  testDir: ".",
  testMatch: ["canvas-generated-names.spec.ts", "canvas-node-readability-names.spec.ts"],
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: "list",
  outputDir: "../../../test-results/canvas-naming",
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3100",
    screenshot: "only-on-failure",
  },
});
