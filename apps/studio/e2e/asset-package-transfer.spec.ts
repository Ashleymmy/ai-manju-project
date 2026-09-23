import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";

// This test requires an isolated, signup-enabled API; never seed user workspaces.
const apiBase = process.env.ASSET_PACKAGE_TEST_API;
test.skip(!apiBase, "ASSET_PACKAGE_TEST_API must point to an isolated test API");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");

async function api(request: APIRequestContext, path: string, token = "", body?: unknown) {
  const response = await request.fetch(`${apiBase}${path}`, { method: body ? "POST" : "GET", headers: token ? { Authorization: `Bearer ${token}` } : {}, data: body });
  const envelope = await response.json();
  expect(response.ok(), JSON.stringify(envelope)).toBeTruthy();
  expect(envelope.success).toBe(true);
  return envelope.data;
}
async function seed(context: BrowserContext, account: string) {
  // Real login installs the HttpOnly session cookie used by native downloads.
  const { token } = await api(context.request, "/api/auth/login", "", { account, password: "qa-local-transfer-password" });
  await context.addInitScript(value => {
    localStorage.setItem("ai-manju:auth_token", value);
    localStorage.setItem("ai-manju:token-store", "local");
  }, token);
}

test("one user exports a folder ZIP and another restores files, nested/empty folders, labels and notes", async ({ browser, request }, testInfo) => {
  test.setTimeout(120_000);
  const suffix = Date.now();
  const source = await api(request, "/api/auth/register", "", { account: `source_${suffix}`, password: "qa-local-transfer-password" });
  const recipient = await api(request, "/api/auth/register", "", { account: `target_${suffix}`, password: "qa-local-transfer-password" });
  const root = await api(request, "/api/asset-folders", source.token, { name: "1" });
  const child = await api(request, "/api/asset-folders", source.token, { name: "2", parent_id: root.id });
  await api(request, "/api/asset-folders", source.token, { name: "空目录", parent_id: root.id });
  const parentTag = await api(request, "/api/tags", source.token, { name: "风格", scope_type: "workspace", asset_enabled: true, prompt_enabled: false });
  const tag = await api(request, "/api/tags", source.token, { name: "古风", parent_id: parentTag.id, scope_type: "workspace", asset_enabled: true, prompt_enabled: false });
  for (const [folderId, name, category] of [[root.id, "场景.png", "environment"], [child.id, "角色.png", "character"]]) {
    const response = await request.post(`${apiBase}/api/assets`, { headers: { Authorization: `Bearer ${source.token}` }, multipart: {
      file: { name, mimeType: "image/png", buffer: png }, name, folder_id: folderId, category, tag_ids: JSON.stringify([tag.id]), note: `${name}的备注`,
    } });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  const sourceContext = await browser.newContext();
  const targetContext = await browser.newContext();
  try {
    await seed(sourceContext, `source_${suffix}`);
    await seed(targetContext, `target_${suffix}`);
    const page = await sourceContext.newPage();
    const target = await targetContext.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    target.on("pageerror", error => errors.push(error.message));
    await page.goto("/assets");
    await page.locator(".folder-name").filter({ hasText: /^1$/ }).waitFor();
    const sourceNotice = page.getByRole("button", { name: "知道了", exact: true });
    if (await sourceNotice.isVisible()) await sourceNotice.click();
    await page.locator(".folder-name").filter({ hasText: /^1$/ }).click();
    await page.getByRole("button", { name: "导出目录", exact: true }).click();
    const exports = page.getByRole("region", { name: "资产导出任务" });
    await expect(exports.getByRole("button", { name: "下载资产包" }).first()).toBeVisible({ timeout: 30_000 });
    const downloadPromise = page.waitForEvent("download");
    await exports.getByRole("button", { name: "下载资产包" }).first().click();
    const zipPath = testInfo.outputPath("folder-1.zip");
    const download = await downloadPromise;
    expect(download.url()).toContain("/api/asset-exports/");
    expect(download.url()).not.toContain("access_token");
    await download.saveAs(zipPath);
    expect(await download.failure()).toBeNull();
    // The same authenticated endpoint supports resumable, bounded reads.
    const range = await sourceContext.request.get(download.url(), { headers: { Range: "bytes=0-63" } });
    expect(range.status()).toBe(206);
    expect(range.headers()["accept-ranges"]).toBe("bytes");
    expect((await range.body()).length).toBe(64);
    await target.goto("/assets");
    await target.locator(".asset-bulk-bar").waitFor();
    const targetNotice = target.getByRole("button", { name: "知道了", exact: true });
    if (await targetNotice.isVisible()) await targetNotice.click();
    await target.locator('input[type="file"][accept=".zip,application/zip"]').setInputFiles(zipPath);
    const progress = target.getByRole("region", { name: "资产包导入进度" });
    await expect(progress.getByText("导入完成", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(target.locator(".folder-name").filter({ hasText: /^1$/ })).toBeVisible();
    const folders = await api(request, "/api/asset-folders", recipient.token);
    const importedRoot = folders.find((folder: any) => folder.name === "1");
    const importedChild = folders.find((folder: any) => folder.name === "2");
    expect(importedRoot.id).not.toBe(root.id);
    expect(importedChild.parent_id).toBe(importedRoot.id);
    expect(folders.find((folder: any) => folder.name === "空目录").parent_id).toBe(importedRoot.id);
    const library = await api(request, `/api/assets/library?folder_id=${importedRoot.id}&include_descendants=true`, recipient.token);
    expect(library.total).toBe(2);
    for (const asset of library.items) {
      expect(asset.tags).toContain("古风");
      expect(asset.note).toBe(`${asset.name}的备注`);
      expect(asset.category).toBe(asset.name === "角色.png" ? "character" : "environment");
      expect(asset.folder_id).toBe(asset.name === "角色.png" ? importedChild.id : importedRoot.id);
      const content = await request.get(`${apiBase}/api/assets/${asset.id}/content`, { headers: { Authorization: `Bearer ${recipient.token}` } });
      expect(await content.body()).toEqual(png);
      const bindings = await api(request, `/api/assets/${asset.id}/tags`, recipient.token);
      expect(bindings.items[0].tag.id).not.toBe(tag.id);
      expect(bindings.items[0].tag.name).toBe("古风");
    }
    // A second import is a separate copy; existing folders/assets remain intact.
    await target.locator('input[type="file"][accept=".zip,application/zip"]').setInputFiles(zipPath);
    await expect(target.locator(".folder-name").filter({ hasText: /^1（导入 1）$/ })).toBeVisible();
    await expect(progress.getByText("导入完成", { exact: true })).toBeVisible();
    expect((await api(request, "/api/assets/library", recipient.token)).total).toBe(4);
    expect((await api(request, "/api/assets/library", source.token)).total).toBe(2);
    expect(errors).toEqual([]);
    await target.screenshot({ path: testInfo.outputPath("import-complete.png"), fullPage: true });
  } finally {
    await sourceContext.close();
    await targetContext.close();
  }
});
