import { expect, test, type Page } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";

// All mutations target a disposable signup-enabled API, never a user workspace.
const apiBase = process.env.ASSET_PACKAGE_TEST_API;
test.skip(!apiBase, "Requires isolated API");
const FILES = 8;
const DB = "ai-manju-asset-imports";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
function fixture() {
  const assets = Array.from({ length: FILES }, (_, n) => ({ id: `asset-${n}`, name: `${n}.png`, type: "image", folder_id: "child", tag_ids: ["tag"] }));
  const manifest = { app: "ai-manju-studio", version: 2,
    folders: [{ id: "root", name: "恢复测试", parent_id: "" }, { id: "child", name: "子目录", parent_id: "root" }],
    tags: [{ id: "tag", name: "恢复标签", parent_id: "" }], assets,
    files: assets.map(asset => ({ assetId: asset.id, path: asset.name, mimeType: "image/png", bytes: png.length })) };
  return { name: "refresh-recovery.zip", mimeType: "application/zip", buffer: Buffer.from(zipSync({
    "assets.json": strToU8(JSON.stringify(manifest)), ...Object.fromEntries(assets.map(asset => [asset.name, png])),
  })) };
}
async function login(page: Page) {
  const response = await page.request.post(`${apiBase}/api/auth/register`, { data: {
    account: `recovery_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`, password: "recovery-test-password",
  } });
  expect(response.ok()).toBeTruthy();
  const { data: { token, user } } = await response.json();
  await page.addInitScript(value => {
    if (!localStorage.getItem("ai-manju:auth_token")) localStorage.setItem("ai-manju:auth_token", value);
    localStorage.setItem("ai-manju:token-store", "local");
  }, token);
  await page.goto("/assets");
  await page.locator(".asset-bulk-bar").waitFor();
  const notice = page.getByRole("button", { name: "知道了", exact: true });
  if (await notice.isVisible()) await notice.click();
  return { token, user };
}
async function total(page: Page) {
  const response = await page.request.get(`${apiBase}/api/assets/library?page_size=100`);
  return (await response.json()).data.total;
}
async function records(page: Page, store = "tasks") {
  return page.evaluate(async ({ dbName, storeName }) => new Promise<any[]>((resolve, reject) => {
    const req = indexedDB.open(dbName);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(storeName, "readonly");
      const query = tx.objectStore(storeName).getAll();
      query.onsuccess = () => resolve(query.result);
      tx.oncomplete = () => db.close();
    };
  }), { dbName: DB, storeName: store });
}
async function start(page: Page) {
  await page.locator('input[type="file"][accept=".zip,application/zip"]').setInputFiles(fixture());
}

test("navigation continues; refresh recovers a lost upload response without duplicates; a second tab follows", async ({ page, context }, testInfo) => {
  await login(page);
  let uploaded = 0;
  let release: (() => void) | undefined;
  await page.route(/\/api\/assets\?/, async route => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    uploaded++;
    if (uploaded === 4) await new Promise<void>(resolve => { release = resolve; });
    else await new Promise(resolve => setTimeout(resolve, 350));
    await route.fulfill({ response }).catch(() => {});
  });
  await start(page);
  await expect.poll(() => uploaded).toBeGreaterThanOrEqual(1);
  await page.locator('a[href="/projects"]').first().click();
  await expect(page).toHaveURL(/\/projects/);
  await expect.poll(() => uploaded).toBe(4);
  await page.getByRole("button", { name: "查看导入任务" }).click();
  await expect(page.getByRole("dialog")).toContainText("refresh-recovery.zip");
  await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: testInfo.outputPath("navigated-progress.png") });
  // The server committed upload 4 but its browser response is still pending.
  await page.reload();
  release?.();
  const other = await context.newPage();
  await other.goto("/projects");
  await page.getByRole("button", { name: "查看导入任务" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "导入完成", exact: true })).toBeVisible({ timeout: 40_000 });
  await expect.poll(() => total(page)).toBe(FILES);
  await expect.poll(async () => (await records(page, "sources")).length).toBe(0);
  await expect(other.getByRole("button", { name: "查看导入任务" })).toContainText(`${FILES}/${FILES}`);
  const folders = (await (await page.request.get(`${apiBase}/api/asset-folders`)).json()).data;
  expect(folders.filter((f: any) => f.name === "恢复测试")).toHaveLength(1);
  expect(folders.filter((f: any) => f.name === "子目录")).toHaveLength(1);
  await page.screenshot({ path: testInfo.outputPath("recovered-complete.png") });
  await other.goto("/assets");
  await other.getByRole("button", { name: "收起导入结果", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("暂无导入任务");
});

