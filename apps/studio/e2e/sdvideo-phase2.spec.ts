import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { authHeaders, createProject, login, seedBrowserAuth, unwrap } from "./api";
import { E2E_ADMIN_ACCOUNT, E2E_ADMIN_PASSWORD, E2E_BASE_URL } from "./env";

const model = "sdvideo/seedance-2.0";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDoAAAAAASUVORK5CYII=", "base64");

// 业务响应完全由真实服务提供；拒绝页面意外直连外部服务并记录失败接口。
async function guardNetwork(context: BrowserContext) {
  // 同源业务请求直接走真实网络，避免拦截器干扰多个浏览器上下文中的 SSE/媒体连接。
  await context.route(url => ["http:", "https:"].includes(url.protocol) && url.origin !== E2E_BASE_URL, async route => {
    const url = new URL(route.request().url());
    // 原页面使用 Google Fonts；仅允许无凭证的字体 GET，不影响业务接口审计。
    const font = route.request().method() === "GET" && url.protocol === "https:" &&
      ["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname);
    if (["http:", "https:"].includes(url.protocol) && url.origin !== E2E_BASE_URL && !font) {
      await route.abort();
      throw new Error(`Unexpected browser egress: ${url.origin}${url.pathname}`);
    }
    await route.continue();
  });
  context.on("requestfailed", request => {
    const url = new URL(request.url());
    if (url.origin === E2E_BASE_URL && url.pathname.startsWith("/api/") && !url.pathname.endsWith("/stream")) {
      console.warn(`Business request failed: ${request.method()} ${url.pathname}: ${request.failure()?.errorText}`);
    }
  });
}
test.beforeEach(async ({ context }) => guardNetwork(context));

async function openVideo(page: Page) {
  await page.goto("/video?scope=personal#workbench");
  await expect(page.locator(".wb-page")).toBeVisible();
  const release = page.getByRole("button", { name: "知道了", exact: true });
  if (await release.isVisible()) await release.click();
  await expect(page.locator(".wb-param-group select").first().locator(`option[value="${model}"]`)).toBeAttached();
  await page.locator(".wb-param-group select").first().selectOption(model);
  await expect(page.getByRole("button", { name: "新建对话", exact: true })).toBeEnabled();
}

async function generate(page: Page, prompt: string) {
  await page.locator(".wb-composer textarea").fill(prompt);
  const submitted = page.waitForResponse(response => response.request().method() === "POST" &&
    /\/api\/ai\/(videos|contents\/generations\/tasks)(\?|$)/.test(response.url()));
  await page.getByRole("button", { name: "开始生成", exact: true }).click();
  const response = await submitted;
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = await response.json();
  expect(body.success).toBeTruthy();
  return (body.data.id || body.data.job_id) as string;
}

async function playable(page: Page) {
  const video = page.locator(".wb-task-video video").last();
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => ({
    ready: element.readyState >= 1 && element.videoWidth > 0 && element.duration > 0, error: element.error?.code || null,
  }))).toEqual({ ready: true, error: null });
}

test("real login and cloud Nginx deep links render Studio, Canvas and Director", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/video?scope=personal#workbench");
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByPlaceholder("输入用户名").fill(E2E_ADMIN_ACCOUNT);
  await page.getByPlaceholder("输入密码", { exact: true }).fill(E2E_ADMIN_PASSWORD);
  await page.locator(".auth-submit").click();
  await expect(page).toHaveURL(/\/video\?scope=personal#workbench$/);
  await expect(page.locator(".wb-page")).toBeVisible();
  for (const route of ["/assets", "/tags", "/prompts", "/queue", "/projects", "/admin", "/admin/model-provider", "/admin/seedance-assets"]) {
    const response = await page.goto(`${route}?phase2=1#deep-link`);
    expect(response?.status(), route).toBe(200);
    await expect(page.locator(".studio-app")).toBeVisible();
    await expect(page.locator("#root")).not.toContainText("页面加载失败");
    expect(new URL(page.url()).pathname).toBe(route);
  }
  const session = await login(page.request);
  const project = await createProject(page.request, session.token, "phase2 browser canvas", {});
  await page.goto(`/canvas/${project.id}?scope=personal`);
  await expect(page.locator(".real-canvas-stage")).toBeVisible();
  await page.goto("/director");
  await expect(page.locator("iframe")).toBeVisible();
  await expect(page.frameLocator("iframe").getByTestId("director-canvas").locator("canvas")).toBeVisible();
  expect(errors).toEqual([]);
  expect((await page.request.get("/assets/missing-phase2.js")).status()).toBe(404);
  const shell = await page.request.get("/video");
  expect(shell.headers()["cache-control"]).toContain("no-store");
  await page.screenshot({ path: ".tmp/sdvideo-phase2/browser/director.png" });
});

