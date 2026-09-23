import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { expect, test, type Page } from "@playwright/test";

const png = readFileSync(new URL("../client/public/comic-lab-pack/stickers/sticker_nice.png", import.meta.url));
const project = { id: "canvas-download-qa", title: "画布下载验收", scope: "personal", owner_id: "download-qa" };

async function setup(page: Page, emptyMedia = false) {
  await page.setViewportSize({ width: 1600, height: 1100 });
  let snapshot: any = {
    schema: "ai-manhua-studio-canvas", version: 3,
    nodes: [
      ...["first", "second"].map((id, n) => ({ id, kind: "image", title: "同名图片", imageAssetId: id,
        metadata: { assetScope: n ? "team" : "personal", mimeType: "image/png" }, x: 180 + n * 360, y: 240, width: 280, height: 210 })),
      { id: "text", kind: "text", title: "文本", content: "山川与河流", x: 900, y: 240, width: 280, height: 170 },
      { id: "empty-audio", kind: "audio", title: "音频轨道", x: 900, y: 490, width: 280, height: 160 },
      { id: "excluded", kind: "image", title: "未选图片", imageSrc: `data:image/png;base64,${png.toString("base64")}`, x: 1600, y: 1500, width: 280, height: 210 },
    ], edges: [], groups: [], zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 },
  };
  if (emptyMedia) snapshot.nodes = ["image", "video", "audio"].map((kind, index) => ({
    id: `empty-${kind}`, kind, title: { image: "图片", video: "视频片段", audio: "音频轨道" }[kind],
    x: 180 + index * 360, y: 400, width: 280, height: 180,
  }));
  const originalRequests: Array<{ id: string; scope: string | null }> = [];
  let audioUploads = 0;
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "canvas-download-test-token");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (!path.startsWith("/api/")) return route.continue();
    const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "authorization,content-type,x-request-id", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS" };
    if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    if (/\/api\/assets\/[^/]+\/content$/.test(path)) {
      const id = path.split("/")[3];
      if (!url.searchParams.has("thumbnail") && id !== "uploaded-audio") originalRequests.push({ id, scope: url.searchParams.get("scope") });
      return route.fulfill({ headers, contentType: id === "uploaded-audio" ? "audio/wav" : "image/png", body: png });
    }
    let data: any = { items: [], total: 0 };
    if (path === "/api/auth/me") data = { id: "download-qa", account: "qa", role: "super_admin", status: "active" };
    else if (path === "/api/announcements/current") data = null;
    else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (path === "/api/ai/models") data = { image_models: ["gpt-image-2"], default_image_model: "gpt-image-2", video_models: ["official::seedance-2.0"] };
    else if (path === "/api/member/quote") data = { credits: 10, params: { pricing_source: "membership_price_sheet" } };
    else if (path === `/api/projects/${project.id}/snapshot`) {
      if (request.method() === "PUT") snapshot = request.postDataJSON().data;
      data = { project_id: project.id, version: 1, data: snapshot };
    } else if (path === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
    else if (path === "/api/projects") data = { items: [project], total: 1 };
    else if (path === "/api/asset-folders") data = [];
    else if (path === "/api/assets" && request.method() === "POST") {
      audioUploads++;
      expect(request.postDataBuffer()?.toString()).toContain('name="type"\r\n\r\naudio');
      data = { id: "uploaded-audio", type: "audio", name: "录音.wav", content_type: "audio/wav", size: 48 };
    }
    if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data, request_id: "download-test" } });
  });
  await page.goto(`/canvas/${project.id}?scope=personal`);
  await expect(page.locator(`[data-node-id="${emptyMedia ? "empty-image" : "first"}"]`)).toBeVisible();
  const notice = page.getByRole("button", { name: "知道了", exact: true });
  if (await notice.isVisible()) await notice.click();
  return { originalRequests, snapshot: () => snapshot, audioUploads: () => audioUploads };
}

for (const target of ["blank", "node", "group", "selection-bar"] as const) test(`marquee batch download from ${target} includes originals only`, async ({ page }, testInfo) => {
  const state = await setup(page);
  await page.mouse.move(120, 215);
  await page.mouse.down();
  await page.mouse.move(1250, 800, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(".real-canvas-node.selected")).toHaveCount(4);
  if (target === "group") await page.getByRole("button", { name: "组成分组", exact: true }).click();
  let downloadButton;
  if (target === "selection-bar") downloadButton = page.locator(".canvas-group-pending-actions").getByRole("button", { name: "批量下载", exact: true });
  else {
    if (target === "node") await page.locator('[data-node-id="first"]').click({ button: "right", position: { x: 100, y: 100 } });
    else if (target === "group") await page.locator(".canvas-group-header").click({ button: "right", position: { x: 10, y: 34 } });
    else await page.mouse.click(840, 620, { button: "right" });
    await expect(page.locator(".canvas-context-menu").getByRole("button", { name: "批量注册拟真人素材", exact: true })).toBeVisible();
    await page.locator(".canvas-context-menu").screenshot({ path: testInfo.outputPath("download-menu.png") });
    downloadButton = page.locator(".canvas-context-menu").getByRole("button", { name: "批量下载", exact: true });
  }
  const pendingDownload = page.waitForEvent("download");
  await downloadButton.click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe("画布下载验收-所选媒体.zip");
  const path = testInfo.outputPath("selection.zip");
  await download.saveAs(path);
  const files = unzipSync(readFileSync(path));
  // Canvas normalizes duplicate node titles on load; downloads preserve those
  // final titles (ZIP collision suffixing is covered separately at service level).
  expect(Object.keys(files)).toEqual(["同名图片.png", "同名图片1.png"]);
  expect(Buffer.from(files["同名图片.png"])).toEqual(png);
  expect(Buffer.from(files["同名图片1.png"])).toEqual(png);
  expect(state.originalRequests).toEqual([{ id: "first", scope: "personal" }, { id: "second", scope: "team" }]);
  await expect(page.getByText("已打包 2 个原文件，跳过 2 个非媒体或空节点", { exact: true })).toBeVisible();
});

