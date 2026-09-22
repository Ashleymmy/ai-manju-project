import { expect, test } from "@playwright/test";

test("canvas duration controls use model capabilities and submit the visible choice", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const project = { id: "duration-qa", title: "视频时长验收", scope: "personal", owner_id: "qa" };
  const long = "provider::seedance-2.5", short = "provider::seedance-2.0", discrete = "sdvideo/seedance-lite", unknown = "provider::ep-unknown";
  const labels = { [long]: "Seedance 2.5", [short]: "Seedance 2.0", [discrete]: "Lite", [unknown]: "自定义模型" };
  const requests: Array<{ model: string; duration: number }> = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let snapshot: any = {
    schema: "ai-manhua-studio-canvas", version: 3,
    nodes: [{ id: "video", kind: "video", title: "视频时长验收", content: "镜头缓慢推近", x: 500, y: 250, width: 300, height: 240,
      metadata: { prompt: "镜头缓慢推近", composerContent: "镜头缓慢推近", generationMode: "video", model: long, seconds: "30" } }],
    edges: [], groups: [], zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 },
  };
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "qa-token");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "authorization,content-type,x-request-id,idempotency-key", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS" };
    if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active", display_name: "QA" };
    else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (path === "/api/ai/models") data = {
      video_models: [long, short, discrete, unknown], default_video_model: long, model_labels: labels,
      video_model_protocols: Object.fromEntries(Object.keys(labels).map(model => [model, "seedance"])),
      video_model_durations: {
        [long]: [-1, ...Array.from({ length: 27 }, (_, i) => i + 4)],
        [short]: [-1, ...Array.from({ length: 12 }, (_, i) => i + 4)], [discrete]: [5, 10],
      },
    };
    else if (path === `/api/projects/${project.id}/snapshot`) {
      if (request.method() === "PUT") snapshot = request.postDataJSON().data;
      data = { project_id: project.id, version: 1, data: snapshot };
    } else if (path === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
    else if (path === "/api/projects") data = { items: [project], total: 1 };
    else if (path === "/api/ai/contents/generations/tasks" && request.method() === "POST") {
      requests.push(request.postDataJSON());
      // Record the actual request, then stop this isolated test task without paid generation.
      return route.fulfill({ headers, status: 400, json: { success: false, error: "验收任务已记录" } });
    }
    if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data, request_id: "duration-qa" } });
  });
  await page.goto(`/canvas/${project.id}?scope=personal`);
  const node = page.locator('[data-node-id="video"]');
  await node.locator(".node-float-label").click();
  const inspector = page.locator(".inspector-panel");
  const parameters = page.locator(".node-pop-params");
  const range = parameters.getByRole("slider", { name: "视频时长", exact: true });
  await inspector.getByRole("button", { name: "参数", exact: true }).click();
  await expect(range).toHaveAttribute("aria-valuemax", "30");
  await expect(parameters.locator(".video-duration-input-caption")).toHaveText("4s15s30s");
  const track = (await range.boundingBox())!;
  await page.mouse.click(track.x + track.width / 2, track.y + track.height / 2);
  await expect(range).toHaveAttribute("aria-valuenow", "15");
  await page.screenshot({ path: testInfo.outputPath("duration-30.png") });
  await range.press("End");
  await expect(range).toHaveAttribute("aria-valuenow", "30");
  await inspector.getByRole("button", { name: "选择生成模型" }).click();
  await page.locator(".node-pop-item").getByText("Seedance 2.0", { exact: true }).click();
  await inspector.getByRole("button", { name: "参数", exact: true }).click();
  await expect(range).toHaveAttribute("aria-valuemax", "15");
  await expect(range).toHaveAttribute("aria-valuenow", "15");
  await expect(parameters.locator(".video-duration-input-caption")).toHaveText("4s7.5s15s");
  const shortTrack = (await range.boundingBox())!;
  await page.mouse.click(shortTrack.x + shortTrack.width / 2, shortTrack.y + shortTrack.height / 2);
  await expect(range).toHaveAttribute("aria-valuenow", "8");
  await page.screenshot({ path: testInfo.outputPath("duration-15.png") });
  await inspector.getByRole("button", { name: "生成", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ model: short, duration: 8 });
  await expect(inspector.getByRole("button", { name: "重试", exact: true })).toBeEnabled();
  await inspector.getByRole("button", { name: "选择生成模型" }).click();
  await page.locator(".node-pop-item").getByText("Lite", { exact: true }).click();
  await inspector.getByRole("button", { name: "参数", exact: true }).click();
  await expect(range).toHaveCount(0);
  await expect(parameters.getByRole("button", { name: "自动时长" })).toHaveCount(0);
  await parameters.getByRole("button", { name: "10 秒", exact: true }).click();
  await inspector.getByRole("button", { name: "重试", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toMatchObject({ model: discrete, duration: 10 });
  await expect(inspector.getByRole("button", { name: "重试", exact: true })).toBeEnabled();
  await inspector.getByRole("button", { name: "选择生成模型" }).click();
  await page.locator(".node-pop-item").getByText("自定义模型", { exact: true }).click();
  await inspector.getByRole("button", { name: "参数", exact: true }).click();
  await expect(range).toHaveCount(0);
  await expect(parameters).toContainText("未提供时长范围");
  expect(errors).toEqual([]);
});
