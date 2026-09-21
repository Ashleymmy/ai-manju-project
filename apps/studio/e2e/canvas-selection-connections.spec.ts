import { expect, test, type Locator, type Page } from "@playwright/test";

async function dragTo(page: Page, handle: Locator, point: { x: number; y: number }) {
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x, point.y, { steps: 12 });
  await page.mouse.up();
}

async function setup(page: Page, zoom: number) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const poster = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#467e68";
    ctx.fillRect(0, 0, 320, 240);
    ctx.fillStyle = "#ecd05e";
    ctx.fillRect(45, 40, 230, 160);
    return canvas.toDataURL("image/png");
  });
  const project = { id: "selection-connections-qa", title: "Selection QA", scope: "personal", owner_id: "qa" };
  let snapshot: any = {
    schema: "ai-manhua-studio-canvas", version: 3,
    nodes: [
      { id: "a", kind: "image", title: "Reference A", content: "", imageSrc: poster, x: 140, y: 140, width: 240, height: 180 },
      { id: "b", kind: "image", title: "Reference B", content: "", imageSrc: poster, x: 460, y: 260, width: 240, height: 180 },
      { id: "target", kind: "image", title: "Target", content: "", x: 1060, y: 180, width: 240, height: 180 },
    ],
    edges: [], connections: [], groups: [], zoom, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: zoom / 100 },
  };
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "qa-token");
    localStorage.setItem("ai-manju:token-store", "local");
  });
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
    if (url.pathname === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active" };
    else if (url.pathname === "/api/announcements/current") data = null;
    else if (url.pathname === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (url.pathname === `/api/projects/${project.id}/snapshot`) {
      if (request.method() === "PUT") snapshot = request.postDataJSON().data;
      data = { project_id: project.id, version: 1, data: snapshot };
    } else if (url.pathname === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
    else if (url.pathname === "/api/projects") data = { items: [project], total: 1 };
    if (url.pathname === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data, request_id: "selection-qa" } });
  });
  await page.goto(`/canvas/${project.id}?scope=personal`);
  await expect(page.locator('[data-node-id="a"]')).toBeVisible();
  const notice = page.getByRole("button", { name: "知道了", exact: true });
  if (await notice.isVisible()) await notice.click();
  const select = async () => {
    const a = (await page.locator('[data-node-id="a"]').boundingBox())!;
    const b = (await page.locator('[data-node-id="b"]').boundingBox())!;
    await page.mouse.move(a.x - 30, a.y - 40);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width + 15, b.y + b.height + 15, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator(".canvas-group-frame.pending")).toBeVisible();
    await expect(page.locator('.real-canvas-node[data-node-id="a"] .canvas-node-handle')).toHaveCount(0);
    await expect(page.locator('.real-canvas-node[data-node-id="b"] .canvas-node-handle')).toHaveCount(0);
  };
  return { select, get snapshot() { return snapshot; }, errors };
}

for (const zoom of [50, 80, 100]) {
  test(`temporary selection has shared ports at ${zoom}% and restores individual ports on cancel`, async ({ page }, testInfo) => {
    const fixture = await setup(page, zoom);
    await fixture.select();
    const frame = page.locator(".canvas-group-frame.pending");
    const left = frame.getByRole("button", { name: "连接到选区", exact: true });
    const right = frame.getByRole("button", { name: "从选区连接", exact: true });
    await expect(left).toHaveCSS("opacity", "1");
    await expect(right).toHaveCSS("pointer-events", "auto");
    const bounds = (await frame.boundingBox())!;
    for (const [port, side] of [[left, "left"], [right, "right"]] as const) {
      const box = (await port.boundingBox())!;
      expect(Math.abs(box.y + box.height / 2 - (bounds.y + bounds.height / 2))).toBeLessThan(1);
      expect(box.width).toBeCloseTo(22 * zoom / 100, 0);
      if (side === "left") expect(box.x + box.width).toBeLessThan(bounds.x);
      else expect(box.x).toBeGreaterThan(bounds.x + bounds.width);
    }
    await page.screenshot({ path: testInfo.outputPath("temporary-selection.png") });
    if (zoom === 50) {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(left).toBeInViewport();
      await expect(right).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath("temporary-selection-mobile.png") });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await frame.getByRole("button", { name: "取消", exact: true }).click();
    await expect(frame).toHaveCount(0);
    await expect(page.locator('[data-node-id="a"] .canvas-node-handle')).toHaveCount(2);
    await fixture.select();
    await frame.getByRole("button", { name: "组成分组", exact: true }).click();
    await expect(page.locator(".canvas-group-frame.pending")).toHaveCount(0);
    await expect(page.locator(".canvas-group-connection-handle")).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath("confirmed-group.png") });
    const target = (await page.locator('[data-node-id="target"]').boundingBox())!;
    const confirmedPort = page.getByRole("button", { name: "从分组连接", exact: true });
    const targetPoint = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    await dragTo(page, confirmedPort, targetPoint);
    await expect.poll(() => fixture.snapshot.edges?.length).toBe(2);
    await dragTo(page, confirmedPort, targetPoint);
    await expect(page.locator(".canvas-group-connection-handle")).toHaveCount(2);
    expect(fixture.snapshot.edges).toHaveLength(2);
    expect(fixture.errors).toEqual([]);
  });
}

