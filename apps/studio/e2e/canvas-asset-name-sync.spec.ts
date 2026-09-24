import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

for (const kind of ["image", "video", "audio", "text"]) {
test(`archived ${kind} names follow rename, undo and reload across library entrances`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1050 });
  const image = readFileSync(new URL("../client/public/comic-lab-pack/stickers/sticker_nice.png", import.meta.url));
  const project = { id: `asset-name-${kind}`, title: "同步检查", scope: "personal", owner_id: "qa" };
  const extension = kind === "image" ? "png" : kind === "video" ? "mp4" : "mp3";
  const asset = { id: "asset", type: kind, name: `旧名称.${extension}`, content_type: `${kind}/${extension}`, folder_id: "other" };
  const folders = [
    { id: "canvas", parent_id: "", name: "画布工坊", system_key: "canvas" },
    { id: "mine", parent_id: "canvas", name: project.title, system_key: "canvas_project", source_ref_id: project.id },
    { id: "other", parent_id: "mine", name: "其他", system_key: "canvas_category", source_ref_id: `${project.id}:other` },
  ].map(folder => ({ ...folder, kind: "system", asset_count: 1, descendant_asset_count: 1, sort_order: 0 }));
  let snapshot: any = { schema: "ai-manhua-studio-canvas", version: 3, zoom: 100, panX: 0, panY: 0, groups: [], edges: [],
    nodes: [
      { id: "source", kind, title: "旧名称", content: kind === "text" ? "保存的正文" : "", x: 250, y: 150, width: 300, height: 180,
        metadata: kind === "text" ? { prompt: "这个提示词不能成为素材名称" } : { assetId: "asset", assetScope: "personal" } },
      { id: "target", kind: "image", title: "引用目标", content: "", x: 850, y: 140, width: 300, height: 180 },
    ] };
  const errors: string[] = [];
  const writes: string[] = [];
  let failRename = false;
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem("ai-manju:auth_token", "qa"); localStorage.setItem("ai-manju:token-store", "local"); });
  await page.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "authorization,content-type,x-request-id,idempotency-key", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS" };
    if (req.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (req.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    if (path === "/api/assets/asset/content") return route.fulfill({ headers, contentType: kind === "image" ? "image/png" : asset.content_type, body: kind === "image" ? image : Buffer.alloc(0) });
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me") data = { id: "qa", username: "qa", role: "super_admin", status: "active" };
    else if (path === "/api/announcements/current") data = null;
    else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (path === "/api/asset-folders") data = folders;
    else if (path === "/api/ai/models") data = { models: [] };
    else if (path === "/api/assets/asset/metadata") {
      const update = req.postDataJSON();
      if (failRename && update.name) return route.fulfill({ headers, status: 500, json: { success: false, error: { message: "测试网络失败" } } });
      if (update.name) { asset.name = update.name; writes.push(update.name); }
      data = { ...asset, ...update };
    } else if (path === "/api/assets/library") data = { items: kind === "text" ? [] : [asset], total: kind === "text" ? 0 : 1, page: 1, page_size: 60 };
    else if (path === "/api/assets/asset") data = asset;
    else if (path === `/api/projects/${project.id}/snapshot`) {
      if (req.method() === "PUT") snapshot = req.postDataJSON().data;
      data = { project_id: project.id, version: 1, data: snapshot };
    } else if (path === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
    else if (path === "/api/projects") data = [project];
    if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data } });
  });
  const source = page.locator('[data-node-id="source"]');
  const inspector = page.locator(".canvas-floating-inspector");
  async function closeInspector() { if (await inspector.isVisible()) await inspector.getByRole("button", { name: "关闭面板", exact: true }).click(); }
  async function rename(name: string) {
    await closeInspector();
    await source.locator(".node-float-label b").dblclick();
    await source.locator(".node-title-input").fill(name);
    await source.locator(".node-title-input").press("Enter");
    await expect(source.locator(".node-float-label b")).toHaveText(name);
  }
  async function assertLibrary(name: string) {
    await page.getByRole("button", { name: "从资产库插入", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name, exact: true })).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: `旧名称.${extension}`, exact: true })).toHaveCount(0);
    await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  }
  await page.goto(`/canvas/${project.id}?scope=personal`);
  await expect(source).toBeVisible();
  await closeInspector();
  await source.hover();
  await source.getByRole("button", { name: "加入素材库", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认加入", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await assertLibrary("旧名称");
  await rename("测试新名称");
  if (kind !== "text") await expect.poll(() => asset.name).toBe("测试新名称");
  await assertLibrary("测试新名称");
  await page.waitForTimeout(250);
  await page.locator(".canvas-head-actions").getByRole("button", { name: "撤销", exact: true }).click();
  await expect(source.locator(".node-float-label b")).toHaveText("旧名称");
  if (kind !== "text") await expect.poll(() => asset.name).toBe("旧名称");
  await assertLibrary("旧名称");
  await page.locator(".canvas-head-actions").getByRole("button", { name: "重做", exact: true }).click();
  await expect(source.locator(".node-float-label b")).toHaveText("测试新名称");
  await assertLibrary("测试新名称");
  if (kind === "image") {
    failRename = true;
    await rename("重试名称");
    await expect(page.getByText("“重试名称”已在画布改名，但素材库名称同步失败")).toBeVisible();
    expect(asset.name).toBe("测试新名称");
    failRename = false;
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect.poll(() => asset.name).toBe("重试名称");
    await rename("测试新名称");
    await expect.poll(() => asset.name).toBe("测试新名称");
  }
  await closeInspector();
  await page.locator('[data-node-id="target"] .node-float-label').click();
  await inspector.locator("textarea").fill("@");
  const mention = page.locator(".canvas-mention-menu");
  await mention.getByRole("button", { name: new RegExp(project.title) }).click();
  await mention.getByRole("button", { name: "其他", exact: true }).click();
  await expect(mention).toContainText("测试新名称");
  await expect(mention).not.toContainText(`旧名称.${extension}`);
  await page.screenshot({ path: info.outputPath(`${kind}-synced-mention.png`) });
  await page.keyboard.press("Escape");
  await page.locator(".canvas-head-actions").getByRole("button", { name: "保存", exact: true }).click();
  await page.reload();
  await expect(source.locator(".node-float-label b")).toHaveText("测试新名称");
  await assertLibrary("测试新名称");
  if (kind !== "text") expect(writes).toContain("测试新名称");
  expect(errors).toEqual([]);
});
}
