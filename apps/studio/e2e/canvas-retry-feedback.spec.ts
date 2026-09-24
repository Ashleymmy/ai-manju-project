import { expect, test } from "@playwright/test";

for (const kind of ["image", "video"] as const) {
  for (const outcome of ["cancel", "submit"] as const) {
    test(`${kind} retry responds before slow references and can ${outcome}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 945 });
      const referenceImage = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 128;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#318877";
        context.fillRect(0, 0, 128, 128);
        return canvas.toDataURL("image/png").split(",")[1];
      });
      const project = { id: `retry-${kind}-${outcome}-qa`, title: "Retry feedback QA", scope: "personal", owner_id: "qa" };
      const reference = { nodeId: "removed-reference", title: "Reference", assetId: "slow-reference", assetScope: "personal", name: "reference.png", contentType: "image/png" };
      let snapshot: any = {
        schema: "ai-manhua-studio-canvas", version: 3,
        nodes: [{ id: "target", kind, title: "Retry target", content: "A quiet lake", x: 220, y: 120, width: 320, height: 240,
          metadata: { status: "error", errorDetails: "Previous generation failed", prompt: "A quiet lake", generationMode: kind,
            model: kind === "image" ? "gpt-image-2" : "sora-2", size: "auto", seconds: "5",
            referenceInputs: kind === "image" ? [reference] : undefined,
            videoReferenceInputs: kind === "video" ? { items: [{ ...reference, type: "image", source: "asset", scope: "personal", mime: "image/png", bytes: 100 }] } : undefined,
          } }],
        edges: [], connections: [], groups: [], zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 },
      };
      let releaseReference!: () => void;
      const referenceReady = new Promise<void>(resolve => { releaseReference = resolve; });
      let referenceRequests = 0;
      let submissions = 0;
      let cancellations = 0;
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem("ai-manju:auth_token", "qa-token");
        localStorage.setItem("ai-manju:token-store", "local");
      });
      await page.route("**/api/**", async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (!path.startsWith("/api/")) return route.continue();
        const headers = {
          "Access-Control-Allow-Origin": new URL(page.url()).origin,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Headers": "authorization,content-type,x-request-id,range",
          "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
        };
        if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
        if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
        if (path.endsWith("/assets/slow-reference/content")) {
          referenceRequests++;
          await referenceReady;
          return route.fulfill({ headers, contentType: "image/png", body: Buffer.from(referenceImage, "base64") }).catch(() => undefined);
        }
        let data: unknown = { items: [], total: 0 };
        if (path === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active", display_name: "QA" };
        else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
        else if (path === "/api/ai/models") data = { models: [], image_models: ["gpt-image-2"], default_image_model: "gpt-image-2", video_models: ["sora-2"], default_video_model: "sora-2" };
        else if (path === `/api/projects/${project.id}/snapshot`) {
          if (request.method() === "PUT") snapshot = request.postDataJSON().data;
          data = { project_id: project.id, version: 1, data: snapshot };
        } else if (path === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
        else if (path === "/api/projects") data = { items: [project], total: 1 };
        else if ((/\/ai\/image\/(generations|edits)$/.test(path) || path === "/api/ai/videos") && request.method() === "POST") {
          submissions++;
          data = { id: "job-retry", job_id: "job-retry", status: "queued" };
        } else if (path.endsWith("/jobs/job-retry/cancel")) {
          cancellations++;
          data = { id: "job-retry", status: "canceled", state: "canceled" };
        } else if (path.endsWith("/jobs/job-retry")) data = { id: "job-retry", type: `${kind}.generate`, status: "running", state: "running", progress: 35 };
        if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
        return route.fulfill({ headers, json: { success: true, data, request_id: "retry-feedback-qa" } });
      });
      try {
        await page.goto(`/canvas/${project.id}?scope=personal`);
        const node = page.locator('[data-node-id="target"]');
        await node.locator(".node-float-label").click();
        const inspector = page.locator(".inspector-panel");
        await (outcome === "cancel" ? node.locator(".node-error-retry") : inspector.getByRole("button", { name: "重试", exact: true })).click();
        await expect(node.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "正在准备生成", { timeout: 1000 });
        await expect(inspector.getByRole("button", { name: "取消", exact: true })).toBeVisible({ timeout: 1000 });
        await expect(node.locator(".node-error-retry")).toHaveCount(0);
        await expect(inspector.getByRole("alert")).toHaveCount(0);
        await expect.poll(() => referenceRequests).toBe(1);
        expect(submissions).toBe(0);
        await page.screenshot({ path: testInfo.outputPath("retry-preparing.png"), animations: "disabled" });
        if (outcome === "cancel") {
          await inspector.getByRole("button", { name: "取消", exact: true }).click();
          await expect(node.getByRole("progressbar")).toHaveCount(0, { timeout: 1000 });
          releaseReference();
          await expect(inspector.getByRole("button", { name: "重试", exact: true })).toBeVisible();
          await page.waitForTimeout(500);
          expect(submissions).toBe(0);
        } else {
          releaseReference();
          await expect.poll(() => submissions).toBe(1);
          await expect(node.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "35");
          await inspector.getByRole("button", { name: "取消", exact: true }).click();
          await expect.poll(() => cancellations).toBe(1);
          await expect(node.getByRole("progressbar")).toHaveCount(0);
          expect(submissions).toBe(1);
        }
        expect(errors).toEqual([]);
      } finally {
        releaseReference();
      }
    });
  }
}
