import { expect, test } from "@playwright/test";

import {
  authHeaders,
  createProject,
  fetchJob,
  login,
  saveSnapshot,
  seedBrowserAuth,
  unwrap,
  waitForTerminalJob,
  type Job,
} from "./api";
import {
  apiUrl,
  E2E_ADMIN_ACCOUNT,
  E2E_ADMIN_PASSWORD,
  E2E_IMAGE_MODEL,
  E2E_PROVIDER_PORT,
  E2E_TEXT_MODEL,
} from "./env";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64");

test("Studio login uses the real auth API", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("输入用户名").fill(E2E_ADMIN_ACCOUNT);
  await page.getByPlaceholder("输入密码").fill("wrong-password");

  const rejected = page.waitForResponse((response) => response.url().includes("/api/auth/login") && response.request().method() === "POST");
  await page.getByRole("button", { name: /进入工作台/ }).click();
  expect((await rejected).status()).toBe(401);
  await expect(page).toHaveURL(/\/login/);

  await page.getByPlaceholder("输入密码").fill(E2E_ADMIN_PASSWORD);
  const accepted = page.waitForResponse((response) => response.url().includes("/api/auth/login") && response.request().method() === "POST");
  await page.getByRole("button", { name: /进入工作台/ }).click();
  expect((await accepted).ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/admin/);
});

test("projects, snapshots, assets, prompts and provider-backed jobs use real services", async ({ request }) => {
  const session = await login(request);
  const token = session.token;
  const project = await createProject(request, token, `E2E integration ${Date.now()}`, { nodes: [], edges: [] });

  const snapshot = {
    schema: "ai-manhua-studio-canvas",
    version: 3,
    nodes: [{ id: "text-1", kind: "text", title: "E2E beat", content: "snapshot round trip", x: 80, y: 120, width: 300, height: 170, metadata: { status: "idle" } }],
    edges: [],
    connections: [],
    groups: [],
    viewport: { x: 0, y: 0, k: 0.9 },
    zoom: 90,
    panX: 0,
    panY: 0,
  };
  await saveSnapshot(request, token, project.id, snapshot);
  const loadedSnapshot = await unwrap<{ data: typeof snapshot }>(await request.get(apiUrl(`/api/projects/${project.id}/snapshot?scope=personal`), {
    headers: authHeaders(token),
  }), "load snapshot");
  expect(loadedSnapshot.data.nodes[0].content).toBe("snapshot round trip");

  const uploaded = await unwrap<{ id: string }>(await request.post(apiUrl("/api/assets?scope=personal"), {
    headers: authHeaders(token),
    multipart: {
      file: { name: "e2e.png", mimeType: "image/png", buffer: png },
      type: "image",
      name: "E2E lineage root",
      source_type: "canvas",
      source_project_id: project.id,
      source_project_name: project.title,
      source_node_id: "text-1",
      relation_type: "generated_from",
    },
  }), "upload asset");
  const lineage = await unwrap<Record<string, unknown>>(await request.get(apiUrl(`/api/assets/${uploaded.id}/lineage?scope=personal`), {
    headers: authHeaders(token),
  }), "asset lineage");
  expect(lineage).toBeTruthy();

  const text = await unwrap<{ text: string }>(await request.post(apiUrl("/api/ai/text"), {
    headers: authHeaders(token),
    data: { model: E2E_TEXT_MODEL, prompt: "E2E short text", stream: false },
  }), "text generation");
  expect(text.text).toContain("e2e mock response");

  const generated = await unwrap<Job>(await request.post(apiUrl("/api/ai/images/generations"), {
    headers: authHeaders(token),
    data: { model: E2E_IMAGE_MODEL, prompt: "E2E image generation", size: "1024x1024", n: 1 },
  }), "image generation");
  const generatedJobId = generated.job_id || generated.id || "";
  expect(generatedJobId).not.toBe("");
  const generatedTerminal = await waitForTerminalJob(request, token, generatedJobId);
  expect(generatedTerminal.job.status).toBe("succeeded");
  expect(generatedTerminal.job.progress).toBe(100);
  expect(generatedTerminal.observations[0].status).toMatch(/queued|running|succeeded/);

  const edited = await unwrap<Job>(await request.post(apiUrl("/api/ai/images/edits"), {
    headers: authHeaders(token),
    multipart: {
      model: E2E_IMAGE_MODEL,
      prompt: "E2E image edit",
      size: "1024x1024",
      image: { name: "source.png", mimeType: "image/png", buffer: png },
    },
  }), "image edit");
  const editedJobId = edited.job_id || edited.id || "";
  expect((await waitForTerminalJob(request, token, editedJobId)).job.status).toBe("succeeded");

  const slow = await unwrap<Job>(await request.post(apiUrl("/api/ai/images/generations"), {
    headers: authHeaders(token),
    data: { model: E2E_IMAGE_MODEL, prompt: "e2e-slow cancellation", size: "1024x1024", n: 1 },
  }), "slow image generation");
  const slowJobId = slow.job_id || slow.id || "";
  await unwrap(await request.post(apiUrl(`/api/jobs/${slowJobId}/cancel`), { headers: authHeaders(token) }), "cancel job");
  expect((await fetchJob(request, token, slowJobId)).status).toBe("canceled");

  const promptResponse = await request.get(apiUrl("/api/prompts?page=1&pageSize=2"));
  expect(promptResponse.ok(), `prompt catalog HTTP ${promptResponse.status()}`).toBeTruthy();
  const promptCatalog = await promptResponse.json();
  expect(Array.isArray(promptCatalog.items)).toBeTruthy();
  expect(Array.isArray(promptCatalog.tags)).toBeTruthy();
  expect(Array.isArray(promptCatalog.categories)).toBeTruthy();
  expect(typeof promptCatalog.total).toBe("number");
});

