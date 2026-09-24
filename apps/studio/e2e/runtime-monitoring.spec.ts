import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

// A disposable API/database, never a user's provider or generation queue.
const API = process.env.MONITORING_QA_API || "http://127.0.0.1:3118";
const PASSWORD = "Monitoring-QA-only-2026";
const nonce = Date.now().toString(36);
async function account(
  request: APIRequestContext,
  name: string,
  register = false
) {
  const response = await request.post(
    `${API}/api/auth/${register ? "register" : "login"}`,
    { data: { username: name, password: PASSWORD } }
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).data as {
    token: string;
    user: { id: string };
  };
}
async function connect(page: Page, token: string) {
  await page.addInitScript(value => {
    localStorage.setItem("ai-manju:auth_token", value);
    localStorage.setItem("ai-manju:token-store", "local");
  }, token);
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const headers = {
      ...route.request().headers(),
      origin: "http://localhost:3100",
    };
    delete headers.host;
    if (headers.accept === "text/event-stream")
      return route.fulfill({
        contentType: "text/event-stream",
        body: ":ok\n\n",
      });
    const response = await route.fetch({
      url: `${API}${url.pathname}${url.search}`,
      headers,
    });
    await route.fulfill({ response });
  });
}

test("real API isolation, filtering, details, export and responsive monitoring", async ({
  page,
  request,
}, info) => {
  const admin = await account(request, "monitoradmin");
  const alice = await account(request, `alice${nonce}`, true);
  const bob = await account(request, `bob${nonce}`, true);
  for (const [owner, label] of [
    [alice, "ALICE"],
    [bob, "BOB"],
  ] as const) {
    const result = await request.post(`${API}/api/monitoring/client-errors`, {
      headers: { Authorization: `Bearer ${owner.token}` },
      data: {
        id: `qa-${label}-${nonce}`,
        user_id: "forged",
        message: `${label} ${nonce} render failed`,
        detail: "api_key=NEVERVISIBLE",
        endpoint: "/canvas/qa?token=NEVERVISIBLE",
        code: "render_error",
      },
    });
    expect(result.status()).toBe(201);
  }
  const forbidden = await request.get(
    `${API}/api/monitoring?user_id=${bob.user.id}&export=csv`,
    { headers: { Authorization: `Bearer ${alice.token}` } }
  );
  expect(forbidden.status()).toBe(403);
  await connect(page, admin.token);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/admin#monitoring");
  await page.getByRole("button", { name: "知道了", exact: true }).click();
  await expect(page.locator(".runtime-monitor")).toBeVisible();
  await expect(
    page.getByText(`ALICE ${nonce} render failed`, { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(`BOB ${nonce} render failed`, { exact: true })
  ).toBeVisible();
  await page.getByLabel("自动刷新").uncheck();
  await page
    .getByRole("combobox", { name: "用户", exact: true })
    .selectOption(alice.user.id);
  await expect(
    page.getByText(`ALICE ${nonce} render failed`, { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(`BOB ${nonce} render failed`, { exact: true })
  ).toHaveCount(0);
  await page.getByLabel("关键词").fill("render failed");
  await page.getByRole("button", { name: "查询监控" }).click();
  await expect(page.locator(".runtime-monitor tbody tr")).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: /^查看详情/ }).click();
  await expect(page.getByRole("dialog")).toContainText("[redacted]");
  await expect(page.getByRole("dialog")).not.toContainText("NEVERVISIBLE");
  await page.screenshot({
    path: info.outputPath("detail.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出全部筛选记录" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv).toContain("ALICE");
  expect(csv).not.toContain("BOB");
  expect(csv).not.toContain("NEVERVISIBLE");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.getByRole("button", { name: /^查看详情/ }).click();
  const rect = await page.getByRole("dialog").boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: info.outputPath("mobile-detail.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.getByLabel("关键词").fill("no-such-record");
  await page.getByRole("button", { name: "查询监控" }).click();
  await expect(page.getByText("当前筛选条件下没有记录")).toBeVisible();
  await page
    .getByRole("combobox", { name: "时间范围", exact: true })
    .selectOption("0");
  await page.getByLabel("开始时间").fill("2026-01-01T00:00");
  await page.getByLabel("结束时间").fill("2026-01-02T00:00");
  await page.getByRole("button", { name: "查询监控" }).click();
  await expect(page.locator(".runtime-monitor-listhead")).toContainText(
    "01/01"
  );
});

test("member sees own records and page errors are actually persisted", async ({
  page,
  request,
}, info) => {
  const member = await account(request, `member${nonce}`, true);
  await connect(page, member.token);
  await page.goto("/monitoring");
  await page.getByRole("button", { name: "知道了", exact: true }).click();
  await expect(page.locator(".runtime-monitor")).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "用户", exact: true })
  ).toHaveCount(0);
  const recorded = page.waitForResponse(
    r =>
      r.url().includes("/monitoring/client-errors") &&
      r.request().method() === "POST"
  );
  await page.evaluate(() =>
    window.dispatchEvent(
      new ErrorEvent("error", { error: new Error("QA browser exception") })
    )
  );
  expect((await recorded).status()).toBe(201);
  await page.getByRole("button", { name: "刷新监控" }).click();
  await expect(
    page.getByText("QA browser exception", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("ALICE render failed", { exact: true })
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("member.png"),
    fullPage: true,
    animations: "disabled",
  });
});
