import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page) {
  const errors: string[] = [];
  const originalNodes = Array.from({ length: 155 }, (_, i) => ({
    id: `node-${i}`, type: "text", title: `分镜 ${i + 1}`, content: "镜头内容",
    position: { x: 160 + (i % 16) * 200, y: 100 + Math.floor(i / 16) * 150 },
    width: 160, height: 100, metadata: {},
  }));
  let snapshot: any = { schema: "ai-manhua-studio-canvas", version: 3,
    nodes: structuredClone(originalNodes), edges: [], connections: [], groups: [],
    zoom: 20, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 0.2 } };
  let saveCount = 0;
  const project = { id: "minimap-qa", title: "小地图拖动验收", scope: "personal", owner_id: "qa" };
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "qa-token");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin,
      "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "authorization,content-type,x-request-id",
      "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS" };
    if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active" };
    else if (path === "/api/announcements/current") data = null;
    else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (path === "/api/ai/models") data = { models: [] };
    else if (path === "/api/projects/minimap-qa/snapshot") {
      if (request.method() === "PUT") { snapshot = request.postDataJSON().data; saveCount++; }
      data = { project_id: project.id, version: 1, data: snapshot };
    } else if (path === "/api/projects/minimap-qa") data = { ...project, data: snapshot };
    else if (path === "/api/projects") data = { items: [project], total: 1 };
    if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data, request_id: "minimap-qa" } });
  });
  await page.goto("/canvas/minimap-qa");
  await expect(page.locator('[data-node-id="node-0"]')).toBeVisible();
  const notice = page.getByRole("button", { name: "知道了", exact: true });
  if (await notice.isVisible()) await notice.click();
  await page.getByRole("button", { name: "打开缩略导航", exact: true }).click();
  await expect(page.locator(".canvas-minimap rect:not(.viewport)")).toHaveCount(155);
  return { errors, get snapshot() { return snapshot; }, get saveCount() { return saveCount; }, originalNodes };
}

async function transform(page: Page) {
  return page.locator(".real-canvas-grid").evaluate(element => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f, zoom: matrix.a };
  });
}

for (const width of [1920, 390]) {
  test(`minimap follows continuous mouse dragging without moving nodes at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 945 });
    const fixture = await setup(page);
    // Stage nodes are culled offscreen; the minimap retains the full selection.
    const selection = () => page.locator(".canvas-minimap rect:not(.viewport)").evaluateAll(nodes => nodes.flatMap((node, index) => node.classList.contains("selected") ? [index] : []));
    const selectedBefore = await selection();
    const map = page.locator(".canvas-minimap");
    const rect = (await map.locator("rect.viewport").boundingBox())!;
    const svg = (await map.locator("svg").boundingBox())!;
    const mapBounds = (await map.boundingBox())!;
    expect(mapBounds.x).toBeGreaterThanOrEqual(0);
    expect(mapBounds.x + mapBounds.width).toBeLessThanOrEqual(width);
    // SVG boundingBox includes the non-scaling stroke; use the actual viewport size.
    const viewportWidth = await map.locator("rect.viewport").evaluate(element => {
      const rect = element as SVGRectElement;
      return rect.width.baseVal.value * rect.getScreenCTM()!.a;
    });
    expect(rect.width).toBeLessThanOrEqual(svg.width / 2 + 1);
    expect(rect.height).toBeLessThanOrEqual(svg.height / 2 + 1);
    const start = { x: rect.x + rect.width * 0.35, y: rect.y + rect.height * 0.4 };
    const before = await transform(page);
    const mapNodes = await map.locator("rect:not(.viewport)").evaluateAll(nodes => nodes.map(node => [node.getAttribute("x"), node.getAttribute("y")]));
    const stage = (await page.locator(".real-canvas-stage").boundingBox())!;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    expect(await transform(page)).toEqual(before);
    for (const step of [1, 2, 3]) {
      await page.mouse.move(start.x + 10 * step, start.y - 4 * step, { steps: 3 });
      await expect.poll(async () => (await transform(page)).x).toBeLessThan(before.x);
      const current = await transform(page);
      expect(current.zoom).toBe(before.zoom);
      expect(current.x).toBeCloseTo(before.x - 10 * step / viewportWidth * stage.width, 0);
      expect(await map.locator("rect:not(.viewport)").evaluateAll(nodes => nodes.map(node => [node.getAttribute("x"), node.getAttribute("y")]))).toEqual(mapNodes);
      expect(await selection()).toEqual(selectedBefore);
    }
    await page.screenshot({ path: testInfo.outputPath(`minimap-drag-${width}.png`) });
    // Pointer capture keeps navigation responsive even outside the map.
    await page.mouse.move(svg.x + svg.width + 30, svg.y - 15, { steps: 5 });
    const outside = await transform(page);
    expect(await selection()).toEqual(selectedBefore);
    await page.mouse.up();
    await expect(map).not.toHaveClass(/is-dragging/);
    expect(await selection()).toEqual(selectedBefore);
    await page.mouse.move(svg.x + 15, svg.y + 15);
    expect(await transform(page)).toEqual(outside);
    const after = await transform(page);
    await map.locator("svg").click({ position: { x: 20, y: 20 } });
    expect(await transform(page)).not.toEqual(after);
    expect((await transform(page)).zoom).toBe(before.zoom);
    expect(await selection()).toEqual(selectedBefore);
    await expect(page.locator(".canvas-context-menu, .canvas-selection-box")).toHaveCount(0);
    const savesBefore = fixture.saveCount;
    await page.getByRole("button", { name: "手动同步到服务端快照（占位，自动同步已开启）", exact: true }).click();
    await expect.poll(() => fixture.saveCount).toBeGreaterThan(savesBefore);
    expect(fixture.snapshot.nodes.length).toBe(155);
    expect(fixture.snapshot.nodes.map((node: any) => ({ id: node.id, position: node.position, width: node.width, height: node.height })))
      .toEqual(fixture.originalNodes.map(({ id, position, width, height }) => ({ id, position, width, height })));
    expect(fixture.errors).toEqual([]);
  });
}

test("touch dragging and cancellation release the minimap", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await setup(page);
  const cdp = await page.context().newCDPSession(page);
  const rect = (await page.locator(".canvas-minimap rect.viewport").boundingBox())!;
  const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const before = await transform(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...start, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + 25, y: start.y - 15, id: 1 }] });
  await expect.poll(async () => (await transform(page)).x).toBeLessThan(before.x);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await expect(page.locator(".canvas-minimap")).not.toHaveClass(/is-dragging/);
  await page.screenshot({ path: testInfo.outputPath("minimap-touch.png") });
  await page.getByRole("button", { name: "关闭缩略导航", exact: true }).click();
  await expect(page.locator(".canvas-minimap")).toHaveCount(0);
  await page.getByRole("button", { name: "打开缩略导航", exact: true }).click();
  await expect(page.locator(".canvas-minimap")).toBeVisible();
  expect(fixture.errors).toEqual([]);
  await cdp.detach();
});
