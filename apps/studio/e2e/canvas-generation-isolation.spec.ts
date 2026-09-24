import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("editing the canvas during video preparation, acceptance and completion survives reload", async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.clock.install();
  const image = readFileSync(new URL("../client/public/comic-lab-pack/stickers/sticker_nice.png", import.meta.url));
  const project = { id: "generation-isolation-qa", title: "并发节点检查", scope: "personal", owner_id: "qa" };
  const model = "official::doubao-seedance-2-0-260128";
  let snapshot: any = { schema: "ai-manhua-studio-canvas", version: 3, zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 }, groups: [],
    nodes: [
      { id: "video", kind: "video", title: "视频", content: "镜头缓慢移动", x: 560, y: 130, width: 320, height: 200,
        metadata: { generationMode: "video", model, seconds: "5", resolution: "720p", size: "16:9" } },
      { id: "reference", kind: "image", title: "参考图", content: "", imageSrc: "http://127.0.0.1:3100/isolation-reference.png", x: 170, y: 130, width: 240, height: 180 },
      { id: "edit", kind: "text", title: "继续编辑", content: "旧内容", x: 1150, y: 120, width: 280, height: 160 },
      { id: "remove", kind: "text", title: "等待中删除", content: "不再需要", x: 1150, y: 350, width: 280, height: 160 },
    ], edges: [{ id: "reference-video", from: "reference", to: "video" }, { id: "remove-edit", from: "remove", to: "edit" }] };
  let holdRead = false, reading = false, submitted = 0, polls = 0, completed = false;
  let releaseRead!: () => void, releaseAccept!: () => void;
  const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
  const acceptGate = new Promise<void>(resolve => { releaseAccept = resolve; });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem("ai-manju:auth_token", "qa"); localStorage.setItem("ai-manju:token-store", "local"); });
  await page.route("**/isolation-reference.png", async route => {
    if (holdRead && route.request().resourceType() === "fetch") { reading = true; await readGate; }
    await route.fulfill({ contentType: "image/png", body: image });
  });
  await page.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "authorization,content-type,x-request-id,idempotency-key", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS" };
    if (req.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (req.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    if (path === "/api/assets/result/content") return route.fulfill({ headers, contentType: "video/mp4", body: Buffer.alloc(0) });
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me") data = { id: "qa", username: "qa", role: "super_admin", status: "active" };
    else if (path === "/api/announcements/current") data = null;
    else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (path === "/api/asset-folders") data = [];
    else if (path === "/api/ai/models") data = { models: [model], video_models: [model], default_video_model: model,
      video_model_protocols: { [model]: "seedance" }, video_model_durations: { [model]: [5, 10, 15] },
      video_model_capabilities: { [model]: { resolutions: ["720p"], ratios: ["16:9"], supports: ["text", "reference_image"] } } };
    else if (path === `/api/projects/${project.id}/snapshot`) {
      if (req.method() === "PUT") snapshot = req.postDataJSON().data;
      data = { project_id: project.id, version: 1, data: snapshot };
    } else if (path === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
    else if (path === "/api/projects") data = [project];
    else if (path === "/api/ai/contents/generations/tasks" && req.method() === "POST") { submitted++; await acceptGate; data = { id: "job_isolation", status: "queued" }; }
    else if (path === "/api/jobs/job_isolation") { polls++; data = completed
      ? { id: "job_isolation", type: "video.generate", status: "succeeded", state: "succeeded", progress: 100,
          result: { assets: [{ id: "result", name: "result.mp4", content_type: "video/mp4" }] } }
      : { id: "job_isolation", type: "video.generate", status: "running", state: "running", progress: 20 }; }
    if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data } });
  });
  const card = (id: string) => page.locator(`[data-node-id="${id}"]`);
  const inspector = page.locator(".canvas-floating-inspector");
  const node = (id: string) => snapshot.nodes.find((item: any) => item.id === id);
  async function edit(id: string, prompt: string) {
    await card(id).locator(".node-float-label").click();
    await inspector.locator("textarea").fill(prompt);
  }
  async function save() { await page.getByRole("button", { name: "保存", exact: true }).click(); }
  try {
    await page.goto(`/canvas/${project.id}?scope=personal`);
    await card("video").locator(".node-float-label").click();
    await expect(inspector.locator(".canvas-video-preflight")).toContainText("参考素材检查通过");
    // A user may wait longer than the preflight media cache before clicking Generate.
    await page.clock.fastForward(61_000);
    holdRead = true;
    await inspector.getByRole("button", { name: "生成", exact: true }).click();
    await expect.poll(() => reading).toBe(true);
    await page.getByRole("button", { name: "添加图片", exact: true }).click();
    const freshImage = await page.locator('[data-node-id]').evaluateAll(items => items.map(item => item.getAttribute("data-node-id")).find(id => !["video", "reference", "edit", "remove"].includes(id!)));
    expect(freshImage).toBeTruthy();
    await edit("edit", "准备生成期间写入的新内容");
    await inspector.getByRole("button", { name: "关闭面板", exact: true }).click();
    await card("remove").locator(".node-float-label").click();
    await page.locator(".canvas-stage").focus();
    await page.keyboard.press("Delete");
    await expect(card("remove")).toHaveCount(0);
    releaseRead();
    await expect.poll(() => submitted).toBe(1);
    await expect(card(freshImage!)).toHaveCount(1);
    await expect(card("remove")).toHaveCount(0);
    await save();
    await expect.poll(() => node("edit")?.content).toBe("准备生成期间写入的新内容");
    expect(snapshot.edges.some((edge: any) => edge.id === "remove-edit")).toBe(false);
    await page.getByRole("button", { name: "添加文本", exact: true }).click();
    const freshText = await page.locator('[data-node-id]').evaluateAll((items, known) => items.map(item => item.getAttribute("data-node-id")).find(id => !known.includes(id!)), ["video", "reference", "edit", freshImage!]);
    expect(freshText).toBeTruthy();
    await inspector.locator("textarea").fill("接收任务期间新建的文本");
    releaseAccept();
    await expect.poll(() => polls).toBeGreaterThan(0);
    await expect(card(freshText!)).toHaveCount(1);
    await inspector.locator("textarea").fill("生成过程中继续编辑的文本");
    await save();
    await expect.poll(() => node(freshText!)?.content).toBe("生成过程中继续编辑的文本");
    completed = true;
    await page.clock.fastForward(2_000);
    await expect.poll(() => node("video")?.metadata?.status).toBe("success");
    for (const id of [freshImage!, freshText!, "edit"]) await expect(card(id)).toHaveCount(1);
    expect(node("remove")).toBeUndefined();
    expect(node("edit").content).toBe("准备生成期间写入的新内容");
    expect(node(freshText!).content).toBe("生成过程中继续编辑的文本");
    await page.screenshot({ path: info.outputPath("concurrent-nodes-preserved.png") });
    await page.reload();
    for (const id of [freshImage!, freshText!, "edit", "video"]) await expect(card(id)).toHaveCount(1);
    await expect(card("remove")).toHaveCount(0);
    await card(freshText!).locator(".node-float-label").click();
    await expect(inspector.locator("textarea")).toHaveValue("生成过程中继续编辑的文本");
    expect(errors).toEqual([]);
    expect(submitted).toBe(1);
  } finally { releaseRead(); releaseAccept(); }
});
