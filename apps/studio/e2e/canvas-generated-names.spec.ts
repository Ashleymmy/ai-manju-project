import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

for (const canvasName of ["测试", "模板1"]) {
test(`names follow canvas ${canvasName} and both output and placeholder indices compact`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const image = readFileSync(new URL("../client/public/comic-lab-pack/stickers/sticker_nice.png", import.meta.url));
  const project = { id: "generated-names-qa", title: canvasName, scope: "personal", owner_id: "qa" };
  let snapshot: any = {
    schema: "ai-manhua-studio-canvas", version: 3,
    nodes: ["first", "second", "third"].map((id, index) => ({
      id, kind: "image", title: "旧提示词", content: "@[node:reference] prompt", imageAssetId: "image",
      x: 200 + index * 400, y: 140, width: 280, height: 200,
      metadata: { generatedInCanvas: true, status: "success", assetId: "image" },
    })),
    edges: [], groups: [], zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 },
  };
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "naming-qa");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "authorization,content-type,x-request-id,idempotency-key", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS" };
    if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    if (path === "/api/assets/image/content") return route.fulfill({ headers, contentType: "image/png", body: image });
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me") data = { id: "qa", username: "qa", role: "super_admin", status: "active" };
    else if (path === "/api/announcements/current") data = null;
    else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (path === "/api/asset-folders") data = [];
    else if (path === `/api/projects/${project.id}/snapshot`) {
      if (request.method() === "PUT") snapshot = request.postDataJSON().data;
      data = { project_id: project.id, version: 1, data: snapshot };
    } else if (path === `/api/projects/${project.id}`) {
      if (request.method() === "PUT") project.title = request.postDataJSON().title;
      data = { ...project, data: snapshot };
    }
    else if (path === "/api/projects") data = [project];
    if (path === "/api/prompts") return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({ headers, json: { success: true, data } });
  });
  await page.goto(`/canvas/${project.id}?scope=personal`);
  const card = (id: string) => page.locator(`[data-node-id="${id}"]`);
  const label = (id: string) => card(id).locator(".node-float-label b");
  const savedTitle = (id: string) => snapshot.nodes.find((node: any) => node.id === id)?.title;
  async function rename(id: string, title: string) {
    await label(id).dblclick();
    await card(id).locator(".node-title-input").fill(title);
    await card(id).locator(".node-title-input").press("Enter");
  }
  async function remove(id: string) {
    await label(id).click();
    await page.locator(".canvas-stage").focus();
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.keyboard.press("Delete");
    await expect(card(id)).toHaveCount(0);
  }
  for (const [index, id] of ["first", "second", "third"].entries()) await expect(label(id)).toHaveText(`${canvasName}image-${index + 1}`);
  await remove("second");
  await expect(label("third")).toHaveText(`${canvasName}image-2`);
  await expect.poll(() => savedTitle("third")).toBe(`${canvasName}image-2`);
  await page.reload();
  await expect(label("third")).toHaveText(`${canvasName}image-2`);
  await page.locator(".canvas-switcher-trigger").dblclick();
  await page.getByRole("textbox", { name: "画布名称", exact: true }).fill("新的画布");
  await page.getByRole("textbox", { name: "画布名称", exact: true }).press("Enter");
  await expect(page.locator(".canvas-switcher-title")).toHaveText("新的画布");
  await expect(label("third")).toHaveText("新的画布image-2");
  await expect.poll(() => savedTitle("third")).toBe("新的画布image-2");
  await rename("first", "苹果");
  await rename("third", "苹果");
  await expect(label("first")).toHaveText("苹果-1");
  await expect(label("third")).toHaveText("苹果-2");
  await expect.poll(() => savedTitle("third")).toBe("苹果-2");
  await page.reload();
  await expect(label("third")).toHaveText("苹果-2");
  await remove("first");
  await expect(label("third")).toHaveText("苹果");
  await expect.poll(() => savedTitle("third")).toBe("苹果");

  // Inspector editing commits once on blur, not after every character or IME event.
  await label("third").click();
  await page.getByRole("complementary").getByRole("button", { name: "更多操作", exact: true }).click();
  const titleInput = page.locator(".node-pop-field input");
  await titleInput.fill("苹果新名称");
  await expect(label("third")).toHaveText("苹果");
  await titleInput.press("Enter");
  await expect(label("third")).toHaveText("苹果新名称");
  await page.keyboard.press("Escape");
  await expect.poll(() => savedTitle("third")).toBe("苹果新名称");

  await page.getByRole("button", { name: "添加图片", exact: true }).click();
  await expect.poll(() => snapshot.nodes.length).toBe(2);
  const blank = snapshot.nodes.find((node: any) => node.id !== "third");
  expect(blank.title).toBe("图片占位-1");
  expect(blank.metadata.generatedInCanvas).toBeUndefined();
  expect(snapshot.nodes.find((node: any) => node.id === "third").content).toBe("@[node:reference] prompt");
  await page.screenshot({ path: info.outputPath("generated-and-blank-names.png") });
  await page.reload();
  await expect(label("third")).toHaveText("苹果新名称");
  await expect(label(blank.id)).toHaveText("图片占位-1");

  // Reproduce the user's old five-placeholder snapshot, including legacy edited flags.
  snapshot = { ...snapshot, nodes: [1, 2, 3, 4, 5].map(number => ({
    id: `blank-${number}`, kind: "image", title: `图片占位（${number}）`, content: "",
    x: 200 + ((number - 1) % 3) * 400, y: number > 3 ? 480 : 140, width: 280, height: 200,
    metadata: { titleEdited: true, titleBase: `图片占位（${number}）`, status: "idle" },
  })) };
  await page.reload();
  for (let number = 1; number <= 5; number++) await expect(label(`blank-${number}`)).toHaveText(`图片占位-${number}`);
  await remove("blank-3");
  await expect(label("blank-4")).toHaveText("图片占位-3");
  await expect(label("blank-5")).toHaveText("图片占位-4");
  await expect.poll(() => savedTitle("blank-5")).toBe("图片占位-4");
  await page.screenshot({ path: info.outputPath("placeholder-delete-compacts.png") });
  await page.reload();
  await expect(label("blank-4")).toHaveText("图片占位-3");
  await expect(label("blank-5")).toHaveText("图片占位-4");
  expect(errors).toEqual([]);
});
}
