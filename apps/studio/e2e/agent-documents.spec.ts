import { expect, test, type Page } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
import * as XLSX from "@e965/xlsx";

function fixtures() {
  const entries = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>WORD正文：雨夜追逐，主角在码头相遇。</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格正文：第二幕</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
  };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["角色", "数量"], ["林小雨", 3]]), "角色表");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["地点", "镜头"], ["旧码头", "远景"]]), "场景表");
  return [
    { name: "剧本与分镜规划说明.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, strToU8(value)])))) },
    { name: "角色与场景.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: XLSX.write(book, { type: "buffer", bookType: "xlsx" }) },
    { name: "补充说明.txt", mimeType: "text/plain", buffer: Buffer.from("TXT正文：画面使用冷色调。") },
    { name: "旧版预算.xls", mimeType: "application/vnd.ms-excel", buffer: XLSX.write(book, { type: "buffer", bookType: "biff8" }) },
  ];
}

async function setup(page: Page, mode: "canvas" | "studio") {
  const requests: any[] = [];
  const errors: string[] = [];
  const project = { id: "document-qa", title: "文档导入验收", scope: "personal", owner_id: "qa" };
  const snapshot = { schema: "ai-manhua-studio-canvas", version: 3, nodes: [], edges: [], connections: [], groups: [], zoom: 100, panX: 0, panY: 0, viewport: { x: 0, y: 0, k: 1 } };
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem("ai-manju:auth_token", "qa-token"); localStorage.setItem("ai-manju:token-store", "local"); });
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (request.headers().accept === "text/event-stream") return route.fulfill({ contentType: "text/event-stream", body: ":ok\n\n" });
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me") data = { id: "qa", username: "QA", role: "super_admin", status: "active" };
    else if (path === "/api/announcements/current") data = null;
    else if (path === "/api/user/preferences") data = { canvas: { promptPresets: [] } };
    else if (path === "/api/ai/models") data = { text_models: ["qa::gpt-5.6-luna"], agent_text_models: ["qa::gpt-5.6-luna"], default_text_model: "qa::gpt-5.6-luna" };
    else if (path === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
    else if (path === `/api/projects/${project.id}/snapshot`) data = { project_id: project.id, version: 1, data: snapshot };
    else if (path === "/api/ai/text") { requests.push(request.postDataJSON()); data = { content: "已收到附件正文，可继续讨论分镜。" }; }
    if (path === "/api/prompts") return route.fulfill({ json: { items: [], total: 0 } });
    return route.fulfill({ json: { success: true, data, request_id: "document-qa" } });
  });
  await page.goto(mode === "canvas" ? `/canvas/${project.id}` : "/skills");
  if (mode === "studio") await expect(page.getByRole("heading", { name: "技能库", exact: true, includeHidden: true })).toBeVisible();
  const notice = page.getByRole("button", { name: "知道了", exact: true });
  if (await notice.isVisible()) await notice.click();
  await page.getByRole("button", { name: mode === "canvas" ? "打开 Agent" : "打开 Agent 对话", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Agent 对话", exact: true });
  await expect(dialog.locator("textarea")).toBeEnabled();
  return { requests, errors, dialog };
}

for (const mode of ["canvas", "studio"] as const) for (const width of [1440, 390]) {
  test(`${mode} reads and sends real Office files at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 945 });
    const { dialog, requests, errors } = await setup(page, mode);
    await dialog.locator(".agent-icon-btn").click();
    const chooser = page.waitForEvent("filechooser");
    await dialog.getByRole("button", { name: "上传附件", exact: true }).click();
    await (await chooser).setFiles(fixtures());
    const drafts = dialog.getByLabel("待发送文件", { exact: true });
    await expect(drafts.locator(".is-ready")).toHaveCount(4, { timeout: 20000 });
    const dropped = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["DRAG正文：镜头 01"], "分镜.csv", { type: "text/csv" }));
      return transfer;
    });
    await dialog.locator(".agent-composer").dispatchEvent("drop", { dataTransfer: dropped });
    await dropped.dispose();
    await expect(drafts.locator(".is-ready")).toHaveCount(5);
    await dialog.locator("input[type=file]").setInputFiles({ name: "超额.txt", mimeType: "text/plain", buffer: Buffer.from("six") });
    await expect(drafts.locator(".agent-document")).toHaveCount(5);
    await expect(dialog.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
    expect(requests).toHaveLength(0);
    await drafts.locator("summary").first().click();
    await expect(drafts.locator("pre").first()).toContainText("WORD正文：雨夜追逐");
    await expect(dialog.getByRole("button", { name: "发送", exact: true })).toBeInViewport();
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await drafts.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("attachments-preview.png") });
    await dialog.getByRole("button", { name: "移除文件：旧版预算.xls" }).click();
    await dialog.locator("textarea").fill("请根据文档规划分镜");
    await dialog.getByRole("button", { name: "发送", exact: true }).click();
    await expect(dialog.locator(".agent-msg-assistant")).toContainText("已收到附件正文");
    expect(requests).toHaveLength(1);
    const content = JSON.stringify(requests[0].messages.at(-1));
    for (const value of ["WORD正文：雨夜追逐", "表格正文：第二幕", "工作表：角色表", "林小雨", "工作表：场景表", "旧码头", "TXT正文：画面使用冷色调", "DRAG正文：镜头 01"]) expect(content).toContain(value);
    expect(content).not.toContain("旧版预算.xls");
    await expect(dialog.getByLabel("待发送文件", { exact: true })).toHaveCount(0);
    await dialog.locator("textarea").fill("继续细化人物");
    await dialog.getByRole("button", { name: "发送", exact: true }).click();
    await expect.poll(() => requests.length).toBe(2);
    expect(JSON.stringify(requests[1].messages)).toContain("WORD正文：雨夜追逐");
    await page.reload();
    await page.getByRole("button", { name: mode === "canvas" ? "打开 Agent" : "打开 Agent 对话", exact: true }).click();
    await dialog.locator(".agent-thread-trigger").click();
    await dialog.locator(".agent-thread-item-main").first().click();
    await expect(dialog.getByLabel("消息文件", { exact: true }).locator(".agent-document")).toHaveCount(4);
    await dialog.locator("input[type=file]").setInputFiles({ name: "损坏.docx", mimeType: "application/octet-stream", buffer: Buffer.from("invalid") });
    await expect(dialog.getByLabel("待发送文件", { exact: true }).locator(".is-error")).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("attachments-error.png") });
    expect(errors).toEqual([]);
  });
}
