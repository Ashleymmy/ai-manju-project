import { expect, test } from "@playwright/test";

for (const width of [1920, 1000, 390]) {
  test(`canvas has no floating import entry and tasks remain accessible in the library at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 945 });
    const project = { id: `import-entry-${width}`, title: "Import entry", scope: "personal", owner_id: "import-entry-qa" };
    const snapshot = { schema: "ai-manhua-studio-canvas", version: 3, nodes: [], edges: [], groups: [], zoom: 100, panX: 0, panY: 0 };
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("ai-manju:auth_token", "import-entry-qa");
      localStorage.setItem("ai-manju:token-store", "local");
    });
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      if (request.headers().accept === "text/event-stream") return route.fulfill({ contentType: "text/event-stream", body: ":ok\n\n" });
      let data: unknown = { items: [], total: 0 };
      if (path === "/api/auth/me") data = { id: "import-entry-qa", account: "qa", role: "super_admin", status: "active" };
      else if (path === "/api/announcements/current") data = null;
      else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
      else if (path === "/api/asset-folders") data = [];
      else if (path === `/api/projects/${project.id}/snapshot`) data = { project_id: project.id, version: 1, data: snapshot };
      else if (path === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
      else if (path === "/api/projects") data = { items: [project], total: 1 };
      if (path === "/api/prompts") return route.fulfill({ json: { items: [], total: 0 } });
      return route.fulfill({ json: { success: true, data, request_id: "import-entry-qa" } });
    });
    await page.goto(`/canvas/${project.id}?scope=personal`);
    const entry = page.getByRole("button", { name: "查看导入任务", exact: true });
    const agent = page.locator(".canvas-agent-fab");
    await expect(agent).toBeEnabled();
    await agent.evaluate(async element => {
      await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
    });
    await expect(entry).toHaveCount(0);
    await expect(page.locator(".asset-import-task-entry")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`import-entry-${width}.png`), clip: { x: width - Math.min(width, 280), y: 945 - 180, width: Math.min(width, 280), height: 180 } });
    // Seed only this isolated browser's task checkpoint, then verify the original panel still works.
    await page.evaluate(async () => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("ai-manju-asset-imports", 1);
      request.onupgradeneeded = () => { request.result.createObjectStore("tasks", { keyPath: "owner" }); request.result.createObjectStore("sources"); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction(["tasks", "sources"], "readwrite");
        tx.objectStore("tasks").put({ id: "entry-test-task", owner: "import-entry-qa", name: "entry-test.zip", size: 1024, scope: "personal", status: "paused",
          warnings: [], progress: { phase: "导入已暂停，可继续导入", total: 3, completed: 1, failures: [] } });
        tx.objectStore("sources").put(new Blob(["test-package"]), "import-entry-qa");
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
    }));
    await page.goto("/assets");
    await page.locator(".asset-bulk-bar").waitFor();
    const notice = page.getByRole("button", { name: "知道了", exact: true });
    if (await notice.isVisible()) await notice.click();
    await page.locator(".asset-bulk-bar").getByRole("button", { name: "导入任务", exact: true }).click();
    const panel = page.getByRole("region", { name: "资产导入任务", exact: true });
    await expect(panel).toContainText("entry-test.zip");
    await expect(panel.getByRole("button", { name: "继续导入", exact: true })).toBeVisible();
    await expect(entry).toHaveCount(0);
    page.once("dialog", confirm => confirm.accept());
    await panel.getByRole("button", { name: "删除任务", exact: true }).click();
    await expect(panel).toContainText("暂无导入任务");
    expect(errors).toEqual([]);
  });
}
