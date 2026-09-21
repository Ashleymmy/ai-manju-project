import { expect, test, type Locator, type Page } from "@playwright/test";

async function drag(page: Page, handle: Locator, dx: number, dy: number) {
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}

for (const kind of ["image", "video"] as const) {
  for (const [width, height] of [[640, 360], [360, 640]]) {
    test(`${kind} ${width}:${height} keeps source proportions through drag, undo and reload`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      const media = await page.evaluate(async ({ width, height, kind }) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d")!;
        const draw = () => {
          context.fillStyle = "#258c69";
          context.fillRect(0, 0, width, height);
          context.fillStyle = "#f8dc56";
          context.fillRect(20, 20, width - 40, height - 40);
          context.fillStyle = "#c95372";
          context.beginPath();
          context.arc(width / 2, height / 2, 90, 0, Math.PI * 2);
          context.fill();
        };
        draw();
        const png = canvas.toDataURL("image/png").split(",")[1];
        if (kind === "image") return { png, video: [] as number[] };
        const stream = canvas.captureStream(10);
        const recorder = new MediaRecorder(stream, { mimeType: "video/mp4" });
        const chunks: Blob[] = [];
        recorder.ondataavailable = event => chunks.push(event.data);
        const done = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
        recorder.start();
        const timer = setInterval(draw, 50);
        await new Promise(resolve => setTimeout(resolve, 1200));
        clearInterval(timer);
        recorder.stop();
        await done;
        stream.getTracks().forEach(track => track.stop());
        return { png, video: Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())) };
      }, { width, height, kind });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      const project = { id: "node-resize-qa", title: "Node resize QA", scope: "personal", owner_id: "qa" };
      let snapshot: any = {
        schema: "ai-manhua-studio-canvas", version: 3,
        nodes: [{ id: "media", kind, title: `${kind} ${width}:${height}`, content: "", imageAssetId: "asset-media",
          x: 100, y: 80, width: 400, height: 360,
          metadata: { assetId: "asset-media", status: "success", assetScope: "personal", mimeType: `${kind}/${kind === "video" ? "mp4" : "png"}` } }],
        edges: [], connections: [], groups: [], zoom: 50, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 0.5 },
      };
      await page.addInitScript(() => {
        localStorage.setItem("ai-manju:auth_token", "qa-token");
        localStorage.setItem("ai-manju:token-store", "local");
      });
      // All API traffic is isolated from real user projects and generation services.
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
        if (url.pathname.endsWith("/assets/asset-media/content")) {
          const video = kind === "video" && !url.searchParams.has("poster");
          return route.fulfill({ headers, contentType: video ? "video/mp4" : "image/png", body: video ? Buffer.from(media.video) : Buffer.from(media.png, "base64") });
        }
        let data: unknown = { items: [], total: 0 };
        if (url.pathname === "/api/auth/me") data = { id: "qa", account: "qa", role: "super_admin", status: "active" };
        else if (url.pathname === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
        else if (url.pathname === `/api/projects/${project.id}/snapshot`) {
          if (request.method() === "PUT") snapshot = request.postDataJSON().data;
          data = { project_id: project.id, version: 1, data: snapshot };
        } else if (url.pathname === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
        else if (url.pathname === "/api/projects") data = { items: [project], total: 1 };
        if (url.pathname === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
        return route.fulfill({ headers, json: { success: true, data, request_id: "node-resize-qa" } });
      });
      await page.goto(`/canvas/${project.id}?scope=personal`);
      const node = page.locator('[data-node-id="media"]');
      const size = () => node.evaluate(element => ({ width: parseFloat((element as HTMLElement).style.width), height: parseFloat((element as HTMLElement).style.height) }));
      // The actual source ratio must appear without hovering, selecting or playing.
      await expect.poll(async () => { const s = await size(); return s.width / s.height; }).toBeCloseTo(width / height, 5);
      if (kind === "video") {
        await expect(node.locator("video")).toHaveJSProperty("videoWidth", width);
        await expect(node.locator("video")).toHaveJSProperty("videoHeight", height);
        await expect(node.locator("video")).toHaveCSS("object-fit", "contain");
      }
      await node.locator(".node-float-label").click();
      const original = await size();
      const handle = node.getByRole("button", { name: "等比调整尺寸", exact: true });
      for (const [dx, dy] of [[40, 0], [0, 40], [-15, -25]]) {
        const before = await size();
        await drag(page, handle, dx, dy);
        const after = await size();
        expect(after.width / after.height).toBeCloseTo(width / height, 4);
        if (dx > 0 || dy > 0) {
          expect(after.width).toBeGreaterThan(before.width + 5);
          expect(after.height).toBeGreaterThan(before.height + 5);
        } else {
          expect(after.width).toBeLessThan(before.width);
          expect(after.height).toBeLessThan(before.height);
        }
      }
      const resized = await size();
      await expect.poll(() => snapshot.nodes[0].width).toBeCloseTo(resized.width, 3);
      await page.keyboard.press("Control+z");
      await expect.poll(async () => (await size()).width).not.toBeCloseTo(resized.width, 1);
      expect((await size()).width / (await size()).height).toBeCloseTo(width / height, 4);
      await page.keyboard.press("Control+Shift+z");
      await expect.poll(async () => (await size()).width).toBeCloseTo(resized.width, 3);
      expect(resized.width).toBeGreaterThan(original.width);
      expect(resized.height).toBeGreaterThan(original.height);
      if (kind === "video" && height > width) expect(resized.height).toBeGreaterThan(720);
      await expect.poll(() => snapshot.nodes[0].width).toBeCloseTo(resized.width, 3);
      await page.screenshot({ path: testInfo.outputPath("node-resize-desktop.png") });
      await page.reload();
      await node.locator(".node-float-label").click();
      if (kind === "video") {
        await expect(node.locator("video")).toHaveJSProperty("videoWidth", width);
        await expect(node.locator("video")).toHaveJSProperty("videoHeight", height);
      }
      await expect.poll(async () => (await size()).width).toBeCloseTo(resized.width, 3);
      await expect.poll(async () => (await size()).height).toBeCloseTo(resized.height, 3);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(handle).toBeInViewport();
      await drag(page, handle, -12, -12);
      const narrow = await size();
      expect(narrow.width / narrow.height).toBeCloseTo(width / height, 4);
      await page.screenshot({ path: testInfo.outputPath("node-resize-mobile.png") });
      expect(errors).toEqual([]);
    });
  }
}
