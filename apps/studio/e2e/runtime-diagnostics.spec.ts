import { expect, test, type Page } from "@playwright/test";
import type { MonitoringRow } from "../client/src/features/admin/services/runtimeMonitoringApi";

const timestamp = new Date().toISOString();
const originalLabels = [
  "用户",
  "状态",
  "操作",
  "模型",
  "错误码",
  "错误信息",
  "诊断详情",
  "处理建议",
  "接口",
  "HTTP 状态",
  "上游状态",
  "请求编号",
  "任务编号",
  "项目编号",
  "节点编号",
  "尝试次数",
  "耗时",
];
const upstream = {
  id: "upstream-fixture",
  source: "worker",
  status: "error",
  user_id: "qa",
  username: "QA",
  operation: "video.generate",
  model: "test-model",
  message: "生成尝试失败",
  detail: "请求被服务拒绝",
  error_code: "invalid_audio",
  duration_ms: 2034,
  http_status: 0,
  provider_status: 422,
  request_id: "original-api-id",
  job_id: "job-qa",
  project_id: "project-qa",
  node_id: "node-qa",
  attempt: 1,
  created_at: timestamp,
  diagnostics: {
    stage: "provider_response",
    provider_response_received: true,
    provider_url: "https://provider.example/v1/videos",
    provider_method: "POST",
    provider_request_id: "provider-request-42",
    provider_code: "invalid_audio",
    provider_body:
      '{"error":{"code":"invalid_audio","message":"Audio duration exceeds 15 seconds"}}',
  },
} as MonitoringRow;

async function setup(
  page: Page,
  rows: MonitoringRow[],
  onReport?: (data: Record<string, any>) => void
) {
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "diagnostic-qa");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  await page.route("**/api/**", async route => {
    const req = route.request(),
      url = new URL(req.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (req.headers().accept === "text/event-stream")
      return route.fulfill({
        contentType: "text/event-stream",
        body: ":ok\n\n",
      });
    let data: unknown = { items: [], total: 0 };
    if (url.pathname === "/api/auth/me")
      data = {
        id: "qa",
        username: "QA",
        role: "super_admin",
        status: "active",
      };
    else if (url.pathname === "/api/user/preferences") data = {};
    else if (url.pathname === "/api/announcements/current") data = null;
    else if (url.pathname === "/api/monitoring/users")
      data = [{ id: "qa", username: "QA" }];
    else if (url.pathname === "/api/monitoring/client-errors") {
      onReport?.(req.postDataJSON());
      data = { id: "captured" };
    } else if (url.pathname === "/api/monitoring")
      data = {
        generated_at: timestamp,
        start: timestamp,
        end: timestamp,
        is_global: true,
        can_view_all: true,
        user_id: "",
        items: rows,
        total: rows.length,
        page: 1,
        page_size: 30,
        stats: {
          records: rows.length,
          errors: rows.length,
          successes: 0,
          pending: 0,
          canceled: 0,
          affected_users: 1,
          average_duration_ms: 2000,
        },
        buckets: [],
        codes: [],
        sources: [],
      };
    await route.fulfill({
      json: { success: true, data, request_id: "log-request-id" },
    });
  });
  await page.goto("/monitoring");
  const notice = page.getByRole("button", { name: "知道了", exact: true });
  await expect(page.locator(".runtime-monitor")).toBeVisible();
  await notice.click();
}

