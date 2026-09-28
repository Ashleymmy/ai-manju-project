import { expect, test } from "@playwright/test";

for (const width of [1600, 390]) {
  test(`node names follow group name zoom at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const project = { id: `label-zoom-${width}`, title: "名称缩放验收", scope: "personal", owner_id: "qa" };
    const kinds = ["image", "video", "audio", "text", "prompt", "note", "config", "director"];
    // Keep the fixture centered as the real zoom buttons zoom around the viewport center.
    const panX = width / 2 - 455 * .45;
    const panY = 500 - 645 * .45;
    const snapshot = {
      schema: "ai-manhua-studio-canvas", version: 3,
      nodes: kinds.map((kind, index) => ({
        id: kind, kind, title: `${kind}名称`, content: "", width: 260, height: 150,
        x: 120 + (index % 2) * 410, y: 240 + Math.floor(index / 2) * 220,
      })),
      groups: [{ id: "group", title: "分组名称", nodeIds: ["image", "video"], color: "#7dd3fc" }],
      edges: [], zoom: 45, panX, panY, viewport: { x: panX, y: panY, k: .45 },
    };
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("ai-manju:auth_token", "qa-token");
      localStorage.setItem("ai-manju:token-store", "local");
    });
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      if (request.headers().accept === "text/event-stream") return route.fulfill({ contentType: "text/event-stream", body: ":ok\n\n" });
      let data: unknown = { items: [], total: 0 };
      if (path === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active" };
      else if (path === "/api/announcements/current") data = null;
      else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
      else if (path === "/api/asset-folders") data = [];
      else if (path === `/api/projects/${project.id}/snapshot`) data = { project_id: project.id, version: 1, data: snapshot };
      else if (path === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
      else if (path === "/api/projects") data = { items: [project], total: 1 };
      if (path === "/api/prompts") return route.fulfill({ json: { items: [], total: 0 } });
      return route.fulfill({ json: { success: true, data, request_id: "label-zoom-qa" } });
    });
    await page.goto(`/canvas/${project.id}?scope=personal`);
    const toolbar = page.locator(".canvas-bottom-tools");
    await expect(toolbar.locator("b")).toHaveText("45%");
    await expect(page.locator(".node-float-label > b")).toHaveCount(kinds.length);
    const closeInspector = page.getByRole("button", { name: "关闭面板", exact: true });
    if (await closeInspector.isVisible()) await closeInspector.click();
    let currentZoom = 45;
    for (const zoom of [45, 25, 5, 75, 105, 155]) {
      while (currentZoom !== zoom) {
        const step = currentZoom < zoom ? 10 : -10;
        await toolbar.getByRole("button", { name: step > 0 ? "+" : "−", exact: true }).click();
        currentZoom += step;
        await expect(toolbar.locator("b")).toHaveText(`${currentZoom}%`);
      }
      const screenScale = zoom < 45 ? zoom / 45 : Math.max(1, zoom / 100);
      const names = page.locator(".node-float-label > b, .canvas-group-header > b");
      // Zooming around the viewport center legitimately culls offscreen nodes.
      const renderedNodes = await page.locator(".real-canvas-node").count();
      expect(renderedNodes).toBeGreaterThan(0);
      if (zoom <= 45) expect(renderedNodes).toBe(kinds.length);
      await expect(names).toHaveCount(renderedNodes + 1);
      await expect.poll(() => names.evaluateAll((elements, expected) => Math.max(...elements.map(element =>
        Math.abs(element.getBoundingClientRect().height / (element as HTMLElement).offsetHeight - expected)
      )), screenScale)).toBeLessThan(.005);
      for (const label of await page.locator(".node-float-label").all()) {
        await expect.poll(() => label.evaluate((element, zoom) => {
          const node = element.parentElement!;
          const innerTop = node.getBoundingClientRect().top + parseFloat(getComputedStyle(node).borderTopWidth) * zoom / 100;
          return innerTop - element.getBoundingClientRect().bottom;
        }, zoom)).toBeCloseTo(6 * screenScale, 0);
      }
      if (zoom === 25 || zoom === 75) await page.screenshot({ path: info.outputPath(`node-labels-${width}-${zoom}.png`) });
    }
    expect(errors).toEqual([]);
  });
}
