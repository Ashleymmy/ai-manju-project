import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, entry = "/projects") {
  let groups: any = {};
  let failSave = false;
  const data = { schema: "ai-manhua-studio-canvas", version: 3,
    nodes: [{ id: "text-1", type: "text", title: "原始节点", content: "原始提示词", position: { x: 100, y: 120 }, width: 320, height: 180, metadata: { status: "loading", jobId: "original-job" } }],
    connections: [], groups: [], viewport: { x: 0, y: 0, k: 1 }, zoom: 100, panX: 0, panY: 0 };
  let projects: any[] = ["苹果画布", "角色画布", "分镜画布"].map((title, index) => ({ id: `project-${index}`, title, scope: "personal", owner_id: "qa", created_at: "2026-09-23T00:00:00Z", updated_at: "2026-09-23T00:00:00Z", data: structuredClone(data), cover_asset_id: "" }));
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem("ai-manju:auth_token", "qa-token"); localStorage.setItem("ai-manju:token-store", "local"); });
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "authorization,content-type,x-request-id", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS" };
    if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    let response: unknown = { items: [], total: 0 };
    if (url.pathname === "/api/auth/me") response = { id: "qa", account: "qa", role: "super_admin", status: "active" };
    else if (url.pathname === "/api/announcements/current") response = null;
    else if (url.pathname === "/api/user/preferences") {
      if (request.method() === "PUT" && request.postDataJSON().canvas?.projectGroups) {
        if (failSave) return route.fulfill({ headers, status: 500, json: { success: false, error: "分组保存失败" } });
        groups = request.postDataJSON().canvas.projectGroups;
      }
      response = { canvas: { projectGroups: groups, promptPresets: [] } };
    } else if (url.pathname === "/api/projects") {
      if (request.method() === "POST") { const project = { ...projects[0], ...request.postDataJSON(), id: `copy-${projects.length}` }; projects.push(project); response = project; }
      else response = { items: projects, total: projects.length };
    } else if (/^\/api\/projects\/[^/]+/.test(url.pathname)) {
      const id = url.pathname.split("/")[3];
      const project = projects.find(item => item.id === id);
      if (url.pathname.endsWith("/snapshot")) {
        if (request.method() === "PUT") project.data = request.postDataJSON().data;
        response = { project_id: id, version: 1, data: project.data };
      } else {
        if (request.method() === "PUT") Object.assign(project, request.postDataJSON());
        if (request.method() === "DELETE") projects = projects.filter(item => item.id !== id);
        response = project;
      }
    }
    if (url.pathname === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data: response, request_id: "project-tools-qa" } });
  });
  await page.goto(entry);
  await expect(page.locator(".project-card-wrap")).toHaveCount(3);
  const notice = page.getByRole("button", { name: "知道了", exact: true });
  if (await notice.isVisible()) await notice.click();
  return { get projects() { return projects; }, get groups() { return groups; }, errors, failSave: () => { failSave = true; } };
}

async function enterPrompt(page: Page, trigger: () => Promise<unknown>, text: string) {
  page.once("dialog", dialog => dialog.accept(text));
  await trigger();
}

test("copies independently, organizes real project IDs and restores groups after reload", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await setup(page);
  const card = page.locator(".project-card-wrap").filter({ hasText: "苹果画布" });
  await card.hover();
  await card.getByRole("button", { name: "复制画布", exact: true }).click();
  await expect(page.locator(".project-card-wrap")).toHaveCount(4);
  const copy = fixture.projects.find(project => project.title === "苹果画布（副本）");
  expect(copy.data.nodes[0].metadata).toEqual({ status: "idle" });
  expect(fixture.projects[0].data.nodes[0].metadata.jobId).toBe("original-job");
  const copyCard = page.locator(".project-card-wrap").filter({ hasText: "苹果画布（副本）" });
  await copyCard.hover();
  await enterPrompt(page, () => copyCard.getByRole("button", { name: "重命名", exact: true }).click(), "独立副本");
  expect(fixture.projects[0].title).toBe("苹果画布");
  await page.getByRole("checkbox", { name: "选择画布 独立副本", exact: true }).check();
  await page.getByRole("checkbox", { name: "选择画布 角色画布", exact: true }).check();
  await enterPrompt(page, () => page.getByRole("button", { name: "创建分组", exact: true }).click(), "角色制作");
  await expect(page.locator(".project-card-wrap")).toHaveCount(2);
  expect(fixture.groups.personal[0].projectIds.sort()).toEqual([copy.id, "project-1"].sort());
  await page.reload();
  await page.locator(".project-group-tabs").getByRole("button", { name: "角色制作 2", exact: true }).click();
  await expect(page.locator(".project-card-wrap")).toHaveCount(2);
  await page.getByRole("checkbox", { name: "选择画布 独立副本", exact: true }).check();
  await page.getByRole("combobox", { name: "移入分组" }).selectOption("ungrouped");
  await expect(page.locator(".project-card-wrap")).toHaveCount(1);
  await enterPrompt(page, () => page.getByRole("button", { name: "重命名分组", exact: true }).click(), "主要角色");
  await expect(page.locator(".project-group-tabs").getByRole("button", { name: "主要角色 1", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("project-groups-desktop.png") });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "解散分组（保留画布）", exact: true }).click();
  await expect(page.locator(".project-card-wrap")).toHaveCount(4);
  expect(fixture.projects).toHaveLength(4);
  fixture.failSave();
  await enterPrompt(page, () => page.getByRole("button", { name: "创建分组", exact: true }).click(), "失败分组");
  await expect(page.getByText(/分组保存失败/)).toBeVisible();
  expect(fixture.groups.personal).toEqual([]);
  await page.goto(`/canvas/${copy.id}`);
  await expect(page.locator('[data-node-id="text-1"]')).toBeVisible();
  expect(fixture.errors).toEqual([]);
});

