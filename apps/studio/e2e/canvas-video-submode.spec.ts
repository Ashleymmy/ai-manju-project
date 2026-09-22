import { expect, test } from "@playwright/test";

test("video prompt mode follows whether the prompt has an @ reference", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const project = { id: "video-submode-qa", title: "视频模式验收", scope: "personal", owner_id: "qa" };
  const snapshot = {
    schema: "ai-manhua-studio-canvas",
    version: 3,
    nodes: [
      {
        id: "video",
        kind: "video",
        title: "视频节点",
        content: "镜头推进",
        x: 320,
        y: 180,
        width: 420,
        height: 240,
        metadata: {
          prompt: "镜头推进",
          composerContent: "镜头推进",
          generationMode: "video",
          model: "sdvideo/seedance-2.0",
        },
      },
      {
        id: "source",
        kind: "image",
        title: "参考图片",
        content: "",
        x: -80,
        y: 180,
        width: 320,
        height: 238,
        metadata: { assetId: "source-image", assetScope: "personal" },
      },
    ],
    edges: [{ id: "edge", from: "source", to: "video" }],
    connections: [],
    groups: [],
    zoom: 100,
    panX: 0,
    panY: 0,
    viewport: { x: 0, y: 0, k: 1 },
  };

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
      "Access-Control-Allow-Headers": "authorization,content-type,x-request-id,idempotency-key",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active" };
    else if (path === "/api/announcements/current") data = null;
    else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (path === "/api/ai/models") data = {
      video_models: ["sdvideo/seedance-2.0"],
      default_video_model: "sdvideo/seedance-2.0",
      model_labels: { "sdvideo/seedance-2.0": "Seedance 2.0" },
      video_model_protocols: { "sdvideo/seedance-2.0": "seedance" },
      video_model_durations: { "sdvideo/seedance-2.0": [5, 10, 15] },
    };
    else if (path === `/api/projects/${project.id}/snapshot`) data = { project_id: project.id, version: 1, data: snapshot };
    else if (path === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
    else if (path === "/api/projects") data = { items: [project], total: 1 };
    else if (path === "/api/asset-folders") data = [];
    if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data, request_id: "video-submode-qa" } });
  });

  await page.goto(`/canvas/${project.id}?scope=personal`);
  await page.locator('[data-node-id="video"] .node-float-label').click();
  const inspector = page.locator(".inspector-panel");
  const prompt = inspector.locator("textarea.node-card-prompt");
  await expect(inspector.getByRole("button", { name: "文生视频", exact: true })).toBeVisible();

  await inspector.getByRole("button", { name: "引用：参考图片", exact: true }).click();
  await expect(inspector.getByRole("button", { name: "全能参考", exact: true })).toBeVisible();

  await prompt.fill("镜头推进");
  await expect(inspector.getByRole("button", { name: "文生视频", exact: true })).toBeVisible();
});
