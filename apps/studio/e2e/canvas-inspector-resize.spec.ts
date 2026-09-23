import { expect, test, type Locator, type Page } from "@playwright/test";

async function closeInitialInspector(page: Page) {
  const close = page.getByRole("button", { name: "关闭面板", exact: true });
  if (await close.isVisible()) await close.click();
}

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
      // This node supplies mention content; keep its toolbar outside the resize scenarios.
      { id: "reference", kind: "text", title: "参考", content: "人物三视图", x: -500, y: -500, width: 180, height: 120 },
      { id: "image", kind: "image", title: "提示词面板缩放", content: "", x: 450, y: 60, width: 320, height: 180,
        metadata: { composerContent: "@[node:reference] 人物展示以正常姿态展示，以左边为大头特写，中间为人物三视图，并加入不同表情。\n" + "保持角色一致，镜头缓慢推进，人物自然转身。\n".repeat(80) } },
    ],
    edges: [{ id: "edge", from: "reference", to: "image" }], connections: [], groups: [],
    zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 },
  };
  await page.addInitScript(() => {
    if (!window.location.protocol.startsWith("http")) return;
    localStorage.setItem("ai-manju:auth_token", "qa-token");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  // External font loading must not block each canvas navigation in local layout QA.
  await page.route("https://fonts.googleapis.com/**", route => route.fulfill({ contentType: "text/css", body: "" }));
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
  await page.goto(`/canvas/${project.id}?scope=personal`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-node-id="image"] .node-float-label').click();
  const panel = page.locator(".inspector-panel.inspector-floating");
  const editor = panel.locator("textarea.node-card-prompt");
  await expect(panel).toBeVisible();
  await panel.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  const original = (await panel.boundingBox())!;
  const nodeBox = (await page.locator('[data-node-id="image"]').boundingBox())!;
  expect(original.y).toBeGreaterThan(nodeBox.y + nodeBox.height);
  expect(original.height).toBeLessThanOrEqual(320);
  expect(await editor.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await panel.locator('.canvas-mention-overlay').hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => editor.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect((await panel.boundingBox())!.height).toBeCloseTo(original.height, 0);
  await page.screenshot({ path: testInfo.outputPath("long-prompt-contained.png") });
  await drag(page, panel.getByRole("button", { name: "拖动调整面板宽度", exact: true }), 80, 0);
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(original.width + 160, 0);
  const beforeHeight = (await panel.boundingBox())!;
  expect(beforeHeight.x).toBeCloseTo(original.x - 80, 0);
  expect(beforeHeight.x + beforeHeight.width / 2).toBeCloseTo(nodeBox.x + nodeBox.width / 2, 0);
  const beforeEditor = (await editor.boundingBox())!;
  await drag(page, panel.getByRole("button", { name: "拖动调整面板高度", exact: true }), 0, 100);
  const tall = (await panel.boundingBox())!;
  expect(tall.height).toBeCloseTo(beforeHeight.height + 100, 0);
  expect(tall.width).toBeCloseTo(beforeHeight.width, 0);
  expect((await editor.boundingBox())!.height).toBeGreaterThan(beforeEditor.height + 90);
  await drag(page, panel.getByRole("button", { name: "拖动自由调整面板大小", exact: true }), 180, 40);
  const widened = (await panel.boundingBox())!;
  expect(widened.width).toBeCloseTo(tall.width + 360, 0);
  expect(widened.height).toBeCloseTo(tall.height + 40, 0);
  expect(widened.x).toBeCloseTo(tall.x - 180, 0);
  expect(widened.y).toBeCloseTo(tall.y, 0);
  await page.screenshot({ path: testInfo.outputPath("inspector-centered-wide.png") });
  await drag(page, panel.getByRole("button", { name: "拖动自由调整面板大小", exact: true }), -90, -40);
  const scaled = (await panel.boundingBox())!;
  expect(scaled.width).toBeCloseTo(widened.width - 180, 0);
  expect(scaled.height).toBeCloseTo(tall.height, 0);
  expect(scaled.x).toBeCloseTo(widened.x + 90, 0);
  expect(scaled.x + scaled.width / 2).toBeCloseTo(nodeBox.x + nodeBox.width / 2, 0);
  const metadata = () => snapshot.nodes.find((node: any) => node.id === "image").metadata;
  await expect.poll(() => metadata().promptPanelHeight).toBeCloseTo(scaled.height, 0);
  expect(metadata().composerContent).toContain("@[node:reference]");
  await page.screenshot({ path: testInfo.outputPath("inspector-resized.png") });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-node-id="image"] .node-float-label').click();
  await expect.poll(async () => (await panel.boundingBox())!.height).toBeCloseTo(scaled.height, 0);
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(scaled.width, 0);
  // A shorter viewport must keep the controls and resize handles reachable.
  await page.setViewportSize({ width: 800, height: 500 });
  await expect(panel.getByRole("button", { name: "拖动自由调整面板大小", exact: true })).toBeInViewport();
  await expect(panel.getByRole("button", { name: "生成", exact: true })).toBeInViewport();
  // Near either viewport edge, the handle follows the mouse through clamping and back to center.
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const x of [60, 1060]) {
    await page.goto("about:blank");
    project.id = `inspector-centered-edge-${x}`;
    snapshot = { ...snapshot, nodes: snapshot.nodes.map((node: any) => node.id === "image" ? { ...node, x,
      metadata: { ...node.metadata, promptPanelWidth: 340, promptPanelHeight: 320 } } : node) };
    await page.goto(`/canvas/${project.id}?scope=personal`, { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-node-id="image"]')).toBeVisible();
    await closeInitialInspector(page);
    await page.locator('[data-node-id="image"] .node-float-label').click();
    await panel.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
    const narrow = (await panel.boundingBox())!;
    const direction = x === 60 ? 1 : -1;
    expect(await panel.evaluate(element => getComputedStyle(element).getPropertyValue('--inspector-resize-x').trim())).toBe(String(direction));
    const widthHandle = panel.getByRole("button", { name: "拖动调整面板宽度", exact: true });
    await drag(page, widthHandle, direction * 200, 0);
    const wide = (await panel.boundingBox())!;
    const edge = (box: typeof wide) => direction > 0 ? box.x + box.width : box.x;
    expect(edge(wide) - edge(narrow)).toBeCloseTo(direction * 200, 0);
    expect(wide.width - narrow.width).toBeGreaterThan(200);
    expect(wide.width - narrow.width).toBeLessThan(400);
    expect(wide.height).toBeCloseTo(narrow.height, 0);
    await page.screenshot({ path: testInfo.outputPath(`inspector-centered-edge-${x}.png`) });
    await drag(page, widthHandle, -direction * 200, 0);
    const restored = (await panel.boundingBox())!;
    expect(restored.width).toBeCloseTo(narrow.width, 0);
    expect(restored.x).toBeCloseTo(narrow.x, 0);
  }
  // A tall video leaves no room below; its long prompt must move beside it.
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const zoom of [50, 100, 200]) {
    await page.goto("about:blank");
    project.id = `inspector-video-${zoom}`;
    snapshot = { ...snapshot, zoom, viewport: { x: 0, y: 0, k: zoom / 100 },
      nodes: snapshot.nodes.map((node: any) => node.id === "image" ? { ...node, kind: "video", x: 100, y: 200, width: 420, height: 620,
        metadata: { ...node.metadata, generationMode: "video" } } : node) };
    await page.goto(`/canvas/${project.id}?scope=personal`, { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-node-id="image"]')).toBeVisible();
    await closeInitialInspector(page);
    await page.locator('[data-node-id="image"] .node-float-label').click();
    await expect(page.locator('.canvas-bottom-tools b')).toHaveText(`${zoom}%`);
    // Focus/scrollIntoView must not introduce a second, untracked canvas offset.
    expect(await page.getByRole("region", { name: "画布", exact: true }).evaluate(stage => {
      stage.scrollTo(200, 400);
      return [stage.scrollLeft, stage.scrollTop];
    })).toEqual([0, 0]);
    await expect.poll(async () => {
      const p = (await panel.boundingBox())!, n = (await page.locator('[data-node-id="image"]').boundingBox())!;
      return p.x + p.width <= n.x || p.x >= n.x + n.width || p.y + p.height <= n.y || p.y >= n.y + n.height;
    }).toBe(true);
    await expect(panel.getByRole("button", { name: "拖动自由调整面板大小", exact: true })).toBeInViewport();
    if (zoom === 100) await page.screenshot({ path: testInfo.outputPath("video-prompt-beside-node.png") });
  }
  // A right-edge node must keep the panel next to it, including outward resizing.
  await page.goto("about:blank");
  project.id = "inspector-right-edge";
  snapshot = { ...snapshot, zoom: 100, viewport: { x: 0, y: 0, k: 1 },
    nodes: snapshot.nodes.map((node: any) => node.id === "image" ? { ...node, kind: "image", x: 1000, y: 400, width: 360, height: 400,
      metadata: { ...node.metadata, generationMode: "image", promptPanelWidth: 560, promptPanelHeight: 320 } } : node) };
  await page.goto(`/canvas/${project.id}?scope=personal`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-node-id="image"]')).toBeVisible();
  await closeInitialInspector(page);
  await page.locator('[data-node-id="image"] .node-float-label').click();
  await panel.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  const gap = async () => {
    const p = (await panel.boundingBox())!, n = (await page.locator('[data-node-id="image"]').boundingBox())!;
    return n.x - p.x - p.width;
  };
  await expect.poll(gap).toBeCloseTo(12, 0);
  const near = (await panel.boundingBox())!;
  const corner = panel.getByRole("button", { name: "拖动自由调整面板大小", exact: true });
  expect((await corner.boundingBox())!.x).toBeCloseTo(near.x + 1, 0);
  await drag(page, corner, -140, 60);
  const expanded = (await panel.boundingBox())!;
  expect(expanded.width).toBeCloseTo(near.width + 140, 0);
  expect(expanded.height).toBeCloseTo(near.height + 60, 0);
  await expect.poll(gap).toBeCloseTo(12, 0);
  await expect.poll(() => metadata().promptPanelWidth).toBeCloseTo(expanded.width, 0);
  await page.screenshot({ path: testInfo.outputPath("right-edge-panel-adjacent.png") });
  await page.reload({ waitUntil: "domcontentloaded" });
  await closeInitialInspector(page);
  await page.locator('[data-node-id="image"] .node-float-label').click();
  await expect.poll(gap).toBeCloseTo(12, 0);
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(expanded.width, 0);
  // Below stays the first choice even when it is shorter than the saved panel.
  await page.goto("about:blank");
  project.id = "inspector-below-priority";
  snapshot = { ...snapshot, nodes: snapshot.nodes.map((node: any) => node.id === "image" ? { ...node, x: 100, y: 100, width: 400, height: 558,
    metadata: { ...node.metadata, promptPanelWidth: 600, promptPanelHeight: 500 } } : node) };
  await page.goto(`/canvas/${project.id}?scope=personal`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-node-id="image"]')).toBeVisible();
  await closeInitialInspector(page);
  await page.locator('[data-node-id="image"] .node-float-label').click();
  await expect.poll(async () => {
    const p = (await panel.boundingBox())!, n = (await page.locator('[data-node-id="image"]').boundingBox())!;
    return p.y - n.y - n.height;
  }).toBeCloseTo(12, 0);
  expect((await panel.boundingBox())!.height).toBeLessThan(320);
  await expect(panel.getByRole("button", { name: "生成", exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("below-priority-compact.png") });
  // Failed media nodes keep long prompts in the editor, including crowded viewports
  // where the old fallback placed the editor directly over the selected node.
  for (const scenario of [
    { kind: "video", width: 846, height: 555, x: 140, y: 140, nodeWidth: 550, nodeHeight: 160 },
    { kind: "image", width: 846, height: 555, x: 140, y: 140, nodeWidth: 550, nodeHeight: 160 },
    { kind: "video", width: 1440, height: 1000, x: 20, y: 20, nodeWidth: 1600, nodeHeight: 1000 },
    { kind: "image", width: 390, height: 640, x: 20, y: 20, nodeWidth: 500, nodeHeight: 500 },
  ]) {
    await page.goto("about:blank");
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    project.id = `inspector-clearance-${scenario.kind}-${scenario.width}`;
    const prompt = "@[node:reference] 镜号1：镜头缓慢推进，保持角色一致。\n".repeat(100);
    snapshot = { ...snapshot, zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 },
      nodes: snapshot.nodes.map((node: any) => node.id === "image" ? { ...node, kind: scenario.kind,
        x: scenario.x, y: scenario.y, width: scenario.nodeWidth, height: scenario.nodeHeight, content: prompt,
        metadata: { generationMode: scenario.kind, composerContent: prompt, status: "error", errorDetails: "生成失败，请稍后重试。".repeat(30) } } : node) };
    await page.goto(`/canvas/${project.id}?scope=personal`, { waitUntil: "domcontentloaded" });
    const card = page.locator('[data-node-id="image"]');
    await expect(card.locator(".node-media-placeholder")).toBeVisible();
    await closeInitialInspector(page);
    await card.locator(".node-media-placeholder p").click();
    await expect(panel).toBeVisible();
    await expect(editor).toHaveValue(/镜号1：镜头缓慢推进，保持角色一致/);
    await expect(editor).toBeInViewport();
    expect((await editor.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await expect(card).not.toContainText("镜号1");
    await expect(card.locator(".node-inline-editor")).toHaveCount(0);
    await expect(card.getByRole("button", { name: scenario.kind === "video" ? "上传视频" : "上传图片", exact: true })).toBeInViewport();
    await expect.poll(async () => {
      const p = (await panel.boundingBox())!, n = (await card.boundingBox())!;
      return p.x + p.width <= n.x || p.x >= n.x + n.width || p.y + p.height <= n.y || p.y >= n.y + n.height;
    }).toBe(true);
    await expect.poll(() => card.evaluate(element => {
      const box = element.getBoundingClientRect();
      return Array.from(element.querySelectorAll('.node-media-placeholder, .node-error-box')).every(child => child.getBoundingClientRect().bottom <= box.bottom + 1);
    })).toBe(true);
    expect(snapshot.nodes.find((node: any) => node.id === "image")).toMatchObject({ x: scenario.x, y: scenario.y, width: scenario.nodeWidth, height: scenario.nodeHeight, metadata: { composerContent: prompt } });
    await page.screenshot({ path: testInfo.outputPath(`clearance-${scenario.kind}-${scenario.width}.png`) });
    if (scenario.width === 846 && scenario.kind === "video") {
      await drag(page, card.locator(".node-media-placeholder p"), 150, 140);
      await expect.poll(async () => {
        const p = (await panel.boundingBox())!, n = (await card.boundingBox())!;
        return p.x + p.width <= n.x || p.x >= n.x + n.width || p.y + p.height <= n.y || p.y >= n.y + n.height;
      }).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("clearance-after-node-drag.png") });
    }
  }
  expect(errors).toEqual([]);
});
