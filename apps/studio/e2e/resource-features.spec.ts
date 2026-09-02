import { expect, test, type Page } from "@playwright/test";

import { login, seedBrowserAuth } from "./api";

test.beforeEach(async ({ page }) => {
  const session = await login(page.request);
  await seedBrowserAuth(page, session);
});

async function dismissReleaseNotes(page: Page) {
  const dismissButton = page.getByRole("button", { name: "知道了" });
  await dismissButton.waitFor({ state: "visible", timeout: 2_000 })
    .then(() => dismissButton.click())
    .catch(() => undefined);
}

test("resource feature deep links keep their routes and isolated page surfaces", async ({
  page,
}) => {
  const routes: Array<[string, string]> = [
    ["/assets?scope=team&filter=recent#library", "资产库"],
    ["/tags?scope=team&tag=角色#taxonomy", "标签库"],
    ["/prompts?tag=镜头#prompts", "提示词中心"],
    ["/skills#skills", "技能库"],
    ["/image?scope=team#keyframe", "关键帧生成"],
    ["/profile#profile", "个人主页"],
    ["/settings#preferences", "偏好设置"],
  ];

  for (const [index, [route, title]] of routes.entries()) {
    await page.goto(route);
    if (index === 0) await dismissReleaseNotes(page);
    await expect(page.getByRole("heading", { name: title, exact: true }))
      .toBeVisible();
    const expected = new URL(route, "http://localhost");
    const actual = new URL(page.url());
    expect(actual.pathname).toBe(expected.pathname);
    expect(actual.search).toBe(expected.search);
    expect(actual.hash).toBe(expected.hash);
  }
});

test("resource-local prompt, skill and WebDAV keys keep their existing semantics", async ({
  page,
}) => {
  const imagePrompt = "资源 feature 解耦 characterization";
  const webdavConfig = {
    proxyMode: "server",
    url: "https://nas.example.test/dav",
    username: "tester",
    password: "secret",
    directory: "ai-manju",
    lastSyncedAt: "",
  };
  await page.addInitScript(
    ({ prompt, webdav }) => {
      window.sessionStorage.setItem("ai-manju:image-prompt", prompt);
      window.localStorage.setItem("ai-manju:canvas_skills", "[]");
      window.localStorage.setItem(
        "ai-manju:webdav_sync",
        JSON.stringify(webdav)
      );
    },
    { prompt: imagePrompt, webdav: webdavConfig }
  );

  await page.goto("/image");
  await expect(page.locator(".prompt-editor textarea")).toHaveValue(
    imagePrompt
  );
  expect(
    await page.evaluate(() =>
      window.sessionStorage.getItem("ai-manju:image-prompt")
    )
  ).toBeNull();

  await page.goto("/skills");
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("ai-manju:canvas_skills")
    )
  ).toBe("[]");

  await page.goto("/settings");
  expect(
    await page.evaluate(() =>
      JSON.parse(
        window.localStorage.getItem("ai-manju:webdav_sync") || "{}"
      )
    )
  ).toEqual(webdavConfig);
});
