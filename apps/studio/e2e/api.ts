import { expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

import {
  apiUrl,
  E2E_ADMIN_ACCOUNT,
  E2E_ADMIN_PASSWORD,
  E2E_IMAGE_MODEL,
  E2E_TEXT_MODEL,
  providerBaseUrlForAPI,
} from "./env";

export type Session = { token: string; user: { id: string; username: string; role: string } };
export type Job = {
  id?: string;
  job_id?: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  progress?: number;
  result?: Record<string, unknown>;
  error?: unknown;
};

type Envelope<T> = { success: boolean; data?: T; error?: string; request_id?: string };

export async function unwrap<T>(response: APIResponse, label: string): Promise<T> {
  const body = await response.json().catch(async () => ({ success: false, error: await response.text().catch(() => "") })) as Envelope<T>;
  expect(response.ok(), `${label} HTTP ${response.status()}: ${JSON.stringify(body)}`).toBeTruthy();
  expect(body.success, `${label} envelope: ${JSON.stringify(body)}`).toBeTruthy();
  return body.data as T;
}

export function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export async function login(request: APIRequestContext): Promise<Session> {
  return unwrap(await request.post(apiUrl("/api/auth/login"), {
    data: { account: E2E_ADMIN_ACCOUNT, password: E2E_ADMIN_PASSWORD },
  }), "admin login");
}

export async function configureMockProvider(request: APIRequestContext, token: string) {
  await unwrap(await request.put(apiUrl("/api/admin/model-provider"), {
    headers: authHeaders(token),
    data: {
      mode: "local_openai",
      base_url: providerBaseUrlForAPI(),
      auth_type: "bearer",
      api_key: "e2e-mock-provider-key",
      text_model: E2E_TEXT_MODEL,
      image_model: E2E_IMAGE_MODEL,
      timeout_ms: 300_000,
      enabled: true,
    },
  }), "configure mock provider");
}

export async function createProject(request: APIRequestContext, token: string, title: string, data: unknown = {}) {
  return unwrap<{ id: string; title: string }>(await request.post(apiUrl("/api/projects?scope=personal"), {
    headers: authHeaders(token),
    data: { title, data },
  }), "create project");
}

export async function saveSnapshot(request: APIRequestContext, token: string, projectId: string, data: unknown) {
  return unwrap(await request.put(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/snapshot?scope=personal`), {
    headers: authHeaders(token),
    data: { data },
  }), "save snapshot");
}

export async function fetchJob(request: APIRequestContext, token: string, jobId: string) {
  return unwrap<Job>(await request.get(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}`), {
    headers: authHeaders(token),
  }), `fetch job ${jobId}`);
}

export async function waitForTerminalJob(request: APIRequestContext, token: string, jobId: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  const observations: Array<{ status: string; progress: number }> = [];
  while (Date.now() <= deadline) {
    const job = await fetchJob(request, token, jobId);
    observations.push({ status: job.status, progress: job.progress || 0 });
    if (["succeeded", "failed", "canceled"].includes(job.status)) return { job, observations };
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`job ${jobId} did not finish; observations=${JSON.stringify(observations)}`);
}

export async function seedBrowserAuth(page: Page, session: Session) {
  await page.addInitScript(({ token, account }) => {
    window.localStorage.setItem("ai-manju:auth_token", token);
    window.localStorage.setItem("ai-manju:token-store", "local");
    window.localStorage.setItem("ai-manju:auth_account", account);
  }, { token: session.token, account: session.user.username });
}
