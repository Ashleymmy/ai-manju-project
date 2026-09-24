import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

function wav(seconds: number) {
  const rate = 8000, dataBytes = seconds * rate * 2;
  const file = Buffer.alloc(44 + dataBytes);
  file.write("RIFF", 0); file.writeUInt32LE(file.length - 8, 4); file.write("WAVEfmt ", 8);
  file.writeUInt32LE(16, 16); file.writeUInt16LE(1, 20); file.writeUInt16LE(1, 22);
  file.writeUInt32LE(rate, 24); file.writeUInt32LE(rate * 2, 28); file.writeUInt16LE(2, 32); file.writeUInt16LE(16, 34);
  file.write("data", 36); file.writeUInt32LE(dataBytes, 40);
  return file;
}

for (const unreadable of [false, true]) {
test(`canvas checks ${unreadable ? "unreadable audio and recovers" : "real audio duration and the selected model contract"} before generation`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  const image = readFileSync(new URL("../client/public/comic-lab-pack/stickers/sticker_nice.png", import.meta.url));
  const project = { id: "preflight-qa", title: "视频生成前检查", scope: "personal", owner_id: "qa" };
  const short = "official::doubao-seedance-2-0-260128", long = "official::doubao-seedance-2-5-260628";
  const caps = (seconds: number) => ({ resolutions: ["720p"], ratios: ["16:9", "1:1"], supports: ["text", "reference_image", "reference_audio"], has_audio: true,
    references: { images: 9, videos: 0, audios: 3, audio_only: false, media_min_duration_ms: 2000, media_max_duration_ms: seconds * 1000, media_max_total_duration_ms: seconds * 1000 } });
  let snapshot: any = { schema: "ai-manhua-studio-canvas", version: 3, zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 }, groups: [],
    nodes: [
      { id: "video", kind: "video", title: "视频", content: "让角色跟随节奏运动", x: 650, y: 160, width: 320, height: 220, metadata: { generationMode: "video", model: short, seconds: "5", resolution: "720p", size: "16:9" } },
      { id: "audio", kind: "audio", title: "20秒配乐", content: "", imageAssetId: "audio-file", x: 230, y: 100, width: 240, height: 120 },
      { id: "image", kind: "image", title: "参考图", content: "", imageAssetId: "image-file", x: 230, y: 300, width: 240, height: 180 },
    ], edges: [{ id: "audio-video", from: "audio", to: "video" }, { id: "image-video", from: "image", to: "video" }] };
  let submits: any[] = [], audioReads = 0, broken = unreadable;
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem("ai-manju:auth_token", "qa"); localStorage.setItem("ai-manju:token-store", "local"); });
  await page.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "authorization,content-type,x-request-id,idempotency-key", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS" };
    if (req.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (req.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    if (path === "/api/assets/audio-file/content") { audioReads++; return route.fulfill({ headers, contentType: "audio/wav", body: broken ? Buffer.from("invalid audio") : wav(unreadable ? 10 : 20) }); }
    if (path === "/api/assets/image-file/content") return route.fulfill({ headers, contentType: "image/png", body: image });
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me") data = { id: "qa", username: "qa", role: "super_admin", status: "active" };
    else if (path === "/api/announcements/current") data = null;
    else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (path === "/api/asset-folders") data = [];
    else if (path === "/api/ai/models") data = { models: [short, long], video_models: [short, long], default_video_model: short,
      video_model_protocols: { [short]: "seedance", [long]: "seedance" }, model_labels: { [short]: "Seedance 2.0", [long]: "Seedance 2.5" },
      video_model_durations: { [short]: [5, 10, 15], [long]: [5, 10, 15, 20, 30] }, video_model_capabilities: { [short]: caps(15), [long]: caps(30) } };
    else if (path === `/api/projects/${project.id}/snapshot`) { if (req.method() === "PUT") snapshot = req.postDataJSON().data; data = { project_id: project.id, version: 1, data: snapshot }; }
    else if (path === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
    else if (path === "/api/projects") data = [project];
    else if (path === "/api/ai/contents/generations/tasks" && req.method() === "POST") { submits.push(req.postDataJSON()); data = { id: "job_preflight", status: "queued" }; }
    else if (path === "/api/jobs/job_preflight") data = { id: "job_preflight", type: "video.generate", status: "running", state: "running", progress: 1 };
    if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data } });
  });
  await page.goto(`/canvas/${project.id}?scope=personal`);
  await page.locator('[data-node-id="video"] .node-float-label').click();
  const inspector = page.locator(".canvas-floating-inspector");
  const feedback = inspector.locator(".canvas-video-preflight");
  if (unreadable) {
    await expect(feedback).toContainText("读取失败", { timeout: 20000 });
    await expect(feedback).toContainText("20秒配乐");
    await expect(inspector.getByRole("button", { name: "生成", exact: true })).toBeDisabled();
    expect(submits).toHaveLength(0);
    broken = false;
    await feedback.getByRole("button", { name: "重新检查" }).click();
    await expect(feedback).toContainText("参考素材检查通过");
    await expect(feedback).toContainText("10.00 秒");
    await expect(inspector.getByRole("button", { name: "生成", exact: true })).toBeEnabled();
    expect(submits).toHaveLength(0);
    expect(errors).toEqual([]);
    return;
  }
  await expect(feedback).toContainText("当前为 20.00 秒", { timeout: 20000 });
  await expect(feedback).toContainText("2-15 秒");
  await expect(inspector.getByRole("button", { name: "生成", exact: true })).toBeDisabled();
  expect(submits).toHaveLength(0);
  await feedback.locator("summary").click();
  await expect(feedback).toContainText("MP3 / WAV");
  // Every disclosed limit remains reachable inside the fixed-height inspector.
  await feedback.getByText("平台已注册素材的内容规格仍需生成服务校验。").scrollIntoViewIfNeeded();
  await expect(feedback.getByText("平台已注册素材的内容规格仍需生成服务校验。")).toBeInViewport();
  await feedback.locator("summary").scrollIntoViewIfNeeded();
  await feedback.evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath("audio-too-long-before-generate.png") });
  await feedback.locator("summary").click();
  await inspector.getByRole("button", { name: "选择生成模型", exact: true }).click();
  await page.getByRole("button", { name: "Seedance 2.5", exact: true }).click();
  await expect(feedback).toContainText("参考素材检查通过");
  await expect(feedback).toContainText("20秒配乐：20.00 秒");
  await expect(feedback.locator("summary")).toContainText("2–30 秒");
  expect(submits).toHaveLength(0);
  const readsBeforeGenerate = audioReads;
  await page.screenshot({ path: info.outputPath("model-supports-audio.png") });
  await inspector.getByRole("button", { name: "生成", exact: true }).click();
  await expect.poll(() => submits.length).toBe(1);
  expect(submits[0].model).toBe(long);
  expect(submits[0].content.some((item: any) => item.type === "audio_url" && item.audio_url.url.startsWith("data:audio/wav;base64,"))).toBe(true);
  expect(audioReads).toBe(readsBeforeGenerate);
  expect(errors).toEqual([]);
});
}
