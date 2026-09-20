import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

// Match the picker page size so overflow is exercised, not just a single row.
const ASSET_COUNT = 60;
const assets = Array.from({ length: ASSET_COUNT }, (_, index) => ({
  id: `picker-${index}`,
  name: `Asset ${String(index).padStart(2, "0")}`,
  type: index % 10 === 8 ? "video" : index % 10 === 9 ? "audio" : "image",
  content_type: "image/png",
  size: 1024,
}));
const png = readFileSync(new URL("../client/public/comic-lab-pack/stickers/sticker_nice.png", import.meta.url));

async function openPicker(page: Page) {
  let releaseImages!: () => void;
  const imagesReady = new Promise<void>(resolve => { releaseImages = resolve; });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const snapshot = {
    schema: "ai-manhua-studio-canvas", version: 3,
    nodes: [], edges: [], connections: [], groups: [],
    viewport: { x: 0, y: 0, k: 1 }, zoom: 100, panX: 0, panY: 0,
  };
  const project = { id: "picker-qa", title: "Picker QA", scope: "personal", owner_id: "qa" };
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "qa-token");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  // All API requests are isolated from the user's actual projects and assets.
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
    if (/\/assets\/picker-\d+\/content$/.test(url.pathname)) {
      await imagesReady;
      if (url.pathname.includes("picker-1/")) return route.fulfill({ headers, status: 404 });
      return route.fulfill({ headers, contentType: "image/png", body: png });
    }
    let data: unknown = { items: [], total: 0 };
    if (url.pathname === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active", display_name: "QA" };
    else if (url.pathname === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (url.pathname === "/api/projects/picker-qa/snapshot") data = { project_id: project.id, version: 1, data: snapshot };
    else if (url.pathname === "/api/projects/picker-qa") data = { ...project, data: snapshot };
    else if (url.pathname === "/api/projects") data = { items: [project], total: 1 };
    else if (url.pathname === "/api/asset-folders") data = [];
    else if (url.pathname === "/api/assets/library") {
      const items = assets.filter(asset => (!url.searchParams.get("type") || asset.type === url.searchParams.get("type"))
        && (!url.searchParams.get("keyword") || asset.name.includes(url.searchParams.get("keyword")!)));
      data = { items, total: items.length, page: 1, page_size: ASSET_COUNT };
    } else if (url.pathname === "/api/assets") data = assets;
    if (url.pathname === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data, request_id: "picker-qa" } });
  });
  await page.goto("/canvas/picker-qa?scope=personal");
  await page.getByRole("button", { name: "从资产库插入", exact: true }).click();
  const dialog = page.locator(".canvas-asset-picker-dialog");
  const list = dialog.locator(".canvas-asset-picker-list");
  await expect(list.locator(":scope > button")).toHaveCount(ASSET_COUNT);
  // Finish opening animations before measuring geometry.
  await dialog.evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished));
  });
  return { dialog, list, releaseImages, errors };
}

async function expectStableTiles(list: Locator) {
  const geometry = await list.evaluate(element => ({
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
    height: element.clientHeight,
    scrollHeight: element.scrollHeight,
    tiles: Array.from(element.querySelectorAll(":scope > button")).map(tile => {
      const rect = tile.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }),
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
  for (const [index, tile] of geometry.tiles.entries()) {
    expect(tile.width).toBeGreaterThan(90);
    expect(Math.abs(tile.height - tile.width)).toBeLessThan(1);
    for (const previous of geometry.tiles.slice(0, index)) {
      const overlaps = tile.x < previous.x + previous.width - 1
        && tile.x + tile.width > previous.x + 1
        && tile.y < previous.y + previous.height - 1
        && tile.y + tile.height > previous.y + 1;
      expect(overlaps).toBe(false);
    }
  }
  if (geometry.tiles.length === ASSET_COUNT) expect(geometry.scrollHeight).toBeGreaterThan(geometry.height);
  return geometry.tiles;
}

async function expectDialogFits(page: Page, dialog: Locator) {
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  await expect(dialog.locator('[data-slot="dialog-footer"]')).toBeInViewport();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const footerUncovered = await dialog.locator('[data-slot="dialog-footer"] button').evaluateAll(buttons => buttons.every(button => {
    const rect = button.getBoundingClientRect();
    return [rect.left + 8, rect.right - 8].every(x => [rect.top + 8, rect.bottom - 8].every(y => button.contains(document.elementFromPoint(x, y))));
  }));
  expect(footerUncovered).toBe(true);
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 600 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test(`asset picker retains square rows and inserts selection at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const { dialog, list, releaseImages, errors } = await openPicker(page);
    try {
      await expectDialogFits(page, dialog);
      const pending = await expectStableTiles(list);
      releaseImages();
      await expect.poll(() => list.locator('button[title="Asset 00"] img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await expect(list.locator('button[title="Asset 01"] .retry-image-error')).toBeVisible();
      expect(await expectStableTiles(list)).toEqual(pending);
      await page.screenshot({ path: testInfo.outputPath("asset-picker.png") });
      await list.locator('button[title="Asset 00"]').click();
      await list.locator('button[title="Asset 59"]').click();
      await expect(dialog.getByRole("button", { name: "插入 2 个资产", exact: true })).toBeInViewport();
      await expectStableTiles(list);
      await dialog.getByRole("button", { name: "插入 2 个资产", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(page.locator(".real-canvas-node")).toHaveCount(2);
      await expect(page.locator(".real-canvas-node").getByText("Asset 00", { exact: true })).toHaveCount(1);
      await expect(page.locator(".real-canvas-node").getByText("Asset 59", { exact: true })).toHaveCount(1);
      expect(errors).toEqual([]);
    } finally { releaseImages(); }
  });
}

test("picker keeps a single result compact and supports filters, search and empty state", async ({ page }) => {
  const { dialog, list, releaseImages, errors } = await openPicker(page);
  releaseImages();
  await dialog.getByRole("button", { name: "视频", exact: true }).click();
  await expect(list.locator(":scope > button")).toHaveCount(6);
  await expectStableTiles(list);
  const search = dialog.getByPlaceholder("按名称、备注或标签搜索");
  await search.fill("Asset 58");
  await search.press("Enter");
  await expect(list.locator(":scope > button")).toHaveCount(1);
  await expectStableTiles(list);
  await search.fill("no-match");
  await dialog.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(list.getByText("当前筛选下没有资产")).toBeVisible();
  await expectDialogFits(page, dialog);
  expect(errors).toEqual([]);
});
