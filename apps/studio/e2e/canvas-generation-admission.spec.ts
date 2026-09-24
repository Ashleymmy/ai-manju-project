import { expect, test } from "@playwright/test";

for (const kind of ["image", "video"] as const) {
  test(`${kind} batch waits for account capacity and completes every result`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1500, height: 1050 });
    const project = { id: `admission-${kind}-qa`, title: "批量排队验收", scope: "personal", owner_id: "qa" };
    const total = kind === "image" ? 6 : 3;
    const capacity = kind === "image" ? 2 : 1;
    let snapshot: any = {
      schema: "ai-manhua-studio-canvas", version: 3,
      nodes: Array.from({ length: kind === "image" ? 1 : total }, (_, index) => ({
        id: `target-${index}`, kind, title: `海景${index + 1}`, content: "一片平静的大海", x: 180 + index * 400, y: 120, width: 320, height: 240,
        metadata: { prompt: "一片平静的大海", generationMode: kind, count: 1, model: kind === "image" ? "gpt-image-2" : "sora-2", seconds: "5", status: "idle" },
      })),
      edges: [], connections: [], groups: [], zoom: 80, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: .8 },
    };
    const jobs = new Map<string, { id: string; status: string; assetId: string }>();
    const acceptedKeys = new Map<string, string>();
    let rejected = 0, peak = 0, allowComplete = false;
    const errors: string[] = [];
    page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
    await page.addInitScript(() => {
      localStorage.setItem("ai-manju:auth_token", "qa-token");
      localStorage.setItem("ai-manju:token-store", "local");
    });
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "authorization,content-type,x-request-id,idempotency-key,range", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS" };
      if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
      if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
      const respond = (data: unknown) => route.fulfill({ headers, json: { success: true, data, request_id: "admission-qa" } });
      if (request.method() === "POST" && (path === "/api/ai/image/generations" || path === "/api/ai/videos")) {
        const key = request.headers()["idempotency-key"];
        expect(key).toBeTruthy();
        if (kind === "image") expect(request.postDataJSON().n).toBe(1);
        if (acceptedKeys.has(key)) return respond({ id: acceptedKeys.get(key), job_id: acceptedKeys.get(key) });
        const active = [...jobs.values()].filter(job => job.status === "running").length;
        if (active >= capacity) {
          rejected++;
          return route.fulfill({ headers, status: 429, json: { success: false, error: kind === "image" ? "当前任务并发已达上限，请稍后重试或升级会员" : "当前视频任务并发已达上限，请等待进行中的任务完成后重试" } });
        }
        const id = `job_${jobs.size + 1}`;
        jobs.set(id, { id, status: "running", assetId: `asset_${jobs.size + 1}` });
        acceptedKeys.set(key, id);
        peak = Math.max(peak, active + 1);
        return respond({ id, job_id: id, status: "queued" });
      }
      const job = jobs.get(path.split("/").pop()!);
      if (path.startsWith("/api/jobs/") && job) {
        if (allowComplete) job.status = "succeeded";
        return respond({ id: job.id, type: `${kind}.generate`, status: job.status, state: job.status, progress: job.status === "running" ? 30 : 100,
          result: { assets: [{ id: job.assetId, asset_id: job.assetId, content_type: kind === "image" ? "image/png" : "video/mp4", name: "海景" }] } });
      }
      if (/\/assets\/asset_\d+\/content$/.test(path)) return route.fulfill({ headers, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBq0AAAAASUVORK5CYII=", "base64") });
      if (/\/assets\/asset_\d+$/.test(path)) return respond({ id: path.split("/").pop(), type: kind, name: "海景", content_type: kind === "image" ? "image/png" : "video/mp4" });
      if (path === "/api/auth/me") return respond({ id: "qa", account: "qa", role: "super_admin", status: "active" });
      if (path === "/api/announcements/current") return respond(null);
      if (path === "/api/user/preferences") return respond({ canvas: { promptPresets: [] } });
      if (path === "/api/ai/models") return respond({ models: [], image_models: ["gpt-image-2"], default_image_model: "gpt-image-2", video_models: ["sora-2"], default_video_model: "sora-2" });
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
    const inspector = page.locator(".inspector-panel");
    for (let index = 0; index < (kind === "image" ? 1 : total); index++) {
      await page.locator(`[data-node-id="target-${index}"] .node-float-label`).click();
      if (kind === "image") {
        await inspector.locator(".node-generation-count").click();
        await expect(page.locator(".canvas-generation-count-options button")).toHaveText(["×1", "×2", "×4", "×6"]);
        await expect(page.locator(".canvas-generation-count-options")).toHaveCSS("display", "flex");
        await page.screenshot({ path: testInfo.outputPath("image-count-options.png") });
        await page.locator(".canvas-generation-count-options").getByRole("button", { name: "×6", exact: true }).click();
        await page.keyboard.press("Escape");
        await expect(inspector.locator(".node-generation-count")).toContainText("×6");
      }
      await inspector.getByRole("button", { name: "生成", exact: true }).click();
    }
    await expect.poll(() => rejected).toBeGreaterThan(0);
    expect(jobs.size).toBe(capacity);
    if (kind === "video") await expect(page.locator('[data-node-id="target-2"]').getByRole("progressbar")).toHaveAttribute("aria-valuetext", "排队等待中");
    await page.screenshot({ path: testInfo.outputPath(`${kind}-queue.png`) });
    allowComplete = true;
    await expect.poll(() => snapshot.nodes.filter((node: any) => node.metadata?.status === "success").length, { timeout: 35000 }).toBe(total);
    expect(jobs.size).toBe(total);
    expect(acceptedKeys.size).toBe(total);
    expect(peak).toBe(capacity);
    expect(snapshot.nodes.filter((node: any) => node.metadata?.status === "error")).toHaveLength(0);
    expect(new Set(snapshot.nodes.map((node: any) => node.metadata.assetId)).size).toBe(total);
    expect(errors).toEqual([]);
  });
}
