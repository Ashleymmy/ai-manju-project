import { expect, test, type Page } from "@playwright/test";

async function expectNoClipping(page: Page, selector: string) {
  const clipped = await page.locator(selector).evaluateAll(elements =>
    elements.filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 &&
        (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
    }).map(element => element.textContent?.trim())
  );
  expect(clipped, selector).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "qa-token");
    localStorage.setItem("ai-manju:token-store", "local");
  });
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
    if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me") data = { id: "qa", username: "QA", display_name: "QA", role: "super_admin", status: "active" };
    else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (path === "/api/announcements/current") data = null;
    else if (path === "/api/ai/models") data = { text_models: ["qa::gpt-5.6-luna"], default_text_model: "qa::gpt-5.6-luna", image_models: [], video_models: [] };
    else if (path === "/api/member/overview") data = { limited_available: 999975, permanent_available: 0, monthly_usage: { total_credits: 25, image_count: 3, video_seconds: 0 } };
    else if (["/api/asset-folders", "/api/asset-exports", "/api/comic-asset-projects", "/api/tags"].includes(path)) data = [];
    if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data, request_id: "typography-qa" } });
  });
});

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`small text is readable without enlarging headings at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/dashboard");
    await expect(page.locator(".stat-strip")).toBeVisible();
    const notice = page.getByRole("button", { name: "知道了", exact: true });
    if (await notice.isVisible()) await notice.click();
    await expect(page.locator(".credit-summary strong").last()).toHaveText("999,975");
    await expect(page.locator(".stat-strip span").first()).toHaveCSS("font-size", "13px");
    await expect(page.locator(".stat-strip small").first()).toHaveCSS("font-size", "13px");
    await expect(page.locator(".credit-summary small").first()).toHaveCSS("font-size", "12px");
    await expect(page.locator(".stat-strip strong").first()).toHaveCSS("font-size", "30px");
    await expect(page.locator(".credit-summary strong").first()).toHaveCSS("font-size", "24px");
    await expect(page.locator(".chat-hero h2")).toHaveCSS("font-size", viewport.width > 760 ? "42px" : "30px");
    await expect(page.locator(".chat-composer textarea")).toHaveCSS("font-size", "13px");
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(async () => {
      const faces = await document.fonts.load('400 13px "Studio UI"', "画布工坊素材与语言");
      return faces.length > 0 && faces.every(face => face.status === "loaded");
    })).toBe(true);
    await expect(page.locator("body")).toHaveCSS("font-weight", "400");
    await expect(page.locator(".ln-label").first()).toHaveCSS("font-family", /Studio UI/);
    await expect(page.locator(".chat-hero h2")).toHaveCSS("font-family", /Studio Rounded/);
    await expect(page.locator(".chat-hero h2")).toHaveCSS("font-weight", "500");
    await expect(page.locator(".chat-hero-sub")).toHaveCSS("font-weight", "400");
    if (viewport.width > 1100) {
      await expect(page.locator(".ln-label").first()).toHaveCSS("font-size", "13px");
      await expect(page.locator('.ln-row[href="/dashboard"]')).toHaveCSS("font-weight", "500");
      const brand = page.getByRole("img", { name: "cloudto 云格", exact: true });
      await expect(brand).toBeVisible();
      await expect.poll(() => brand.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await page.locator('.ln-row[href="/dashboard"]').hover();
      await expectNoClipping(page, ".ln-label, .ln-index, .ln-row kbd, .brand-lockup");
    }
    await expectNoClipping(page, ".stat-strip > div, .credit-summary > div, .chat-tool-btn, .outline-button");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath("dashboard.png"), fullPage: true });
    if (viewport.width <= 760) {
      const rail = (await page.locator(".side-rail").boundingBox())!;
      const nav = (await page.locator(".line-nav").boundingBox())!;
      expect(nav.y).toBeGreaterThanOrEqual(rail.y);
      expect(nav.y + nav.height).toBeLessThanOrEqual(rail.y + rail.height);
      await page.locator('.ln-row[href="/skills"]').click();
      await expect(page).toHaveURL(/\/skills$/);
    }

    for (const path of ["/skills", "/assets", "/projects", "/image", "/video"]) {
      await page.goto(path);
      await expect(page.locator(".feature-page, .page-content, .wb-main").first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "页面遇到异常", exact: true })).toHaveCount(0);
      await expectNoClipping(page, ".ln-label, .outline-button, .primary-button, .segmented button");
      await page.screenshot({ path: testInfo.outputPath(`${path.slice(1)}.png`), fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}

test("bundled rounded UI fonts remain available without Google Fonts", async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("https://fonts.gstatic.com/**", route => route.abort());
  await page.goto("/dashboard");
  await expect(page.locator(".ln-label").first()).toBeVisible();
  const weights = await page.evaluate(async () => {
    await document.fonts.ready;
    const results: boolean[] = [];
    for (const weight of [400, 500, 700]) {
      const faces = await document.fonts.load(`${weight} 13px "Studio UI"`, "工作台画布工坊素材与语言");
      results.push(faces.length > 0 && faces.every(face => face.status === "loaded"));
    }
    return results;
  });
  expect(weights).toEqual([true, true, true]);
});
