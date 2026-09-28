import { expect, test, type Page } from "@playwright/test";

async function openLibrary(page: Page, count = 42) {
  let batches = Array.from({ length: count }, (_, index) => ({
    id: `export-${index}`, file_name: `素材包-${index}.zip`, selection_mode: "folder",
    status: index === 0 ? "running" : index % 3 === 0 ? "expired" : "succeeded",
    total: 302, succeeded: 302, failed: 0, size: 862_000_000, created_at: "2026-09-28T10:00:00Z",
  }));
  const reads: string[] = [], deletes: string[] = [], errors: string[] = [];
  let failDelete = false;
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "transfer-test");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (request.headers().accept === "text/event-stream") return route.fulfill({ contentType: "text/event-stream", body: ":ok\n\n" });
    let data: unknown = { items: [], total: 0 };
    if (url.pathname === "/api/auth/me") data = { id: "transfer-qa", role: "super_admin", status: "active", display_name: "QA" };
    else if (url.pathname === "/api/user/preferences") data = {};
    else if (url.pathname === "/api/assets" || url.pathname === "/api/asset-folders") data = [];
    else if (url.pathname === "/api/assets/library") data = { items: [], total: 0, page: 1, page_size: 30 };
    else if (url.pathname === "/api/asset-exports") { reads.push(url.href); data = batches; }
    else if (url.pathname.startsWith("/api/asset-exports/") && request.method() === "DELETE") {
      const id = url.pathname.split("/").at(-1)!;
      if (failDelete) return route.fulfill({ status: 500, json: { success: false, error: "暂时无法清理打包文件", request_id: "delete-error" } });
      deletes.push(id); batches = batches.filter(batch => batch.id !== id); data = { deleted: true };
    }
    return route.fulfill({ json: { success: true, data, request_id: "transfer-qa" } });
  });
  await page.goto("/assets");
  await expect(page.locator(".asset-bulk-bar")).toBeVisible();
  const notice = page.getByRole("button", { name: "知道了", exact: true });
  if (await notice.isVisible()) await notice.click();
  return { reads, deletes, errors, failDeletion: () => { failDelete = true; } };
}

