import { expect, test, type Page } from "@playwright/test";

async function isolateApi(page: Page, announcement = false) {
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "loading-layout-qa");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (request.headers().accept === "text/event-stream") return route.fulfill({ contentType: "text/event-stream", body: ":ok\n\n" });
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me") data = { id: "qa", username: "qa", role: "super_admin", status: "active" };
    if (path === "/api/announcements/current") data = announcement ? { id: "notice", title: "测试公告", content: "公告占用的高度不计入页面加载区域。", kind: "notice" } : null;
    return route.fulfill({ json: { success: true, data } });
  });
}

async function holdModule(page: Page, path: string) {
  let release!: () => void;
  let markRequested!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { markRequested = resolve; });
  // Delay only the route import, not shared exports consumed by the navigation shell.
  await page.route("**/__qa__/pending-route", async route => {
    markRequested();
    await pending;
    await route.fulfill({ body: "ok" });
  });
  await page.route(url => url.pathname === "/src/app/routes/routes.ts", async route => {
    const response = await route.fetch();
    const source = await response.text();
    const body = source.replace(/import\("([^"]+)"\)/g, (expression, url: string) =>
      new URL(url, route.request().url()).pathname === path
        ? `fetch("/__qa__/pending-route").then(() => ${expression})`
        : expression);
    expect(body).not.toBe(source);
    await route.fulfill({ response, body });
  });
  return { release, requested };
}

async function assertCentered(page: Page, contained: boolean) {
  const loader = page.locator(contained ? ".page-loader-contained" : ".page-loader:not(.page-loader-contained)");
  await expect(loader).toBeVisible();
  await expect.poll(async () => loader.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const image = element.querySelector("img")!.getBoundingClientRect();
    const label = element.querySelector("p")!.getBoundingClientRect();
    const stage = element.closest(".main-stage");
    const header = stage?.querySelector(".topbar")?.getBoundingClientRect();
    const banner = stage?.querySelector(":scope > section")?.getBoundingClientRect();
    const canvas = Boolean(element.closest(".canvas-focus-direct"));
    const left = canvas ? 0 : stage?.getBoundingClientRect().left ?? 0;
    const top = banner?.bottom ?? header?.bottom ?? 0;
    return Math.max(Math.abs(rect.left - left), Math.abs(rect.top - top), Math.abs(rect.right - innerWidth),
      Math.abs(rect.bottom - innerHeight), Math.abs((image.left + image.right) / 2 - (left + innerWidth) / 2),
      Math.abs((image.top + label.bottom) / 2 - (top + innerHeight) / 2));
  })).toBeLessThan(2);
  await expect(loader.locator("img")).toHaveJSProperty("complete", true);
  expect(await loader.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
}

for (const scenario of [
  { route: "/tags", module: "/src/features/tags/index.ts", width: 1920, height: 1080 },
  { route: "/prompts", module: "/src/features/prompts/index.ts", width: 1280, height: 900, announcement: true },
  { route: "/skills?rail=collapsed", module: "/src/features/skills/index.ts", width: 1280, height: 900 },
  { route: "/settings", module: "/src/features/settings/index.ts", width: 900, height: 900 },
  { route: "/tags", module: "/src/features/tags/index.ts", width: 390, height: 844, announcement: true },
  { route: "/canvas/loading-qa", module: "/src/features/canvas/CanvasPage.tsx", width: 1280, height: 900 },
  { route: "/canvas/loading-qa", module: "/src/features/canvas/CanvasPage.tsx", width: 390, height: 844 },
]) {
  test(`centers pending ${scenario.route} in the actual content area at ${scenario.width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await isolateApi(page, scenario.announcement);
    const { release, requested } = await holdModule(page, scenario.module);
    try {
      await page.goto(scenario.route, { waitUntil: "commit" });
      await requested;
      if (!scenario.route.startsWith("/canvas")) {
        await page.getByRole("button", { name: "知道了", exact: true }).click();
        if (scenario.announcement) await expect(page.getByText("测试公告", { exact: true })).toBeVisible();
      }
      await assertCentered(page, true);
      await page.screenshot({ path: info.outputPath("loading-centered.png"), fullPage: true });
      await page.setViewportSize({ width: scenario.width, height: scenario.height - 180 });
      await assertCentered(page, true);
    } finally { release(); }
  });
}

test("layout-free routes use a full viewport loader", async ({ page }, info) => {
  await isolateApi(page);
  const { release, requested } = await holdModule(page, "/src/features/admin/ui/ProviderHubPage.tsx");
  try {
    await page.goto("/admin/model-hub", { waitUntil: "commit" });
    await requested;
    await assertCentered(page, false);
    await page.screenshot({ path: info.outputPath("standalone-loading.png"), fullPage: true });
  } finally { release(); }
});

test("navigation stays usable and loaded content returns to normal layout", async ({ page }) => {
  await isolateApi(page);
  const { release, requested } = await holdModule(page, "/src/features/tags/index.ts");
  try {
    await page.goto("/settings");
    await page.getByRole("button", { name: "知道了", exact: true }).click();
    await expect(page.locator(".page-loader")).toHaveCount(0);
    await page.locator('.side-rail a[href="/tags"]').click();
    await requested;
    await assertCentered(page, true);
    await page.locator('.side-rail a[href="/settings"]').click();
    await expect(page.locator(".page-loader")).toHaveCount(0);
    expect(await page.locator(".main-stage").evaluate(element => getComputedStyle(element).display)).toBe("block");
  } finally { release(); }
});
