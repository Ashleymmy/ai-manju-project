import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("all node kinds share unique names and controls stay readable when zoomed out", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const image = readFileSync(new URL("../client/public/comic-lab-pack/stickers/sticker_nice.png", import.meta.url));
  const project = { id: "node-names-qa", title: "节点命名与缩放验收", scope: "personal", owner_id: "qa" };
  const kinds = ["image", "video", "audio", "text", "prompt", "note", "config", "director"];
  let snapshot: any = {
    schema: "ai-manhua-studio-canvas", version: 3,
    nodes: kinds.map((kind, index) => ({
      id: kind, kind, title: "苹果", content: "测试内容", x: index ? 3000 + index * 400 : 550, y: 300,
      width: 320, height: 240,
      ...(kind === "image" ? { imageAssetId: "apple", metadata: { assetId: "apple", titleEdited: true } } : {}),
    })),
    edges: [], groups: [], zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 },
  };
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "qa-token");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  // Every request is isolated; copies and saves cannot touch a real project.
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "authorization,content-type,x-request-id,idempotency-key", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS" };
    if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    if (path === "/api/assets/apple/content") return route.fulfill({ headers, contentType: "image/png", body: image });
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active" };
    else if (path === "/api/announcements/current") data = null;
    else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (path === "/api/asset-folders") data = [];
    else if (path === `/api/projects/${project.id}/snapshot`) {
      if (request.method() === "PUT") snapshot = request.postDataJSON().data;
      data = { project_id: project.id, version: 1, data: snapshot };
    } else if (path === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
    else if (path === "/api/projects") data = { items: [project], total: 1 };
    if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data, request_id: "node-names-qa" } });
  });
  await page.goto(`/canvas/${project.id}?scope=personal`);
  const original = page.locator('[data-node-id="image"]');
  await original.locator(".node-float-label").click();
  await original.getByRole("button", { name: "复制", exact: true }).click();
  await expect.poll(() => snapshot.nodes.length).toBe(9);
  await page.locator(".real-canvas-node.selected").getByRole("button", { name: "复制", exact: true }).click();
  await expect.poll(() => snapshot.nodes.length).toBe(10);
  await page.locator(".canvas-stage").focus();
  await page.keyboard.press("Control+c");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/^ai-manju-canvas-nodes:/);
  await page.keyboard.press("Control+v");
  await expect.poll(() => snapshot.nodes.length).toBe(11);
  expect(snapshot.nodes.map((node: any) => node.title)).toEqual([
    "苹果", "苹果1", "苹果2", "苹果3", "苹果4", "苹果5", "苹果6", "苹果7", "苹果副本", "苹果副本2", "苹果副本3",
  ]);
  await page.reload();
  await original.locator(".node-float-label b").dblclick();
  await original.locator(".node-title-input").fill("春天的苹果园很美");
  await original.locator(".node-title-input").press("Enter");
  await expect(original.locator(".node-float-label b")).toHaveText("春天的苹果…");
  await expect(original.locator(".node-float-label b")).toHaveAttribute("title", "春天的苹果园很美（双击重命名节点）");
  await expect.poll(() => snapshot.nodes[0].title).toBe("春天的苹果园很美");

  // Test actual viewport changes and rendered screen dimensions, including animation.
  for (const zoom of [25, 5]) {
    snapshot.zoom = zoom; snapshot.viewport.k = zoom / 100;
    snapshot.panX = 500; snapshot.panY = 260;
    snapshot.viewport.x = 500; snapshot.viewport.y = 260;
    await page.reload();
    await original.locator(".node-float-label").click({ position: { x: 1, y: 1 } });
    await expect(page.locator(".canvas-bottom-tools b")).toHaveText(`${zoom}%`);
    await expect.poll(async () => (await original.locator(".node-float-label b").boundingBox())!.height).toBeGreaterThanOrEqual(12);
    const copy = original.getByRole("button", { name: "复制", exact: true });
    await expect.poll(async () => (await copy.boundingBox())!.height).toBeGreaterThanOrEqual(27);
    const titleBox = (await original.locator(".node-float-label").boundingBox())!;
    const toolbarBox = (await original.locator(".node-toolbar-wrap").boundingBox())!;
    expect(toolbarBox.y + toolbarBox.height).toBeLessThan(titleBox.y);
    await page.screenshot({ path: testInfo.outputPath(`readable-at-${zoom}.png`) });
    await copy.click();
    await expect.poll(() => snapshot.nodes.length).toBe(zoom === 25 ? 12 : 13);
  }
  expect(errors).toEqual([]);
});
