import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page) {
  const submissions: Array<{ path: string; body: string }> = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
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
      "Access-Control-Allow-Headers": "authorization,content-type,x-request-id,idempotency-key",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active" };
    else if (path === "/api/announcements/current") data = null;
    else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] }, generation: { size: "1:1" } };
    else if (path === "/api/ai/models") data = { models: [], image_models: ["gpt-image-2"], default_image_model: "gpt-image-2" };
    else if (path === "/api/member/quote") data = { credits: 20, params: { range_min: 10, range_max: 150 } };
    else if (/\/api\/ai\/image\/(generations|edits)$/.test(path)) {
      submissions.push({ path, body: request.postData() || "" });
      data = { job_id: `footer-job-${submissions.length}`, status: "queued" };
    } else if (/\/api\/jobs\/footer-job-/.test(path)) data = { id: path.split("/").at(-1), status: "running", progress: 25 };
    if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data, request_id: "image-footer-qa" } });
  });
  await page.goto("/image");
  await expect(page.locator(".image-generation-footer")).toBeVisible();
  const notice = page.getByRole("button", { name: "知道了", exact: true });
  if (await notice.isVisible()) await notice.click();
  await expect(page.getByRole("button", { name: "生成关键帧", exact: true })).toBeEnabled();
  await expect(page.locator(".image-generation-footer")).toContainText("10–150 积分 · 自动规格");
  return { submissions, errors };
}

for (const viewport of [{ width: 1920, height: 945 }, { width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`generation remains visible while settings scroll at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const fixture = await setup(page);
    const composer = page.locator(".image-composer");
    const scroller = page.getByRole("region", { name: "图片生成设置", exact: true });
    const footer = page.locator(".image-generation-footer");
    if (viewport.width <= 760) await composer.evaluate(element => element.scrollIntoView({ block: "end" }));
    const initial = (await footer.boundingBox())!;
    expect(initial.y).toBeGreaterThan(0);
    expect(initial.y + initial.height).toBeLessThanOrEqual(viewport.height);
    await expect(scroller).toBeVisible();
    const expectPinned = async () => {
      const rect = (await footer.boundingBox())!;
      expect(Math.abs(rect.y - initial.y)).toBeLessThan(1);
      expect(Math.abs(rect.height - initial.height)).toBeLessThan(1);
      const bounds = await scroller.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { bottom: rect.bottom, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
      });
      expect(bounds.bottom).toBeLessThanOrEqual(rect.y + 1);
      expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1);
    };
    await scroller.hover();
    await page.mouse.wheel(0, 2000);
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await expectPinned();
    await expect(scroller.getByRole("button", { name: "AUTO auto", exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`footer-bottom-${viewport.width}.png`) });
    await page.mouse.wheel(0, -3000);
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0);
    await expectPinned();
    await scroller.locator("textarea").fill("固定底栏生成验收");
    await page.screenshot({ path: testInfo.outputPath(`footer-top-${viewport.width}.png`) });
    const generate = page.getByRole("button", { name: "生成关键帧", exact: true });
    await generate.click();
    await expect(page.getByRole("button", { name: /生成中 25%/ })).toBeDisabled();
    expect(fixture.submissions).toHaveLength(1);
    expect(JSON.parse(fixture.submissions[0].body)).toMatchObject({ model: "gpt-image-2", size: "1024x1024", n: 1 });
    expect(JSON.parse(fixture.submissions[0].body).prompt).toContain("固定底栏生成验收");
    await expectPinned();
    await page.screenshot({ path: testInfo.outputPath(`footer-generating-${viewport.width}.png`) });
    await page.getByRole("button", { name: "停止", exact: true }).click();
    await expect(generate).toBeEnabled();

    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvV8AAAAASUVORK5CYII=", "base64");
    await page.locator('input[type="file"]').setInputFiles(Array.from({ length: 11 }, (_, index) => ({ name: `reference-${index}.png`, mimeType: "image/png", buffer: png })));
    await expect(page.locator(".reference-thumb")).toHaveCount(11);
    await expect.poll(() => page.locator(".reference-thumb img").evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await expectPinned();
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expectPinned();
    await expect(scroller.getByRole("button", { name: "AUTO auto", exact: true })).toBeInViewport();
    await scroller.evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath(`footer-references-${viewport.width}.png`) });
    await page.getByRole("button", { name: "生成编辑结果", exact: true }).click();
    await expect(page.getByRole("button", { name: /生成中 25%/ })).toBeDisabled();
    expect(fixture.submissions).toHaveLength(2);
    expect(fixture.submissions[1].path).toBe("/api/ai/image/edits");
    expect(fixture.submissions[1].body.match(/filename="reference-/g)).toHaveLength(11);
    await expectPinned();
    await page.getByRole("button", { name: "停止", exact: true }).click();
    await expect(page.getByRole("button", { name: "生成编辑结果", exact: true })).toBeEnabled();
    expect(fixture.errors).toEqual([]);
  });
}
