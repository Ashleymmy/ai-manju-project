import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "qa-token");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  const project = {
    id: "switch-qa",
    title: "页面切换验收",
    scope: "personal",
    owner_id: "qa",
    updated_at: "2026-09-20T00:00:00Z",
  };
  let snapshot: any = {
    schema: "ai-manhua-studio-canvas",
    version: 3,
    nodes: [],
    edges: [],
    connections: [],
    groups: [],
    zoom: 100,
    panX: 0,
    panY: 0,
    viewport: { x: 0, y: 0, k: 1 },
  };
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    const headers = {
      "Access-Control-Allow-Origin": new URL(page.url()).origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "authorization,content-type,x-request-id",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    };
    if (request.method() === "OPTIONS")
      return route.fulfill({ headers, status: 204 });
    if (request.headers().accept === "text/event-stream")
      return route.fulfill({
        headers,
        contentType: "text/event-stream",
        body: ":ok\n\n",
      });
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me")
      data = {
        id: "qa",
        account: "qa",
        role: "super_admin",
        status: "active",
        display_name: "QA",
      };
    else if (path === "/api/user/preferences")
      data = { canvas: { promptPresets: [] } };
    else if (path === "/api/ai/models")
      data = { image_models: [], text_models: [], video_models: [] };
    else if (path === "/api/projects") data = { items: [project], total: 1 };
    else if (path === `/api/projects/${project.id}`)
      data = { ...project, data: snapshot };
    else if (path === `/api/projects/${project.id}/snapshot`) {
      if (request.method() === "PUT") snapshot = request.postDataJSON().data;
      data = { project_id: project.id, version: 1, data: snapshot };
    } else if (
      path === "/api/asset-folders" ||
      path === "/api/asset-exports" ||
      path === "/api/comic-asset-projects" ||
      path === "/api/tags"
    )
      data = [];
    if (path === "/api/prompts")
      return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({
      headers,
      json: { success: true, data, request_id: "switch-qa" },
    });
  });
});

test("switching studio pages and returning from the canvas does not crash", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.stack || error.message));
  page.on("console", message => {
    if (
      message.type() === "error" &&
      /React|Error:|Invalid hook|destroy|removeChild/.test(message.text())
    )
      errors.push(message.text());
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "知道了", exact: true }).click();
  for (const path of [
    "/image",
    "/video",
    "/assets",
    "/projects",
    "/comic-assets",
    "/prompts",
    "/skills",
    "/tags",
    "/settings",
    "/profile",
    "/queue",
    "/dashboard",
    "/image",
    "/assets",
  ]) {
    await test.step(`navigate to ${path}`, async () => {
      await page.locator(`a[href="${path}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.locator(".main-stage")).toBeVisible();
      await expect(page.getByText("连接工作区…", { exact: true })).toHaveCount(
        0
      );
      await page.evaluate(
        () =>
          new Promise<void>(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      );
      const fallback = page.getByRole("heading", {
        name: "页面遇到异常",
        exact: true,
      });
      if (await fallback.count())
        throw new Error(
          (await page.locator("#root").innerText()) + "\n" + errors.join("\n")
        );
    });
  }
  await page.locator('a[href="/canvas?resume=recent"]').click();
  await expect(
    page.getByRole("region", { name: "画布", exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await expect(page.locator('a[href="/image"]').first()).toBeVisible();
  await page.locator('a[href="/image"]').first().click();
  await expect(
    page.getByRole("heading", { name: "页面遇到异常", exact: true })
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("after-page-switches.png"),
  });
  expect(errors).toEqual([]);
});

test("page errors preserve navigation, support retry and retain diagnostics", async ({
  page,
}, testInfo) => {
  // Inject a render failure only into this test's served module; production code has no test switch.
  await page.route("**/src/features/image/ImagePage.tsx*", async route => {
    const response = await route.fetch();
    const source = await response.text();
    const functionStart = /function ImageWorkbenchView\(\)\s*\{/;
    expect(source).toMatch(functionStart);
    const body = source.replace(
      functionStart,
      '$& if (window.__pageSwitchFailure) throw new Error("page-switch simulated render failure");'
    );
    await route.fulfill({ response, body });
  });
  await page.addInitScript(() => {
    (window as any).__pageSwitchFailure = true;
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "知道了", exact: true }).click();
  await page.locator('a[href="/image"]').first().click();
  const errorHeading = page.getByRole("heading", {
    name: "页面遇到异常",
    exact: true,
  });
  await expect(errorHeading).toBeVisible();
  await expect(page.locator(".side-rail")).toBeVisible();
  const report = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("ai-manju:last-page-error")!)
  );
  expect(report).toMatchObject({
    fromPath: "/dashboard",
    path: "/image",
    message: "page-switch simulated render failure",
  });
  await page.screenshot({
    path: testInfo.outputPath("contained-page-error.png"),
  });

  await page.locator('a[href="/assets"]').first().click();
  await expect(page).toHaveURL(/\/assets$/);
  await expect(errorHeading).toHaveCount(0);
  await page.goBack();
  await expect(errorHeading).toBeVisible();
  await page.evaluate(() => {
    (window as any).__pageSwitchFailure = false;
    (window as any).__recoveryDocument = "same document";
  });
  await page.getByRole("button", { name: "重试此页面", exact: true }).click();
  await expect(errorHeading).toHaveCount(0);
  await expect(page.getByText("连接工作区…", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__recoveryDocument)).toBe(
    "same document"
  );

  const retainedReport = await page.evaluate(() =>
    sessionStorage.getItem("ai-manju:last-page-error")
  );
  await page.locator('a[href="/assets"]').first().click();
  await expect(page).toHaveURL(/\/assets$/);
  await page.reload();
  await expect(page.locator(".side-rail")).toBeVisible();
  await expect(errorHeading).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("ai-manju:last-page-error")
    )
  ).toBe(retainedReport);
});
