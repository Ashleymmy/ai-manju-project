import { expect, test, type Page } from "@playwright/test";

import { login, seedBrowserAuth } from "./api";

const videoModel = "provider::video-v1";
const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

test("Video keeps upload, generation, cancellation and refresh history contracts", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const session = await login(page.request);
  await seedBrowserAuth(page, session);
  await installObjectUrlAudit(page);

  const submissions: string[] = [];
  let submissionCount = 0;
  await page.route(/\/api\/ai\/models(?:\?.*)?$/, async route => {
    await route.fulfill(jsonEnvelope({
      models: [videoModel],
      video_models: [videoModel],
      default_video_model: videoModel,
      model_labels: { [videoModel]: "E2E Video" },
    }));
  });
  await page.route(/\/api\/ai\/videos(?:\?.*)?$/, async route => {
    submissionCount += 1;
    submissions.push(route.request().postData() || "");
    await route.fulfill(jsonEnvelope({ job_id: `video-e2e-job-${submissionCount}` }));
  });
  await page.route(/\/api\/jobs\/video-e2e-job-1(?:\?.*)?$/, async route => {
    await route.fulfill(jsonEnvelope({
      id: "video-e2e-job-1",
      type: "video.generate",
      status: "succeeded",
      progress: 100,
      scope: "personal",
      result: {
        assets: [{
          id: "video-e2e-asset",
          name: "video-result.mp4",
          content_type: "video/mp4",
        }],
      },
    }));
  });
  await page.route(/\/api\/jobs\/video-e2e-job-2(?:\?.*)?$/, async route => {
    await route.fulfill(jsonEnvelope({
      id: "video-e2e-job-2",
      type: "video.generate",
      status: "running",
      progress: 38,
      scope: "personal",
    }));
  });
  await page.route(/\/api\/jobs\/video-e2e-job-2\/cancel(?:\?.*)?$/, async route => {
    await route.fulfill(jsonEnvelope({
      id: "video-e2e-job-2",
      type: "video.generate",
      status: "canceled",
      progress: 38,
      scope: "personal",
    }));
  });
  await page.route(/\/api\/assets\/video-e2e-asset\/content(?:\?.*)?$/, async route => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "video/mp4" },
      body: Buffer.from("e2e-video-result"),
    });
  });

  await page.goto("/video?scope=personal#workbench");
  await expect(page.locator(".wb-page")).toBeVisible();
  await expect(page.locator(".wb-param-group select").first()).toHaveValue(
    videoModel,
  );

  const upload = page.locator('.wb-composer input[type="file"][multiple]');
  await upload.setInputFiles({
    name: "reference.png",
    mimeType: "image/png",
    buffer: Buffer.from(pngBase64, "base64"),
  });
  await expect(page.locator(".wb-shelf-item")).toContainText("@图片1");

  const prompt = page.locator(".wb-composer textarea");
  await prompt.fill("镜头环绕 @");
  await page.locator(".wb-mention-item", { hasText: "@图片1" }).click();
  await expect(prompt).toHaveValue(/镜头环绕 @\[ref:[^\]]+\]/);
  await expect(page.locator(".wb-prompt-overlay .wb-token")).toHaveCount(1);

  await page.getByRole("button", { name: "开始生成" }).click();
  await expect(page.getByRole("button", { name: "下载" })).toBeVisible();
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toContain("镜头环绕 图片1");
  expect(submissions[0]).toContain('filename="reference.png"');

  const objectUrls = await page.evaluate(() =>
    (window as unknown as {
      __e2eVideoObjectUrls: { created: string[]; revoked: string[] };
    }).__e2eVideoObjectUrls,
  );
  expect(
    objectUrls.created.some(url => objectUrls.revoked.includes(url)),
  ).toBeTruthy();

  await prompt.fill("保持当前构图继续推进");
  await page.getByRole("button", { name: "开始生成" }).click();
  await expect(page.getByRole("button", { name: "取消生成" })).toBeVisible();
  const cancelResponse = page.waitForResponse(response =>
    response.request().method() === "POST"
    && response.url().includes("/api/jobs/video-e2e-job-2/cancel"),
  );
  await page.getByRole("button", { name: "取消生成" }).click();
  expect((await cancelResponse).ok()).toBeTruthy();
  await expect(page.getByText("任务已取消", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "任务历史" }).click();
  await expect(page.locator(".wb-history-row")).toHaveCount(2);
  await expect(page.locator(".wb-history-status", { hasText: "成功" }))
    .toHaveCount(1);
  await expect(page.locator(".wb-history-status", { hasText: "已取消" }))
    .toHaveCount(1);

  await page.reload();
  await expect(page.locator(".wb-page")).toBeVisible();
  await page.getByRole("button", { name: "任务历史" }).click();
  await expect(page.locator(".wb-history-row")).toHaveCount(2);
  await expect(page.locator(".wb-history-status", { hasText: "成功" }))
    .toHaveCount(1);
  await expect(page.locator(".wb-history-status", { hasText: "已取消" }))
    .toHaveCount(1);

  const stores = await page.evaluate(async () => {
    const request = indexedDB.open("ai-manhua-studio");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const names = Array.from(database.objectStoreNames);
    database.close();
    return names;
  });
  expect(stores).toEqual(expect.arrayContaining([
    "video_workbench_conversations_v1",
    "video_workbench_media_v1",
  ]));
});

function jsonEnvelope(data: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      data,
      error: null,
      request_id: "video-workbench-e2e",
    }),
  };
}

async function installObjectUrlAudit(page: Page) {
  await page.addInitScript(() => {
    const audit = { created: [] as string[], revoked: [] as string[] };
    Object.defineProperty(window, "__e2eVideoObjectUrls", {
      configurable: true,
      value: audit,
    });
    const originalCreate = URL.createObjectURL.bind(URL);
    const originalRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource) => {
      const url = originalCreate(object);
      audit.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      audit.revoked.push(url);
      originalRevoke(url);
    };
  });
}
