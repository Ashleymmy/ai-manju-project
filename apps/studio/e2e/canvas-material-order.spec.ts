import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("material menus group types and use complete numbered node names in downloads", async ({ page }, info) => {
  await page.setViewportSize({ width: 1700, height: 1100 });
  const image = readFileSync(new URL("../client/public/comic-lab-pack/stickers/sticker_nice.png", import.meta.url));
  const project = { id: "material-order-qa", title: "序号检查", scope: "personal", owner_id: "qa" };
  const assets = [
    { id: "audio", type: "audio", name: "素材声音", content_type: "audio/mpeg" },
    { id: "video", type: "video", name: "素材镜头", content_type: "video/mp4" },
    { id: "original", type: "image", name: "素材苹果", content_type: "image/png" },
    { id: "numbered", type: "image", name: "素材苹果", content_type: "image/png" },
  ];
  const folders = [
    { id: "canvas", parent_id: "", name: "画布工坊", system_key: "canvas" },
    { id: "mine", parent_id: "canvas", name: project.title, system_key: "canvas_project", source_ref_id: project.id },
    { id: "other", parent_id: "mine", name: "其他", system_key: "canvas_category", source_ref_id: `${project.id}:other` },
  ].map(folder => ({ ...folder, kind: "system", asset_count: 4, descendant_asset_count: 4, sort_order: 0 }));
  let snapshot: any = { schema: "ai-manhua-studio-canvas", version: 3, zoom: 100, panX: 0, panY: 0, groups: [], edges: [], nodes: [
    ...[assets[2], assets[3], assets[1], assets[0]].map((asset, index) => ({ id: asset.id, kind: asset.type,
      title: asset.id === "original" ? asset.name : `${asset.name}（1）`, content: "", x: 180 + index * 340, y: 120, width: 250, height: 180,
      metadata: { assetId: asset.id, assetScope: "personal", canvasOrigin: "imported" } })),
    { id: "text", kind: "text", title: "素材剧本（1）", content: "保存的剧本正文", x: 180, y: 430, width: 250, height: 180 },
    { id: "target", kind: "image", title: "引用目标", content: "", x: 850, y: 430, width: 250, height: 180 },
  ] };
  const errors: string[] = [], sorts: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem("ai-manju:auth_token", "qa"); localStorage.setItem("ai-manju:token-store", "local"); });
  await page.route("**/api/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (!path.startsWith("/api/")) return route.continue();
    const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "authorization,content-type,x-request-id,idempotency-key", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS" };
    if (req.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (req.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    const asset = assets.find(asset => path.startsWith(`/api/assets/${asset.id}`));
    if (asset && path.endsWith("/content")) return route.fulfill({ headers, contentType: asset.content_type, body: asset.type === "image" ? image : Buffer.from("original bytes") });
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me") data = { id: "qa", username: "qa", role: "super_admin", status: "active" };
    else if (path === "/api/announcements/current") data = null;
    else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (path === "/api/asset-folders") data = folders;
    else if (path === "/api/ai/models") data = { models: [] };
    else if (asset && path.endsWith("/metadata")) { Object.assign(asset, req.postDataJSON()); data = asset; }
    else if (path === "/api/assets/library") {
      sorts.push(url.searchParams.get("sort") || "");
      data = { items: assets, total: assets.length, page: 1, page_size: 100 };
    } else if (asset) data = asset;
    else if (path === `/api/projects/${project.id}/snapshot`) {
      if (req.method() === "PUT") snapshot = req.postDataJSON().data;
      data = { project_id: project.id, version: 1, data: snapshot };
    } else if (path === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
    else if (path === "/api/projects") data = [project];
    if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data } });
  });
  await page.goto(`/canvas/${project.id}?scope=personal`);
  const inspector = page.locator(".canvas-floating-inspector");
  const card = (id: string) => page.locator(`[data-node-id="${id}"]`);
  async function closeInspector() { if (await inspector.isVisible()) await inspector.getByRole("button", { name: "关闭面板", exact: true }).click(); }
  await expect(card("numbered").locator(".node-float-label b")).toHaveText("素材苹果（1）");
  await closeInspector();
  // The text asset shares the same popup but is stored locally.
  await card("text").locator(".node-float-label").click();
  await closeInspector();
  await card("text").hover();
  await card("text").getByRole("button", { name: "加入素材库", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认加入", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "从资产库插入", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "素材苹果（1）", exact: true })).toBeVisible();
  await expect.poll(() => assets.map(asset => asset.name)).toEqual(["素材声音（1）", "素材镜头（1）", "素材苹果", "素材苹果（1）"]);
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  await closeInspector();
  await card("target").locator(".node-float-label").click();
  const prompt = inspector.locator("textarea");
  await prompt.fill("@");
  const menu = page.locator(".canvas-mention-menu");
  const labels = menu.locator(".canvas-mention-item:not(.canvas-mention-item-folder) strong");
  const ordered = ["素材剧本（1）", "素材苹果", "素材苹果（1）", "素材镜头（1）", "素材声音（1）"];
  await menu.getByRole("button", { name: new RegExp(project.title) }).click();
  await menu.getByRole("button", { name: "其他", exact: true }).click();
  await expect(labels).toHaveText(ordered);
  await page.screenshot({ path: info.outputPath("ordered-numbered-folder.png") });
  await page.keyboard.press("Escape");
  await prompt.fill("@素材");
  await expect(labels).toHaveText(ordered);
  await page.keyboard.press("Escape");
  await prompt.fill("");
  await prompt.fill("@");
  await menu.getByRole("button", { name: "收藏夹", exact: true }).click();
  await expect(labels).toHaveText(ordered.slice(1));
  await page.keyboard.press("Escape");
  for (const [id, filename] of [["numbered", "素材苹果（1）.png"], ["video", "素材镜头（1）.mp4"], ["audio", "素材声音（1）.mp3"]]) {
    await closeInspector();
    await card(id).locator(".node-float-label").click();
    await closeInspector();
    await card(id).hover();
    const downloaded = page.waitForEvent("download");
    await card(id).getByRole("button", { name: "下载", exact: true }).click();
    expect((await downloaded).suggestedFilename()).toBe(filename);
    await page.keyboard.press("Escape");
  }
  expect(sorts.length).toBeGreaterThan(3);
  expect(sorts.every(sort => sort === "type_created_at_desc")).toBe(true);
  expect(errors).toEqual([]);
});
