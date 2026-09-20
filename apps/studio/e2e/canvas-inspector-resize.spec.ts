import { expect, test, type Locator, type Page } from "@playwright/test";

async function drag(page: Page, handle: Locator, dx: number, dy: number) {
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}

test("inspector resizes in three directions, expands its editor and restores saved dimensions", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const project = { id: "inspector-resize-qa", title: "Inspector resize QA", scope: "personal", owner_id: "qa" };
  let snapshot: any = {
    schema: "ai-manhua-studio-canvas", version: 3,
    nodes: [
      { id: "reference", kind: "text", title: "参考", content: "人物三视图", x: 50, y: 50, width: 180, height: 120 },
      { id: "image", kind: "image", title: "提示词面板缩放", content: "", x: 450, y: 60, width: 320, height: 180,
        metadata: { composerContent: "@[node:reference] 人物展示以正常姿态展示，以左边为大头特写，中间为人物三视图，并加入不同表情。" } },
    ],
    edges: [{ id: "edge", from: "reference", to: "image" }], connections: [], groups: [],
    zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 },
  };
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "qa-token");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  // Isolate every API request so this test cannot edit a real project or start generation.
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
    else if (url.pathname === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (url.pathname === `/api/projects/${project.id}/snapshot`) {
      if (request.method() === "PUT") snapshot = request.postDataJSON().data;
      data = { project_id: project.id, version: 1, data: snapshot };
    } else if (url.pathname === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
    else if (url.pathname === "/api/projects") data = { items: [project], total: 1 };
    if (url.pathname === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data, request_id: "inspector-resize-qa" } });
  });
  await page.goto(`/canvas/${project.id}?scope=personal`);
  await page.locator('[data-node-id="image"] .node-float-label').click();
  const panel = page.locator(".inspector-panel.inspector-floating");
  const editor = panel.locator("textarea.node-card-prompt");
  await expect(panel).toBeVisible();
  await panel.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  const original = (await panel.boundingBox())!;
  await drag(page, panel.getByRole("button", { name: "拖动调整面板宽度", exact: true }), 80, 0);
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(original.width + 80, 0);
  const beforeHeight = (await panel.boundingBox())!;
  const beforeEditor = (await editor.boundingBox())!;
  await drag(page, panel.getByRole("button", { name: "拖动调整面板高度", exact: true }), 0, 100);
  const tall = (await panel.boundingBox())!;
  expect(tall.height).toBeCloseTo(beforeHeight.height + 100, 0);
  expect(tall.width).toBeCloseTo(beforeHeight.width, 0);
  expect((await editor.boundingBox())!.height).toBeGreaterThan(beforeEditor.height + 90);
  await drag(page, panel.getByRole("button", { name: "拖动等比缩放面板", exact: true }), 64, tall.height / 10);
  const scaled = (await panel.boundingBox())!;
  expect(scaled.width / scaled.height).toBeCloseTo(tall.width / tall.height, 2);
  expect(scaled.width).toBeGreaterThan(tall.width);
  const metadata = () => snapshot.nodes.find((node: any) => node.id === "image").metadata;
  await expect.poll(() => metadata().promptPanelHeight).toBeCloseTo(scaled.height, 0);
  expect(metadata().composerContent).toContain("@[node:reference]");
  await page.screenshot({ path: testInfo.outputPath("inspector-resized.png") });
  await page.reload();
  await page.locator('[data-node-id="image"] .node-float-label').click();
  await expect.poll(async () => (await panel.boundingBox())!.height).toBeCloseTo(scaled.height, 0);
  expect((await panel.boundingBox())!.width).toBeCloseTo(scaled.width, 0);
  // A shorter viewport must keep the controls and resize handles reachable.
  await page.setViewportSize({ width: 800, height: 500 });
  await expect(panel.getByRole("button", { name: "拖动等比缩放面板", exact: true })).toBeInViewport();
  await expect(panel.getByRole("button", { name: "生成", exact: true })).toBeInViewport();
  expect(errors).toEqual([]);
});
