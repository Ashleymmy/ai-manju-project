import { expect, test, type Locator } from "@playwright/test";

for (const zoom of [100, 50]) {
  test(`canvas ports connect output to input without reversing at ${zoom}% zoom`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    const project = { id: "connection-ports-qa", title: "连线端口验收", scope: "personal", owner_id: "qa" };
    let snapshot: any = {
      schema: "ai-manhua-studio-canvas", version: 3,
      nodes: [
        { id: "audio", kind: "audio", title: "音频输出", content: "", x: 180, y: 140, width: 240, height: 160 },
        { id: "text", kind: "text", title: "文本输入", content: "", x: 620, y: 380, width: 240, height: 160 },
      ],
      edges: [], groups: [], zoom, panX: 160, panY: 100, viewport: { x: 160, y: 100, k: zoom / 100 },
    };
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("ai-manju:auth_token", "connection-ports-qa");
      localStorage.setItem("ai-manju:token-store", "local");
    });
    // Isolate every application API, including autosave, from real user data.
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "authorization,content-type,x-request-id,idempotency-key", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS" };
      if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
      if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
      let data: unknown = { items: [], total: 0 };
      if (path === "/api/auth/me") data = { id: "qa", username: "qa", role: "super_admin", status: "active" };
      else if (path === "/api/announcements/current") data = null;
      else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
      else if (path === "/api/asset-folders") data = [];
      else if (path === `/api/projects/${project.id}/snapshot`) {
        if (request.method() === "PUT") snapshot = request.postDataJSON().data;
        data = { project_id: project.id, version: 1, data: snapshot };
      } else if (path === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
      else if (path === "/api/projects") data = [project];
      if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
      return route.fulfill({ headers, json: { success: true, data } });
    });
    await page.goto(`/canvas/${project.id}?scope=personal`);
    const audio = page.locator('[data-node-id="audio"]');
    const text = page.locator('[data-node-id="text"]');
    await expect(audio).toBeVisible();
    await expect(text).toBeVisible();
    const port = (node: Locator, type: "source" | "target") => node.locator(`[data-connection-handle-type="${type}"]`);
    async function startDrag(from: Locator, to: Locator) {
      const closeInspector = page.getByRole("button", { name: "关闭面板", exact: true });
      if (await closeInspector.isVisible()) await closeInspector.click();
      await page.mouse.move(1400, 800);
      const a = (await from.boundingBox())!, b = (await to.boundingBox())!;
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await expect(from).toBeVisible();
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    }
    const edges = page.locator(".real-canvas-edge-visible");
    for (const type of ["source", "target"] as const) {
      await startDrag(port(audio, type), port(text, type));
      await page.mouse.up();
      await expect(edges).toHaveCount(0);
      await expect(page.locator(".canvas-connection-create-menu")).toHaveCount(0);
      expect(snapshot.edges).toEqual([]);
    }
    await startDrag(port(audio, "source"), port(text, "target"));
    const expectedPath = "M 420 220 C 520 220, 520 460, 620 460";
    await expect(page.locator(".real-canvas-edge-preview")).toHaveAttribute("d", expectedPath);
    await page.mouse.up();
    await expect(edges).toHaveAttribute("d", expectedPath);
    await expect.poll(() => snapshot.edges.map(({ from, to }: any) => ({ from, to })))
      .toEqual([{ from: "audio", to: "text" }]);
    await page.mouse.move(1400, 800);
    await page.screenshot({ path: info.outputPath(`output-to-input-${zoom}.png`) });
    await page.reload();
    await expect(edges).toHaveAttribute("d", expectedPath);
    // Reverse dragging the same two compatible ports keeps the same direction.
    await startDrag(port(text, "target"), port(audio, "source"));
    await expect(page.locator(".real-canvas-edge-preview")).toHaveAttribute("d", expectedPath);
    await page.mouse.up();
    await expect(edges).toHaveCount(1);
    // Two clicks on compatible ports complete the connection; a wrong second
    // port must not replace the original output and create the reverse edge.
    await port(audio, "source").click();
    await port(text, "source").click();
    await expect(port(audio, "source")).toHaveClass(/active/);
    await port(text, "target").click();
    await expect(port(audio, "source")).not.toHaveClass(/active/);
    await expect(edges).toHaveCount(1);
    expect(snapshot.edges.map(({ from, to }: any) => ({ from, to }))).toEqual([{ from: "audio", to: "text" }]);
    expect(errors).toEqual([]);
  });
}
