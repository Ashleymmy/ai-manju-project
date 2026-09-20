import { expect, test, type Page } from "@playwright/test";

const longName = "003eb3d64c34521074166f1b06c76b7a".repeat(5) + ".png";
const originalAssets = [
  { id: "bulk-a", name: longName, type: "image", category: "character", note: "keep a", tags: ["已有标签"] },
  { id: "bulk-b", name: "portrait.png", type: "image", category: "other", note: "keep b", tags: [] },
  { id: "bulk-c", name: "unselected.png", type: "image", category: "reference", note: "keep c", tags: [] },
];
const tag = { id: "tag-a", name: "已有标签", parent_id: "", asset_enabled: true, aliases: [], status: "active", sort_order: 0, asset_count: 1 };

async function openLibrary(page: Page) {
  const assets = structuredClone(originalAssets);
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const tagUpdates: Array<{ asset_ids: string[]; tag_ids: string[]; action: string }> = [];
  const errors: string[] = [];
  let failSecond = false;
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "bulk-panel-test");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (request.headers().accept === "text/event-stream") return route.fulfill({ contentType: "text/event-stream", body: ":ok\n\n" });
    let data: unknown = { items: [], total: 0 };
    if (url.pathname === "/api/auth/me") data = { id: "qa", role: "super_admin", status: "active", display_name: "QA" };
    else if (url.pathname === "/api/user/preferences") data = {};
    else if (url.pathname === "/api/asset-folders" || url.pathname === "/api/asset-exports") data = [];
    else if (url.pathname === "/api/tags") data = { items: [tag], total: 1 };
    else if (url.pathname === "/api/assets/library" || url.pathname === "/api/assets/trash/library") data = { items: assets, total: assets.length, page: 1, page_size: 30 };
    else if (url.pathname.endsWith("/content")) {
      const portrait = url.pathname.includes("bulk-b");
      return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="${portrait ? 300 : 2400}" height="${portrait ? 1800 : 400}" viewBox="0 0 300 200"><rect width="300" height="200" fill="#5b716a"/><circle cx="150" cy="100" r="50" fill="#e9c17d"/></svg>` });
    } else if (url.pathname.endsWith("/metadata") && request.method() === "PUT") {
      const id = url.pathname.split("/")[3];
      const input = request.postDataJSON();
      updates.push({ id, data: input });
      if (id === "bulk-b" && failSecond) return route.fulfill({ status: 500, json: { success: false, error: "temporary error" } });
      const asset = assets.find(item => item.id === id)!;
      Object.assign(asset, input);
      data = asset;
    } else if (url.pathname === "/api/assets/bulk-tags") {
      const input = request.postDataJSON();
      tagUpdates.push(input);
      data = { count: input.asset_ids.length };
    } else if (url.pathname.endsWith("/tags")) {
      const id = url.pathname.split("/")[3];
      data = { items: id === "bulk-a" ? [{ tag, binding: { id: "binding-a", asset_id: id, tag_id: tag.id, state: "active" }, origins: [] }] : [], total: id === "bulk-a" ? 1 : 0 };
    } else if (url.pathname === "/api/assets") data = assets;
    return route.fulfill({ json: { success: true, data, request_id: "bulk-panel-qa" } });
  });
  await page.goto("/assets");
  await expect(page.locator(".library-asset")).toHaveCount(3);
  const notice = page.getByRole("button", { name: "知道了", exact: true });
  if (await notice.isVisible()) await notice.click();
  await page.keyboard.press("Escape");
  return { assets, updates, tagUpdates, errors, setFailSecond: (value: boolean) => { failSecond = value; } };
}

async function selectPair(page: Page) {
  await page.getByRole("checkbox", { name: `选择资产 ${longName}`, exact: true }).check();
  await page.getByRole("checkbox", { name: "选择资产 portrait.png", exact: true }).check();
  const panel = page.getByRole("region", { name: "批量编辑资产" });
  await expect(panel.getByRole("heading", { name: "已选择 2 项资产" })).toBeVisible();
  return panel;
}

test("multi-selection edits categories and tags in the sidebar without touching unselected assets", async ({ page }) => {
  const state = await openLibrary(page);
  const panel = await selectPair(page);
  expect(await panel.locator(".asset-bulk-preview").evaluate(element => Array.from(element.querySelectorAll("img")).every(img => {
    const bounds = img.getBoundingClientRect();
    const parent = img.parentElement!.getBoundingClientRect();
    return bounds.left >= parent.left && bounds.top >= parent.top && bounds.right <= parent.right && bounds.bottom <= parent.bottom;
  }))).toBe(true);
  await panel.getByLabel("批量分类").selectOption("environment");
  await expect(page.locator(".asset-check input:checked")).toHaveCount(2);
  await panel.getByRole("button", { name: "应用到 2 项资产" }).click();
  await expect.poll(() => state.updates.length).toBe(2);
  expect(state.updates.map(item => item.id).sort()).toEqual(["bulk-a", "bulk-b"]);
  expect(state.updates.every(item => JSON.stringify(item.data) === JSON.stringify({ category: "environment" }))).toBe(true);
  expect(state.assets[0].name).toBe(longName);
  expect(state.assets[0].note).toBe("keep a");
  expect(state.assets[0].tags).toEqual(["已有标签"]);
  expect(state.assets[2].category).toBe("reference");
  await panel.getByRole("button", { name: "编辑所选资产标签" }).click();
  const dialog = page.getByRole("dialog", { name: "批量编辑标签" });
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "确认添加", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.tagUpdates[0]).toEqual({ asset_ids: ["bulk-a", "bulk-b"], tag_ids: ["tag-a"], action: "add" });
  await panel.getByRole("button", { name: "编辑所选资产标签" }).click();
  await dialog.getByRole("button", { name: "移除标签", exact: true }).click();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "从 1 项资产移除", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.tagUpdates[1]).toEqual({ asset_ids: ["bulk-a"], tag_ids: ["tag-a"], action: "remove" });
  await expect(page.locator(".asset-check input:checked")).toHaveCount(2);
  await page.screenshot({ path: ".tmp/asset-bulk-panel-qa/bulk-details.png", fullPage: true });
  expect(state.errors).toEqual([]);
});

test("partial category failure retries only failed assets", async ({ page }) => {
  const state = await openLibrary(page);
  state.setFailSecond(true);
  const panel = await selectPair(page);
  await panel.getByLabel("批量分类").selectOption("prop");
  await panel.getByRole("button", { name: "应用到 2 项资产" }).click();
  await expect(panel.getByRole("alert")).toContainText("1 项失败");
  state.setFailSecond(false);
  await panel.getByRole("button", { name: "重试失败的 1 项" }).click();
  await expect.poll(() => state.updates.length).toBe(3);
  expect(state.updates[2].id).toBe("bulk-b");
  await expect(panel.getByRole("status")).toContainText("已更新 1 项");
});

test("single selection follows the checked asset and keeps long names and media within the detail panel", async ({ page }) => {
  await openLibrary(page);
  const detail = page.locator(".asset-detail");
  for (const index of [0, 1]) {
    await page.locator(".library-asset-preview").nth(index).click();
    await expect(detail.locator("h3")).toHaveText(originalAssets[index].name);
    const measurements = await detail.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { scroll: element.scrollWidth, width: element.clientWidth, contained: Array.from(element.querySelectorAll(".detail-head h3, .detail-head button, img, input, select, textarea")).every(child => { const bounds = child.getBoundingClientRect(); return bounds.left >= rect.left && bounds.right <= rect.right; }) };
    });
    expect(measurements.scroll).toBeLessThanOrEqual(measurements.width + 1);
    expect(measurements.contained).toBe(true);
  }
  await page.getByRole("checkbox", { name: `选择资产 ${longName}`, exact: true }).check();
  await page.getByRole("checkbox", { name: "选择资产 portrait.png", exact: true }).uncheck();
  await expect(detail.locator("h3")).toHaveText(longName);
  await page.screenshot({ path: ".tmp/asset-bulk-panel-qa/long-name.png", fullPage: true });
});

test("trash multi-selection offers no metadata editing", async ({ page }) => {
  await openLibrary(page);
  await page.getByRole("button", { name: "回收站", exact: true }).click();
  const panel = await selectPair(page);
  await expect(panel).toContainText("请先恢复");
  await expect(panel.getByRole("combobox")).toHaveCount(0);
  await expect(panel.getByRole("button")).toHaveCount(0);
});
