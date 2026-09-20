import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const png = readFileSync(new URL("../client/public/comic-lab-pack/stickers/sticker_nice.png", import.meta.url));

async function openCanvas(page: Page, withVideos = false) {
  const video = withVideos ? Buffer.from(await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 640;
    const context = canvas.getContext("2d")!;
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: "video/mp4" });
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const done = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
    recorder.start();
    const draw = setInterval(() => {
      context.fillStyle = "#257964";
      context.fillRect(0, 0, 640, 640);
      context.fillStyle = "#ffffff";
      context.fillRect(Date.now() % 550, 100, 80, 80);
    }, 50);
    await new Promise(resolve => setTimeout(resolve, 2400));
    clearInterval(draw);
    recorder.stop();
    await done;
    stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  })) : null;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const project = { id: "agent-references-qa", title: "Agent References QA", scope: "personal", owner_id: "qa" };
  let snapshot: any = {
    schema: "ai-manhua-studio-canvas", version: 3,
    nodes: ["a", "b"].map((id, index) => ({ id, kind: "image", title: `Reference ${id}`, imageAssetId: `asset-${id}`, x: 100 + index * 300, y: 100, width: 240, height: 180, metadata: { assetId: `asset-${id}`, assetScope: "personal", status: "success" } })),
    edges: [], connections: [], groups: [], zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 },
  };
  if (withVideos) snapshot.nodes.push(...["v1", "v2"].map((id, index) => ({ id, kind: "video", title: `Video ${id}`, x: 100 + index * 340, y: 420, width: 320, height: 240, metadata: { assetId: `asset-${id}`, assetScope: "personal", status: "success", mimeType: "video/mp4" } })));
  const chats: any[] = [];
  const edits: Buffer[] = [];
  const videoRequests: any[] = [];
  let failReferences = false;
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
      "Access-Control-Allow-Headers": "authorization,content-type,x-request-id,idempotency-key",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    if (/\/assets\/asset-(a|b|generated)\/content$/.test(url.pathname)) {
      if (failReferences && url.searchParams.get("thumbnail") === "640") return route.fulfill({ headers, status: 503, body: "Unavailable" });
      return route.fulfill({ headers, contentType: "image/png", body: png });
    }
    if (/\/assets\/asset-v[12]\/content$/.test(url.pathname)) {
      return route.fulfill({ headers, contentType: url.searchParams.has("poster") ? "image/png" : "video/mp4", body: url.searchParams.has("poster") ? png : video! });
    }
    let data: unknown = { items: [], total: 0 };
    if (url.pathname === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active", display_name: "QA" };
    else if (url.pathname === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (url.pathname === "/api/ai/models") data = { models: ["gpt-5.5"], text_models: ["gpt-5.5"], agent_text_models: ["gpt-5.5"], image_models: ["gpt-image-2"], default_text_model: "gpt-5.5", default_image_model: "gpt-image-2", video_models: ["doubao-seedance-2-5-pro"], default_video_model: "doubao-seedance-2-5-pro" };
    else if (url.pathname === `/api/projects/${project.id}/snapshot`) {
      if (request.method() === "PUT") snapshot = request.postDataJSON().data;
      data = { project_id: project.id, version: 1, data: snapshot };
    } else if (url.pathname === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
    else if (url.pathname === "/api/projects") data = { items: [project], total: 1 };
    else if (url.pathname === "/api/ai/text") {
      chats.push(request.postDataJSON());
      data = chats.length === 1 ? { content: "准备生成", tool_calls: [{ id: "call-generate", type: "function", function: { name: withVideos ? "canvas_generate_video" : "canvas_generate_image", arguments: JSON.stringify({ prompt: "A new scene", model: withVideos ? "doubao-seedance-2-5-pro" : "gpt-image-2" }) } }] } : { content: "已完成", tool_calls: [] };
    } else if (url.pathname === "/api/ai/image/edits") {
      edits.push(request.postDataBuffer()!);
      data = { job_id: "job-ref" };
    } else if (url.pathname === "/api/ai/contents/generations/tasks" && request.method() === "POST") {
      videoRequests.push(request.postDataJSON());
      // Stop at the provider boundary: verify real uploads without invoking a paid generation.
      return route.fulfill({ headers, status: 400, json: { success: false, error: { message: "QA provider boundary reached" } } });
    } else if (url.pathname === "/api/jobs/job-ref") data = { id: "job-ref", type: "image.generate", status: "succeeded", state: "succeeded", scope: "personal", result: { outputs: [{ asset_id: "asset-generated", name: "Generated", content_type: "image/png" }] } };
    if (url.pathname === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data, request_id: "agent-references-qa" } });
  });
  await page.goto(`/canvas/${project.id}?scope=personal`);
  await expect(page.locator(".real-canvas-stage")).toBeVisible();
  await page.getByRole("button", { name: "打开 Agent", exact: true }).click();
  return { chats, edits, videoRequests, video, errors, get snapshot() { return snapshot; }, failReferences: () => { failReferences = true; } };
}

