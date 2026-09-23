import { expect, test } from "@playwright/test";

for (const kind of ["video", "image"]) {
  test(`${kind} reference hover control disconnects only its incoming edge and persists`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const project = { id: `reference-disconnect-${kind}`, title: "素材断线验收", scope: "personal", owner_id: "qa" };
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    let snapshot: any = {
      schema: "ai-manhua-studio-canvas", version: 3,
      nodes: [
        { id: "source", kind: "image", title: "参考图片", content: "", x: 40, y: 100, width: 220, height: 180,
          imageSrc: "http://127.0.0.1:3100/qa-reference.svg" },
        { id: "text", kind: "text", title: "参考文字", content: "参考描述", x: 40, y: 420, width: 220, height: 180 },
        { id: "target", kind, title: "目标节点", content: "保持这段提示词", x: 400, y: 100, width: 420, height: 240,
          metadata: { prompt: "保持这段提示词", composerContent: "保持这段提示词", generationMode: kind } },
        { id: "other", kind: "image", title: "其他节点", content: "", x: 1040, y: 100, width: 220, height: 180 },
      ],
      edges: [
        { id: "source-target", from: "source", to: "target" },
        { id: "text-target", from: "text", to: "target" },
        { id: "source-other", from: "source", to: "other" },
      ],
      groups: [], zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 },
    };
    await page.addInitScript(() => {
      localStorage.setItem("ai-manju:auth_token", "qa-token");
      localStorage.setItem("ai-manju:token-store", "local");
    });
    await page.route("**/qa-reference.svg", route => route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="180"><rect width="220" height="180" fill="#c0d7bb"/><circle cx="110" cy="85" r="52" fill="#cf785e"/></svg>',
    }));
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "authorization,content-type,x-request-id", "Access-Control-Allow-Methods": "GET,PUT,OPTIONS" };
      if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
      if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
      let data: unknown = { items: [], total: 0 };
      if (path === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active" };
      else if (path === "/api/announcements/current") data = null;
      else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
      else if (path === `/api/projects/${project.id}/snapshot`) {
        if (request.method() === "PUT") snapshot = request.postDataJSON().data;
        data = { project_id: project.id, version: 1, data: snapshot };
      } else if (path === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
      else if (path === "/api/projects") data = { items: [project], total: 1 };
      else if (path === "/api/asset-folders") data = [];
      if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
      return route.fulfill({ headers, json: { success: true, data, request_id: "disconnect-qa" } });
    });
    await page.goto(`/canvas/${project.id}?scope=personal`);
    await page.locator('[data-node-id="target"] .node-float-label').click();
    const inspector = page.locator(".inspector-panel");
    const remove = inspector.getByRole("button", { name: "断开与「参考图片」的连线", exact: true });
    const thumbnail = inspector.getByRole("button", { name: "引用：参考图片", exact: true });
    await expect(inspector.locator(".canvas-connected-preview-item")).toHaveCount(2);
    await expect(remove).toHaveCSS("opacity", "0");
    await thumbnail.hover();
    await expect(remove).toHaveCSS("opacity", "1");
    await expect(thumbnail.locator("img")).toBeVisible();
    const thumbBox = (await thumbnail.boundingBox())!, removeBox = (await remove.boundingBox())!;
    expect(removeBox.x).toBeGreaterThan(thumbBox.x);
    expect(removeBox.x + removeBox.width).toBeLessThanOrEqual(thumbBox.x + thumbBox.width);
    expect(removeBox.y).toBeGreaterThanOrEqual(thumbBox.y);
    expect(removeBox.y + removeBox.height).toBeLessThan(thumbBox.y + thumbBox.height);
    await page.screenshot({ path: testInfo.outputPath(`${kind}-reference-hover.png`) });
    await remove.click();
    await expect(remove).toHaveCount(0);
    await expect(page.locator('[data-edge-id="source-target"]')).toHaveCount(0);
    await expect(page.locator('[data-edge-id="source-other"]')).toHaveCount(1);
    await expect(page.locator('[data-edge-id="text-target"]')).toHaveCount(1);
    await expect(page.locator(".real-canvas-node")).toHaveCount(4);
    await expect(inspector.locator("textarea.node-card-prompt")).toHaveValue("保持这段提示词");
    await expect.poll(() => snapshot.edges.map((edge: any) => edge.id).sort()).toEqual(["source-other", "text-target"]);
    expect(snapshot.nodes).toHaveLength(4);

    // The ordinary graph history must restore the removed connection.
    await page.locator('button[aria-label="撤销"]').click();
    await expect(page.locator('[data-edge-id="source-target"]')).toHaveCount(1);
    await page.locator('[data-node-id="target"] .node-float-label').click();
    await expect(remove).toHaveCount(1);
    await expect.poll(() => snapshot.edges.length).toBe(3);
    await thumbnail.hover();
    await remove.click();
    await expect.poll(() => snapshot.edges.length).toBe(2);
    await page.reload();
    await page.locator('[data-node-id="target"] .node-float-label').click();
    await expect(remove).toHaveCount(0);
    await expect(inspector.locator(".canvas-connected-preview-item")).toHaveCount(1);
    await expect(page.locator('[data-edge-id="source-other"]')).toHaveCount(1);
    await expect(page.locator(".real-canvas-node")).toHaveCount(4);
    expect(errors).toEqual([]);
  });
}
