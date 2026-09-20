import { expect, test, type Locator } from "@playwright/test";

test("Ctrl wheel zooms only the canvas and keeps panels, dialogs and browser scale stable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const project = { id: "wheel-qa", title: "画布滚轮缩放验收", scope: "personal", owner_id: "qa" };
  let snapshot: any = {
    schema: "ai-manhua-studio-canvas", version: 3,
    nodes: [{ id: "image", kind: "image", title: "缩放验收节点", content: "", x: 350, y: 120, width: 280, height: 180,
      metadata: { composerContent: Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 行提示词`).join("\n") } }],
    edges: [], connections: [], groups: [], zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 },
  };
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "qa-token");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  // Only test fixtures are read/saved. No real projects or generation requests are used.
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const headers = {
      "Access-Control-Allow-Origin": new URL(page.url()).origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "authorization,content-type,x-request-id",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    let data: unknown = { items: [], total: 0 };
    if (url.pathname === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active", display_name: "QA" };
    else if (url.pathname === "/api/user/preferences") data = { canvas: { promptPresets: [], wheelZoomRequiresCtrl: true } };
    else if (url.pathname === `/api/projects/${project.id}/snapshot`) {
      if (request.method() === "PUT") snapshot = request.postDataJSON().data;
      data = { project_id: project.id, version: 1, data: snapshot };
    } else if (url.pathname === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
    else if (url.pathname === "/api/projects") data = { items: [project], total: 1 };
    else if (url.pathname === "/api/ai/models") data = { image_models: [], text_models: [] };
    else if (url.pathname === "/api/asset-folders") data = [];
    if (url.pathname === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data, request_id: "wheel-qa" } });
  });
  await page.goto(`/canvas/${project.id}?scope=personal`);
  const stage = page.getByRole("region", { name: "画布", exact: true });
  const zoom = page.locator(".canvas-bottom-tools b").first();
  await expect(zoom).toHaveText("100%");
  const metrics = () => page.evaluate(() => ({ ratio: devicePixelRatio, width: innerWidth, height: innerHeight, scale: visualViewport?.scale }));
  const originalMetrics = await metrics();
  await page.evaluate(() => {
    (window as any).__wheelChecks = [];
    // Installed after the canvas guard, observe native/trusted events in capture phase.
    window.addEventListener("wheel", event => {
      (window as any).__wheelChecks.push({ prevented: event.defaultPrevented, trusted: event.isTrusted, ctrl: event.ctrlKey });
    }, { capture: true, passive: true });
  });
  async function ctrlWheel(target: Locator, deltaY = -100) {
    const box = (await target.boundingBox())!;
    const before = await page.evaluate(() => (window as any).__wheelChecks.length);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, deltaY);
    await page.keyboard.up("Control");
    await expect.poll(() => page.evaluate(() => (window as any).__wheelChecks.length)).toBeGreaterThan(before);
    expect(await page.evaluate(() => (window as any).__wheelChecks.at(-1))).toEqual({ prevented: true, trusted: true, ctrl: true });
    expect(await metrics()).toEqual(originalMetrics);
  }
  // The center of this empty stage is outside the node and floating toolbars.
  await ctrlWheel(stage);
  await expect(zoom).toHaveText("110%");
  await ctrlWheel(stage, 100);
  await expect(zoom).toHaveText("100%");

  await page.locator('[data-node-id="image"] .node-float-label').click();
  const inspector = page.locator(".inspector-panel.inspector-floating");
  await expect(inspector).toBeVisible();
  await inspector.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  const originalInspector = (await inspector.boundingBox())!;
  await ctrlWheel(inspector.locator("textarea.node-card-prompt"));
  await expect(zoom).toHaveText("100%");
  expect((await inspector.boundingBox())!.width).toBeCloseTo(originalInspector.width, 1);
  expect((await inspector.boundingBox())!.height).toBeCloseTo(originalInspector.height, 1);
  // Plain wheel continues to scroll a long prompt instead of zooming the page or canvas.
  const editor = inspector.locator("textarea.node-card-prompt");
  const scrollBefore = await editor.evaluate(element => element.scrollTop);
  await page.mouse.wheel(0, 250);
  await expect.poll(() => editor.evaluate(element => element.scrollTop)).toBeGreaterThan(scrollBefore);
  await expect(zoom).toHaveText("100%");

  await ctrlWheel(page.locator(".canvas-bottom-tools"));
  await expect(zoom).toHaveText("100%");
  await page.getByTitle("打开 Agent", { exact: true }).click();
  const agent = page.locator(".agent-panel");
  await expect(agent).toBeVisible();
  await agent.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  const originalAgent = (await agent.boundingBox())!;
  await ctrlWheel(agent.locator("textarea").last(), 200);
  expect((await agent.boundingBox())!.width).toBeCloseTo(originalAgent.width, 1);
  expect((await agent.boundingBox())!.height).toBeCloseTo(originalAgent.height, 1);
  await expect(zoom).toHaveText("100%");
  await agent.getByTitle("关闭对话", { exact: true }).click();
  await page.getByTitle("生成历史", { exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  const originalDialog = (await dialog.boundingBox())!;
  await ctrlWheel(dialog, 200);
  expect((await dialog.boundingBox())!.width).toBeCloseTo(originalDialog.width, 1);
  expect((await dialog.boundingBox())!.height).toBeCloseTo(originalDialog.height, 1);
  await expect(zoom).toHaveText("100%");
  await page.screenshot({ path: testInfo.outputPath("stable-dialog-after-ctrl-wheel.png") });
  expect(errors).toEqual([]);
});
