import { expect, test, type Page } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
type InputFile = { name: string; mimeType: string; buffer: Buffer };
const media: InputFile = { name: "ordinary.png", mimeType: "image/png", buffer: png };
const picker = (page: Page) => page.locator('input[type="file"][multiple]');
const imports = (page: Page) => page.getByRole("region", { name: "资产导入任务", exact: true });

function packageFile(name = "assets.zip", mimeType = "application/zip"): InputFile {
  const manifest = {
    app: "ai-manju-studio", version: 2,
    folders: [{ id: "root", name: "导入目录", parent_id: "" }, { id: "child", name: "子目录", parent_id: "root" }],
    tags: [{ id: "style", name: "风格", parent_id: "" }, { id: "tag", name: "古风", parent_id: "style" }],
    assets: [{ id: "image", name: "角色.png", type: "image", category: "character", folder_id: "child", tag_ids: ["tag"], note: "角色备注" }],
    files: [{ assetId: "image", path: "files/image.png", mimeType: "image/png", bytes: png.length }],
  };
  return { name, mimeType, buffer: Buffer.from(zipSync({ "assets.json": strToU8(JSON.stringify(manifest)), "files/image.png": png })) };
}

async function openLibrary(page: Page) {
  const uploads: { name: string; bytes: Buffer; metadata: Record<string, string> }[] = [];
  const folders: Record<string, unknown>[] = [], tags: Record<string, unknown>[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "package-routing-test");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  // Network isolation only: ZIP parsing, IndexedDB and resumable import are real.
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (request.headers().accept === "text/event-stream") return route.fulfill({ contentType: "text/event-stream", body: ":ok\n\n" });
    let data: unknown = { items: [], total: 0 };
    if (url.pathname === "/api/auth/me") data = { id: "routing-qa", role: "super_admin", status: "active", display_name: "QA" };
    else if (url.pathname === "/api/user/preferences") data = {};
    else if (url.pathname === "/api/asset-folders") {
      if (request.method() === "POST") {
        data = { ...request.postDataJSON(), id: `folder-${folders.length}`, kind: "user", sort_order: 0, asset_count: 0 };
        folders.push(data as Record<string, unknown>);
      } else data = folders;
    } else if (url.pathname === "/api/tags") {
      if (request.method() === "POST") {
        data = { ...request.postDataJSON(), id: `tag-${tags.length}`, status: "active", aliases: [], sort_order: 0 };
        tags.push(data as Record<string, unknown>);
      } else data = { items: tags, total: tags.length };
    } else if (url.pathname === "/api/assets" && request.method() === "POST") {
      const form = await new Response(request.postDataBuffer(), { headers: { "content-type": request.headers()["content-type"] } }).formData();
      const file = form.get("file") as File;
      const metadata = Object.fromEntries([...form.entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string"));
      uploads.push({ name: file.name, bytes: Buffer.from(await file.arrayBuffer()), metadata });
      data = { id: `uploaded-${uploads.length}`, ...metadata, type: "image" };
    } else if (url.pathname === "/api/assets" || url.pathname === "/api/asset-exports") data = [];
    await route.fulfill({ json: { success: true, data, request_id: "routing-qa" } });
  });
  await page.goto("/assets");
  await expect(page.locator(".asset-bulk-bar")).toBeVisible();
  const notice = page.getByRole("button", { name: "知道了", exact: true });
  if (await notice.isVisible()) await notice.click();
  return { uploads, folders, tags, errors };
}

async function drop(page: Page, files: InputFile[]) {
  const transfer = await page.evaluateHandle(files => {
    const data = new DataTransfer();
    files.forEach(file => data.items.add(new File([Uint8Array.from(atob(file.bytes), value => value.charCodeAt(0))], file.name, { type: file.mimeType })));
    return data;
  }, files.map(file => ({ name: file.name, mimeType: file.mimeType, bytes: file.buffer.toString("base64") })));
  await page.locator(".asset-browser").dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
}

test("ordinary picker recognizes uppercase ZIP without MIME and preserves package metadata", async ({ page }, testInfo) => {
  const state = await openLibrary(page);
  await picker(page).setInputFiles(packageFile("assets.ZIP", ""));
  await expect(imports(page)).toContainText("已完成");
  expect(state.uploads).toHaveLength(1);
  expect(state.uploads[0].bytes).toEqual(png);
  expect(state.uploads[0].name).not.toMatch(/\.zip$/i);
  expect(state.folders.map(folder => [folder.name, folder.parent_id])).toEqual([["导入目录", ""], ["子目录", "folder-0"]]);
  expect(state.tags.map(tag => [tag.name, tag.parent_id])).toEqual([["风格", ""], ["古风", "tag-0"]]);
  expect(state.uploads[0].metadata).toMatchObject({ name: "角色.png", category: "character", folder_id: "folder-1", tag_ids: '["tag-1"]', note: "角色备注" });
  expect(await picker(page).inputValue()).toBe("");
  await picker(page).setInputFiles(packageFile("assets.ZIP", ""));
  await expect.poll(() => state.uploads.length).toBe(2);
  await expect(imports(page)).toContainText("已完成");
  expect(state.errors).toEqual([]);
  await imports(page).screenshot({ path: testInfo.outputPath("ordinary-picker-package-complete.png") });
});