test("empty audio node opens an audio picker and uploads into the same node", async ({ page }, testInfo) => {
  const state = await setup(page);
  const node = page.locator('[data-node-id="empty-audio"]');
  await node.hover();
  const upload = node.getByRole("button", { name: "上传音频", exact: true });
  await expect(upload).toBeVisible();
  const bounds = (await node.boundingBox())!;
  expect((await upload.boundingBox())!.y + (await upload.boundingBox())!.height).toBeLessThan(bounds.y);
  await page.screenshot({ path: testInfo.outputPath("audio-upload-entry.png"), clip: { x: bounds.x - 20, y: bounds.y - 90, width: bounds.width + 40, height: bounds.height + 110 } });
  const picker = page.waitForEvent("filechooser");
  await node.getByRole("button", { name: "上传音频", exact: true }).click();
  const chooser = await picker;
  expect(await chooser.element().getAttribute("accept")).toBe("audio/*");
  await chooser.setFiles({ name: "录音.wav", mimeType: "audio/wav", buffer: Buffer.from("RIFFtest-audio") });
  await expect.poll(state.audioUploads).toBe(1);
  await expect.poll(() => state.snapshot().nodes.find((n: any) => n.id === "empty-audio")?.imageAssetId).toBe("uploaded-audio");
  expect(state.snapshot().nodes).toHaveLength(5);
  await expect(node.locator("audio")).toBeVisible();
  await node.screenshot({ path: testInfo.outputPath("audio-uploaded.png") });
});

for (const kind of ["image", "video", "audio"] as const) test(`${kind} upload uses the original floating pill above the node`, async ({ page }, testInfo) => {
  await setup(page, true);
  const node = page.locator(`[data-node-id="empty-${kind}"]`);
  await node.hover();
  const upload = node.locator(":scope > .node-upload-pill");
  await expect(upload).toHaveText(kind === "image" ? "上传" : kind === "video" ? "上传视频" : "上传音频");
  await expect(node.locator(".node-media-placeholder")).toHaveCount(0);
  const bounds = (await node.boundingBox())!;
  const button = (await upload.boundingBox())!;
  expect(button.y + button.height).toBeLessThan(bounds.y);
  await page.screenshot({ path: testInfo.outputPath(`${kind}-upload-pill.png`), clip: { x: bounds.x - 20, y: bounds.y - 90, width: bounds.width + 40, height: bounds.height + 110 } });
  const picker = page.waitForEvent("filechooser");
  await upload.click();
  expect(await (await picker).element().getAttribute("accept")).toBe(`${kind}/*`);
  await page.mouse.move(1400, 950);
  await expect(upload).toHaveCount(0);
  if (kind !== "image") {
    await node.dblclick();
    await expect(node.locator(".node-inline-editor")).toBeVisible();
  }
});

test("text toolbar keeps price and font controls on one line at different zooms", async ({ page }, testInfo) => {
  await setup(page);
  const node = page.locator('[data-node-id="text"]');
  await node.click();
  const toolbar = node.locator(".node-hover-toolbar");
  await expect(toolbar.locator(".generation-price-compact")).toContainText("10");
  for (const zoom of [100, 60, 150]) {
    await page.locator(".real-canvas-grid").evaluate((element, value) => { (element as HTMLElement).style.setProperty("--canvas-zoom", String(value)); }, zoom);
    const bounds = await toolbar.evaluate(element => {
      const toolbarRect = element.getBoundingClientRect();
      const price = element.querySelector(".generation-price")!.getBoundingClientRect();
      return { toolbarHeight: toolbarRect.height, priceHeight: price.height, priceTop: price.top, toolbarTop: toolbarRect.top };
    });
    expect(bounds.priceHeight).toBeLessThanOrEqual(bounds.toolbarHeight);
    expect(bounds.priceTop).toBeGreaterThanOrEqual(bounds.toolbarTop);
  }
  await page.locator(".real-canvas-grid").evaluate(element => { (element as HTMLElement).style.setProperty("--canvas-zoom", "100"); });
  await expect(toolbar.getByLabel("当前字号")).toHaveText("14");
  await toolbar.getByTitle("增大字号", { exact: true }).click();
  await expect(toolbar.getByLabel("当前字号")).toHaveText("16");
  await toolbar.screenshot({ path: testInfo.outputPath("text-toolbar.png") });
});
