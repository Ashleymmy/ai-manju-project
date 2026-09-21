import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const png = readFileSync(new URL("../client/public/comic-lab-pack/stickers/sticker_nice.png", import.meta.url));
const prompt = "四个不一样的苹果@[node:reference-a]@[node:reference-b]\n保持光照";

for (const kind of ["config", "image", "video", "text"]) {
  test(`copies references into a ${kind} node, supports cut/paste and survives reload`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(testInfo.project.use.baseURL!).origin });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const project = { id: "prompt-clipboard-qa", title: "Prompt clipboard QA", scope: "personal", owner_id: "qa" };
    let snapshot: any = {
      schema: "ai-manhua-studio-canvas", version: 3,
      nodes: [
        ...["a", "b"].map((id, index) => ({ id: `reference-${id}`, kind: "image", title: `Reference ${id}`, content: "", x: 100 + index * 170, y: 80, width: 120, height: 90, imageAssetId: `asset-${id}`, metadata: { assetId: `asset-${id}`, assetScope: "personal" } })),
        { id: "source", kind: "image", title: "Source", content: prompt, x: 450, y: 80, width: 240, height: 180, metadata: { prompt, composerContent: prompt } },
        { id: "target", kind, title: "Target", content: "", x: 780, y: 80, width: 240, height: 180, metadata: { generationMode: kind === "video" ? "video" : kind === "text" ? "text" : "image", model: "gpt-image-2" } },
      ],
      edges: [], connections: [], groups: [], zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 },
    };
    const edits: Buffer[] = [];
    await page.addInitScript(() => {
      localStorage.setItem("ai-manju:auth_token", "qa-token");
      localStorage.setItem("ai-manju:token-store", "local");
    });
    await page.route("**/api/**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/api/")) return route.continue();
      const headers = {
        "Access-Control-Allow-Origin": new URL(page.url()).origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "authorization,content-type,x-request-id,idempotency-key",
        "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      };
      if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
      if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
      if (/\/assets\/asset-(a|b|generated)\/content$/.test(url.pathname)) return route.fulfill({ headers, contentType: "image/png", body: png });
      let data: unknown = { items: [], total: 0 };
      if (url.pathname === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active" };
      else if (url.pathname === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
      else if (url.pathname === "/api/ai/models") data = { models: ["gpt-image-2"], image_models: ["gpt-image-2"], default_image_model: "gpt-image-2", video_models: ["sora-2"], default_video_model: "sora-2" };
      else if (url.pathname === `/api/projects/${project.id}/snapshot`) {
        if (request.method() === "PUT") snapshot = request.postDataJSON().data;
        data = { project_id: project.id, version: 1, data: snapshot };
      } else if (url.pathname === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
      else if (url.pathname === "/api/projects") data = { items: [project], total: 1 };
      else if (url.pathname === "/api/ai/image/edits") {
        edits.push(request.postDataBuffer()!);
        data = { job_id: "job-ref" };
      } else if (url.pathname === "/api/jobs/job-ref") data = { id: "job-ref", type: "image.generate", status: "succeeded", state: "succeeded", scope: "personal", result: { outputs: [{ asset_id: "asset-generated", name: "Generated", content_type: "image/png" }] } };
      if (url.pathname === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
      return route.fulfill({ headers, json: { success: true, data, request_id: "prompt-clipboard-qa" } });
    });
    await page.goto(`/canvas/${project.id}?scope=personal`);
    const panel = page.locator(".inspector-panel");
    const editor = panel.locator("textarea.node-card-prompt");
    const chips = panel.locator(".mention-chip-thumb-only");
    await page.locator('[data-node-id="source"] .node-float-label').click();
    await expect(chips).toHaveCount(2);
    await editor.focus();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+c");
    expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n?/g, "\n")).toBe(prompt);
    await page.locator('[data-node-id="target"] .node-float-label').click();
    await editor.focus();
    await page.keyboard.press("Control+v");
    await expect(chips).toHaveCount(2);
    const savedPrompt = () => snapshot.nodes.find((node: any) => node.id === "target").metadata.composerContent;
    await expect.poll(savedPrompt).toBe(prompt);
    expect(snapshot.nodes).toHaveLength(4);
    expect(snapshot.edges).toHaveLength(0);
    await expect(chips.locator("img").first()).toHaveJSProperty("naturalWidth", 260);

    // Select only the first adjacent thumbnail, then cut/paste via the real clipboard.
    await editor.focus();
    await page.keyboard.press("Control+Home");
    for (let index = 0; index < "四个不一样的苹果".length; index++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Control+x");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("@[node:reference-a]");
    await expect(chips).toHaveCount(1);
    await page.keyboard.press("Control+v");
    await expect(chips).toHaveCount(2);
    await expect.poll(savedPrompt).toBe(prompt);
    await page.reload();
    await page.locator('[data-node-id="target"] .node-float-label').click();
    await expect(chips).toHaveCount(2);

    // The one-click copy path uses the same canonical plain-text representation.
    await panel.getByRole("button", { name: "复制提示词", exact: true }).click();
    expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n?/g, "\n")).toBe(prompt);
    await editor.focus();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+v");
    await expect(chips).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath(`pasted-${kind}-references.png`) });

    // Test both the reported six-image suffix and wrapped, image-only content.
    for (const scenario of [
      { name: "trailing", prefix: "吧哈斯巴擦拭就餐时的承诺吧", count: 6 },
      { name: "wrapped", prefix: "", count: 24 },
    ]) {
      if (scenario.name === "wrapped") {
        await page.locator(".canvas-bottom-tools").getByRole("button", { name: "−", exact: true }).click();
        await page.locator(".canvas-bottom-tools").getByRole("button", { name: "−", exact: true }).click();
      }
      const tokens = Array.from({ length: scenario.count }, (_, index) => `@[node:reference-${index % 2 ? "b" : "a"}]`);
      const caretPrompt = scenario.prefix + tokens.join("");
      await page.evaluate(text => navigator.clipboard.writeText(text), caretPrompt);
      await editor.focus();
      await page.keyboard.press("Control+a");
      await page.keyboard.press("Control+v");
      await expect(chips).toHaveCount(scenario.count);
      const caret = panel.locator(".canvas-mention-caret");
      const firstBox = (await chips.first().boundingBox())!;
      const lastBox = (await chips.last().boundingBox())!;
      if (scenario.name === "wrapped") expect(lastBox.y).toBeGreaterThan(firstBox.y + firstBox.height);
      for (const index of [0, 2, scenario.count - 1]) {
        const chip = chips.nth(index);
        const box = (await chip.boundingBox())!;
        for (const [fraction, boundary] of [[0.1, "start"], [0.9, "end"]] as const) {
          await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
          await expect(editor).toBeFocused();
          const offset = Number(await chip.getAttribute(`data-mention-${boundary}`));
          await expect.poll(() => editor.evaluate(element => element.selectionStart)).toBe(offset);
          await expect(caret).toBeVisible();
        }
      }
      // A click in the empty area after the last image must be a usable end position.
      await page.mouse.click(lastBox.x + lastBox.width + 12, lastBox.y + lastBox.height / 2);
      await expect.poll(() => editor.evaluate(element => element.selectionStart === element.value.length)).toBe(true);
      const caretBox = (await caret.boundingBox())!;
      expect(Math.abs(caretBox.x - lastBox.x - lastBox.width)).toBeLessThan(2);
      expect(Math.abs(caretBox.y - lastBox.y)).toBeLessThan(2);
      await page.screenshot({ path: testInfo.outputPath(`caret-${kind}-${scenario.name}.png`) });
      await page.keyboard.insertText("末尾继续");
      await expect.poll(savedPrompt).toBe(caretPrompt + "末尾继续");

      // Inserting in a thumbnail gap preserves every surrounding reference.
      const gapBox = (await chips.nth(2).boundingBox())!;
      await page.mouse.click(gapBox.x + 1, gapBox.y + gapBox.height / 2);
      await page.keyboard.insertText("中间");
      await expect.poll(savedPrompt).toBe(scenario.prefix + tokens.slice(0, 2).join("") + "中间" + tokens.slice(2).join("") + "末尾继续");
      await expect(chips).toHaveCount(scenario.count);
    }

    // Restore the original prompt for the generation-reference assertions below.
    await page.evaluate(text => navigator.clipboard.writeText(text), prompt);
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+v");
    await expect(chips).toHaveCount(2);
    if (kind === "config" || kind === "image") {
      await panel.getByRole("button", { name: "生成", exact: true }).click();
      await expect.poll(() => edits.length).toBe(1);
      expect(edits[0].toString().match(/name="image"/g)).toHaveLength(2);
      expect(edits[0].includes(png)).toBe(true);
      expect(edits[0].toString()).toContain("四个不一样的苹果");
    }
    expect(errors).toEqual([]);
  });
}