test("upstream details remain readable, copyable and responsive", async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await setup(page, [upstream]);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: /^查看详情/ }).click();
    const dialog = page.getByRole("dialog");
    const original = dialog.locator('dl[aria-label="运行记录字段"]');
    await expect(original.locator("dt")).toHaveText(originalLabels);
    await expect(dialog).toContainText("Audio duration exceeds 15 seconds");
    await expect(dialog).toContainText("provider-request-42");
    await expect(dialog).toContainText("422");
    const rect = await dialog.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.width).toBeLessThanOrEqual(width);
    if (width === 1440) {
      // Measure both cells in one layout snapshot, including during animation.
      const geometry = await original.locator("dt").evaluateAll(elements =>
        Object.fromEntries(
          elements.map(element => {
            const rect = element.getBoundingClientRect();
            return [element.textContent || "", { x: rect.x, y: rect.y }];
          })
        )
      );
      for (const [left, right] of [
        ["操作", "模型"],
        ["接口", "HTTP 状态"],
        ["上游状态", "请求编号"],
        ["任务编号", "项目编号"],
        ["节点编号", "尝试次数"],
      ]) {
        expect(Math.abs(geometry[left].y - geometry[right].y)).toBeLessThan(1);
        expect(geometry[left].x).toBeLessThan(geometry[right].x);
      }
    }
    await page.screenshot({
      path: info.outputPath(`details-${width}.png`),
      animations: "disabled",
    });
    if (width === 1440) {
      await page.getByRole("button", { name: "复制诊断信息" }).click();
      const text = await page.evaluate(() => navigator.clipboard.readText());
      expect(JSON.parse(text).diagnostics.provider_request_id).toBe(
        "provider-request-42"
      );
    }
    await page.keyboard.press("Escape");
  }
});

test("the screenshot's legacy 404 retains all seventeen original fields and copy content", async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1920, height: 946 });
  const legacy = {
    id: "legacy-404",
    source: "api",
    status: "error",
    operation: "GET /api/admin/generation-recovery",
    method: "GET",
    endpoint: "/api/admin/generation-recovery",
    error_code: "http_404",
    message: "Not Found",
    http_status: 404,
    request_id: "original-404-request",
    created_at: timestamp,
    duration_ms: 0,
  } as MonitoringRow;
  await setup(page, [legacy]);
  await page.getByRole("button", { name: /^查看详情/ }).click();
  const dialog = page.getByRole("dialog");
  const original = dialog.locator('dl[aria-label="运行记录字段"]');
  await expect(original.locator("dt")).toHaveText(originalLabels);
  for (const label of [
    "模型",
    "诊断详情",
    "处理建议",
    "上游状态",
    "任务编号",
    "项目编号",
    "节点编号",
    "尝试次数",
  ]) {
    await expect(
      original
        .locator("div")
        .filter({
          has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }),
        })
        .locator("dd")
    ).toHaveText("未记录");
  }
  await expect(original).toContainText("Not Found");
  await expect(original).toContainText("404");
  await expect(original).toContainText("GET /api/admin/generation-recovery");
  await expect(original).toContainText("original-404-request");
  await page.screenshot({
    path: info.outputPath("original-fields-restored.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "复制诊断信息" }).click();
  const copied = JSON.parse(
    await page.evaluate(() => navigator.clipboard.readText())
  );
  expect(copied).toEqual(legacy);
});

test("a real browser fetch failure reports original exception and request correlation", async ({
  page,
}, info) => {
  let posted: Record<string, any> | undefined;
  let originalID = "";
  await setup(page, [], data => {
    posted = data;
  });
  await page.route("**/api/diagnostic-offline", async route => {
    originalID = route.request().headers()["x-request-id"];
    await route.abort("failed");
  });
  await page.evaluate(async source => {
    const api = await import(/* @vite-ignore */ source);
    try {
      await api.request("/api/diagnostic-offline");
    } catch {
      /* Expected transport failure. */
    }
  }, "/src/shared/api/http/request.ts");
  await expect.poll(() => posted?.endpoint).toBe("/api/diagnostic-offline");
  expect(posted!.request_id).toBe(originalID);
  expect(posted!.http_status).toBe(0);
  expect(posted!.duration_ms).toBeGreaterThanOrEqual(0);
  expect(posted!.diagnostics).toMatchObject({
    stage: "request_transport",
    response_received: false,
    exception_name: "TypeError",
    exception_message: "Failed to fetch",
    page_path: "/monitoring",
  });
  await page.screenshot({
    path: info.outputPath("browser-collection.png"),
    fullPage: true,
  });
});
