import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const png = readFileSync(new URL("../client/public/comic-lab-pack/stickers/sticker_nice.png", import.meta.url));

async function openCanvas(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const project = { id: "clipboard-qa", title: "Clipboard QA", scope: "personal", owner_id: "qa" };
  let snapshot: any = { schema: "ai-manhua-studio-canvas", version: 3, nodes: [], edges: [], connections: [], groups: [], zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 } };
  const uploads: string[] = [];
  let failNext = false;
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "qa-token");
    localStorage.setItem("ai-manju:token-store", "local");
  });
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
    if (/\/assets\/pasted-\d+\/content$/.test(url.pathname)) return route.fulfill({ headers, contentType: "image/png", body: png });
    let data: unknown = { items: [], total: 0 };
    if (url.pathname === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active", display_name: "QA" };
    else if (url.pathname === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (url.pathname === "/api/projects/clipboard-qa/snapshot") {
      if (request.method() === "PUT") snapshot = request.postDataJSON().data;
      data = { project_id: project.id, version: 1, data: snapshot };
    } else if (url.pathname === "/api/projects/clipboard-qa") data = { ...project, data: snapshot };
    else if (url.pathname === "/api/projects") data = { items: [project], total: 1 };
    else if (url.pathname === "/api/assets" && request.method() === "POST") {
      uploads.push(request.postData() || "");
      if (failNext) {
        failNext = false;
        return route.fulfill({ headers, status: 503, json: { success: false, error: { message: "Upload unavailable" } } });
      }
      data = { id: `pasted-${uploads.length}`, name: `Pasted ${uploads.length}`, type: "image", content_type: "image/png", size: png.length };
    }
    if (url.pathname === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data, request_id: "clipboard-qa" } });
  });
  await page.goto("/canvas/clipboard-qa?scope=personal");
  await expect(page.locator(".real-canvas-stage")).toBeVisible();
  return { get snapshot() { return snapshot; }, uploads, errors, failNextUpload: () => { failNext = true; } };
}

async function focusCanvas(page: Page) {
  const close = page.locator(".inspector-panel").getByRole("button", { name: "关闭面板", exact: true });
  if (await close.isVisible()) await close.click();
  await page.locator(".real-canvas-stage").click({ position: { x: 1100, y: 100 } });
}

async function copyImage(page: Page) {
  await page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]);
  }, png.toString("base64"));
}

test("Ctrl+V imports an external image after a toolbar click and a real blank-canvas click", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await openCanvas(page);
  const background = page.getByRole("button", { name: "网格背景", exact: true });
  await background.click();
  await expect(background).toBeFocused();
  await focusCanvas(page);
  await expect(page.locator(".real-canvas-stage")).toBeFocused();
  await copyImage(page);
  await page.keyboard.press("Control+v");
  await expect.poll(() => state.snapshot.nodes.length).toBe(1);
  expect(state.uploads).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test("clicking blank canvas after editing restores image paste without blurring the editor in test code", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await openCanvas(page);
  await focusCanvas(page);
  await page.evaluate(() => navigator.clipboard.writeText("Existing prompt"));
  await page.keyboard.press("Control+v");
  const editor = page.locator(".inspector-panel textarea.node-card-prompt");
  await expect(editor).toBeVisible();
  await editor.click();
  await expect(editor).toBeFocused();
  await page.locator(".real-canvas-stage").click({ position: { x: 1100, y: 100 } });
  await expect(page.locator(".real-canvas-stage")).toBeFocused();
  await copyImage(page);
  await page.keyboard.press("Control+v");
  await expect.poll(() => state.snapshot.nodes.length).toBe(2);
  expect(state.snapshot.nodes.map((node: any) => node.kind)).toEqual(["text", "image"]);
  expect(state.uploads).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test("native external image and text paste persist without breaking internal node copies or editor paste", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await openCanvas(page);
  await focusCanvas(page);
  await copyImage(page);
  await page.keyboard.press("Control+v");
  await expect.poll(() => state.snapshot.nodes.length).toBe(1);
  expect(state.uploads).toHaveLength(1);
  expect(state.uploads[0]).toContain('"canvas_node_ingestion":"paste"');
  expect(state.snapshot.nodes[0]).toMatchObject({ kind: "image", metadata: { assetId: "pasted-1", canvasOrigin: "imported", assetScope: "personal" } });
  await expect(page.locator('.real-canvas-node.image img').first()).toHaveJSProperty("naturalWidth", 260);
  await page.screenshot({ path: testInfo.outputPath("pasted-image.png") });
  await page.locator(".canvas-head-actions").getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator(".real-canvas-node.image")).toHaveCount(0);
  await page.locator(".canvas-head-actions").getByRole("button", { name: "重做", exact: true }).click();
  await expect(page.locator(".real-canvas-node.image")).toHaveCount(1);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.reload();
  await expect(page.locator(".real-canvas-node.image")).toHaveCount(1);

  await page.locator(".real-canvas-node.image .node-float-label").click();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Control+c");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/^ai-manju-canvas-nodes:/);
  await page.keyboard.press("Control+v");
  await expect(page.locator(".real-canvas-node.image")).toHaveCount(2);
  expect(state.uploads).toHaveLength(1);

  await focusCanvas(page);
  await copyImage(page);
  await page.keyboard.press("Control+v");
  await expect.poll(() => state.snapshot.nodes.length).toBe(3);
  expect(state.uploads).toHaveLength(2);
  expect(state.snapshot.nodes.filter((node: any) => node.metadata.assetId === "pasted-1")).toHaveLength(2);
  expect(state.snapshot.nodes.filter((node: any) => node.metadata.assetId === "pasted-2")).toHaveLength(1);

  await focusCanvas(page);
  await page.evaluate(() => navigator.clipboard.writeText("External text\nSecond line"));
  await page.keyboard.press("Control+v");
  await expect.poll(() => state.snapshot.nodes.length).toBe(4);
  expect(state.snapshot.nodes.at(-1)).toMatchObject({ kind: "text", content: "External text\nSecond line" });
  await expect(page.locator(".real-canvas-node.text")).toContainText("External text");
  const editor = page.locator(".inspector-panel textarea.node-card-prompt");
  await expect(editor).toBeVisible();
  await editor.fill("");
  await page.evaluate(() => navigator.clipboard.writeText("Prompt line one\nPrompt line two"));
  await editor.focus();
  await expect(editor).toBeFocused();
  await page.keyboard.press("Control+v");
  await expect(editor).toHaveValue("Prompt line one\nPrompt line two");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  expect(state.snapshot.nodes).toHaveLength(4);
  expect(state.uploads).toHaveLength(2);
  await page.reload();
  await expect(page.locator(".real-canvas-node")).toHaveCount(4);
  expect(state.errors).toEqual([]);
});

