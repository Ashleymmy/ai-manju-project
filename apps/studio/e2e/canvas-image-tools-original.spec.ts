import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("image tools edit original pixels while canvas keeps thumbnails", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1500, height: 1050 });
  const fixture = await page.evaluate(() => {
    const render = (width: number, height: number, color: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = color; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#ffffff"; ctx.fillRect(width / 2, height / 2, 1, 1);
      return canvas.toDataURL("image/png").split(",")[1];
    };
    return { original: render(2048, 1024, "#1e82d2"), thumbnail: render(256, 128, "#888888") };
  });
  const original = Buffer.from(fixture.original, "base64"), thumbnail = Buffer.from(fixture.thumbnail, "base64");
  let savedImage: Buffer | undefined;
  let releaseOriginal: (() => void) | undefined;
  let holdOriginal = false;
  const requests: string[] = [], errors: string[] = [];
  const project = { id: "original-tools-qa", title: "原图工具验收", scope: "personal", owner_id: "qa" };
  let snapshot: any = {
    schema: "ai-manhua-studio-canvas", version: 3,
    nodes: [{ id: "original-node", kind: "image", title: "原图", content: "", x: 180, y: 180, width: 320, height: 160, imageAssetId: "original-asset",
      metadata: { assetId: "original-asset", assetScope: "personal", status: "success", naturalWidth: 2048, naturalHeight: 1024, quality: "high", imageResolution: "2K", model: "gpt-image-2" } }],
    edges: [], connections: [], groups: [], zoom: 80, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: .8 },
  };
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "qa-token");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (!path.startsWith("/api/")) return route.continue();
    const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "authorization,content-type,x-request-id,idempotency-key,range", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS" };
    if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    const respond = (data: unknown) => route.fulfill({ headers, json: { success: true, data, request_id: "original-tools-qa" } });
    if (/\/assets\/[^/]+\/content$/.test(path)) {
      requests.push(url.search);
      const isThumbnail = url.searchParams.has("thumbnail");
      if (holdOriginal && !isThumbnail) await new Promise<void>(resolve => { releaseOriginal = resolve; });
      return route.fulfill({ headers, contentType: "image/png", body: isThumbnail ? thumbnail : path.includes("edited-asset") ? savedImage! : original });
    }
    if (path === "/api/assets" && request.method() === "POST") {
      const form = await new Response(request.postDataBuffer()!, { headers: { "content-type": request.headers()["content-type"] } }).formData();
      savedImage = Buffer.from(await (form.get("file") as File).arrayBuffer());
      return respond({ id: "edited-asset", name: "原图-标注.png", type: "image", content_type: "image/png", size: savedImage.length });
    }
    if (/\/assets\/[^/]+$/.test(path)) return respond({ id: path.split("/").pop(), type: "image", name: "原图", content_type: "image/png" });
    if (path === "/api/auth/me") return respond({ id: "qa", account: "qa", role: "super_admin", status: "active" });
    if (path === "/api/announcements/current") return respond(null);
    if (path === "/api/user/preferences") return respond({ canvas: { promptPresets: [] } });
    if (path === "/api/ai/models") return respond({ models: [], image_models: ["gpt-image-2"], default_image_model: "gpt-image-2" });
    if (path === `/api/projects/${project.id}/snapshot`) {
      if (request.method() === "PUT") snapshot = request.postDataJSON().data;
      return respond({ project_id: project.id, version: 1, data: snapshot });
    }
    if (path === `/api/projects/${project.id}`) return respond({ ...project, data: snapshot });
    if (path === "/api/projects") return respond({ items: [project], total: 1 });
    if (path === "/api/asset-folders") return respond([]);
    if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return respond({ items: [], total: 0 });
  });
  await page.goto(`/canvas/${project.id}?scope=personal`);
  const node = page.locator('[data-node-id="original-node"]');
  await expect(node.locator("img").first()).toBeVisible();
  await expect.poll(() => requests.some(query => query.includes("thumbnail="))).toBe(true);
  const openTool = async (name: string) => {
    await node.locator(".node-float-label").click();
    await node.hover();
    await node.getByTitle("图片工具（更多）", { exact: true }).click();
    await page.getByRole("button", { name, exact: true }).click();
  };
  await openTool("蒙版修改");
  await expect(page.locator(".canvas-image-mask-stage canvas")).toHaveAttribute("width", "2048");
  await expect(page.locator(".canvas-image-mask-stage canvas")).toHaveAttribute("height", "1024");
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  await page.keyboard.press("Escape");
  await openTool("裁剪");
  await expect.poll(() => page.getByRole("dialog").locator("img").first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2048);
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  await page.keyboard.press("Escape");
  holdOriginal = true;
  await openTool("标注");
  await expect(page.getByRole("button", { name: "保存标注图片" })).toBeDisabled();
  await expect(page.getByText("正在加载原图…", { exact: true })).toBeVisible();
  await expect.poll(() => Boolean(releaseOriginal)).toBe(true);
  holdOriginal = false; releaseOriginal!();
  const stage = page.locator(".canvas-annotation-stage svg");
  await expect(stage).toHaveAttribute("viewBox", "0 0 2048 1024");
  await expect(page.getByText("原图 2048 × 1024 · 按原分辨率保存")).toBeVisible();
  const bounds = (await stage.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * .2, bounds.y + bounds.height * .2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .4, bounds.y + bounds.height * .4, { steps: 5 });
  await page.mouse.up();
  await page.screenshot({ path: testInfo.outputPath("annotation-original.png") });
  await page.getByRole("button", { name: "保存标注图片" }).click();
  await expect.poll(() => Boolean(savedImage)).toBe(true);
  expect(savedImage!.readUInt32BE(16)).toBe(2048);
  expect(savedImage!.readUInt32BE(20)).toBe(1024);
  const pixels = await page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0);
    return [Array.from(ctx.getImageData(10, 10, 1, 1).data), Array.from(ctx.getImageData(1024, 512, 1, 1).data)];
  }, savedImage!.toString("base64"));
  expect(pixels).toEqual([[30, 130, 210, 255], [255, 255, 255, 255]]);
  await expect.poll(() => snapshot.nodes.length).toBe(2);
  const edited = snapshot.nodes.find((item: any) => item.imageAssetId === "edited-asset");
  expect(edited.metadata).toMatchObject({ naturalWidth: 2048, naturalHeight: 1024, quality: "high", imageResolution: "2K" });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const editedNode = page.locator(`[data-node-id="${edited.id}"]`);
  await editedNode.locator(".node-float-label").click();
  await editedNode.hover();
  const downloadPromise = page.waitForEvent("download");
  await editedNode.getByTitle("下载", { exact: true }).click();
  const download = await downloadPromise;
  expect(await readFile((await download.path())!)).toEqual(savedImage);
  expect(errors).toEqual([]);
});