test("text video reaches Worker and Asset; empty second browser restores server history", async ({ page, browser }) => {
  const session = await login(page.request);
  await seedBrowserAuth(page, session);
  await openVideo(page);
  await page.getByRole("button", { name: "新建对话", exact: true }).click();
  const prompt = `phase2 browser text ${Date.now()}`;
  const failures: string[] = [];
  page.on("response", response => {
    if (response.url().includes("/api/sd-video/") && response.status() >= 400) {
      failures.push(`${response.request().method()} ${new URL(response.url()).pathname}: ${response.status()}`);
    }
  });
  const jobId = await generate(page, prompt);
  await expect(page.getByRole("button", { name: "下载", exact: true })).toBeVisible({ timeout: 45_000 });
  await playable(page);
  const job = await unwrap<{ external_provider: string; result: { asset_id: string } }>(
    await page.request.get(`/api/jobs/${jobId}`, { headers: authHeaders(session.token) }), "real bridge job");
  expect(job.external_provider).toBe("sd-video");
  expect(job.result.asset_id).toBeTruthy();
  const range = await page.request.get(`/api/assets/${job.result.asset_id}/content`, {
    headers: { ...authHeaders(session.token), Range: "bytes=0-31" },
  });
  expect(range.status()).toBe(206);
  expect((await range.body()).subarray(0, 32).includes(Buffer.from("ftyp"))).toBeTruthy();
  await page.reload();
  await playable(page);
  const second = await browser.newContext({ baseURL: E2E_BASE_URL });
  try {
    await guardNetwork(second);
    const otherPage = await second.newPage();
    await seedBrowserAuth(otherPage, session);
    await openVideo(otherPage);
    await otherPage.locator(".wb-conv-item", { hasText: prompt.slice(0, 24) }).click();
    await expect(otherPage.locator(".wb-msg.user p")).toHaveText(prompt);
    await playable(otherPage);
    await otherPage.screenshot({ path: ".tmp/sdvideo-phase2/browser/video-restored.png" });
  } finally { await second.close(); }
  expect(failures).toEqual([]);
});

test("mobile video deep link loads the same authenticated workbench", async ({ page }) => {
  const session = await login(page.request);
  await seedBrowserAuth(page, session);
  await page.setViewportSize({ width: 390, height: 844 });
  await openVideo(page);
  await expect(page.locator(".wb-composer textarea")).toBeVisible();
  await page.screenshot({ path: ".tmp/sdvideo-phase2/browser/video-mobile.png", fullPage: true });
});

test("reference mention, cancellation and explicit retry survive reload", async ({ page }) => {
  const session = await login(page.request);
  await seedBrowserAuth(page, session);
  await openVideo(page);
  await page.getByRole("button", { name: "新建对话", exact: true }).click();
  await page.locator('.wb-composer input[type="file"][multiple]').setInputFiles({ name: "phase2-ref.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".wb-shelf-item")).toHaveCount(1);
  await page.locator(".wb-composer textarea").fill("@图");
  await page.locator(".wb-mention-item").first().click();
  await expect(page.locator(".wb-prompt-overlay .wb-token")).toHaveCount(1);
  const id = await generate(page, "phase2 cancel @图1");
  await expect(page.locator(".wb-task-id")).toContainText(id);
  await page.getByRole("button", { name: "取消生成", exact: true }).click();
  await expect(page.getByText("任务已取消", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("任务已取消", { exact: true })).toBeVisible();
  const job = await unwrap<{ status: string; result?: { asset_id?: string } }>(
    await page.request.get(`/api/jobs/${id}`, { headers: authHeaders(session.token) }), "canceled job");
  expect(job.status).toBe("canceled");
  expect(job.result?.asset_id).toBeFalsy();
  const retryResponse = page.waitForResponse(response => response.request().method() === "POST" &&
    response.url().includes("/api/ai/contents/generations/tasks"));
  await page.getByRole("button", { name: "重试", exact: true }).click();
  const retried = await retryResponse;
  expect(retried.ok(), await retried.text()).toBeTruthy();
  expect((await retried.json()).data.id).not.toBe(id);
  await expect(page.getByRole("button", { name: "下载", exact: true })).toBeVisible({ timeout: 45_000 });
  await playable(page);
  const old = await unwrap<{ status: string; result?: { asset_id?: string } }>(
    await page.request.get(`/api/jobs/${id}`, { headers: authHeaders(session.token) }), "old canceled job after retry");
  expect(old.status).toBe("canceled");
  expect(old.result?.asset_id).toBeFalsy();
});

test("new member cannot read another owner's conversation, result or admin page", async ({ page }) => {
  const session = await login(page.request);
  const admin = authHeaders(session.token);
  const member = `phase2-member-${Date.now()}`;
  await unwrap(await page.request.post("/api/admin/users", { headers: admin,
    data: { username: member, password: E2E_ADMIN_PASSWORD, role: "member" } }), "create isolated member");
  const conversation = await unwrap<{ id: string }>(
    await page.request.post("/api/sd-video/conversations", { headers: admin,
      data: { id: `private-${Date.now()}`, title: "private admin history" } }), "admin conversation");
  const asset = await unwrap<{ id: string }>(await page.request.post("/api/assets?scope=personal", {
    headers: admin, multipart: { file: { name: "private.png", mimeType: "image/png", buffer: png } },
  }), "private asset");
  const account = await unwrap<{ token: string; user: { id: string; username: string; role: string } }>(
    await page.request.post("/api/auth/login", { data: { username: member, password: E2E_ADMIN_PASSWORD } }), "member login");
  await seedBrowserAuth(page, account);
  await openVideo(page);
  await expect(page.locator(".wb-msg")).toHaveCount(0);
  const denied = await page.request.get(`/api/sd-video/conversations/${conversation.id}/messages`, { headers: authHeaders(account.token) });
  expect(denied.status()).toBe(404);
  expect([403, 404]).toContain((await page.request.get(`/api/assets/${asset.id}/content?scope=personal`, { headers: authHeaders(account.token) })).status());
  expect((await page.request.get("/api/admin/users", { headers: authHeaders(account.token) })).status()).toBe(403);
  await page.goto("/admin");
  await expect(page.locator(".real-admin-page")).toHaveCount(0);
});
