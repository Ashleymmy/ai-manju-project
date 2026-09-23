import { expect, test } from "@playwright/test";

// Explicitly opt into an isolated API and generated 34-file ZIP64 fixture.
const apiBase = process.env.ASSET_PACKAGE_TEST_API;
const fixture = process.env.ASSET_PACKAGE_LARGE_FIXTURE;
const mediaSize = Number(process.env.ASSET_PACKAGE_LARGE_FILE_MIB || 20) * 1024 * 1024;
test.skip(!apiBase || !fixture, "Requires isolated API and large synthetic package");

test("imports a large folder package without reading the whole ZIP", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const registration = await page.request.post(`${apiBase}/api/auth/register`, {
    data: { account: `large_import_${Date.now()}`, password: "local-large-import-test-password" },
  });
  expect(registration.ok()).toBeTruthy();
  const { data: { token } } = await registration.json();
  await page.addInitScript(value => {
    localStorage.setItem("ai-manju:auth_token", value);
    localStorage.setItem("ai-manju:token-store", "local");
    const read = Blob.prototype.arrayBuffer;
    (window as any).__packageLargestRead = 0;
    Blob.prototype.arrayBuffer = function () {
      (window as any).__packageLargestRead = Math.max((window as any).__packageLargestRead, this.size);
      if (this.size > 64 * 1024 * 1024) throw new Error("Unbounded ZIP read");
      return read.call(this);
    };
  }, token);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/assets");
  await page.locator(".asset-bulk-bar").waitFor();
  const notice = page.getByRole("button", { name: "知道了", exact: true });
  if (await notice.isVisible()) await notice.click();
  await page.locator('input[type="file"][accept=".zip,application/zip"]').setInputFiles(fixture!);
  const progress = page.getByRole("region", { name: "资产包导入进度" });
  if (process.env.ASSET_PACKAGE_REFRESH === "true") {
    await expect.poll(async () => {
      const error = page.getByRole("alert");
      if (await error.isVisible()) throw new Error(`${await error.textContent()} ${JSON.stringify(await page.evaluate(() => navigator.storage.estimate()))}`);
      return Number(await progress.locator("progress").getAttribute("value"));
    }, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
    await page.reload();
  }
  await expect(progress.getByText("导入完成", { exact: true })).toBeVisible({ timeout: 150_000 });
  await expect(progress.locator(".asset-import-count")).toContainText("34 / 34");
  const response = await page.request.get(`${apiBase}/api/assets/library?page_size=100`);
  const { data: library } = await response.json();
  expect(library.total).toBe(34);
  expect(new Set(library.items.map((asset: any) => asset.id)).size).toBe(34);
  for (const asset of library.items) {
    expect(asset.size).toBe(mediaSize);
    expect(asset.tags).toContain("容量验证");
    expect(asset.note).toMatch(/^备注 /);
    expect(asset.category).toBe("character");
  }
  const folderResponse = await page.request.get(`${apiBase}/api/asset-folders`);
  const { data: folders } = await folderResponse.json();
  expect(folders.find((folder: any) => folder.name === "子目录").parent_id).toBe(folders.find((folder: any) => folder.name === "大包导入验证").id);
  expect(await page.evaluate(() => (window as any).__packageLargestRead)).toBeLessThanOrEqual(64 * 1024 * 1024);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("large-import-complete.png"), fullPage: true });
});