test("context-menu paste imports system images and surfaces denied permission", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await openCanvas(page);
  await copyImage(page);
  await page.locator(".real-canvas-stage").click({ button: "right", position: { x: 1100, y: 100 } });
  await page.getByRole("button", { name: "粘贴", exact: true }).click();
  await expect.poll(() => state.snapshot.nodes.length).toBe(1);
  await page.evaluate(() => { navigator.clipboard.read = async () => { throw new DOMException("Denied", "NotAllowedError"); }; });
  await focusCanvas(page);
  await page.locator(".real-canvas-stage").click({ button: "right", position: { x: 1100, y: 100 } });
  await page.getByRole("button", { name: "粘贴", exact: true }).click();
  await expect(page.getByText(/无法读取剪贴板/)).toBeVisible();
  expect(state.uploads).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test("partial import failure preserves successful clipboard files and rejects unsupported files", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await openCanvas(page);
  state.failNextUpload();
  await page.locator(".real-canvas-stage").evaluate(element => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File(["bad"], "failed.png", { type: "image/png" }));
    clipboardData.items.add(new File(["good"], "good.jpg"));
    clipboardData.items.add(new File(["unsupported"], "file.pdf", { type: "application/pdf" }));
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => state.snapshot.nodes.length).toBe(1);
  await expect(page.getByText("已添加 1 个媒体节点，1 个导入失败", { exact: true })).toBeVisible();
  expect(state.uploads).toHaveLength(2);
  expect(state.snapshot.nodes[0].metadata.assetId).toBe("pasted-2");
  expect(state.errors).toEqual([]);
});

test("clipboard media files create their corresponding node types", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await openCanvas(page);
  await page.locator(".real-canvas-stage").evaluate(element => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File(["video fixture"], "clip.mp4"));
    clipboardData.items.add(new File(["audio fixture"], "sound.wav", { type: "application/octet-stream" }));
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => state.snapshot.nodes.length).toBe(2);
  expect(state.snapshot.nodes.map((node: any) => node.kind)).toEqual(["video", "audio"]);
  expect(state.uploads[0]).toContain("Content-Type: video/mp4");
  expect(state.uploads[1]).toContain("Content-Type: audio/wav");
  await page.reload();
  await expect(page.locator(".real-canvas-node.video")).toHaveCount(1);
  await expect(page.locator(".real-canvas-node.audio")).toHaveCount(1);
  expect(state.errors).toEqual([]);
});

test("leaving the canvas during a clipboard upload does not write late nodes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await openCanvas(page);
  let finishUpload!: () => void;
  const uploadWait = new Promise<void>(resolve => { finishUpload = resolve; });
  await page.route("**/api/assets?*", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    await uploadWait;
    return route.fallback();
  });
  await focusCanvas(page);
  await copyImage(page);
  const started = page.waitForRequest(request => new URL(request.url()).pathname === "/api/assets" && request.method() === "POST");
  await page.keyboard.press("Control+v");
  await started;
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  finishUpload();
  await expect(page.getByText("画布已切换，已上传素材保留在原工作区资产库", { exact: true })).toBeVisible();
  expect(state.snapshot.nodes).toHaveLength(0);
  expect(state.uploads).toHaveLength(1);
  expect(state.errors).toEqual([]);
});
