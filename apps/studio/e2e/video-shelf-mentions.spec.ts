import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Three seconds of mono PCM, matching the reference-duration validation.
function silentWav() {
  const rate = 8000, bytes = rate * 3 * 2;
  const wav = Buffer.alloc(44 + bytes);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + bytes, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(bytes, 40);
  return wav;
}

test("long labels keep their own row beside flowing short labels and retain selection after resizing", async ({ page }, info) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const image = readFileSync(new URL("../client/public/comic-lab-pack/stickers/sticker_nice.png", import.meta.url));
  const labels = ["@图片1", "@图片2", "@这是一个需要独立成行的完整场景参考素材名称"];
  const ids = ["short-a", "short-b", "long-c"];
  await page.addInitScript(() => { localStorage.setItem("ai-manju:auth_token", "shelf-qa"); localStorage.setItem("ai-manju:token-store", "local"); });
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/assets/image-qa/content") return route.fulfill({ contentType: "image/png", body: image });
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me") data = { id: "qa", username: "qa", role: "super_admin", status: "active" };
    else if (path === "/api/announcements/current") data = null;
    else if (path === "/api/sd-video/conversations") data = { items: [{ id: "long-history", title: "长短引用", version: 1, created_at: 1 }], total: 1 };
    else if (path === "/api/sd-video/conversations/long-history/messages") data = { items: [{
      id: "long-message", role: "user", created_at: 1, version: 1, metadata: {},
      text: [...ids, ids[0], ids[1]].map(id => `@[ref:${id}]`).join("\n"),
      attachments: ids.map((id, index) => ({ id, token: labels[index], name: labels[index], kind: "image", role: "reference",
        assetId: "image-qa", mime: "image/png", bytes: image.length, width: 640, height: 640 })),
    }], total: 1 };
    return route.fulfill({ json: { success: true, data } });
  });
  await page.goto("/video?scope=personal#workbench");
  await page.getByRole("button", { name: "知道了", exact: true }).click();
  await page.getByRole("button", { name: "重新编辑提示词和参考素材", exact: true }).press("Enter");
  const prompt = page.locator(".wb-composer textarea"), chips = page.locator(".wb-prompt-overlay .wb-token");
  await expect(chips).toHaveCount(5);
  await expect(page.locator(".wb-token.long")).toHaveCount(1);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await prompt.scrollIntoViewIfNeeded();
    await prompt.evaluate((input: HTMLTextAreaElement) => { input.scrollTop = 0; input.dispatchEvent(new Event("scroll")); });
    await expect.poll(async () => {
      const boxes = await chips.evaluateAll(items => items.map(item => { const box = item.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width }; }));
      const input = (await prompt.boundingBox())!;
      return boxes[0].y === boxes[1].y && boxes[2].y > boxes[1].y && boxes[3].y > boxes[2].y
        && boxes[3].y === boxes[4].y && boxes[2].x + boxes[2].width < input.x + input.width;
    }).toBe(true);
    await page.screenshot({ path: info.outputPath(`mixed-reference-lengths-${width}.png`), fullPage: true });
  }
  await prompt.focus();
  await prompt.evaluate((input: HTMLTextAreaElement) => {
    const tokens = [...input.value.matchAll(/\u2007+/g)];
    input.setSelectionRange(tokens[3].index!, tokens[3].index! + tokens[3][0].length);
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(() => prompt.evaluate((input: HTMLTextAreaElement) => {
    const data = new DataTransfer();
    input.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData("text/plain");
  })).toBe("@[ref:short-a]");
});

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`clicking library media inserts usable prompt references at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const image = readFileSync(new URL("../client/public/comic-lab-pack/stickers/sticker_nice.png", import.meta.url));
    const video = readFileSync(new URL("./fixtures/video-shelf-reference.mp4", import.meta.url));
    const audio = silentWav();
    const model = "qa::doubao-seedance-2-0-260128";
    const assets = [
      { id: "image-qa", type: "image", name: "参考图片.png", content_type: "image/png", size: image.length },
      { id: "video-qa", type: "video", name: "参考视频.mp4", content_type: "video/mp4", size: video.length },
      { id: "audio-qa", type: "audio", name: "参考音频.wav", content_type: "audio/wav", size: audio.length },
      { id: "extra-qa", type: "image", name: "待移除图片.png", content_type: "image/png", size: image.length },
    ];
    const submissions: Array<{ content: Array<Record<string, any>> }> = [];
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    // External font-CDN stalls must not block these API-isolated interaction checks.
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    await page.addInitScript(() => { localStorage.setItem("ai-manju:auth_token", "shelf-qa"); localStorage.setItem("ai-manju:token-store", "local"); });
    // Keep cloud conversation writes and generation requests entirely inside the test.
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      if (!path.startsWith("/api/")) return route.continue();
      const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "authorization,content-type,x-request-id,idempotency-key", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,OPTIONS" };
      if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
      if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
      const asset = assets.find(item => path === `/api/assets/${item.id}/content`);
      if (asset) return route.fulfill({ headers,
        contentType: url.searchParams.has("poster") ? "image/png" : asset.content_type,
        body: url.searchParams.has("poster") ? image : asset.type === "video" ? video : asset.type === "audio" ? audio : image });
      let data: unknown = { items: [], total: 0 };
      if (path === "/api/auth/me") data = { id: "qa", username: "qa", role: "super_admin", status: "active" };
      else if (path === "/api/announcements/current") data = null;
      else if (path === "/api/asset-folders") data = [];
      else if (path === "/api/assets/library") data = { items: assets, total: assets.length };
      else if (path === "/api/member/quote") data = { credits: 30, params: { pricing_source: "membership_price_sheet" } };
      else if (path === "/api/ai/models") data = { models: [model], video_models: [model], default_video_model: model,
        video_model_protocols: { [model]: "seedance" }, video_model_durations: { [model]: [5, 10, 15] },
        video_model_capabilities: { [model]: { resolutions: ["720p"], ratios: ["16:9"], supports: ["text", "reference_image", "reference_video", "reference_audio"] } } };
      else if (path.startsWith("/api/sd-video/") && ["POST", "PATCH"].includes(request.method())) data = { ...request.postDataJSON(), version: 1, created_at: Date.now() / 1000 };
      else if (path === "/api/ai/contents/generations/tasks" && request.method() === "POST") {
        submissions.push(request.postDataJSON()); data = { id: "job_shelf_qa", status: "queued" };
      } else if (path === "/api/jobs/job_shelf_qa") data = { id: "job_shelf_qa", type: "video.generate", status: "running", state: "running", progress: 10 };
      return route.fulfill({ headers, json: { success: true, data } });
    });
    await page.goto("/video?scope=personal#workbench");
    await expect(page.locator(".wb-page")).toBeVisible();
    await page.getByRole("button", { name: "知道了", exact: true }).click();
    await page.getByRole("button", { name: "从资产库选择", exact: true }).click();
    await expect(page.locator(".wb-picker-card")).toHaveCount(4);
    // Audio selected first must still validate together with the images and video in this batch.
    for (const index of [2, 0, 1, 3]) await page.locator(".wb-picker-card").filter({ hasText: assets[index].name }).click();
    await page.getByRole("button", { name: "确认添加 4 项" }).click();
    await expect(page.locator(".wb-shelf-item")).toHaveCount(4);
    const prompt = page.locator(".wb-composer textarea");
    await prompt.fill("前后");
    await prompt.press("Home");
    await prompt.press("ArrowRight");
    await page.getByRole("button", { name: "引用 @图片1", exact: true }).click();
    await expect(prompt).toBeFocused();
    await page.getByRole("button", { name: "引用 @视频1", exact: true }).click();
    await expect(prompt).toBeFocused();
    const audioButton = page.getByRole("button", { name: "引用 @音频1", exact: true });
    await audioButton.focus();
    await audioButton.press("Space");
    await expect(prompt).toBeFocused();
    await page.getByRole("button", { name: "引用 @图片1", exact: true }).click();
    const value = await prompt.inputValue();
    expect(value).toBe(`前\n${Array(4).fill("\u2007".repeat(14)).join(" ")}\n后`);
    expect(await page.locator(".wb-prompt-overlay .wb-token i").allTextContents()).toEqual(["@图片1", "@视频1", "@音频1", "@图片1"]);
    await page.locator(".wb-shelf-item").filter({ hasText: "@图片2" }).getByTitle("移除引用", { exact: true }).click();
    await expect(prompt).toHaveValue(value);
    await expect(page.locator(".wb-shelf-item")).toHaveCount(3);
    expect(submissions).toHaveLength(0);
    await prompt.scrollIntoViewIfNeeded();
    await prompt.evaluate((element: HTMLTextAreaElement) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
    const geometry = await prompt.evaluate((element) => {
      const textarea = element as HTMLTextAreaElement;
      const overlay = document.querySelector<HTMLElement>(".wb-prompt-overlay")!;
      const mirror = document.createElement("div");
      const style = getComputedStyle(textarea);
      for (const property of Array.from(style)) mirror.style.setProperty(property, style.getPropertyValue(property));
      const bounds = textarea.getBoundingClientRect();
      Object.assign(mirror.style, { position: "fixed", left: `${bounds.left}px`, top: `${bounds.top}px`,
        width: `${textarea.clientWidth}px`, height: `${textarea.clientHeight}px`, visibility: "hidden", overflow: "hidden" });
      mirror.textContent = textarea.value + "\u200b";
      document.body.append(mirror);
      mirror.scrollTop = textarea.scrollTop;
      const source = mirror.firstChild!;
      const nativeTokens = [...textarea.value.matchAll(/\u2007+/g)];
      const deltas = [...overlay.querySelectorAll(".wb-token-source")].map((token, index) => {
        const range = document.createRange();
        range.setStart(source, nativeTokens[index].index!); range.setEnd(source, nativeTokens[index].index! + nativeTokens[index][0].length);
        const native = range.getBoundingClientRect();
        const visual = token.getBoundingClientRect();
        return { x: Math.abs(native.x - visual.x), y: Math.abs(native.y - visual.y), width: Math.abs(native.width - visual.width), lines: token.getClientRects().length };
      });
      mirror.remove();
      return deltas;
    });
    expect(geometry).toHaveLength(4);
    for (const delta of geometry) {
      expect(delta.x).toBeLessThan(1); expect(delta.y).toBeLessThan(1); expect(delta.width).toBeLessThan(1); expect(delta.lines).toBe(1);
    }
    const chips = page.locator(".wb-prompt-overlay .wb-token");
    const firstChip = (await chips.first().boundingBox())!;
    await page.mouse.click(firstChip.x + firstChip.width - 2, firstChip.y + firstChip.height / 2);
    await expect.poll(() => prompt.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(16);
    await prompt.press("ArrowLeft");
    expect(await prompt.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(2);
    await prompt.press("ArrowRight");
    expect(await prompt.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(16);
    const secondChip = (await chips.nth(1).boundingBox())!;
    expect(Math.abs(secondChip.y - firstChip.y)).toBeLessThan(1);
    expect(secondChip.x).toBeGreaterThan(firstChip.x + firstChip.width);
    await page.mouse.move(firstChip.x + 2, firstChip.y + firstChip.height / 2);
    await page.mouse.down();
    await page.mouse.move(secondChip.x + secondChip.width - 2, secondChip.y + secondChip.height / 2, { steps: 8 });
    await page.mouse.up();
    expect(await prompt.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([2, 31]);
    await prompt.press("Control+End");
    await prompt.press("Enter");
    await prompt.pressSequentially("caret-test");
    await expect(prompt).toHaveValue(`${value}\ncaret-test`);
    expect(submissions).toHaveLength(0);
    // Copy/cut uses the canonical ids, never the invisible display spacers.
    const copied = await prompt.evaluate((element: HTMLTextAreaElement) => {
      element.select();
      const clipboardData = new DataTransfer();
      element.dispatchEvent(new ClipboardEvent("copy", { clipboardData, bubbles: true, cancelable: true }));
      return clipboardData.getData("text/plain");
    });
    expect(copied).toMatch(/^前\n(?:@\[ref:[^\]]+\] ){3}@\[ref:[^\]]+\]\n后\ncaret-test$/);
    await prompt.press("ArrowRight");
    await page.screenshot({ path: info.outputPath("shelf-inserts-media-mentions.png"), fullPage: true, caret: "initial" });
    const token = copied.match(/@\[ref:[^\]]+\]/)![0];
    await prompt.fill(`${token} `.repeat(200) + "滚动后的文字");
    await prompt.press("Control+End");
    await prompt.pressSequentially("-end");
    await expect(chips).toHaveCount(200);
    const scrolled = await prompt.evaluate((element: HTMLTextAreaElement) => {
      const overlay = document.querySelector<HTMLElement>(".wb-prompt-overlay")!;
      return { native: element.scrollTop, visual: overlay.scrollTop, scrollHeight: element.scrollHeight, visualHeight: overlay.scrollHeight };
    });
    expect(scrolled.native).toBeGreaterThan(0);
    expect(scrolled.visual).toBe(scrolled.native);
    expect(Math.abs(scrolled.scrollHeight - scrolled.visualHeight)).toBeLessThan(2);
    const inputBounds = (await prompt.boundingBox())!;
    const actionsBounds = (await page.locator(".wb-composer-actions").boundingBox())!;
    expect(inputBounds.y + inputBounds.height).toBeLessThanOrEqual(actionsBounds.y + 1);
    await page.screenshot({ path: info.outputPath("scrolled-reference-caret.png"), fullPage: true, caret: "initial" });
    await prompt.fill(copied);
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
    await expect.poll(() => submissions.length).toBe(1);
    const content = submissions[0].content;
    expect(content.map(item => item.type)).toEqual(["text", "image_url", "video_url", "audio_url"]);
    expect(content[0].text).toContain("前\n图片1 视频1 音频1 图片1\n后\ncaret-test");
    expect(content[0].text).not.toContain("@[ref:");
    expect(content[1].image_url.url).toMatch(/^data:image\//);
    expect(content[2].video_url.url).toBe(`data:video/mp4;base64,${video.toString("base64")}`);
    expect(content[3].audio_url.url).toBe(`data:audio/wav;base64,${audio.toString("base64")}`);
    expect(errors).toEqual([]);
  });
}
