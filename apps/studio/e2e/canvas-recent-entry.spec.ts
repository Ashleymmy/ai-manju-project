import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, empty = false) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const state = {
    projects: empty ? [] : [
      { id: "older", title: "Older Canvas", scope: "personal", updated_at: "2026-09-01T12:00:00Z", created_at: "2026-09-01T12:00:00Z" },
      { id: "recent", title: "Recent Canvas", scope: "personal", updated_at: "2026-09-20T12:00:00Z", created_at: "2026-09-01T12:00:00Z" },
    ],
    failList: false,
    createRequests: 0,
    saves: 0,
    errors,
  };
  const snapshots = new Map<string, any>(state.projects.map(project => [project.id, {
    schema: "ai-manhua-studio-canvas", version: 3, nodes: [], edges: [], connections: [], groups: [],
    zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 },
  }]));
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "recent-entry-qa");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const headers = {
      "Access-Control-Allow-Origin": new URL(page.url()).origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "authorization,content-type,x-request-id",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    let data: unknown = { items: [], total: 0 };
    if (url.pathname === "/api/auth/me") data = { id: "qa", username: "qa", role: "super_admin", status: "active" };
    else if (url.pathname === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (url.pathname === "/api/projects") {
      if (request.method() === "POST") state.createRequests++;
      if (state.failList) return route.fulfill({ headers, status: 503, json: { success: false, error: { message: "画布列表暂时不可用" } } });
      data = { items: state.projects, total: state.projects.length };
    } else {
      const match = url.pathname.match(/^\/api\/projects\/([^/]+)(\/snapshot)?$/);
      if (match) {
        const project = state.projects.find(item => item.id === match[1]);
        if (match[2]) {
          if (request.method() === "PUT" && project) {
            snapshots.set(project.id, request.postDataJSON().data);
            project.updated_at = "2026-10-01T12:00:00Z";
            state.saves++;
          }
          data = { project_id: match[1], version: state.saves + 1, data: snapshots.get(match[1]) };
        } else data = { ...project, data: snapshots.get(match[1]) };
      }
    }
    if (url.pathname === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data, request_id: "recent-entry-qa" } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "知道了", exact: true }).click();
  await expect(page.getByRole("link", { name: "画布工坊", exact: false })).toBeVisible();
  return state;
}

test("sidebar opens the latest server-edited canvas, supports Back and ignores deleted projects", async ({ page }, testInfo) => {
  const state = await setup(page);
  await page.getByRole("link", { name: "画布工坊", exact: false }).click();
  await expect(page).toHaveURL(/\/canvas\/recent\?scope=personal$/);
  await expect(page.locator(".real-canvas-stage")).toBeVisible();
  await expect(page.locator(".canvas-switcher-title")).toHaveText("Recent Canvas");
  await page.screenshot({ path: testInfo.outputPath("recent-canvas.png") });
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);
  state.projects = state.projects.filter(project => project.id !== "recent");
  await page.getByRole("link", { name: "画布工坊", exact: false }).click();
  await expect(page).toHaveURL(/\/canvas\/older\?scope=personal$/);
  await expect(page.locator(".real-canvas-stage")).toBeVisible();
  expect(state.createRequests).toBe(0);
  expect(state.errors).toEqual([]);
});

test("editing another canvas changes the next sidebar destination", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/canvas/older?scope=personal");
  await expect(page.locator(".real-canvas-stage")).toBeVisible();
  await page.locator(".real-canvas-stage").click({ position: { x: 1000, y: 200 } });
  await page.evaluate(() => navigator.clipboard.writeText("Latest canvas edit"));
  await page.keyboard.press("Control+v");
  await expect.poll(() => state.saves).toBeGreaterThan(0);
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page.getByRole("link", { name: "画布工坊", exact: false }).click();
  await expect(page).toHaveURL(/\/canvas\/older\?scope=personal$/);
  await expect(page.locator(".real-canvas-node.text")).toContainText("Latest canvas edit");
  expect(state.errors).toEqual([]);
});

test("new users see the existing create entry without an automatic project", async ({ page }) => {
  const state = await setup(page, true);
  await page.getByRole("link", { name: "画布工坊", exact: false }).click();
  await expect(page).toHaveURL(/\/canvas\?scope=personal$/);
  await expect(page.getByText("还没有画布项目。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "新建画布", exact: true })).toBeVisible();
  expect(state.createRequests).toBe(0);
  expect(state.errors).toEqual([]);
});

test("list failures return to the list without a redirect loop", async ({ page }) => {
  const state = await setup(page);
  state.failList = true;
  await page.getByRole("link", { name: "画布工坊", exact: false }).click();
  await expect(page).toHaveURL(/\/canvas\?scope=personal$/);
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "新建画布", exact: true })).toBeVisible();
  expect(state.errors).toEqual([]);
});
