import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("asset batch shows queued jobs, progress, errors, retry recovery and output images", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  const png = readFileSync(
    new URL(
      "../client/public/comic-lab-pack/stickers/sticker_nice.png",
      import.meta.url
    )
  );
  const project = {
    id: "comic-qa",
    title: "批量图片验收",
    style_preset: "国风",
    created_at: "2026-09-20T00:00:00Z",
  };
  const assets = ["阿青", "竹林"].map((name, i) => ({
    id: `asset-${i}`,
    project_id: project.id,
    name,
    class: i ? "environment" : "character",
    code: `C00${i}`,
    approved_prompt: `${name}，清晰的国风动画设计图`,
    prompt_status: "approved",
    prompt_version: 1,
  }));
  let phase = "empty";
  let batchReads = 0;
  let retryCalls = 0;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const batch = () => {
    const completed =
      phase === "failed" || phase === "retrying" || phase === "done";
    const items = assets.map((asset, i) => ({
      id: `item-${i}`,
      batch_id: "batch-qa",
      comic_asset_id: asset.id,
      asset_name: asset.name,
      status:
        phase === "done" || (completed && !i)
          ? "succeeded"
          : phase === "failed" && i
            ? "failed"
            : "queued",
      job_id: phase === "retrying" && i ? "job-retry" : `job-${i}`,
      output_asset_id:
        phase === "done" || (completed && !i) ? `output-${i}` : "",
      attempt: phase === "retrying" && i ? 2 : 1,
      error:
        phase === "failed" && i
          ? {
              message: "该分组未开通图片生成",
              suggestion: "请检查所选图像模型的生成权限",
            }
          : undefined,
    }));
    return {
      batch: {
        id: "batch-qa",
        project_id: project.id,
        status:
          phase === "done"
            ? "succeeded"
            : phase === "failed"
              ? "partial_failed"
              : "running",
        total: 2,
        pending: 0,
        active:
          phase === "failed" || phase === "done"
            ? 0
            : phase === "retrying"
              ? 1
              : 2,
        succeeded: phase === "done" ? 2 : completed ? 1 : 0,
        failed: phase === "failed" ? 1 : 0,
        canceled: 0,
        created_at: project.created_at,
      },
      items,
    };
  };
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "qa-token");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  // Isolated responses exercise the real route without creating paid jobs or changing user projects.
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const headers = {
      "Access-Control-Allow-Origin": new URL(page.url()).origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers":
        "authorization,content-type,x-request-id,idempotency-key",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    };
    if (request.method() === "OPTIONS")
      return route.fulfill({ headers, status: 204 });
    if (request.headers().accept === "text/event-stream")
      return route.fulfill({
        headers,
        contentType: "text/event-stream",
        body: ":ok\n\n",
      });
    if (/\/api\/assets\/output-\d\/content/.test(url.pathname))
      return route.fulfill({ headers, contentType: "image/png", body: png });
    let data: unknown = { items: [], total: 0 };
    if (url.pathname === "/api/auth/me")
      data = {
        id: "qa",
        account: "qa",
        role: "super_admin",
        status: "active",
        display_name: "QA",
      };
    else if (url.pathname === "/api/ai/models")
      data = {
        image_models: ["qa::gpt-image-2.5-flare"],
        default_image_model: "qa::gpt-image-2.5-flare",
        text_models: ["qa::text"],
      };
    else if (url.pathname === "/api/comic-asset-projects") data = [project];
    else if (url.pathname === `/api/comic-asset-projects/${project.id}`)
      data = { project, assets };
    else if (
      url.pathname ===
      `/api/comic-asset-projects/${project.id}/generation-batches`
    ) {
      if (request.method() === "POST") {
        expect(request.postDataJSON().asset_ids).toEqual([
          "asset-0",
          "asset-1",
        ]);
        phase = "queued";
        data = batch();
      } else data = phase === "empty" ? [] : [batch().batch];
    } else if (
      url.pathname === "/api/comic-asset-generation-batches/batch-qa"
    ) {
      batchReads++;
      data = batch();
    } else if (
      url.pathname ===
      "/api/comic-asset-generation-batches/batch-qa/items/item-1/retry"
    ) {
      retryCalls++;
      phase = "retrying";
      data = batch();
    } else if (url.pathname.startsWith("/api/jobs/job-"))
      data = {
        id: url.pathname.split("/").at(-1),
        status:
          phase === "running" || phase === "retrying" ? "running" : "queued",
        progress: phase === "running" || phase === "retrying" ? 65 : 0,
      };
    else if (url.pathname === "/api/asset-folders") data = [];
    if (url.pathname === "/api/prompts")
      return route.fulfill({ headers, json: { items: [], total: 0 } });
    return route.fulfill({
      headers,
      json: { success: true, data, request_id: "comic-qa" },
    });
  });
  await page.goto("/comic-assets");
  await page.getByRole("button", { name: "知道了", exact: true }).click();
  await page.getByRole("button", { name: project.title, exact: true }).click();
  await page.getByRole("button", { name: "创建批量生成", exact: true }).click();
  const panel = page.getByRole("region", { name: "批量生成进度" });
  await expect(panel.getByText("排队中", { exact: true })).toHaveCount(2);
  phase = "running";
  await expect(panel.getByText("生成中 65%", { exact: true })).toHaveCount(2);
  await panel.screenshot({ path: testInfo.outputPath("running-progress.png") });
  phase = "failed";
  await expect(
    panel.getByText("该分组未开通图片生成", { exact: true })
  ).toBeVisible();
  await expect(panel.getByRole("img", { name: "阿青 生成结果" })).toBeVisible();
  await panel.screenshot({
    path: testInfo.outputPath("failure-and-output.png"),
  });
  await panel.getByRole("button", { name: "重试此项", exact: true }).click();
  await expect.poll(() => retryCalls).toBe(1);
  await expect(panel.getByText("生成中 65%", { exact: true })).toHaveCount(1);
  const readsAfterRetry = batchReads;
  await expect.poll(() => batchReads).toBeGreaterThan(readsAfterRetry);
  phase = "done";
  await expect(panel.getByRole("img")).toHaveCount(2);
  await expect(panel.getByText("全部完成", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "查看 阿青 的生成图片" }).click();
  await expect(
    page.getByRole("dialog").getByRole("img", { name: "阿青", exact: true })
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: project.title, exact: true }).click();
  await expect(panel.getByRole("img")).toHaveCount(2);
  await expect(panel.getByText("全部完成", { exact: true })).toBeVisible();
  await panel.screenshot({
    path: testInfo.outputPath("completed-after-reopen.png"),
  });
  expect(errors).toEqual([]);
});
