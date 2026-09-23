import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const png = readFileSync(new URL("../client/public/comic-lab-pack/stickers/sticker_nice.png", import.meta.url));

async function openCanvas(page: Page) {
  let releaseUpload!: (failed?: boolean) => void;
  const uploadResult = new Promise<boolean>(resolve => { releaseUpload = (failed = false) => resolve(failed); });
  const errors: string[] = [];
  let uploads = 0;
  let polls = 0;
  let snapshot: any = {
    schema: "ai-manhua-studio-canvas", version: 3,
    nodes: ["first", "second"].map((id, index) => ({
      id, type: "image", title: index ? "测试角色二" : "测试角色一", imageSrc: `data:image/png;base64,${png.toString("base64")}`,
      position: { x: 100 + 360 * index, y: 100 }, width: 280, height: 210, metadata: {},
    })), edges: [], connections: [], groups: [],
    viewport: { x: 0, y: 0, k: 1 }, zoom: 100, panX: 0, panY: 0,
  };
  const project = { id: "registration-qa", title: "后台注册测试", scope: "personal", owner_id: "qa" };
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "qa-token");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  // Mock every API call: no user projects, provider registrations or credits are changed.
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
    let data: unknown = { items: [], total: 0 };
    if (url.pathname === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active", display_name: "QA" };
    else if (url.pathname === "/api/announcements/current") data = null;
    else if (url.pathname === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (url.pathname === "/api/ai/models") data = { video_models: ["official::seedance-2.0"], default_video_model: "official::seedance-2.0" };
    else if (url.pathname === "/api/projects/registration-qa/snapshot") {
      if (request.method() === "PUT") snapshot = request.postDataJSON().data;
      data = { project_id: project.id, version: 1, data: snapshot };
    } else if (url.pathname === "/api/projects/registration-qa") data = { ...project, data: snapshot };
    else if (url.pathname === "/api/projects") data = { items: [project], total: 1 };
    else if (url.pathname === "/api/asset-folders") data = [];
    else if (url.pathname === "/api/ai/seedance-assets/upload") {
      uploads++;
      expect(url.searchParams.get("provider_id")).toBe("official");
      const failed = await uploadResult;
      if (failed) return route.fulfill({ headers, status: 502, json: { success: false, error: "素材注册失败", request_id: "registration-qa" } });
      data = { id: "registered", name: "测试角色一", volcano_asset_id: "", status: "Processing", asset_type: "Image" };
    } else if (url.pathname === "/api/ai/seedance-assets/registered") {
      polls++;
      data = { id: "registered", name: "测试角色一", volcano_asset_id: "remote", status: "Active", asset_type: "Image" };
    }
    if (url.pathname === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data, request_id: "registration-qa" } });
  });
  await page.goto("/canvas/registration-qa?scope=personal");
  await expect(page.locator(".real-canvas-node")).toHaveCount(2);
  return { releaseUpload, errors, get uploads() { return uploads; }, get polls() { return polls; }, get snapshot() { return snapshot; } };
}

async function openRegistration(page: Page, nodeId: string) {
  const node = page.locator(`.real-canvas-node[data-node-id="${nodeId}"]`);
  await node.click();
  await node.hover();
  await node.getByRole("button", { name: "注册拟真人素材", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("submitting closes the modal during a slow upload and success never closes a later dialog", async ({ page }) => {
  const fixture = await openCanvas(page);
  await openRegistration(page, "first");
  await page.getByRole("button", { name: "后台注册 / 更新状态", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => fixture.uploads).toBe(1);
  await expect(page.locator('[data-node-id="first"] .canvas-seedance-registration')).toHaveAttribute("aria-busy", "true");
  await openRegistration(page, "second");
  fixture.releaseUpload();
  await expect(page.getByText("拟真人素材注册成功", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect.poll(() => fixture.snapshot.nodes.find((node: any) => node.id === "first").metadata.seedanceVolcanoAssets?.[0]?.status).toBe("Active");
  expect(fixture.uploads).toBe(1);
  expect(fixture.polls).toBe(1);
  expect(fixture.errors).toEqual([]);
});

test("background failure reports the error and unlocks the original node for retry", async ({ page }) => {
  const fixture = await openCanvas(page);
  await openRegistration(page, "first");
  await page.getByRole("button", { name: "后台注册 / 更新状态", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  fixture.releaseUpload(true);
  await expect(page.getByText("拟真人素材上传或注册失败", { exact: true })).toBeVisible();
  const node = page.locator('[data-node-id="first"]');
  await node.hover();
  await node.locator(".canvas-seedance-registration").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "后台注册 / 更新状态", exact: true })).toBeEnabled();
  expect(fixture.uploads).toBe(1);
  expect(fixture.errors).toEqual([]);
});
