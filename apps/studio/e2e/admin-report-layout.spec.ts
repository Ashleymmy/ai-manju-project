import { expect, test, type Page } from "@playwright/test";

const timestamp = new Date().toISOString();
const ledger = Array.from({ length: 6 }, (_, i) => ({
  id: `ledger-${i}`,
  user_id: "user_report_qa",
  entry_type: "consume",
  amount: -15,
  bucket: "grant",
  permanent_after: 100,
  grant_remaining_after: 85,
  job_id: `job_report_fixture_${i}`,
  created_at: timestamp,
}));
const stats = {
  tasks: 6,
  credits_settled: 90,
  credits_frozen: 15,
  succeeded: 5,
  failed: 1,
  estimated_cost_micros: 2200000,
  actual_cost_micros: 1000000,
  accounted_cost_micros: 2500000,
  actual_count: 2,
  estimated_count: 4,
  unknown_cost_count: 1,
};
const usage = {
  items: [
    {
      job_id: "job_fixture",
      user_id: "user_report_qa",
      username: "report-qa",
      display_name: "界面验收用户",
      project_name: "界面验收项目",
      project_id: "project_fixture",
      model: "fixture-model",
      provider: "fixture-provider",
      status: "succeeded",
      task_type: "image.generate",
      credit_status: "settled",
      credits_settled: 15,
      credits_quoted: 15,
      created_at: timestamp,
      estimated_cost_micros: 500000,
      actual_cost_micros: null,
    },
  ],
  total: 1,
  page: 1,
  page_size: 20,
  stats,
  groups: [{ ...stats, key: "2026-09-29", label: "09/29" }],
};

