import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("successive Agent generations keep one column across completion and reload", async ({ page }, info) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const png = readFileSync(new URL("../client/public/comic-lab-pack/stickers/sticker_nice.png", import.meta.url));
  const project = { id: "agent-placement-qa", title: "Agent 排布验证", scope: "personal", owner_id: "qa" };
  let snapshot: any = { schema: "ai-manhua-studio-canvas", version: 3,
    nodes: [{ id: "existing", kind: "text", title: "保留原节点", content: "已有内容", x: 100, y: 100, width: 300, height: 170 }],
    edges: [], connections: [], groups: [], zoom: 80, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 0.8 } };
  const errors: string[] = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  let turn = 0;
  let submitted = 0;
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "placement-qa");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin,
      "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "authorization,content-type,x-request-id,idempotency-key",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS" };
    if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    if (/\/assets\/result-\d+\/content$/.test(path)) return route.fulfill({ headers, contentType: "image/png", body: png });
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active", display_name: "QA" };
    else if (path === "/api/announcements/current") data = null;
    else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (path === "/api/asset-folders") data = [];
    else if (path === "/api/ai/models") data = { models: ["gpt-5.5"], text_models: ["gpt-5.5"], agent_text_models: ["gpt-5.5"],
      image_models: ["gpt-image-2"], default_text_model: "gpt-5.5", default_image_model: "gpt-image-2" };
    else if (path === `/api/projects/${project.id}/snapshot`) {
      if (request.method() === "PUT") snapshot = request.postDataJSON().data;
      data = { project_id: project.id, version: 1, data: snapshot };
    } else if (path === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
    else if (path === "/api/projects") data = { items: [project], total: 1 };
    else if (path === "/api/ai/text") {
      const body = request.postDataJSON();
      if (body.tool_choice === "required") {
        turn++;
        data = { content: "准备生成", tool_calls: [{ id: `call-${turn}`, type: "function", function: {
          name: "canvas_generate_image", arguments: JSON.stringify({ prompt: `场景 ${turn}`, model: "gpt-image-2",
            x: turn % 2 ? -1800 : 5000, y: turn % 2 ? 50 : -600 }),
        } }] };
      } else data = { content: `第 ${turn} 组完成`, tool_calls: [] };
    } else if (path === "/api/ai/image/generations") {
      submitted++;
      data = { job_id: `placement-${submitted}` };
    } else if (/\/jobs\/placement-\d+$/.test(path)) {
      const index = path.split("-").at(-1);
      data = { id: `placement-${index}`, type: "image.generate", status: "succeeded", state: "succeeded", scope: "personal",
        result: { outputs: [{ asset_id: `result-${index}`, name: `生成结果 ${index}`, content_type: "image/png" }] } };
    }
    if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data, request_id: "placement-qa" } });
  });
  await page.goto(`/canvas/${project.id}?scope=personal`);
  await expect(page.locator(".real-canvas-stage")).toBeVisible();
  await page.getByRole("button", { name: "打开 Agent", exact: true }).click();
  const groups: any[][] = [];
  for (let index = 1; index <= 3; index++) {
    await page.locator(".agent-composer textarea").fill(`生成第 ${index} 张图片`);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.locator(".agent-pending-actions").getByRole("button", { name: "执行", exact: true }).click();
    await expect(page.locator(".agent-msg-assistant").last()).toContainText(`第 ${index} 组完成`);
    await expect.poll(() => submitted).toBe(index);
    await expect.poll(() => snapshot.nodes.filter((node: any) => node.metadata?.agentGenerationFlowId).length).toBe(index * 2);
    const group = snapshot.nodes.filter((node: any) => node.metadata?.agentGenerationFlowId).slice(-2);
    groups.push(structuredClone(group));
    expect(group[0].x).toBe(100);
    expect(group[1].x).toBe(520);
    const output = snapshot.nodes.find((node: any) => node.metadata?.sourceNodeId === group[1].id);
    expect(output).toBeTruthy();
    expect(output.x).toBeGreaterThan(group[1].x + group[1].width);
    const outputCard = page.locator(`[data-node-id="${output.id}"]`);
    await expect(outputCard).toBeVisible();
    const outputBounds = (await outputCard.boundingBox())!;
    const panelBounds = (await page.getByRole("dialog", { name: "Agent 对话" }).boundingBox())!;
    expect(outputBounds.x).toBeGreaterThanOrEqual(0);
    expect(outputBounds.x + outputBounds.width).toBeLessThan(panelBounds.x);
    expect(snapshot.nodes.find((node: any) => node.id === "existing")).toMatchObject({ x: 100, y: 100, content: "已有内容" });
    if (index > 1) {
      const previous = groups[index - 2];
      expect(group[0].y).toBeGreaterThan(previous[1].y + previous[1].height);
      expect(snapshot.nodes.find((node: any) => node.id === previous[0].id)).toMatchObject({ x: previous[0].x, y: previous[0].y });
    }
    if (index === 2) {
      await page.reload();
      await expect(page.locator(".real-canvas-stage")).toBeVisible();
      if (!await page.locator(".agent-composer textarea").isVisible()) {
        await page.getByRole("button", { name: "打开 Agent", exact: true }).click();
      }
    }
  }
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("agent-flow-placement.png") });
  await info.attach("flow-positions", { body: JSON.stringify(groups.map(group => group.map(({ x, y, width, height }) => ({ x, y, width, height }))), null, 2), contentType: "application/json" });
});