test("explicit pause survives refresh and resumes only on request", async ({ page }) => {
  await login(page);
  await page.route(/\/api\/assets\?/, async route => {
    if (route.request().method() === "POST") await new Promise(resolve => setTimeout(resolve, 500));
    await route.continue().catch(() => {});
  });
  await start(page);
  await expect.poll(() => total(page)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "暂停导入", exact: true }).click();
  await expect(page.getByRole("heading", { name: "导入已暂停", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "导入已暂停", exact: true })).toBeVisible();
  const paused = await total(page);
  expect(paused).toBeLessThan(FILES);
  await page.waitForTimeout(4_000); // Longer than the automatic recovery poll.
  expect(await total(page)).toBe(paused);
  await page.getByRole("button", { name: "继续 / 重试未完成项", exact: true }).click();
  await expect(page.getByRole("heading", { name: "导入完成", exact: true })).toBeVisible();
  expect(await total(page)).toBe(FILES);
});

for (const definition of ["asset-folders", "tags"]) test(`refresh after a ${definition} response is lost reuses the created definition`, async ({ page }) => {
  await login(page);
  let created = false;
  let release: (() => void) | undefined;
  await page.route(new RegExp(`/api/${definition}\\?`), async route => {
    if (route.request().method() !== "POST" || created) return route.continue();
    const response = await route.fetch();
    created = true;
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ response }).catch(() => {});
  });
  await start(page);
  await expect.poll(() => created).toBe(true);
  await page.reload();
  release?.();
  await expect(page.getByRole("heading", { name: "导入完成", exact: true })).toBeVisible({ timeout: 40_000 });
  const folders = (await (await page.request.get(`${apiBase}/api/asset-folders`)).json()).data;
  expect(folders.filter((f: any) => f.kind === "user")).toHaveLength(2);
  const tags = (await (await page.request.get(`${apiBase}/api/tags?usage=asset`)).json()).data;
  expect(tags.items.filter((tag: any) => tag.name.startsWith("恢复标签"))).toHaveLength(1);
  expect(await total(page)).toBe(FILES);
});

test("changing account cannot continue the previous user's import with the new token", async ({ page }) => {
  const original = await login(page);
  let committed = false;
  let release: (() => void) | undefined;
  await page.route(/\/api\/assets\?/, async route => {
    if (route.request().method() !== "POST" || committed) return route.continue();
    const response = await route.fetch();
    committed = true;
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ response }).catch(() => {});
  });
  await start(page);
  await expect.poll(() => committed).toBe(true);
  const otherResponse = await page.request.post(`${apiBase}/api/auth/register`, { data: {
    account: `other_${Date.now()}`, password: "recovery-test-password",
  } });
  const { data: other } = await otherResponse.json();
  await page.evaluate(token => localStorage.setItem("ai-manju:auth_token", token), other.token);
  release?.();
  await page.waitForTimeout(4_000);
  const otherLibrary = await page.request.get(`${apiBase}/api/assets/library`, { headers: { Authorization: `Bearer ${other.token}` } });
  expect((await otherLibrary.json()).data.total).toBe(0);
  await page.reload();
  await page.getByRole("button", { name: "查看导入任务" }).click();
  await expect(page.getByRole("dialog")).toContainText("暂无导入任务");
  await page.evaluate(token => localStorage.setItem("ai-manju:auth_token", token), original.token);
  await page.reload();
  await expect(page.getByRole("heading", { name: "导入完成", exact: true })).toBeVisible({ timeout: 40_000 });
  const originalLibrary = await page.request.get(`${apiBase}/api/assets/library`, { headers: { Authorization: `Bearer ${original.token}` } });
  expect((await originalLibrary.json()).data.total).toBe(FILES);
});

test("storage quota failure performs no partial server import", async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === "sources") throw new DOMException("Test quota exhausted", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  await start(page);
  await expect(page.getByRole("alert")).toContainText("未开始导入");
  expect(await total(page)).toBe(0);
  expect(await records(page)).toEqual([]);
});