test("WebDAV proxy preserves raw methods, bodies and response status", async ({ page }) => {
  const target = `http://host.docker.internal:${E2E_PROVIDER_PORT}/dav/e2e.bin`;
  await page.goto("/login");
  const result = await page.evaluate(async ({ targetUrl }) => {
    const invoke = (method: string, body?: string) => fetch("/webdav-proxy", {
      method: "POST",
      headers: {
        "x-webdav-target": targetUrl,
        "x-webdav-method": method,
        ...(body === undefined ? {} : { "x-webdav-content-type": "application/octet-stream" }),
      },
      body,
    });
    const created = await invoke("PUT", "webdav-e2e");
    const listed = await invoke("PROPFIND");
    const loaded = await invoke("GET");
    return {
      put: created.status,
      propfind: listed.status,
      propfindBody: await listed.text(),
      get: loaded.status,
      body: await loaded.text(),
      etag: loaded.headers.get("etag"),
    };
  }, { targetUrl: target });

  expect(result.put).toBe(201);
  expect(result.propfind).toBe(207);
  expect(result.propfindBody).toContain("multistatus");
  expect(result.get).toBe(200);
  expect(result.body).toBe("webdav-e2e");
  expect(result.etag).toBeTruthy();
});

test("canvas reload resumes an in-flight job, browser traffic hits the API, and tilde focuses a node", async ({ page }) => {
  const session = await login(page.request);
  const pending = await unwrap<Job>(await page.request.post(apiUrl("/api/ai/images/generations"), {
    headers: authHeaders(session.token),
    data: { model: E2E_IMAGE_MODEL, prompt: "e2e-slow refresh recovery", size: "1024x1024", n: 1 },
  }), "recovery generation");
  const jobId = pending.job_id || pending.id || "";
  const project = await createProject(page.request, session.token, `E2E recovery ${Date.now()}`, {});
  await saveSnapshot(page.request, session.token, project.id, {
    schema: "ai-manhua-studio-canvas",
    version: 3,
    nodes: [
      { id: "focus-node", kind: "text", title: "Focus target", content: "hover then press tilde", x: 860, y: 430, width: 300, height: 170, metadata: { status: "idle" } },
      { id: "job-node", kind: "image", title: "Recovering image", content: "e2e-slow refresh recovery", x: 120, y: 160, width: 320, height: 238, metadata: { status: "loading", jobId, prompt: "e2e-slow refresh recovery", model: E2E_IMAGE_MODEL, generationMode: "image" } },
    ],
    edges: [],
    connections: [],
    groups: [],
    viewport: { x: 0, y: 0, k: 0.9 },
    zoom: 90,
    panX: 0,
    panY: 0,
  });
  await seedBrowserAuth(page, session);

  let jobReads = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && request.url().includes(`/api/jobs/${jobId}`)) jobReads += 1;
  });
  await page.goto(`/canvas/${project.id}?scope=personal`);
  await expect(page.getByText(project.title, { exact: true }).first()).toBeVisible();
  const focusNode = page.locator('.real-canvas-node[data-node-id="focus-node"]');
  await expect(focusNode).toBeVisible();
  const stage = page.locator(".real-canvas-stage");
  const before = await stage.evaluate((element) => (element as HTMLElement).style.getPropertyValue("--canvas-grid-x"));
  await focusNode.hover();
  await page.keyboard.press("Backquote");
  await expect.poll(async () => stage.evaluate((element) => (element as HTMLElement).style.getPropertyValue("--canvas-grid-x"))).not.toBe(before);

  await expect.poll(() => jobReads, { timeout: 20_000 }).toBeGreaterThan(0);
  const beforeReloadReads = jobReads;
  await page.reload();
  await expect.poll(() => jobReads, { timeout: 20_000 }).toBeGreaterThan(beforeReloadReads);
  await expect(page.locator('.real-canvas-node[data-node-id="job-node"] img')).toBeVisible({ timeout: 60_000 });
});

test("Director Desk is built into Studio and connects through its iframe", async ({ page }) => {
  const session = await login(page.request);
  const project = await createProject(page.request, session.token, `E2E director ${Date.now()}`, { nodes: [], edges: [] });
  await saveSnapshot(page.request, session.token, project.id, { schema: "ai-manhua-studio-canvas", version: 3, nodes: [], edges: [], connections: [], groups: [], zoom: 90, panX: 0, panY: 0 });
  await seedBrowserAuth(page, session);

  const staticResponse = await page.request.get("/director-desk/index.html");
  expect(staticResponse.ok()).toBeTruthy();
  expect(await staticResponse.text()).toContain("<title>3D导演台 Demo</title>");
  await page.goto(`/director?canvasId=${project.id}&nodeId=director-e2e&instanceId=director-e2e&scope=personal&returnPath=${encodeURIComponent(`/canvas/${project.id}?scope=personal`)}`);
  const iframe = page.locator('iframe[title="3D 导演台"]');
  await expect(iframe).toBeVisible();
  await expect(iframe).toHaveAttribute("src", /\/director-desk\/index\.html/);
  await expect(iframe.contentFrame().locator("#root")).not.toBeEmpty();
});
