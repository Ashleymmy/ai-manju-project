import { expect, test } from "@playwright/test";

test("overwritten videos survive refresh, play in history and apply independently", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Record different source proportions to exercise replacement without remote media.
  const fixtures = await page.evaluate(async () => {
    const results: Array<{ width: number; height: number; bytes: number[]; poster: string }> = [];
    for (const [width, height] of [[320, 180], [180, 320], [240, 240]]) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      const stream = canvas.captureStream(10);
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => chunks.push(event.data);
      const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
      recorder.start();
      const draw = setInterval(() => {
        context.fillStyle = "#327965";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = "#f8dc56";
        context.lineWidth = 8;
        context.strokeRect(8, 8, width - 16, height - 16);
        context.fillStyle = "#ffffff";
        context.fillRect(Date.now() % (width - 50), 60, 40, 40);
      }, 50);
      await new Promise(resolve => setTimeout(resolve, 1000));
      clearInterval(draw);
      recorder.stop();
      await stopped;
      stream.getTracks().forEach(track => track.stop());
      results.push({ width, height, bytes: Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())), poster: canvas.toDataURL("image/png").split(",")[1] });
    }
    return results;
  });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const project = { id: "video-history-qa", title: "Video history QA", scope: "personal", owner_id: "qa" };
  let snapshot: any = {
    schema: "ai-manhua-studio-canvas", version: 3,
    nodes: [
      { id: "reference", kind: "text", title: "Scene", content: "A quiet lake", x: 100, y: 100, width: 300, height: 180 },
      { id: "video", kind: "video", title: "Original video", content: "A quiet lake", x: 500, y: 100, width: 420, height: 260,
        metadata: { assetId: "video-old", assetScope: "personal", status: "success", generationMode: "video", model: "sora-2", prompt: "A quiet lake", composerContent: "@[node:reference] Slow pan", size: "1280x720", seconds: "5", mimeType: "video/webm", generatedAt: "2026-09-10T08:00:00.000Z" } },
    ],
    edges: [], connections: [], groups: [], zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 },
  };
  let generations = 0;
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
      "Access-Control-Allow-Headers": "authorization,content-type,x-request-id,range",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    if (/\/assets\/video-(old|\d+)\/content$/.test(url.pathname)) {
      const id = url.pathname.split("/").at(-2)!;
      const fixture = fixtures[id === "video-old" ? 0 : Number(id.split("-").at(-1))];
      return route.fulfill({ headers, contentType: url.searchParams.has("poster") ? "image/png" : "video/webm", body: url.searchParams.has("poster") ? Buffer.from(fixture.poster, "base64") : Buffer.from(fixture.bytes) });
    }
    let data: unknown = { items: [], total: 0 };
    if (url.pathname === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active", display_name: "QA" };
    else if (url.pathname === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (url.pathname === "/api/ai/models") data = { models: [], video_models: ["sora-2"], default_video_model: "sora-2" };
    else if (url.pathname === "/api/projects/video-history-qa/snapshot") {
      if (request.method() === "PUT") snapshot = request.postDataJSON().data;
      data = { project_id: project.id, version: 1, data: snapshot };
    } else if (url.pathname === "/api/projects/video-history-qa") data = { ...project, data: snapshot };
    else if (url.pathname === "/api/projects") data = { items: [project], total: 1 };
    else if (url.pathname === "/api/ai/videos" && request.method() === "POST") data = { id: `job-video-${++generations}` };
    else if (/\/jobs\/job-video-\d+$/.test(url.pathname)) {
      const index = url.pathname.split("-").at(-1);
      data = { id: `job-video-${index}`, type: "video.generate", status: "succeeded", state: "succeeded", scope: "personal", result: { outputs: [{ asset_id: `video-${index}`, name: `Video ${index}`, content_type: "video/webm" }] } };
    }
    if (url.pathname === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data, request_id: "video-history-qa" } });
  });
  await page.goto("/canvas/video-history-qa?scope=personal");
  const node = page.locator('[data-node-id="video"]');
  const nodeRatio = () => node.evaluate(element => parseFloat((element as HTMLElement).style.width) / parseFloat((element as HTMLElement).style.height));
  await expect.poll(nodeRatio).toBeCloseTo(320 / 180, 4);
  await node.locator(".node-float-label").click();
  const inspector = page.locator(".inspector-panel");
  for (let index = 1; index <= 2; index++) {
    await inspector.getByRole("button", { name: "生成", exact: true }).click();
    await expect.poll(() => snapshot.nodes.find((node: any) => node.id === "video")?.metadata.assetId).toBe(`video-${index}`);
    const { width, height } = fixtures[index];
    await expect.poll(nodeRatio).toBeCloseTo(width / height, 4);
    await expect(node.locator("video")).toHaveJSProperty("videoWidth", width);
    await expect(node.locator("video")).toHaveJSProperty("videoHeight", height);
    await expect.poll(() => snapshot.nodes.find((item: any) => item.id === "video")?.metadata.naturalWidth).toBe(width);
    // Display follows the returned file, not the requested landscape size or old video.
    expect(snapshot.nodes.find((item: any) => item.id === "video")?.metadata.size).toBe("1280x720");
    await page.screenshot({ path: testInfo.outputPath(`generated-video-${width}x${height}.png`) });
  }
  await page.reload();
  await expect.poll(nodeRatio).toBeCloseTo(1, 4);
  await page.getByRole("button", { name: "生成历史", exact: true }).click();
  const dialog = page.locator(".canvas-generation-history-dialog");
  await dialog.getByRole("button", { name: "视频", exact: true }).click();
  const original = dialog.getByTitle("Original video", { exact: true });
  await expect(original).toBeVisible();
  await expect(dialog.getByTitle("Video 1", { exact: true })).toBeVisible();
  await expect(dialog.getByTitle("Video 2", { exact: true })).toBeVisible();
  await original.click();
  const player = dialog.locator(".canvas-generation-history-hero video");
  await expect(player).toHaveAttribute("src", /\/assets\/video-old\/content/);
  await player.evaluate(async (video: HTMLVideoElement) => { video.muted = true; video.loop = true; await video.play(); });
  await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.2);
  await expect(player).toHaveJSProperty("videoWidth", 320);
  await expect(player).toHaveJSProperty("videoHeight", 180);
  await page.screenshot({ path: testInfo.outputPath("overwritten-video-history.png") });
  await dialog.getByRole("button", { name: "应用到画布", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => snapshot.nodes.length).toBe(3);
  expect(snapshot.nodes.find((node: any) => node.id === "video").metadata.assetId).toBe("video-2");
  expect(snapshot.nodes.find((node: any) => node.metadata?.appliedFromHistory)?.metadata.assetId).toBe("video-old");
  await page.reload();
  await expect(page.locator(".real-canvas-node.video")).toHaveCount(2);
  expect(generations).toBe(2);
  expect(errors).toEqual([]);
});
