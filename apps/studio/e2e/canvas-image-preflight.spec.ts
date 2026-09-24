import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1600, height: 1000 }, { width: 1024, height: 768 }]) {
  test(`saved image parameters and public errors at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const project = { id: "image-preflight-qa", title: "参数检查", scope: "personal", owner_id: "qa" };
    const model = "qa::gpt-image-2.5-flare";
    const diagnostic = "图片尺寸不符合所选参数：要求 2560×1440 px，实际返回 1672×941 px。请更换模型或调整参数后重试。";
    const friendly = "本次图片未达到所选规格，请调整参数或更换模型后重试。";
    let snapshot: any = { schema: "ai-manhua-studio-canvas", version: 3, zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 }, groups: [], edges: [],
      nodes: [{ id: "image", kind: "image", title: "生成失败", content: "电影摄影风格的空仓库", x: 260, y: 60, width: 320, height: 230,
        metadata: { generationMode: "image", model, imageResolution: "2K", size: "16:9", quality: "medium", prompt: "电影摄影风格的空仓库", status: "error", errorDetails: diagnostic } }] };
    const requests: Record<string, unknown>[] = [];
    const errors: string[] = [];
    page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
    page.on("console", message => { if (message.type() === "error") console.error(message.text()); });
    await page.addInitScript(() => { localStorage.setItem("ai-manju:auth_token", "qa"); localStorage.setItem("ai-manju:token-store", "local"); });
    // Every API call is isolated: no provider charges, real snapshots or settings are touched.
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "authorization,content-type,x-request-id,idempotency-key", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS" };
      if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
      if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
      let data: unknown = { items: [], total: 0 };
      if (path === "/api/auth/me") data = { id: "qa", username: "qa", role: "super_admin", status: "active" };
      else if (path === "/api/announcements/current") data = null;
      else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
      else if (path === "/api/asset-folders") data = [];
      else if (path === "/api/member/quote") data = { credits: 30, params: { pricing_source: "membership_price_sheet" } };
      else if (path === "/api/ai/models") data = { models: [model], image_models: [model], default_image_model: model, image_model_protocols: { [model]: "openai_images" } };
      else if (path === `/api/projects/${project.id}/snapshot`) {
        if (request.method() === "PUT") snapshot = request.postDataJSON().data;
        data = { project_id: project.id, version: 1, data: snapshot };
      } else if (path === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
      else if (path === "/api/projects") data = [project];
      else if (path === "/api/ai/image/generations" && request.method() === "POST") {
        requests.push(request.postDataJSON());
        data = { job_id: "job_image_preflight", status: "queued" };
      } else if (path === "/api/jobs/job_image_preflight") data = {
        id: "job_image_preflight", type: "image.generate", status: "failed", state: "failed",
        error: { code: "image_output_size_mismatch", message: diagnostic, retryable: false },
      };
      if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
      return route.fulfill({ headers, json: { success: true, data } });
    });
    await page.goto(`/canvas/${project.id}?scope=personal`);
    const card = page.locator('[data-node-id="image"]');
    const inspector = page.locator(".canvas-floating-inspector");
    await expect(card.locator(".node-error-box p")).toHaveText(friendly);
    await expect(card.locator(".node-error-box p")).toHaveAttribute("title", friendly);
    await card.locator(".node-float-label").click();
    await expect(inspector).toContainText("当前暂不支持 2K");
    await expect(inspector.getByRole("button", { name: "重试", exact: true })).toBeDisabled();
    await card.locator(".node-error-retry").click();
    await expect(page.locator("[data-sonner-toast]").last()).toContainText("当前暂不支持 2K");
    expect(requests).toHaveLength(0);
    await page.screenshot({ path: info.outputPath("blocked-saved-2k.png") });
    await inspector.getByTitle("详细参数", { exact: true }).click();
    const parameters = page.locator(".node-pop-params");
    await expect(parameters.getByRole("button", { name: "2K", exact: true })).toBeDisabled();
    await expect(parameters.getByRole("button", { name: "4K", exact: true })).toBeDisabled();
    await parameters.getByRole("button", { name: "1K", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(inspector.getByRole("button", { name: "重试", exact: true })).toBeEnabled();
    await inspector.getByRole("button", { name: "重试", exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toMatchObject({ size: "1280x720", quality: "medium" });
    await expect.poll(() => snapshot.nodes[0].metadata.errorDetails).toBe(friendly);
    await expect.poll(() => snapshot.nodes[0].metadata.status).toBe("error");
    await expect(card.locator(".node-error-box p")).toHaveText(friendly);
    await expect(inspector).toContainText(friendly);
    await expect(page.locator("body")).not.toContainText("实际返回");
    await expect(page.locator("body")).not.toContainText("1672");
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "当前暂不支持 2K" })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("friendly-failure.png") });
    expect(errors).toEqual([]);
  });
}
