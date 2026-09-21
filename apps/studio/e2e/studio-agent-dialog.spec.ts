import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`opens Agent on the current page and keeps usable conversations at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    const requests: any[] = [];
    const writes: string[] = [];
    const project = { id: "agent-qa", title: "Canvas Agent QA", scope: "personal", owner_id: "qa" };
    let snapshot: any = { schema: "ai-manhua-studio-canvas", version: 3, nodes: [], edges: [], connections: [], groups: [], zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 } };
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
        "Access-Control-Allow-Headers": "authorization,content-type,x-request-id",
        "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      };
      if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
      if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
      if (request.method() !== "GET") writes.push(path);
      let data: unknown = { items: [], total: 0 };
      if (path === "/api/auth/me") data = { id: "qa", username: "QA", display_name: "QA", role: "super_admin", status: "active" };
      else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
      else if (path === "/api/ai/models") data = { text_models: ["qa::gpt-5.6-luna", "qa::plain-model"], agent_text_models: ["qa::gpt-5.6-luna"], default_text_model: "qa::gpt-5.6-luna" };
      else if (path === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
      else if (path === `/api/projects/${project.id}/snapshot`) {
        if (request.method() === "PUT") snapshot = request.postDataJSON().data;
        data = { project_id: project.id, version: 1, data: snapshot };
      }
      else if (path === "/api/ai/text") {
        requests.push(request.postDataJSON());
        data = { content: "可以先确定主题，再设计角色与镜头。", model: request.postDataJSON().model };
      }
      if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
      return route.fulfill({ headers, json: { success: true, data, request_id: "studio-agent-qa" } });
    });
    await page.goto("/skills");
    await expect(page.getByRole("heading", { name: "技能库", exact: true, includeHidden: true })).toBeVisible();
    const notice = page.getByRole("button", { name: "知道了", exact: true });
    if (await notice.isVisible()) await notice.click();
    const search = page.getByPlaceholder("名称、描述或指令");
    await search.fill("My unsaved search");
    const fab = page.getByRole("button", { name: "打开 Agent 对话", exact: true });
    await fab.click();
    const dialog = page.getByRole("dialog", { name: "Agent 对话", exact: true });
    await expect(dialog.locator(".agent-composer textarea")).toBeEnabled();
    await expect(page).toHaveURL(/\/skills$/);
    await expect(search).toHaveValue("My unsaved search");
    await expect(dialog.getByRole("heading", { name: "今天一起创作点什么？" })).toBeVisible();
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    await expect(dialog.getByRole("button", { name: "发送", exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("agent-welcome.png") });
    if (viewport.width > 600) {
      const handle = (await dialog.locator(".agent-panel-resizer").boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x - 25, handle.y + handle.height / 2, { steps: 5 });
      await page.mouse.up();
      expect((await dialog.boundingBox())!.width).toBeGreaterThan(bounds.width + 10);
    }

    const composer = dialog.locator(".agent-composer textarea");
    await dialog.locator(".agent-model-selector").click();
    await dialog.getByRole("button", { name: "plain-model", exact: true }).click();
    await composer.fill("帮我规划一段创意故事");
    await dialog.getByRole("button", { name: "发送", exact: true }).click();
    await expect(dialog.locator(".agent-msg-assistant")).toContainText("可以先确定主题");
    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe("qa::plain-model");
    expect(requests[0].tools).toBeUndefined();
    expect(requests[0].tool_choice).toBeUndefined();
    expect(requests[0].messages.at(-1).content).toBe("帮我规划一段创意故事");

    await composer.fill("尚未发送的补充");
    await dialog.getByRole("button", { name: "关闭对话", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(search).toHaveValue("My unsaved search");
    await fab.click();
    await expect(composer).toHaveValue("尚未发送的补充");
    await expect(dialog.locator(".agent-msg-assistant")).toContainText("可以先确定主题");
    await dialog.locator(".agent-thread-trigger").click();
    await dialog.locator(".agent-thread-new").click();
    await expect(dialog.locator(".agent-msg")).toHaveCount(0);
    await dialog.locator(".agent-thread-trigger").click();
    await dialog.locator(".agent-thread-item-main").first().click();
    await expect(dialog.locator(".agent-msg-assistant")).toContainText("可以先确定主题");
    await page.screenshot({ path: testInfo.outputPath("agent-conversation.png") });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.reload();
    await fab.click();
    await dialog.locator(".agent-thread-trigger").click();
    await dialog.locator(".agent-thread-item-main").first().click();
    await expect(dialog.locator(".agent-msg-assistant")).toContainText("可以先确定主题");
    expect(writes.filter(path => path.startsWith("/api/projects"))).toEqual([]);
    expect(errors).toEqual([]);
    await expect(page).toHaveURL(/\/skills$/);
    if (viewport.width > 600) {
      await page.goto(`/canvas/${project.id}?scope=personal`);
      await page.getByRole("button", { name: "打开 Agent", exact: true }).click();
      const canvasAgent = page.getByRole("dialog", { name: "Agent 对话", exact: true });
      await expect(canvasAgent.locator(".agent-composer textarea")).toBeEnabled();
      await expect(canvasAgent.locator(".agent-confirm-picker")).toBeVisible();
      await expect(canvasAgent.locator(".agent-msg")).toHaveCount(0);
      await canvasAgent.locator(".agent-composer textarea").fill("读取当前画布");
      await canvasAgent.getByRole("button", { name: "发送", exact: true }).click();
      await expect(canvasAgent.locator(".agent-msg-assistant")).toContainText("可以先确定主题");
      expect(requests.at(-1).tool_choice).toBe("required");
      expect(requests.at(-1).tools.some((tool: any) => tool.function.name === "canvas_get_state")).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("canvas-agent-regression.png"), animations: "disabled" });
      expect(errors).toEqual([]);
    }
  });
}
