import { request, type FullConfig } from "@playwright/test";

import { configureMockProvider, login } from "./api";
import { E2E_API_URL, E2E_BASE_URL, E2E_WORKER_URL } from "./env";

export default async function globalSetup(_config: FullConfig) {
  await Promise.all([
    waitForHealthy(`${E2E_API_URL}/health`, "api"),
    waitForHealthy(`${E2E_WORKER_URL}/health`, "worker"),
    waitForHealthy(E2E_BASE_URL, "studio"),
  ]);
  const context = await request.newContext();
  try {
    const session = await login(context);
    await configureMockProvider(context, session.token);
  } finally {
    await context.dispose();
  }
}

async function waitForHealthy(url: string, label: string) {
  const deadline = Date.now() + 90_000;
  let lastError = "";
  while (Date.now() <= deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `${response.status} ${await response.text().catch(() => "")}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`${label} health check failed at ${url}: ${lastError}`);
}
