import { expect, test } from "@playwright/test";

test("uploaded script survives a gateway error during background polling", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let submissions = 0;
  let reads = 0;
  const candidate = { class: "character", code: "C001", name: "阿青", state: "默认", description: "青衣少年", visual_description: "青衣", source_prompt: "青衣少年", change_request: "", prompt_template: "", archive_status: "pending" };
  const detail = (status: string) => ({
    session: { id: "analysis-qa", title: "等待链路验收", style_preset: "国风动画", status, active_revision_id: status === "active" ? "revision-qa" : "", confirmed_revision_id: "", project_id: "", source_file_name: "script.txt" },
    revisions: status === "active" ? [{ id: "revision-qa", version: 1, source: "initial", instruction: "拆解资产", requested_model: "qa-text", response_model: "qa-text", candidate: { assets: [candidate] } }] : [],
  });
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "qa-token");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  // Intercept every API request; never send the fixture to a real model.
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "authorization,content-type,x-request-id", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    let data: unknown = [];
    let status = 200;
    if (url.pathname === "/api/auth/me") data = { id: "qa", username: "qa", role: "super_admin", status: "active" };
    else if (url.pathname === "/api/ai/models") data = { text_models: ["qa-text"], default_text_model: "qa-text", image_models: [], models: ["qa-text"] };
    else if (url.pathname === "/api/comic-asset-analysis-sessions" && request.method() === "POST") {
      submissions++;
      expect(url.searchParams.get("async")).toBe("true");
      expect(request.postDataBuffer()?.toString()).toContain("雨夜，阿青走入巷子");
      data = detail("processing"); status = 202;
    } else if (url.pathname === "/api/comic-asset-analysis-sessions/analysis-qa") {
      reads++;
      if (reads === 1) return route.fulfill({ headers, status: 504, contentType: "text/html", body: "<html>504 Gateway Time-out</html>" });
      data = detail(reads < 3 ? "processing" : "active");
    } else if (url.pathname === "/api/comic-asset-projects") data = [];
    else if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    return route.fulfill({ headers, status, contentType: "application/json", body: JSON.stringify({ success: true, data }) });
  });
  await page.goto("/comic-assets");
  await page.getByRole("button", { name: "知道了", exact: true }).click();
  await page.getByRole("button", { name: "新建资产项目", exact: true }).click();
  await page.getByPlaceholder("例如：画家故国第一季").fill("等待链路验收");
  await page.locator("#script-file-input").setInputFiles({ name: "script.txt", mimeType: "text/plain", buffer: Buffer.from("雨夜，阿青走入巷子。") });
  await page.getByRole("button", { name: "解析并预览", exact: true }).click();
  await expect(page.getByText("正在分析剧本…", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "等待链路验收 候选资产", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "阿青", exact: true })).toBeVisible();
  expect(submissions).toBe(1);
  expect(reads).toBe(3);
  expect(errors).toEqual([]);
});
