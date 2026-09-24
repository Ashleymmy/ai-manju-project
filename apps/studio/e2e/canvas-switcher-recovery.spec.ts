import { expect, test } from "@playwright/test";

test("canvas switcher recovers from failed lists, keeps loaded canvases and refreshes on reopen", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1500, height: 960 });
  const active = { id: "switcher-current", title: "当前画布", scope: "personal", owner_id: "qa", created_at: "", updated_at: "" };
  const old = { ...active, id: "switcher-old", title: "之前的画布" };
  const projects = [active, old];
  const snapshot = {
    schema: "ai-manhua-studio-canvas", version: 3,
    nodes: [{ id: "keep-node", kind: "text", title: "原有节点", content: "画布内容应保留", x: 500, y: 250, width: 320, height: 240 }],
    edges: [], groups: [], zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 },
  };
  let failLists = true;
  let emptySuccessfulList = false;
  let failSaves = false;
  let failedSaves = 0;
  const saves: any[] = [];
  const errors: string[] = [];
  let summaryReads = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "qa-token");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  // Isolate all writes and reads from user data, including autosave and creation.
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (!path.startsWith("/api/")) return route.continue();
    const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "authorization,content-type,x-request-id,idempotency-key", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS" };
    if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active" };
    else if (path === "/api/announcements/current") data = null;
    else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (path === "/api/asset-folders") data = [];
    else if (path === "/api/projects") {
      if (request.method() === "POST") {
        const created = { ...active, id: "created-canvas", title: request.postDataJSON().title };
        projects.unshift(created);
        data = { ...created, data: snapshot };
      } else {
        if (url.searchParams.get("include_data") === "false") summaryReads++;
        if (failLists) return route.fulfill({ headers, status: 503, json: { success: false, error: "temporary list failure" } });
        data = emptySuccessfulList ? [] : projects;
      }
    } else if (path.startsWith("/api/projects/")) {
      const id = path.split("/")[3];
      const project = projects.find(item => item.id === id);
      if (path.endsWith("/snapshot")) {
        if (request.method() === "PUT") {
          saves.push(request.postDataJSON().data);
          if (failSaves) {
            failedSaves++;
            return route.fulfill({ headers, status: 503, json: { success: false, error: "temporary save failure" } });
          }
        }
        data = { project_id: id, version: 1, data: snapshot };
      } else data = { ...project, data: snapshot };
    }
    if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data } });
  });
  await page.goto(`/canvas/${active.id}?scope=personal`);
  const trigger = page.locator(".canvas-switcher-trigger");
  const menu = page.locator(".canvas-switcher-popover");
  await expect(page.locator('[data-node-id="keep-node"]')).toBeVisible();
  await trigger.click();
  await expect(menu.getByRole("button", { name: "重试", exact: true })).toBeEnabled();
  await expect(menu).toContainText("画布列表加载失败");
  await expect(menu).not.toContainText("无匹配画布");
  await expect(menu.locator(".canvas-switcher-item")).toHaveCount(1);
  await expect(menu.locator(".canvas-switcher-item")).toContainText("当前画布");
  await page.screenshot({ path: testInfo.outputPath("list-failed-retry.png") });
  failLists = false;
  emptySuccessfulList = true;
  await menu.getByRole("button", { name: "重试", exact: true }).click();
  await expect(menu).toContainText("列表暂不完整");
  await expect(menu.locator(".canvas-switcher-item")).toHaveCount(1);
  await expect(menu).not.toContainText("当前空间还没有画布");
  await page.screenshot({ path: testInfo.outputPath("empty-list-keeps-verified-current.png") });
  emptySuccessfulList = false;
  await menu.getByRole("button", { name: "重试", exact: true }).click();
  await expect(menu.locator(".canvas-switcher-item")).toHaveCount(2);
  await expect(menu).not.toContainText("列表暂不完整");
  await expect(menu).toContainText("之前的画布");
  await menu.getByPlaceholder("搜索画布…").fill("不存在的名称");
  await expect(menu).toContainText("无匹配画布");
  await page.keyboard.press("Escape");
  projects.push({ ...active, id: "external-canvas", title: "其他窗口新建" });
  await trigger.click();
  await expect(menu.getByPlaceholder("搜索画布…")).toHaveValue("");
  await expect(menu.locator(".canvas-switcher-item")).toHaveCount(3);
  failLists = true;
  await menu.getByRole("button", { name: "刷新列表", exact: true }).click();
  await expect(menu).toContainText("已保留上次加载的画布");
  await expect(menu.locator(".canvas-switcher-item")).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath("list-refresh-failed-keeps-canvases.png") });
  failLists = false;
  await menu.getByRole("button", { name: "之前的画布", exact: true }).click();
  await expect(page).toHaveURL(/canvas\/switcher-old/);
  await expect(trigger).toContainText("之前的画布");
  await expect(page.locator('[data-node-id="keep-node"]')).toBeVisible();
  await trigger.click();
  await menu.getByRole("button", { name: "新建画布", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox").fill("新建后立即可见");
  failSaves = true;
  await dialog.getByRole("button", { name: "创建并进入", exact: true }).click();
  await expect.poll(() => failedSaves).toBeGreaterThan(0);
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/canvas\/switcher-old/);
  await expect(page.locator('[data-node-id="keep-node"]')).toBeVisible();
  failSaves = false;
  await trigger.click();
  await expect(menu.locator(".canvas-switcher-item")).toHaveCount(4);
  await menu.getByRole("button", { name: "新建后立即可见", exact: true }).click();
  await expect(page).toHaveURL(/canvas\/created-canvas/);
  await expect(trigger).toContainText("新建后立即可见");
  await trigger.click();
  await expect(menu.locator(".canvas-switcher-item")).toHaveCount(4);
  await expect(menu).toContainText("新建后立即可见");
  await page.screenshot({ path: testInfo.outputPath("list-restored-with-new-canvas.png") });
  expect(summaryReads).toBeGreaterThan(3);
  expect(saves.length).toBeGreaterThan(0);
  expect(saves.every(saved => saved.nodes?.some((node: any) => node.id === "keep-node"))).toBe(true);
  expect(errors).toEqual([]);
});
