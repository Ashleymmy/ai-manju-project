import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const png = readFileSync(new URL("../client/public/comic-lab-pack/stickers/sticker_nice.png", import.meta.url));

for (const menuTarget of ["node", "blank", "group"] as const) {
  test(`marquee selection registers images from the ${menuTarget} context menu and retries failures`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    let releaseUploads!: () => void;
    const uploadGate = new Promise<void>(resolve => { releaseUploads = resolve; });
    const errors: string[] = [];
    let uploads = 0;
    let snapshot: any = {
      schema: "ai-manhua-studio-canvas", version: 3,
      nodes: [
        ...["first", "second"].map((id, index) => ({ id, kind: "image", title: `角色${index + 1}`, imageSrc: `data:image/png;base64,${png.toString("base64")}`, x: 180 + index * 360, y: 240, width: 280, height: 210 })),
        { id: "text", kind: "text", title: "提示词", content: "保留文字", x: 900, y: 240, width: 280, height: 170 },
        { id: "empty", kind: "image", title: "空图片", x: 900, y: 490, width: 280, height: 210 },
      ], edges: [], groups: [], zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 },
    };
    const project = { id: "batch-registration-qa", title: "批量注册验收", scope: "personal", owner_id: "qa" };
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("ai-manju:auth_token", "qa-token");
      localStorage.setItem("ai-manju:token-store", "local");
    });
    // Isolate user projects and provider uploads; never submit real registrations.
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url());
      const path = url.pathname;
      if (!path.startsWith("/api/")) return route.continue();
      const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "authorization,content-type,x-request-id", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS" };
      if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
      if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
      let data: unknown = { items: [], total: 0 };
      if (path === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active" };
      else if (path === "/api/announcements/current") data = null;
      else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
      else if (path === "/api/ai/models") data = { video_models: ["official::seedance-2.0"], default_video_model: "official::seedance-2.0", model_labels: { "official::seedance-2.0": "yuntu Seedance Fast" } };
      else if (path === `/api/projects/${project.id}/snapshot`) {
        if (request.method() === "PUT") snapshot = request.postDataJSON().data;
        data = { project_id: project.id, version: 1, data: snapshot };
      } else if (path === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
      else if (path === "/api/projects") data = { items: [project], total: 1 };
      else if (path === "/api/asset-folders") data = [];
      else if (path === "/api/ai/seedance-assets/upload") {
        const number = ++uploads;
        expect(url.searchParams.get("provider_id")).toBe("official");
        await uploadGate;
        if (number === 2) return route.fulfill({ headers, status: 502, json: { success: false, error: "测试单张失败" } });
        data = { id: `registered-${number}`, name: `角色${number}`, status: "Active", volcano_asset_id: `remote-${number}`, asset_type: "Image" };
      }
      if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
      return route.fulfill({ headers, json: { success: true, data, request_id: "batch-qa" } });
    });
    await page.goto(`/canvas/${project.id}?scope=personal`);
    await expect(page.locator(".real-canvas-node")).toHaveCount(4);
    const notice = page.getByRole("button", { name: "知道了", exact: true });
    if (await notice.isVisible()) await notice.click();
    await page.mouse.move(120, 215);
    await page.mouse.down();
    await page.mouse.move(1250, 800, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator(".real-canvas-node.selected")).toHaveCount(4);
    await expect(page.locator(".canvas-group-frame.pending")).toBeVisible();
    if (menuTarget === "group") await page.getByRole("button", { name: "组成分组", exact: true }).click();
    const openBatch = async () => {
      if (menuTarget === "node") await page.locator('[data-node-id="first"]').click({ button: "right", position: { x: 100, y: 100 } });
      else if (menuTarget === "group") await page.locator('.canvas-group-header').click({ button: "right", position: { x: 10, y: 34 } });
      else await page.mouse.click(840, 620, { button: "right" });
      await page.locator(".canvas-context-menu").screenshot({ path: testInfo.outputPath("batch-menu.png") });
      await page.locator(".canvas-context-menu").getByRole("button", { name: "批量注册拟真人素材", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("将批量注册 2 张图片，跳过 2 个非图片或空节点");
      await expect(dialog.getByRole("combobox", { name: "目标视频模型" })).toHaveValue("official::seedance-2.0");
      await dialog.screenshot({ path: testInfo.outputPath("batch-confirm.png") });
      await dialog.getByRole("button", { name: "开始批量注册", exact: true }).click();
      await expect(dialog).toHaveCount(0);
    };
    await openBatch();
    await expect.poll(() => uploads).toBe(2);
    await openBatch();
    expect(uploads).toBe(2);
    releaseUploads();
    await expect(page.getByText("拟真人素材批量注册完成", { exact: true })).toBeVisible();
    await expect.poll(() => snapshot.nodes.filter((node: any) => node.metadata?.seedanceVolcanoAssets?.length).length).toBe(1);
    await openBatch();
    await expect.poll(() => uploads).toBe(3);
    await expect.poll(() => snapshot.nodes.filter((node: any) => node.metadata?.seedanceVolcanoAssets?.length).length).toBe(2);
    expect(snapshot.nodes).toHaveLength(4);
    expect(errors).toEqual([]);
  });
}
