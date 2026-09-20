import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("copied image nodes remain independent after saving and reloading", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const png = readFileSync(new URL("../client/public/comic-lab-pack/stickers/sticker_nice.png", import.meta.url));
  const project = { id: "duplicate-qa", title: "独立节点复制验收", scope: "personal", owner_id: "qa" };
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let snapshot: any = {
    schema: "ai-manhua-studio-canvas", version: 3,
    nodes: [
      { id: "config", kind: "config", title: "原前置节点", content: "生成一个苹果", x: 100, y: 250, width: 280, height: 200, metadata: { generationMode: "image" } },
      { id: "image", kind: "image", title: "苹果", content: "生成一个苹果", x: 500, y: 250, width: 280, height: 280, imageAssetId: "apple",
        metadata: { assetId: "apple", assetScope: "personal", status: "success", sourceNodeId: "config", jobId: "finished-job", prompt: "生成一个苹果", generationMode: "image" } },
      { id: "next", kind: "config", title: "原后置节点", content: "参考苹果", x: 900, y: 250, width: 280, height: 200, metadata: { generationMode: "image" } },
    ],
    edges: [{ id: "config:image", from: "config", to: "image" }, { id: "image:next", from: "image", to: "next" }],
    groups: [], zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 },
  };
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "qa-token");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  // Exercise the real UI and save path against isolated fixtures, never user data.
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const headers = {
      "Access-Control-Allow-Origin": new URL(page.url()).origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "authorization,content-type,x-request-id",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    if (url.pathname === "/api/assets/apple/content") return route.fulfill({ headers, contentType: "image/png", body: png });
    let data: unknown = { items: [], total: 0 };
    if (url.pathname === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active", display_name: "QA" };
    else if (url.pathname === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (url.pathname === "/api/projects/duplicate-qa/snapshot") {
      if (request.method() === "PUT") snapshot = request.postDataJSON().data;
      data = { project_id: project.id, version: 1, data: snapshot };
    } else if (url.pathname === "/api/projects/duplicate-qa") data = { ...project, data: snapshot };
    else if (url.pathname === "/api/projects") data = { items: [project], total: 1 };
    if (url.pathname === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data, request_id: "duplicate-qa" } });
  });
  await page.goto("/canvas/duplicate-qa?scope=personal");
  const original = page.locator('[data-node-id="image"]');
  await original.locator(".node-float-label").click();
  await expect(page.locator("[data-edge-id]")).toHaveCount(2);
  await original.getByRole("button", { name: "复制", exact: true }).click();
  await expect(page.getByText("节点已复制为独立节点，不继承连线", { exact: true })).toBeVisible();
  await expect(page.locator(".real-canvas-node")).toHaveCount(4);
  await expect(page.locator("[data-edge-id]")).toHaveCount(2);
  await expect.poll(() => snapshot.nodes.length).toBe(4);
  const duplicate = snapshot.nodes.find((node: any) => !["config", "image", "next"].includes(node.id));
  expect(duplicate.metadata.assetId).toBe("apple");
  expect(duplicate.metadata.sourceNodeId).toBeUndefined();
  expect(duplicate.metadata.jobId).toBeUndefined();
  expect(snapshot.connections).toEqual([
    expect.objectContaining({ fromNodeId: "config", toNodeId: "image" }),
    expect.objectContaining({ fromNodeId: "image", toNodeId: "next" }),
  ]);
  await page.reload();
  await expect(page.locator(".real-canvas-node")).toHaveCount(4);
  await expect(page.locator("[data-edge-id]")).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath("independent-copy.png") });
  expect(errors).toEqual([]);
});