test("dragging a package with ordinary media imports both through their correct paths", async ({ page }) => {
  const state = await openLibrary(page);
  await drop(page, [packageFile(), media]);
  await expect(imports(page)).toContainText("已完成");
  await expect.poll(() => state.uploads.length).toBe(2);
  expect(state.uploads.map(upload => upload.metadata.name).sort()).toEqual(["ordinary.png", "角色.png"]);
  expect(state.uploads.every(upload => !upload.name.endsWith(".zip"))).toBe(true);
  expect(state.uploads.find(upload => upload.name === media.name)?.metadata).toMatchObject({ source_type: "manual_upload", category: "other" });
  expect(state.errors).toEqual([]);
});

test("ordinary media still uploads and can be selected again", async ({ page }) => {
  const state = await openLibrary(page);
  await picker(page).setInputFiles(media);
  await expect(page.getByRole("button", { name: "导入资产", exact: true })).toBeEnabled();
  await expect.poll(() => state.uploads.length).toBe(1);
  await picker(page).setInputFiles(media);
  await expect.poll(() => state.uploads.length).toBe(2);
  expect(state.folders).toHaveLength(0);
  await expect(imports(page)).toHaveCount(0);
});

test("multiple ZIPs are rejected together without silently losing or uploading them as media", async ({ page }) => {
  const state = await openLibrary(page);
  await picker(page).setInputFiles([packageFile(), packageFile("second.zip"), media]);
  await expect(page.getByText("一次只能导入一个资产包", { exact: false })).toBeVisible();
  await expect.poll(() => state.uploads.length).toBe(1);
  expect(state.uploads[0].name).toBe(media.name);
  expect(state.folders).toHaveLength(0);
  await expect(imports(page)).toHaveCount(0);
});

test("invalid package stays out of media uploads; pending tasks are not replaced; deletion allows retry", async ({ page }) => {
  const state = await openLibrary(page);
  const invalid = { name: "not-a-package.zip", mimeType: "application/zip", buffer: Buffer.from(zipSync({ "readme.txt": strToU8("not an asset package") })) };
  await picker(page).setInputFiles(invalid);
  await expect(imports(page)).toContainText("资产包缺少 assets.json 或 manifest.json 清单");
  await picker(page).setInputFiles(packageFile());
  await expect(page.getByText("请先完成或结束已有导入任务", { exact: false })).toBeVisible();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(invalid.name);
  expect(state.uploads).toHaveLength(0);
  expect(state.folders).toHaveLength(0);
  page.once("dialog", dialog => dialog.accept());
  await dialog.getByRole("button", { name: "删除任务", exact: true }).click();
  await expect(imports(page)).toContainText("暂无导入任务");
  await picker(page).setInputFiles(packageFile());
  await expect(imports(page)).toContainText("已完成");
  expect(state.uploads).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test("ZIP MIME recognition and the dedicated package input both retain the existing importer", async ({ page }) => {
  const state = await openLibrary(page);
  await picker(page).setInputFiles(packageFile("download", "application/x-zip-compressed"));
  await expect(imports(page)).toContainText("已完成");
  await page.locator('input[type="file"][accept=".zip,application/zip"]').setInputFiles(packageFile());
  await expect(imports(page)).toContainText("assets.zip");
  await expect.poll(() => state.uploads.length).toBe(2);
  await expect(imports(page)).toContainText("已完成");
  expect(state.errors).toEqual([]);
});

test("removing floating entries does not stop an import when navigating away from the library", async ({ page }) => {
  const state = await openLibrary(page);
  let arrived = false;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/assets?*", async route => {
    if (route.request().method() === "POST") {
      arrived = true;
      await pending;
    }
    await route.fallback();
  });
  try {
    await picker(page).setInputFiles(packageFile());
    await expect.poll(() => arrived).toBe(true);
    await page.locator('a[href="/projects"]').first().click();
    await expect(page).toHaveURL(/\/projects/);
    await expect(page.locator(".asset-import-task-entry")).toHaveCount(0);
    release();
    await expect.poll(() => state.uploads.length).toBe(1);
    await page.locator('a[href="/assets"]').first().click();
    await page.locator(".asset-bulk-bar").getByRole("button", { name: "导入任务", exact: true }).click();
    await expect(imports(page)).toContainText("已完成");
    await expect(imports(page)).toContainText("1/1 个资产");
    await expect(page.getByRole("button", { name: "查看导入任务", exact: true })).toHaveCount(0);
    expect(state.errors).toEqual([]);
  } finally { release(); }
});