test("ordinary successive clicks accumulate nameless image references and pass both files to generation", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await openCanvas(page);
  await page.locator('[data-node-id="a"] > img').click();
  await page.locator('[data-node-id="b"] > img').click();
  const references = page.getByLabel("本次引用", { exact: true });
  await expect(references.locator("img")).toHaveCount(2);
  await expect(references.locator(".agent-reference-title")).toHaveCount(0);
  await expect(references).toHaveText("");
  await page.locator('[data-node-id="b"] .node-float-label').click();
  await expect(references.locator("img")).toHaveCount(2);
  await page.locator(".real-canvas-stage").click({ position: { x: 720, y: 620 } });
  await expect(references.locator("img")).toHaveCount(2);
  await expect(references.locator("img").first()).toHaveJSProperty("naturalWidth", 260);
  await page.screenshot({ path: testInfo.outputPath("agent-references-desktop.png") });
  await page.locator(".agent-composer textarea").fill("参考这两张图片生成一个新场景");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".agent-pending-tool")).toBeVisible();
  const parts = state.chats[0].messages.at(-1).content;
  expect(parts.filter((part: any) => part.type === "image_url")).toEqual([1, 2].map(() => ({ type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } })));
  // The visible draft changes, but the pending tool must retain both original references.
  await references.getByRole("button", { name: "移除引用：Reference b" }).click();
  await page.locator(".agent-pending-actions").getByRole("button", { name: "执行", exact: true }).click();
  await expect.poll(() => state.edits.length).toBe(1);
  const body = state.edits[0];
  expect(body.toString().match(/name="image"/g)).toHaveLength(2);
  expect(body.includes(png)).toBe(true);
  expect(body.toString()).toContain("A new scene");
  await expect(page.locator(".agent-msg-assistant").last()).toContainText("已完成");
  await expect(references.locator(".agent-reference")).toHaveCount(1);
  await expect(page.getByLabel("消息引用").locator(".agent-reference-title")).toHaveCount(0);
  expect(state.snapshot.nodes.find((node: any) => node.id === "a").imageAssetId).toBe("asset-a");
  expect(state.errors).toEqual([]);
});

test("removed references stay out of requests and thumbnail layout fits a narrow viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await openCanvas(page);
  await page.locator('[data-node-id="a"] .node-float-label').click();
  await page.locator('[data-node-id="b"] .node-float-label').click();
  await page.setViewportSize({ width: 390, height: 844 });
  const references = page.getByLabel("本次引用", { exact: true });
  await expect(references).toBeVisible();
  const bounds = await references.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  const composer = await page.locator(".agent-composer").boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(composer!.y);
  await page.screenshot({ path: testInfo.outputPath("agent-references-mobile.png") });
  await references.getByRole("button", { name: "移除引用：Reference b" }).click();
  await page.locator(".agent-composer textarea").fill("参考此图");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => state.chats.length).toBe(1);
  const parts = state.chats[0].messages.at(-1).content;
  expect(parts.filter((part: any) => part.type === "image_url")).toHaveLength(1);
  expect(parts.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n")).not.toContain("@[node:b]");
  expect(state.errors).toEqual([]);
});

test("unavailable image references block sending and report a recoverable error", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await openCanvas(page);
  await page.locator('[data-node-id="a"] .node-float-label').click();
  state.failReferences();
  await page.locator(".agent-composer textarea").fill("参考此图");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".agent-msg-error")).toContainText("无法读取引用图片");
  expect(state.chats).toHaveLength(0);
  expect(state.edits).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test("image and video clicks accumulate together, removed videos can be re-added and both clips reach generation", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await openCanvas(page, true);
  const references = page.getByLabel("本次引用", { exact: true });
  for (const id of ["a", "b", "v1", "v2"]) {
    await page.locator(`[data-node-id="${id}"] > ${id.startsWith("v") ? "video" : "img"}`).click({ position: { x: 100, y: 70 } });
  }
  await expect(references.locator(".agent-reference-media")).toHaveCount(4);
  await expect(references.locator(".agent-reference-title")).toHaveCount(0);
  await expect(references.locator("img[src*='poster=1']")).toHaveCount(2);
  await expect(references.locator("img[src*='poster=1']").first()).toHaveJSProperty("naturalWidth", 260);
  await references.getByRole("button", { name: "移除引用：Video v2" }).click();
  await expect(references.locator(".agent-reference-media")).toHaveCount(3);
  await page.locator('[data-node-id="v2"] .node-float-label').click();
  await expect(references.locator(".agent-reference-media")).toHaveCount(4);
  await page.locator(".real-canvas-stage").click({ position: { x: 790, y: 30 } });
  await expect(references.locator(".agent-reference-media")).toHaveCount(4);
  await page.screenshot({ path: testInfo.outputPath("accumulated-image-video-references.png") });
  await page.locator(".agent-composer textarea").fill("参考这两张图片和两段视频生成新视频");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.locator(".agent-pending-actions").getByRole("button", { name: "执行", exact: true }).click();
  await expect.poll(() => state.videoRequests.length).toBe(1);
  const content = state.videoRequests[0].content;
  expect(content.filter((part: any) => part.type === "image_url")).toHaveLength(2);
  expect(content.filter((part: any) => part.type === "video_url")).toEqual([1, 2].map(() => ({ type: "video_url", video_url: { url: `data:video/mp4;base64,${state.video!.toString("base64")}` }, role: "reference_video" })));
  await expect(page.locator(".agent-stop-btn")).toHaveCount(0);
  expect(state.errors).toEqual([]);
});
