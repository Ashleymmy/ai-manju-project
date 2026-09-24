import { expect, test } from "@playwright/test";

test("all projects retries timed-out requests, shares metadata and keeps cards on refresh failure", async ({ page }, info) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const projects = Array.from({ length: 3 }, (_, index) => ({
    id: `archived-${index}`, title: index ? `旧画布 ${index}` : "我叫MT-2", scope: "personal", owner_id: "qa",
    created_at: "2026-09-20T00:00:00Z", updated_at: "2026-09-23T00:00:00Z",
  }));
  let listMode: "timeout" | "ok" | "failure" = "timeout";
  let releaseTimeout!: () => void;
  const timeoutGate = new Promise<void>(resolve => { releaseTimeout = resolve; });
  const lists: URL[] = [];
  let snapshotReads = 0;
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "project-list-qa");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  // Every application API is isolated. No user projects or generation service are touched.
  await page.route("**/api/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (!path.startsWith("/api/")) return route.continue();
    const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "authorization,content-type,x-request-id,idempotency-key", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (req.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me") data = { id: "qa", username: "qa", display_name: "项目验收", role: "ops_admin", status: "active" };
    else if (path === "/api/announcements/current") data = null;
    else if (path === "/api/user/preferences") data = { canvas: { projectGroups: { personal: [] } } };
    else if (path === "/api/projects") {
      lists.push(url);
      if (listMode === "timeout") {
        // Hold beyond the real HTTP deadline; this exercises AbortController, not a fake UI error.
        await timeoutGate;
        await route.abort("timedout").catch(() => {});
        return;
      }
      if (listMode === "failure") return route.fulfill({ headers, status: 503, json: { success: false, error: "temporarily unavailable" } });
      data = projects;
    } else if (path.endsWith("/snapshot")) {
      snapshotReads++;
      data = { project_id: path.split("/")[3], version: 1, data: { nodes: [{ id: "preserved", kind: "text" }], edges: [] } };
    }
    return route.fulfill({ headers, json: { success: true, data } });
  });
  await page.goto("/projects");
  await expect(page.getByText("正在读取项目…", { exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "知道了", exact: true }).click();
  await expect(page.locator(".project-group-tabs")).toContainText("全部 —");
  await expect(page.locator(".project-list-feedback")).toBeVisible({ timeout: 40000 });
  await expect(page.getByText("还没有画布项目", { exact: true })).toHaveCount(0);
  await expect(page.locator(".side-foot")).toContainText("— 项目");
  expect(snapshotReads).toBe(0);
  await page.screenshot({ path: info.outputPath("timeout-is-not-empty.png") });
  listMode = "ok";
  releaseTimeout();
  await page.locator(".project-list-feedback").getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator(".project-card-wrap")).toHaveCount(3);
  await expect(page.locator(".project-group-tabs")).toContainText("全部 3");
  await expect(page.locator(".side-foot")).toContainText("3 项目");
  await expect(page.locator(".project-list-feedback")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "我叫MT-2", exact: true })).toBeVisible();
  await expect(page.locator(".project-card").first()).toHaveCSS("opacity", "1");
  await page.screenshot({ path: info.outputPath("projects-restored.png") });
  listMode = "failure";
  await page.getByRole("button", { name: "刷新列表", exact: true }).click();
  await expect(page.locator(".project-list-feedback")).toContainText("已保留上次加载的项目");
  await expect(page.locator(".project-card-wrap")).toHaveCount(3);
  await expect(page.locator(".side-foot")).toContainText("3 项目");
  listMode = "ok";
  await page.locator(".project-list-feedback").getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator(".project-list-feedback")).toHaveCount(0);
  const snapshotCountBeforeExport = snapshotReads;
  await page.getByRole("checkbox", { name: "选择画布 我叫MT-2" }).check();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出选中", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/画布项目.+\.zip$/);
  expect(snapshotReads).toBe(snapshotCountBeforeExport + 1);
  expect(lists.every(url => url.searchParams.get("include_data") === "false")).toBe(true);
  expect(pageErrors).toEqual([]);
});