async function open(page: Page, path: string) {
  const requests: URL[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "report-layout-qa");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    requests.push(url);
    if (route.request().headers().accept === "text/event-stream")
      return route.fulfill({
        contentType: "text/event-stream",
        body: ":ok\n\n",
      });
    let data: unknown = [];
    if (url.pathname === "/api/auth/me")
      data = {
        id: "qa",
        username: "QA",
        role: "super_admin",
        status: "active",
      };
    else if (url.pathname === "/api/user/preferences") data = {};
    else if (url.pathname === "/api/announcements/current") data = null;
    else if (url.pathname === "/api/admin/billing/dashboard")
      data = {
        total_users: 1248,
        paid_users: 326,
        gmv_today_cents: 198000,
        gmv_month_cents: 3980000,
        credits_consumed_today: 12340,
        image_generation_total: 42856,
        video_seconds_total: 13280,
      };
    else if (url.pathname === "/api/admin/billing/ledger")
      data = {
        items: ledger,
        total: 1629,
        page: Number(url.searchParams.get("page") || 1),
        page_size: 20,
      };
    else if (url.pathname === "/api/admin/billing/usage")
      data = url.searchParams.get("export")
        ? { csv: "job_id\njob_fixture", total: 1 }
        : usage;
    else if (url.pathname === "/api/admin/billing/orders") {
      const pageNumber = Number(url.searchParams.get("page") || 1);
      const pageSize = Number(url.searchParams.get("page_size") || 20);
      const orders = Array.from({ length: 21 }, (_, index) => ({
        id: `order-report-${index + 1}`,
        user_id: "user_report_qa",
        order_type: "credit_pack",
        amount_cents: 1990,
        status: "paid",
        pay_channel: "wechat",
        created_at: timestamp,
        paid_at: timestamp,
      }));
      data = {
        items: orders.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
        total: orders.length,
        page: pageNumber,
        page_size: pageSize,
      };
    } else if (url.pathname === "/api/admin/billing/consumptions")
      data = {
        items: [
          {
            id: "consumption-report-1",
            job_id: "job-report-1",
            user_id: "user_report_qa",
            task_type: "image",
            model: "真实接口模型字段",
            credits_quoted: 25,
            credits_settled: null,
            status: "reserved",
            created_at: timestamp,
            params: {
              aspect_ratio: "1:1",
              prompt: "<script>not executable</script>",
            },
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
        stats: {},
      };
    else if (url.pathname === "/api/admin/member-users")
      data = {
        items:
          url.searchParams.get("search") === "不存在"
            ? []
            : [
                {
                  user_id: "user_report_qa",
                  username: "report-qa",
                  display_name: "界面验收用户",
                  status: "active",
                  member_level: "标准会员",
                  permanent_balance: 120,
                  limited_balance: 30,
                  total_recharge_cents: 1990,
                  registered_at: timestamp,
                  last_login_at: timestamp,
                },
              ],
        total: url.searchParams.get("search") === "不存在" ? 0 : 1,
        page: 1,
        page_size: 20,
      };
    else if (url.pathname.includes("readiness")) data = { ready: false };
    else if (
      url.pathname.includes("assets") ||
      url.pathname.includes("projects") ||
      url.pathname.includes("jobs")
    )
      data = { items: [], total: 0 };
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto(path);
  await expect(page.locator(".admin-report-content")).toBeVisible();
  const notice = page.getByRole("button", { name: "知道了", exact: true });
  if (await notice.isVisible()) await notice.click();
  return requests;
}

test("ledger consolidates filters and applies actual user/type/time parameters together", async ({
  page,
}, info) => {
  const requests = await open(page, "/admin/credit-ledger");
  const content = page.locator(".admin-report-content");
  const head = page.locator(".admin-panel-head");
  await expect(head.getByRole("heading", { name: "积分流水" })).toBeVisible();
  await expect(head.getByRole("button", { name: "刷新" })).toBeVisible();
  await expect(content.getByLabel("流水类型")).toBeVisible();
  await expect(content.getByLabel("时间范围")).toBeVisible();
  await expect(page.locator(".admin-side-status")).toBeVisible();
  await expect(content.locator("tbody tr")).toHaveCount(6);
  await expect(
    content.locator("tbody tr").first().locator("td").nth(5)
  ).toHaveText("85该批次剩余");
  await page.mouse.move(1900, 10);
  await page.screenshot({
    path: info.outputPath("ledger-desktop.png"),
    fullPage: true,
  });
  await content.getByLabel("搜索用户").fill("界面验收");
  await expect
    .poll(() =>
      requests
        .filter(r => r.pathname.endsWith("/member-users"))
        .at(-1)
        ?.searchParams.get("search")
    )
    .toBe("界面验收");
  await content.getByLabel("用户范围").selectOption("user_report_qa");
  await content.getByLabel("时间范围").selectOption("7");
  await content.getByLabel("流水类型").selectOption("consume");
  await expect(content.getByText("条件已修改，点击查询生效")).toBeVisible();
  expect(
    requests
      .filter(r => r.pathname.endsWith("/ledger"))
      .at(-1)
      ?.searchParams.has("user_id")
  ).toBe(false);
  await content.getByRole("button", { name: "查询", exact: true }).click();
  await expect
    .poll(() =>
      requests
        .filter(r => r.pathname.endsWith("/ledger"))
        .at(-1)
        ?.searchParams.get("user_id")
    )
    .toBe("user_report_qa");
  const query = requests.filter(r => r.pathname.endsWith("/ledger")).at(-1)!;
  expect(query.searchParams.has("start")).toBe(true);
  expect(query.searchParams.get("entry_type")).toBe("consume");
  await expect(content.locator(".admin-ledger-applied")).toContainText(
    "界面验收用户"
  );
  await content.getByRole("button", { name: "下一页" }).click();
  await expect
    .poll(() =>
      requests
        .filter(r => r.pathname.endsWith("/ledger"))
        .at(-1)
        ?.searchParams.get("page")
    )
    .toBe("2");
  expect(
    requests
      .filter(r => r.pathname.endsWith("/ledger"))
      .at(-1)
      ?.searchParams.get("start")
  ).toBe(query.searchParams.get("start"));
  await content.getByRole("button", { name: "重置", exact: true }).click();
  await expect(content.locator(".admin-ledger-applied")).toContainText(
    "全部用户"
  );
  await expect
    .poll(() =>
      requests
        .filter(r => r.pathname.endsWith("/ledger"))
        .at(-1)
        ?.searchParams.get("page")
    )
    .toBe("1");
  expect(
    requests
      .filter(r => r.pathname.endsWith("/ledger"))
      .at(-1)
      ?.searchParams.has("user_id")
  ).toBe(false);
});

test("ledger validates custom dates and unresolved user searches before requesting", async ({
  page,
}, info) => {
  const requests = await open(page, "/admin/credit-ledger");
  const content = page.locator(".admin-report-content");
  await expect(content.locator("tbody tr")).toHaveCount(6);
  await content.getByLabel("时间范围").selectOption("custom");
  await content.getByLabel("开始日期").fill("2026-09-10");
  await content.getByLabel("结束日期").fill("2026-09-01");
  const before = requests.filter(r => r.pathname.endsWith("/ledger")).length;
  await content.getByRole("button", { name: "查询", exact: true }).click();
  await expect(content.getByRole("alert")).toHaveText(
    "开始日期不能晚于结束日期"
  );
  expect(requests.filter(r => r.pathname.endsWith("/ledger"))).toHaveLength(
    before
  );
  await content.getByLabel("结束日期").fill("2026-09-12");
  await content.getByRole("button", { name: "查询", exact: true }).click();
  await expect
    .poll(() =>
      requests
        .filter(r => r.pathname.endsWith("/ledger"))
        .at(-1)
        ?.searchParams.has("end")
    )
    .toBe(true);
  const query = requests.filter(r => r.pathname.endsWith("/ledger")).at(-1)!;
  const expected = await page.evaluate(() => ({
    start: new Date(2026, 8, 10).toISOString(),
    end: new Date(2026, 8, 12, 23, 59, 59, 999)
      .toISOString()
      .replace(".999Z", ".999999999Z"),
  }));
  expect(query.searchParams.get("start")).toBe(expected.start);
  expect(query.searchParams.get("end")).toBe(expected.end);
  await page.mouse.move(1900, 10);
  await page.screenshot({
    path: info.outputPath("ledger-custom-dates.png"),
    fullPage: true,
  });
  await content.getByLabel("搜索用户").fill("不存在");
  await expect(
    content.getByText("没有找到匹配用户，请更换关键词")
  ).toBeVisible();
  const previous = requests.filter(r => r.pathname.endsWith("/ledger")).length;
  await content.getByRole("button", { name: "查询", exact: true }).click();
  await expect(content.getByRole("alert")).toContainText("请从匹配用户中选择");
  expect(requests.filter(r => r.pathname.endsWith("/ledger"))).toHaveLength(
    previous
  );
});

test("dashboard filters existing metrics without falsifying aggregate requests", async ({
  page,
}, info) => {
  const requests = await open(page, "/admin/dashboard");
  const content = page.locator(".admin-report-content");
  await expect(content.locator(".admin-report-stats > div")).toHaveCount(7);
  await page.screenshot({
    path: info.outputPath("dashboard-desktop.png"),
    fullPage: true,
  });
  await content.getByLabel("指标分类").selectOption("revenue");
  await expect(content.locator(".admin-report-stats > div")).toHaveCount(2);
  await content.getByLabel("统计口径").selectOption("today");
  await expect(content.locator(".admin-report-stats > div")).toHaveCount(1);
  await expect(content.locator(".admin-report-stats strong")).toHaveText(
    "¥1980.00"
  );
  await content.getByLabel("关键词").fill("不存在的指标");
  await content
    .getByRole("form", { name: "运营指标筛选" })
    .getByRole("button", { name: "查询", exact: true })
    .click();
  await expect(content.getByText("没有符合筛选条件的指标")).toBeVisible();
  expect(
    requests
      .filter(r => r.pathname.endsWith("/dashboard"))
      .every(r => !r.search)
  ).toBe(true);
});

test("dashboard business details query real endpoints, page records and open complete read-only details", async ({
  page,
}, info) => {
  const requests = await open(page, "/admin/dashboard");
  const details = page.getByRole("region", { name: "运营明细" });
  const form = details.getByRole("form", { name: "运营明细筛选" });
  await expect(details.getByRole("table", { name: "用户明细" })).toContainText(
    "界面验收用户"
  );
  await page.mouse.move(1900, 10);
  await page.screenshot({
    path: info.outputPath("dashboard-with-details.png"),
    fullPage: true,
  });
  await details
    .getByRole("button", { name: "查看用户详情 user_report_qa" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("累计充值");
  await expect(page.getByRole("dialog")).toContainText("¥19.90");
  await page.keyboard.press("Escape");
  await form.getByLabel("搜索用户").fill("界面验收");
  await form.getByLabel("账号状态").selectOption("active");
  await form.getByRole("button", { name: "查询", exact: true }).click();
  await expect
    .poll(() =>
      requests
        .filter(r => r.pathname.endsWith("/member-users"))
        .at(-1)
        ?.searchParams.get("search")
    )
    .toBe("界面验收");
  expect(
    requests
      .filter(r => r.pathname.endsWith("/member-users"))
      .at(-1)
      ?.searchParams.get("status")
  ).toBe("active");
  await details.getByRole("button", { name: "订单明细", exact: true }).click();
  await expect(
    details.getByRole("table", { name: "订单明细" }).locator("tbody tr")
  ).toHaveCount(20);
  await details.getByRole("button", { name: "下一页" }).click();
  await expect(details.getByRole("table", { name: "订单明细" })).toContainText(
    "order-report-21"
  );
  expect(
    requests
      .filter(r => r.pathname.endsWith("/orders"))
      .at(-1)
      ?.searchParams.get("page")
  ).toBe("2");
  await details
    .getByRole("button", { name: "查看订单详情 order-report-21" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("order-report-21");
  await expect(page.getByRole("dialog")).toContainText("已支付");
  await page.keyboard.press("Escape");
  await details.getByRole("button", { name: "消耗明细", exact: true }).click();
  await expect(details.getByRole("table", { name: "消耗明细" })).toContainText(
    "实扣 —"
  );
  await expect(details.getByRole("table", { name: "消耗明细" })).toContainText(
    "已冻结"
  );
  await form.getByLabel("用户 ID").fill("user_report_qa");
  await form.getByLabel("积分状态").selectOption("reserved");
  await form.getByRole("button", { name: "查询", exact: true }).click();
  await expect
    .poll(() =>
      requests
        .filter(r => r.pathname.endsWith("/consumptions"))
        .at(-1)
        ?.searchParams.get("status")
    )
    .toBe("reserved");
  expect(
    requests
      .filter(r => r.pathname.endsWith("/consumptions"))
      .at(-1)
      ?.searchParams.get("user_id")
  ).toBe("user_report_qa");
  await details
    .getByRole("button", { name: "查看消耗详情 consumption-report-1" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("真实接口模型字段");
  await expect(page.getByRole("dialog").locator("pre")).toContainText(
    "<script>not executable</script>"
  );
  await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: info.outputPath("dashboard-consumption-detail.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await details.getByRole("button", { name: "用户明细", exact: true }).click();
  await form.getByLabel("搜索用户").fill("不存在");
  await form.getByRole("button", { name: "查询", exact: true }).click();
  await expect(
    details.getByText("暂无用户明细", { exact: true })
  ).toBeVisible();
  await expect(page.locator(".admin-report-stats > div")).toHaveCount(7);
});

test("usage filters and export keep the selected API query", async ({
  page,
}, info) => {
  const requests = await open(page, "/admin/consumptions");
  const form = page.getByRole("form", { name: "消耗与成本筛选" });
  await expect(
    page.getByRole("table", { name: "成员项目任务消耗明细" })
  ).toContainText("fixture-model");
  await page.mouse.move(1900, 10);
  await page.screenshot({
    path: info.outputPath("usage-desktop.png"),
    fullPage: true,
  });
  await form.getByLabel("模型", { exact: true }).fill("selected-model");
  await form.getByLabel("任务状态").selectOption("failed");
  await form.getByLabel("成员", { exact: true }).selectOption("user_report_qa");
  await form.getByRole("button", { name: "查询", exact: true }).click();
  await expect
    .poll(() =>
      requests
        .filter(r => r.pathname.endsWith("/usage"))
        .at(-1)
        ?.searchParams.get("model")
    )
    .toBe("selected-model");
  const selected = requests.filter(r => r.pathname.endsWith("/usage")).at(-1)!;
  expect(selected.searchParams.get("status")).toBe("failed");
  expect(selected.searchParams.get("user_id")).toBe("user_report_qa");
  expect(selected.searchParams.get("page")).toBe("1");
  await form.getByRole("button", { name: "导出筛选结果（全部页）" }).click();
  await expect
    .poll(() =>
      requests
        .filter(r => r.pathname.endsWith("/usage"))
        .at(-1)
        ?.searchParams.get("export")
    )
    .toBe("csv");
  expect(
    requests
      .filter(r => r.pathname.endsWith("/usage"))
      .at(-1)
      ?.searchParams.get("model")
  ).toBe("selected-model");
});

test("all three content areas wrap filters and confine table overflow", async ({
  page,
}, info) => {
  for (const route of ["dashboard", "credit-ledger", "consumptions"]) {
    await page.unrouteAll({ behavior: "wait" });
    await open(page, `/admin/${route}`);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.mouse.move(width - 5, 5);
      const bounds = await page
        .locator(".admin-report-content")
        .evaluate(element => {
          const rect = element.getBoundingClientRect();
          return {
            width: rect.width,
            scroll: element.scrollWidth,
            viewport: window.innerWidth,
            right: rect.right,
          };
        });
      expect(bounds.scroll).toBeLessThanOrEqual(Math.ceil(bounds.width) + 1);
      expect(bounds.right).toBeLessThanOrEqual(bounds.viewport + 1);
      const controls = await page
        .locator(".admin-report-filters input, .admin-report-filters select")
        .evaluateAll(elements =>
          elements.map(element => element.getBoundingClientRect().height)
        );
      expect(controls.every(height => height === 36)).toBe(true);
      await page.screenshot({
        path: info.outputPath(`${route}-${width}.png`),
        fullPage: true,
      });
    }
  }
});
