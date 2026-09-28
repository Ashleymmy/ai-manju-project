import { expect, test } from "@playwright/test";
import { CANVAS_PIN_COLORS } from "../client/src/features/canvas/domain/pin";

for (const width of [1440, 390]) {
  test(`twelve pin colors fit in two rows and persist selection at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 950 });
    const project = { id: `pin-palette-${width}`, title: "Pin colors", scope: "personal", owner_id: "pin-qa" };
    const panX = width / 2 - 120, panY = 420;
    let snapshot = {
      schema: "ai-manhua-studio-canvas", version: 3,
      nodes: [{ id: "pin-image", kind: "image", title: "Pin image", content: "", x: 0, y: 0, width: 240, height: 160,
        imageSrc: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN9sAAAAASUVORK5CYII=",
        metadata: {} as { pinColor?: string } }],
      edges: [], groups: [], zoom: 100, panX, panY, viewport: { x: panX, y: panY, k: 1 },
    };
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("ai-manju:auth_token", "pin-qa");
      localStorage.setItem("ai-manju:token-store", "local");
    });
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      if (request.headers().accept === "text/event-stream") return route.fulfill({ contentType: "text/event-stream", body: ":ok\n\n" });
      let data: unknown = { items: [], total: 0 };
      if (path === "/api/auth/me") data = { id: "pin-qa", account: "pin-qa", role: "super_admin", status: "active" };
      else if (path === "/api/announcements/current") data = null;
      else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
      else if (path === "/api/asset-folders") data = [];
      else if (path === `/api/projects/${project.id}/snapshot`) {
        if (request.method() === "PUT") snapshot = request.postDataJSON().data;
        data = { project_id: project.id, version: 1, data: snapshot };
      } else if (path === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
      else if (path === "/api/projects") data = { items: [project], total: 1 };
      if (path === "/api/prompts") return route.fulfill({ json: { items: [], total: 0 } });
      return route.fulfill({ json: { success: true, data, request_id: "pin-qa" } });
    });
    await page.goto(`/canvas/${project.id}?scope=personal`);
    const node = page.locator('[data-node-id="pin-image"]');
    await node.click();
    // Close the existing floating inspector before testing the node toolbar on narrow screens.
    const closeInspector = page.getByRole("button", { name: "关闭面板", exact: true });
    if (await closeInspector.isVisible()) await closeInspector.click();
    const trigger = node.locator(".node-toolbar-pin");
    await trigger.click();
    const picker = page.locator(".node-pin-picker");
    const swatches = picker.locator(".node-pin-swatch");
    await expect(swatches).toHaveCount(12);
    expect(await swatches.evaluateAll(elements => elements.map(element => element.getAttribute("title")))).toEqual([...CANVAS_PIN_COLORS]);
    const layout = await swatches.evaluateAll(elements => {
      const rects = elements.map(element => element.getBoundingClientRect());
      return { rows: [...new Set(rects.map(rect => Math.round(rect.y)))], columns: [...new Set(rects.map(rect => Math.round(rect.x)))],
        contained: rects.every(rect => rect.x >= 0 && rect.right <= innerWidth && rect.y >= 0 && rect.bottom <= innerHeight) };
    });
    expect(layout.rows).toHaveLength(2);
    expect(layout.columns).toHaveLength(6);
    expect(layout.contained).toBe(true);
    await picker.screenshot({ path: info.outputPath(`pin-palette-${width}.png`) });
    for (const color of CANVAS_PIN_COLORS) {
      if (!(await picker.isVisible())) await trigger.click();
      await picker.getByRole("button", { name: `标记为 ${color}`, exact: true }).click();
      await expect(node.locator(".node-pin-marker")).toBeVisible();
      await expect.poll(() => snapshot.nodes[0].metadata?.pinColor).toBe(color);
      await trigger.click();
      await expect(picker.locator(".node-pin-swatch.selected")).toHaveAttribute("title", color);
    }
    await page.reload();
    await expect(node.locator(".node-pin-marker")).toBeVisible();
    await node.click();
    if (await closeInspector.isVisible()) await closeInspector.click();
    await trigger.click();
    await expect(picker.locator(".node-pin-swatch.selected")).toHaveAttribute("title", CANVAS_PIN_COLORS[11]);
    await picker.getByRole("button", { name: "取消标记", exact: true }).click();
    await expect(node.locator(".node-pin-marker")).toHaveCount(0);
    await expect.poll(() => snapshot.nodes[0].metadata?.pinColor).toBeUndefined();
    expect(errors).toEqual([]);
  });
}