async function seedImport(page: Page, status: "completed" | "paused" = "completed") {
  await page.evaluate(async status => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("ai-manju-asset-imports", 1);
      request.onupgradeneeded = () => { request.result.createObjectStore("tasks", { keyPath: "owner" }); request.result.createObjectStore("sources"); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction(["tasks", "sources"], "readwrite");
        for (const owner of ["transfer-qa", "other-owner"]) {
          tx.objectStore("tasks").put({ id: `${owner}-task`, owner, name: "测试导入包.zip", size: 1024, scope: "personal", status,
            warnings: Array.from({ length: 35 }, (_, i) => `测试提示 ${i + 1}`),
            progress: { phase: status === "completed" ? "导入完成" : "导入已暂停，可继续导入", total: 300, completed: status === "completed" ? 300 : 12, failures: [] } });
          tx.objectStore("sources").put(new Blob(["test-package"]), owner);
        }
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, status);
}

async function storedImports(page: Page) {
  return page.evaluate(async () => new Promise<{ tasks: IDBValidKey[]; sources: IDBValidKey[] }>((resolve, reject) => {
    const req = indexedDB.open("ai-manju-asset-imports", 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result, tx = db.transaction(["tasks", "sources"], "readonly");
      const tasks = tx.objectStore("tasks").getAllKeys(), sources = tx.objectStore("sources").getAllKeys();
      tx.oncomplete = () => { db.close(); resolve({ tasks: tasks.result, sources: sources.result }); };
    };
  }));
}

test("adjacent import/export toggles, bounded export history and persistent deletion", async ({ page }) => {
  const { reads, deletes, errors } = await openLibrary(page);
  const bar = page.locator(".asset-bulk-bar");
  expect(reads).toHaveLength(0);
  await bar.getByRole("button", { name: "导出任务", exact: true }).click();
  const panel = page.getByRole("region", { name: "资产导出任务", exact: true });
  await expect(panel.locator(".asset-transfer-row")).toHaveCount(20);
  await expect(panel.getByRole("button", { name: "删除导出任务 素材包-0.zip", exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "下一页导出任务" }).click();
  await expect(panel.getByText("素材包-20.zip", { exact: true })).toBeVisible();
  page.once("dialog", dialog => dialog.dismiss());
  await panel.getByRole("button", { name: "删除导出任务 素材包-20.zip", exact: true }).click();
  expect(deletes).toHaveLength(0);
  page.once("dialog", dialog => dialog.accept());
  await panel.getByRole("button", { name: "删除导出任务 素材包-20.zip", exact: true }).click();
  await expect(panel.getByText("素材包-20.zip", { exact: true })).toHaveCount(0);
  expect(deletes).toEqual(["export-20"]);
  await bar.getByRole("button", { name: "导入任务", exact: true }).click();
  await expect(page.getByRole("region", { name: "资产导入任务", exact: true })).toContainText("暂无导入任务");
  await bar.getByRole("button", { name: "收起导入任务", exact: true }).click();
  await expect(page.getByRole("region", { name: "资产导入任务", exact: true })).toHaveCount(0);
  await page.reload();
  await page.locator(".asset-bulk-bar").getByRole("button", { name: "导出任务", exact: true }).click();
  await page.getByRole("button", { name: "下一页导出任务" }).click();
  await expect(page.getByText("素材包-20.zip", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("failed export deletion keeps the row available for retry", async ({ page }) => {
  const state = await openLibrary(page, 2);
  state.failDeletion();
  await page.locator(".asset-bulk-bar").getByRole("button", { name: "导出任务", exact: true }).click();
  page.once("dialog", dialog => dialog.accept());
  const button = page.getByRole("button", { name: "删除导出任务 素材包-1.zip", exact: true });
  await button.click();
  await expect(button).toBeEnabled();
  expect(state.deletes).toHaveLength(0);
  await expect(page.getByText("暂时无法清理打包文件", { exact: false })).toBeVisible();
});

for (const status of ["completed", "paused"] as const) {
  test(`deleting a ${status} import clears only its owner's checkpoint and source`, async ({ page }) => {
    await openLibrary(page, 0);
    await seedImport(page, status);
    await page.locator(".asset-bulk-bar").getByRole("button", { name: "导入任务", exact: true }).click();
    const panel = page.getByRole("region", { name: "资产导入任务", exact: true });
    await expect(panel.getByText("测试导入包.zip", { exact: false })).toBeVisible();
    page.once("dialog", dialog => dialog.dismiss());
    await panel.getByRole("button", { name: "删除任务", exact: true }).click();
    expect((await storedImports(page)).tasks).toContain("transfer-qa");
    page.once("dialog", dialog => dialog.accept());
    await panel.getByRole("button", { name: "删除任务", exact: true }).click();
    await expect(panel).toContainText("暂无导入任务");
    expect(await storedImports(page)).toEqual({ tasks: ["other-owner"], sources: ["other-owner"] });
    await page.reload();
    await page.locator(".asset-bulk-bar").getByRole("button", { name: "导入任务", exact: true }).click();
    await expect(panel).toContainText("暂无导入任务");
  });
}

for (const width of [1920, 1000, 390]) {
  test(`task panels scroll without growing and no floating entry remains at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 945 });
    const { errors } = await openLibrary(page);
    await seedImport(page);
    const entry = page.getByRole("button", { name: "查看导入任务", exact: true });
    await expect(entry).toHaveCount(0);
    await page.locator(".asset-bulk-bar").getByRole("button", { name: "导出任务", exact: true }).click();
    const panel = page.getByRole("region", { name: "资产导出任务", exact: true });
    await expect(panel.locator(".asset-transfer-row")).toHaveCount(20);
    const scroll = panel.getByRole("region", { name: "导出任务列表", exact: true });
    const metrics = await scroll.evaluate(element => ({ height: element.clientHeight, total: element.scrollHeight, style: getComputedStyle(element).overflowY, scrollbar: getComputedStyle(element, "::-webkit-scrollbar").width }));
    expect(metrics.total).toBeGreaterThan(metrics.height);
    expect(metrics.style).toBe("auto"); expect(metrics.scrollbar).toBe("8px");
    expect((await panel.boundingBox())!.height).toBeLessThanOrEqual(380);
    await scroll.evaluate(element => { element.scrollTop = 300; });
    expect(await scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await panel.evaluate(element => element.scrollIntoView({ block: "center" }));
    await panel.screenshot({ path: `.tmp/transfer-task-qa/exports-${width}.png` });
    await page.locator(".asset-bulk-bar").getByRole("button", { name: "导入任务", exact: true }).click();
    const imports = page.getByRole("region", { name: "资产导入任务", exact: true });
    await expect(imports.getByText("测试导入包.zip", { exact: false })).toBeVisible();
    await expect(imports.locator(".asset-transfer-row")).toHaveCount(1);
    await expect(imports.locator(".asset-import-summary")).toHaveCount(0);
    expect((await imports.locator(".asset-transfer-header").boundingBox())!.height).toBe((await panel.locator(".asset-transfer-header").boundingBox())!.height);
    const initialHeight = (await imports.boundingBox())!.height;
    await imports.locator("summary").filter({ hasText: "35 项资产包提示" }).click();
    const importScroll = imports.getByRole("region", { name: "导入任务详情" });
    expect(await importScroll.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    expect((await imports.boundingBox())!.height).toBeLessThanOrEqual(380);
    expect((await imports.boundingBox())!.height).toBe(initialHeight);
    expect(await importScroll.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await importScroll.evaluate(element => { element.scrollTop = 200; });
    expect(await importScroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await importScroll.evaluate(element => { element.scrollTop = 0; });
    await imports.evaluate(element => element.scrollIntoView({ block: "center" }));
    await imports.screenshot({ path: `.tmp/transfer-task-qa/imports-${width}.png` });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `.tmp/transfer-task-qa/page-${width}.png` });
    expect(errors).toEqual([]);
  });
}
