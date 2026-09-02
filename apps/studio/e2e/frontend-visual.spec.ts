import { expect, test, type Locator, type Page } from "@playwright/test";

import { createProject, login, saveSnapshot, seedBrowserAuth } from "./api";

const visualSnapshot = {
  schema: "ai-manhua-studio-canvas",
  version: 3,
  nodes: [
    {
      id: "visual-text",
      kind: "text",
      title: "第一幕：雨夜相遇",
      content: "雨夜，旧街口。主角在霓虹倒影中停步。",
      x: 150,
      y: 150,
      width: 300,
      height: 180,
      metadata: {
        status: "idle",
        generationMode: "text",
        prompt: "雨夜，旧街口。主角在霓虹倒影中停步。",
      },
    },
    {
      id: "visual-image",
      kind: "image",
      title: "关键帧",
      content: "等待生成",
      x: 560,
      y: 210,
      width: 320,
      height: 238,
      metadata: {
        status: "idle",
        generationMode: "image",
        prompt: "雨夜霓虹街道，低机位",
      },
    },
  ],
  edges: [{ id: "visual-edge", from: "visual-text", to: "visual-image" }],
  connections: [{ id: "visual-edge", from: "visual-text", to: "visual-image" }],
  groups: [],
  viewport: { x: 0, y: 0, k: 1 },
  zoom: 100,
  panX: 0,
  panY: 0,
};

test.describe("desktop visual baseline", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("login", async ({ page }) => {
    await prepareVisualPage(page, "/login");
    await expect(page).toHaveScreenshot(
      "login-desktop.png",
      screenshotOptions()
    );
  });

  test("Chat", async ({ page }) => {
    await prepareVisualPage(page, "/chat");
    await expect(page).toHaveScreenshot(
      "chat-desktop.png",
      screenshotOptions()
    );
  });

  test("Canvas stage", async ({ page }) => {
    const stage = await openVisualCanvas(page);
    await expect(stage).toHaveScreenshot(
      "canvas-desktop.png",
      screenshotOptions(stage.locator(".canvas-agent-fab"))
    );
  });
});

test.describe("mobile visual baseline", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("login", async ({ page }) => {
    await prepareVisualPage(page, "/login");
    await expect(page).toHaveScreenshot(
      "login-mobile.png",
      screenshotOptions()
    );
  });

  test("Chat", async ({ page }) => {
    await prepareVisualPage(page, "/chat");
    await expect(page).toHaveScreenshot("chat-mobile.png", screenshotOptions());
  });

  test("Canvas stage", async ({ page }) => {
    const stage = await openVisualCanvas(page);
    await expect(stage).toHaveScreenshot(
      "canvas-mobile.png",
      screenshotOptions(stage.locator(".canvas-agent-fab"))
    );
  });
});

async function openVisualCanvas(page: Page) {
  const session = await login(page.request);
  const project = await createProject(
    page.request,
    session.token,
    "Frontend visual baseline",
    {}
  );
  await saveSnapshot(page.request, session.token, project.id, visualSnapshot);
  await seedBrowserAuth(page, session);
  await page.route(/\/api\/user\/preferences$/, async route => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { canvas: { promptPresets: [], wheelZoomRequiresCtrl: true } },
        request_id: "e2e-visual-preferences",
      }),
    });
  });
  await prepareVisualPage(page, `/canvas/${project.id}?scope=personal`);
  const stage = page.locator(".real-canvas-stage");
  await expect(stage).toBeVisible();
  await expect(stage.locator(".real-canvas-node")).toHaveCount(2);
  return stage;
}

async function prepareVisualPage(page: Page, path: string) {
  await page.goto(path);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page
    .locator("body")
    .evaluate(body => body.setAttribute("data-e2e-visual-ready", "true"));
}

function screenshotOptions(dynamicRegion?: Locator) {
  return {
    animations: "disabled" as const,
    caret: "hide" as const,
    scale: "css" as const,
    ...(dynamicRegion ? { mask: [dynamicRegion] } : {}),
  };
}