for (const side of ["source", "target"] as const) {
  test(`selection ${side} port connects every member to an existing node and to a new node`, async ({ page }, testInfo) => {
    const fixture = await setup(page, 80);
    await fixture.select();
    const port = page.locator(`.canvas-group-frame.pending .canvas-group-connection-handle.${side}`);
    const target = (await page.locator('[data-node-id="target"]').boundingBox())!;
    await dragTo(page, port, { x: target.x + target.width / 2, y: target.y + target.height / 2 });
    const expected = side === "source" ? ["a->target", "b->target"] : ["target->a", "target->b"];
    const edgePairs = () => (fixture.snapshot.edges || []).map((edge: any) => `${edge.from}->${edge.to}`).sort();
    await expect.poll(edgePairs).toEqual(expected);
    expect(fixture.snapshot.groups).toEqual([]);
    await expect(page.locator(".real-canvas-edge-hit")).toHaveCount(1);
    await expect(page.locator(".canvas-group-frame.pending")).toBeVisible();
    await dragTo(page, port, { x: 740, y: 720 });
    const menu = page.locator(".canvas-connection-create-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("button")).toHaveText(["新建图片", "新建视频", "新建文本", "新建音频", "取消连接"]);
    await page.screenshot({ path: testInfo.outputPath("connection-create-menu.png") });
    await menu.getByRole("button", { name: "新建图片", exact: true }).click();
    await expect.poll(() => fixture.snapshot.nodes.length).toBe(4);
    const created = fixture.snapshot.nodes.find((node: any) => !["a", "b", "target"].includes(node.id)).id;
    const added = side === "source" ? [`a->${created}`, `b->${created}`] : [`${created}->a`, `${created}->b`];
    await expect.poll(edgePairs).toEqual([...expected, ...added].sort());
    expect(fixture.snapshot.groups).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("selection-connections.png") });
    expect(fixture.errors).toEqual([]);
  });
}

test("click-connect and dropping onto a selection port both connect all members", async ({ page }) => {
  const fixture = await setup(page, 80);
  await fixture.select();
  const frame = page.locator(".canvas-group-frame.pending");
  await frame.getByRole("button", { name: "从选区连接", exact: true }).click();
  await page.locator('[data-node-id="target"]').click({ position: { x: 80, y: 80 } });
  await expect.poll(() => fixture.snapshot.edges?.length).toBe(2);
  await expect(frame).toBeVisible();
  const left = (await frame.getByRole("button", { name: "连接到选区", exact: true }).boundingBox())!;
  const target = page.locator('[data-node-id="target"]');
  await target.hover();
  await dragTo(page, target.getByRole("button", { name: "从此节点连接", exact: true }), { x: left.x + left.width / 2, y: left.y + left.height / 2 });
  await expect.poll(() => fixture.snapshot.edges?.length).toBe(4);
  expect(fixture.snapshot.edges.map((edge: any) => `${edge.from}->${edge.to}`).sort()).toEqual(["a->target", "b->target", "target->a", "target->b"]);
  await frame.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator(".real-canvas-edge-hit")).toHaveCount(4);
  expect(fixture.errors).toEqual([]);
});

test("Ctrl multi-selection still connects a new node without a temporary frame", async ({ page }) => {
  const fixture = await setup(page, 80);
  const a = page.locator('[data-node-id="a"]');
  const b = page.locator('[data-node-id="b"]');
  await a.click();
  await page.getByRole("button", { name: "关闭面板", exact: true }).click();
  await b.click({ modifiers: ["Control"] });
  await expect(page.locator(".real-canvas-node.selected")).toHaveCount(2);
  await expect(page.locator(".canvas-group-frame")).toHaveCount(0);
  await dragTo(page, b.getByRole("button", { name: "从此节点连接", exact: true }), { x: 740, y: 720 });
  await page.locator(".canvas-connection-create-menu").getByRole("button", { name: "新建图片", exact: true }).click();
  await expect.poll(() => fixture.snapshot.nodes.length).toBe(4);
  const created = fixture.snapshot.nodes.find((node: any) => !["a", "b", "target"].includes(node.id)).id;
  expect(fixture.snapshot.edges.map((edge: any) => `${edge.from}->${edge.to}`).sort()).toEqual([`a->${created}`, `b->${created}`]);
  expect(fixture.errors).toEqual([]);
});

for (const [kind, label] of [["image", "新建图片"], ["video", "新建视频"], ["text", "新建文本"], ["audio", "新建音频"]] as const) {
  test(`connection menu creates the selected ${kind} kind and retains all references`, async ({ page }) => {
    const fixture = await setup(page, 80);
    await fixture.select();
    await dragTo(page, page.getByRole("button", { name: "从选区连接", exact: true }), { x: 740, y: 600 });
    const menu = page.locator(".canvas-connection-create-menu");
    await expect(menu.getByRole("button")).toHaveText(["新建图片", "新建视频", "新建文本", "新建音频", "取消连接"]);
    await menu.getByRole("button", { name: label, exact: true }).click();
    await expect.poll(() => fixture.snapshot.nodes.length).toBe(4);
    const created = fixture.snapshot.nodes.find((node: any) => !["a", "b", "target"].includes(node.id));
    expect(created.kind).toBe(kind);
    expect(fixture.snapshot.edges.map((edge: any) => `${edge.from}->${edge.to}`).sort()).toEqual([`a->${created.id}`, `b->${created.id}`]);
    expect(fixture.errors).toEqual([]);
  });
}