test("copying within a group reveals and selects the independent copy", async ({ page }) => {
  const fixture = await setup(page);
  await page.getByRole("checkbox", { name: "选择画布 角色画布", exact: true }).check();
  await enterPrompt(page, () => page.getByRole("button", { name: "创建分组", exact: true }).click(), "角色制作");
  await expect(page.locator(".project-card-wrap")).toHaveCount(1);
  await page.getByRole("checkbox", { name: "选择画布 角色画布", exact: true }).check();
  await page.getByRole("button", { name: "复制选中", exact: true }).click();
  await expect(page.locator(".project-card-wrap")).toHaveCount(4);
  await expect(page.locator(".project-group-tabs").getByRole("button", { name: "全部 4", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("checkbox", { name: "选择画布 角色画布（副本）", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "选择画布 角色画布", exact: true })).not.toBeChecked();
  expect(fixture.groups.personal[0].projectIds).toEqual(["project-1"]);
  expect(fixture.errors).toEqual([]);
});

test("project controls wrap without overlap on narrow screens", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await enterPrompt(page, () => page.getByRole("button", { name: "创建分组", exact: true }).click(), "长名称的项目分类分组");
  await expect(page.locator(".project-group-tabs").getByRole("button", { name: "长名称的项目分类分组 0", exact: true })).toBeVisible();
  const controls = page.locator(".project-bulk-bar button, .project-group-move");
  const boxes = await controls.evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }; }));
  for (const [index, box] of boxes.entries()) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.w).toBeLessThanOrEqual(390);
    for (const other of boxes.slice(index + 1)) expect(box.x < other.x + other.w - 1 && box.x + box.w > other.x + 1 && box.y < other.y + other.h - 1 && box.y + box.h > other.y + 1).toBe(false);
  }
  await page.screenshot({ path: testInfo.outputPath("project-groups-mobile.png") });
});

for (const width of [1440, 390]) {
  test(`dashboard copies the selected canvas without navigating at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await setup(page, "/dashboard");
    const card = page.locator(".project-card-wrap").filter({ hasText: "角色画布" });
    await card.hover();
    await expect(card.locator(".project-card-tools")).toHaveCSS("opacity", "1");
    const tools = card.locator(".project-card-tools button");
    await expect(tools).toHaveCount(4);
    const boxes = await tools.evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom };
    }));
    for (const [index, box] of boxes.entries()) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
      for (const other of boxes.slice(index + 1)) {
        expect(box.x < other.right && box.right > other.x && box.y < other.bottom && box.bottom > other.y).toBe(false);
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`dashboard-copy-${width}.png`) });
    await card.getByRole("button", { name: "复制画布", exact: true }).click();
    await expect(page.getByText("已复制 1 个画布", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator(".stat-strip > div:last-child strong")).toHaveText("04");
    const copy = fixture.projects.find(project => project.title === "角色画布（副本）");
    expect(copy.id).not.toBe("project-1");
    expect(copy.data.nodes[0].metadata).toEqual({ status: "idle" });
    expect(fixture.projects[1].data.nodes[0].metadata.jobId).toBe("original-job");
    await page.getByRole("button", { name: "全部项目", exact: true }).click();
    await expect(page.locator(".project-card-wrap").filter({ hasText: "角色画布（副本）" })).toBeVisible();
    expect(fixture.errors).toEqual([]);
  });
}
