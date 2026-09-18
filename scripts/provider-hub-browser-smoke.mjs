// Local-only UI acceptance test. Run against a disposable memory API with the
// fixture credentials below, never a cloud or paid provider environment.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const origin = "http://127.0.0.1:3197";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto(`${origin}/admin/model-hub`);
  await page.getByLabel("账号", { exact: true }).fill("hub-admin");
  await page.getByLabel("密码", { exact: true }).fill("provider-hub-test-password");
  await page.getByRole("button", { name: "进入工作台", exact: true }).click();
  await page.waitForURL(`${origin}/admin/model-hub`);
  await page.getByRole("heading", { name: "模型接入", exact: true }).waitFor();
  await page.getByRole("navigation", { name: "模型能力分类" }).getByRole("button", { name: /^文本 \/ LLM/ }).click();
  await page.getByRole("button", { name: "高级 JSON", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Provider JSON 配置" });
  const document = JSON.parse(await editor.inputValue());
  document.config.name = "JSON 保存验收";
  await editor.fill(JSON.stringify(document, null, 2));
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await page.getByRole("heading", { name: "JSON 保存验收", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: /JSON 保存验收/ }).click();
  await page.getByRole("button", { name: "高级 JSON", exact: true }).click();
  if (JSON.parse(await editor.inputValue()).config.name !== "JSON 保存验收") throw new Error("Saved document was not persisted");
  await editor.fill('{"schema_version":1}');
  if (await page.getByRole("button", { name: "保存配置", exact: true }).isEnabled()) throw new Error("Invalid JSON remains saveable");
  await page.getByRole("button", { name: "放弃 JSON 修改", exact: true }).click();
  await page.getByRole("navigation", { name: "模型能力分类" }).getByRole("button", { name: /^视频/ }).click();
  await page.getByRole("heading", { name: "视频服务示例", exact: true }).waitFor();
  const output = path.join(process.env.TEMP || ".", "provider-hub-browser");
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, "desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "高级 JSON", exact: true }).click();
  await page.screenshot({ path: path.join(output, "mobile.png"), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) throw new Error("Horizontal overflow on mobile");
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  console.log("PASS: admin route, capability selection, JSON save/reload, invalid JSON, responsive layout; no upstream calls");
  console.log(`Screenshots: ${output}`);
} catch (error) {
  console.log((await page.locator("body").innerText()).slice(-2400));
  throw error;
} finally {
  await browser.close();
}
