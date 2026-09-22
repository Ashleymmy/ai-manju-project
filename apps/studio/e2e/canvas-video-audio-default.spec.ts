import { expect, test } from "@playwright/test";

for (const initial of ["new", "unset", "disabled"] as const) {
  test(`canvas video audio defaults and saved choice reach the request: ${initial}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    const project = { id: "video-audio-qa", title: "视频音频默认值验收", scope: "personal", owner_id: "qa" };
    const model = "sdvideo/seedance-2.0";
    const requests: Array<{ generate_audio: boolean; ratio: string }> = [];
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    let snapshot: any = {
      schema: "ai-manhua-studio-canvas", version: 3,
      nodes: initial === "new" ? [] : [{ id: "video", kind: "video", title: "视频音频验收", content: "镜头缓慢推近", x: 450, y: 250, width: 420, height: 240,
        metadata: { prompt: "镜头缓慢推近", composerContent: "镜头缓慢推近", generationMode: "video", model, seconds: "5", size: initial === "disabled" ? "adaptive" : "auto", ...(initial === "disabled" ? { generateAudio: false } : {}) } }],
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
      if (path === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active" };
      else if (path === "/api/announcements/current") data = null;
      else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
      else if (path === "/api/ai/models") data = {
        video_models: [model], default_video_model: model, model_labels: { [model]: "Seedance 2.0" },
        video_model_protocols: { [model]: "seedance" }, video_model_durations: { [model]: [5, 10, 15] },
      };
      else if (path === `/api/projects/${project.id}/snapshot`) {
        if (request.method() === "PUT") snapshot = request.postDataJSON().data;
        data = { project_id: project.id, version: 1, data: snapshot };
      } else if (path === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
      else if (path === "/api/projects") data = { items: [project], total: 1 };
      else if (path === "/api/ai/contents/generations/tasks" && request.method() === "POST") {
        requests.push(request.postDataJSON());
        // Inspect the actual submission without starting a paid provider job.
        return route.fulfill({ headers, status: 400, json: { success: false, error: "验收任务已记录" } });
      }
      if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
      return route.fulfill({ headers, json: { success: true, data, request_id: "audio-default-qa" } });
    });
    await page.goto(`/canvas/${project.id}?scope=personal`);
    if (initial === "new") await page.getByRole("button", { name: "添加视频", exact: true }).click();
    const node = page.locator(".real-canvas-node.video");
    await node.locator(".node-float-label").click();
    const inspector = page.locator(".inspector-panel");
    const parameters = page.locator(".node-pop-params");
    const audio = parameters.getByRole("checkbox", { name: "生成音频", exact: true });
    await inspector.getByRole("textbox", { name: "请输入视频描述…" }).fill("镜头缓慢推近");
    await inspector.getByRole("button", { name: "参数", exact: true }).click();
    await expect(audio).toBeChecked({ checked: initial !== "disabled" });
    await expect(parameters.getByRole("button", { name: "自适应", exact: true })).toHaveCount(0);
    await expect(parameters.getByRole("button", { name: "16:9", exact: true })).toHaveClass(/active/);
    await expect(parameters.getByRole("checkbox", { name: "添加水印", exact: true })).not.toBeChecked();
    if (initial === "new") await parameters.screenshot({ path: testInfo.outputPath("default-audio-enabled.png") });
    await inspector.getByRole("button", { name: "生成", exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].generate_audio).toBe(initial !== "disabled");
    expect(requests[0].ratio).toBe("16:9");
    await expect(inspector.getByRole("button", { name: "重试", exact: true })).toBeEnabled();
    if (!(await audio.isVisible())) await inspector.getByRole("button", { name: "参数", exact: true }).click();
    await audio.setChecked(initial === "disabled");
    await parameters.getByRole("button", { name: "9:16", exact: true }).click();
    await expect.poll(() => snapshot.nodes[0]?.metadata?.generateAudio).toBe(initial === "disabled");
    await expect.poll(() => snapshot.nodes[0]?.metadata?.size).toBe("9:16");
    await page.reload();
    await node.locator(".node-float-label").click();
    await inspector.getByRole("button", { name: "参数", exact: true }).click();
    await expect(audio).toBeChecked({ checked: initial === "disabled" });
    await expect(parameters.getByRole("button", { name: "9:16", exact: true })).toHaveClass(/active/);
    await inspector.getByRole("button", { name: "重试", exact: true }).click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1].generate_audio).toBe(initial === "disabled");
    expect(requests[1].ratio).toBe("9:16");
    expect(errors).toEqual([]);
  });
}
