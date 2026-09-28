import { expect, test } from "@playwright/test";

for (const width of [1920, 1280, 900, 761, 390]) {
  test(`brand logo fits the header at ${width}px without moving other controls`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 945 });
    await page.addInitScript(() => {
      localStorage.setItem("ai-manju:auth_token", "brand-logo-qa");
      localStorage.setItem("ai-manju:token-store", "local");
    });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      if (request.headers().accept === "text/event-stream") return route.fulfill({ contentType: "text/event-stream", body: ":ok\n\n" });
      let data: unknown = { items: [], total: 0 };
      if (path === "/api/auth/me") data = { id: "brand-qa", account: "qa", display_name: "LocalAdmin", role: "super_admin", status: "active" };
      else if (path === "/api/user/preferences") data = {};
      else if (path === "/api/announcements/current") data = null;
      else if (path === "/api/asset-folders") data = [];
      await route.fulfill({ json: { success: true, data, request_id: "brand-qa" } });
    });
    await page.goto("/projects");
    await expect(page.locator(".topbar")).toBeVisible();
    const notice = page.getByRole("button", { name: "知道了", exact: true });
    if (await notice.isVisible()) await notice.click();
    const logo = page.getByRole("img", { name: "cloudto 云格", includeHidden: true });
    const header = page.locator(".topbar"), actions = page.locator(".top-actions");
    if (width > 760) {
      await expect(logo).toBeVisible();
      await expect(logo).toHaveJSProperty("complete", true);
      expect(await logo.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
      const rect = (await logo.boundingBox())!, bar = (await header.boundingBox())!;
      expect(rect.height).toBe(42);
      expect(rect.width / rect.height).toBeCloseTo(900 / 250, 2);
      expect(bar.height).toBe(82);
      // The header's 1px bottom border is outside its centered content box.
      expect(Math.abs(rect.y + rect.height / 2 - (bar.y + bar.height / 2))).toBeLessThan(1);
      const lockup = (await page.locator(".brand-lockup").boundingBox())!;
      const crumbs = (await page.locator(".crumbs").boundingBox())!;
      const buttons = (await actions.boundingBox())!;
      expect(rect.x + rect.width).toBeLessThanOrEqual(lockup.x + lockup.width);
      expect(rect.x + rect.width).toBeLessThan(crumbs.x);
      expect(crumbs.x + crumbs.width).toBeLessThanOrEqual(buttons.x);
      if (width === 1920) {
        const clip = { x: 0, y: 0, width: 550, height: 82 };
        const source = await (await page.request.get("/cloudto/logos/svg/logo-horizontal-on-dark.svg")).text();
        const groups = await page.evaluate(source => {
          const root = new DOMParser().parseFromString(source, "image/svg+xml").documentElement;
          return [...root.children].filter(element => element.tagName === "g").map(element => element.getAttribute("transform"));
        }, source);
        expect(groups).toEqual(["translate(6 12) scale(.96)", "translate(385 24) scale(1.36)", "translate(392 153) scale(2)"]);
        // Compare only the Chinese group at the same enlarged overall size.
        await logo.evaluate(async (element: HTMLImageElement, source) => {
          const doc = new DOMParser().parseFromString(source, "image/svg+xml");
          doc.getElementById("chinese-wordmark")!.setAttribute("transform", "translate(392 160) scale(1.5)");
          element.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(doc))}`;
          await element.decode();
        }, source);
        await page.screenshot({ path: info.outputPath("brand-before-chinese.png"), clip });
        expect(await header.boundingBox()).toEqual(bar);
        expect(await actions.boundingBox()).toEqual(buttons);
        await logo.evaluate(async (element: HTMLImageElement) => {
          element.src = "/cloudto/logos/svg/logo-horizontal-on-dark.svg";
          await element.decode();
        });
        await page.screenshot({ path: info.outputPath("brand-after.png"), clip });
      }
    } else {
      await expect(logo).toBeHidden();
      await expect(actions).toBeVisible();
    }
    await header.screenshot({ path: info.outputPath(`header-${width}.png`) });
    expect(errors).toEqual([]);
  });
}
