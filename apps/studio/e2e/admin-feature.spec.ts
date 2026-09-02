import { expect, test, type Page } from "@playwright/test";

import { login, seedBrowserAuth } from "./api";
import { E2E_TEXT_MODEL, providerBaseUrlForAPI } from "./env";

test.beforeEach(async ({ page }) => {
  const session = await login(page.request);
  await seedBrowserAuth(page, session);
});

async function openAdmin(page: Page, path: string) {
  await page.goto(path);
  const releaseNotes = page.getByRole("button", { name: "知道了" });
  await releaseNotes
    .waitFor({ state: "visible", timeout: 2_000 })
    .then(() => releaseNotes.click())
    .catch(() => undefined);
  await expect(page.locator(".real-admin-page")).toBeVisible();
}

test("Admin user dialog preserves create and edit semantics", async ({ page }) => {
  const username = `admin_feature_${Date.now()}`;
  const displayName = `Admin Feature User ${Date.now()}`;
  await openAdmin(page, "/admin/users?source=e2e#users");
  await expect(page).toHaveURL(/\/admin\/users\?source=e2e#users$/);

  await page.getByRole("button", { name: "创建用户" }).click();
  const dialog = page.getByRole("dialog", { name: "创建用户" });
  await dialog.getByLabel("用户名").fill(username);
  await dialog.getByLabel("显示名称").fill(displayName);
  await dialog.getByLabel("密码").fill("admin-feature-password");
  await dialog.getByRole("button", { name: "创建用户" }).click();

  const row = page.locator(".admin-table-row").filter({ hasText: displayName });
  await expect(row).toContainText(displayName);
  await row.getByTitle("编辑用户").click();
  const editDialog = page.getByRole("dialog", { name: "编辑用户" });
  await expect(editDialog.getByLabel("用户名")).toHaveValue(username);
  await expect(editDialog.getByLabel("用户名")).toHaveAttribute("readonly", "");
  await editDialog.getByLabel("状态").selectOption("disabled");
  await editDialog.getByRole("button", { name: "保存修改" }).click();
  await expect(row).toContainText("disabled");
});

test("Admin provider flow clears secrets, fetches models and keeps destructive confirmation", async ({
  page,
}) => {
  const providerId = `e2e-provider-${Date.now()}`;
  const providerName = `E2E Provider ${Date.now()}`;
  await openAdmin(page, "/admin/model-provider");
  await page.getByRole("button", { name: "新建 Provider" }).click();

  await page.getByLabel("名称", { exact: true }).fill(providerName);
  await page.getByLabel("Provider ID").fill(providerId);
  await page.getByLabel("Base URL").fill(providerBaseUrlForAPI());
  await page
    .getByLabel("API Key", { exact: true })
    .fill("e2e-provider-secret");
  await page.getByLabel("文本模型", { exact: true }).fill(E2E_TEXT_MODEL);
  await page.getByRole("button", { name: "保存 Provider" }).click();

  const providerButton = page
    .locator(".provider-list button")
    .filter({ hasText: providerName });
  await expect(providerButton).toBeVisible();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");

  await page.getByLabel("API Key", { exact: true }).fill("must-not-leak");
  const otherProvider = page
    .locator(".provider-list button")
    .filter({ hasNotText: providerName })
    .first();
  await otherProvider.click();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await providerButton.click();

  await page.getByRole("button", { name: "拉取模型" }).click();
  await expect(page.getByText("模型列表已拉取")).toBeVisible();
  await page.getByRole("button", { name: "测试连接" }).click();
  const confirm = page.getByRole("alertdialog", {
    name: "测试连接与文本模型",
  });
  await confirm.getByRole("button", { name: "确认测试" }).click();
  await expect(page.locator(".provider-test-result")).toBeVisible();

  await page.getByRole("button", { name: "删除 Provider" }).click();
  const deletion = page.getByRole("alertdialog", { name: "删除 Provider" });
  await expect(deletion).toContainText(providerId);
  await deletion.getByRole("button", { name: "确认删除" }).click();
  await expect(providerButton).toHaveCount(0);
});

test("Admin announcement publish, republish and revoke remain connected", async ({
  page,
}) => {
  const suffix = Date.now();
  const title = `Admin feature announcement ${suffix}`;
  const republishedTitle = `${title} republished`;
  await openAdmin(page, "/admin/announcements");

  await page.getByRole("button", { name: "发布公告" }).click();
  const createDialog = page.getByRole("dialog", { name: "发布公告" });
  await createDialog.getByLabel("公告类型").selectOption("notice");
  await createDialog.getByLabel("标题").fill(title);
  await createDialog.getByLabel("内容").fill("Admin feature E2E content");
  await createDialog.getByRole("button", { name: "发布公告" }).click();

  const original = page.locator(".announcement-card").filter({ hasText: title });
  await expect(original).toBeVisible();
  await original.getByRole("button", { name: "编辑并重发" }).click();
  const editDialog = page.getByRole("dialog", { name: "编辑并重新发布" });
  await editDialog.getByLabel("标题").fill(republishedTitle);
  await editDialog.getByRole("button", { name: "编辑并重发" }).click();

  const republished = page
    .locator(".announcement-card")
    .filter({ hasText: republishedTitle });
  await expect(republished).toBeVisible();
  await republished.getByRole("button", { name: "撤销" }).click();
  const revokeDialog = page.getByRole("alertdialog", { name: "撤销公告" });
  await revokeDialog.getByRole("button", { name: "确认撤销" }).click();
  await expect(republished).toContainText("revoked");
});

test("Admin Seedance tag CRUD and filtered list controls stay operational", async ({
  page,
}) => {
  const tagName = `seedance-tag-${Date.now()}`;
  await openAdmin(page, "/admin/seedance-assets");
  await page.getByRole("button", { name: "新建标签" }).click();
  const dialog = page.getByRole("dialog", { name: "新建 Seedance 标签" });
  await dialog.getByLabel("名称 *").fill(tagName);
  await dialog.getByPlaceholder("#7dd3fc").fill("#123456");
  await dialog.getByRole("button", { name: "创建标签" }).click();

  const deleteTagButton = page.getByLabel(`删除标签 ${tagName}`);
  await expect(deleteTagButton).toBeVisible();
  await deleteTagButton.click();
  const deletion = page.getByRole("alertdialog", {
    name: "删除 Seedance 标签",
  });
  await deletion.getByRole("button", { name: "确认删除" }).click();
  await expect(deleteTagButton).toHaveCount(0);

  await page.getByPlaceholder("搜索名称 / AssetID").fill("no-such-asset");
  await page.getByRole("button", { name: "查询" }).click();
  await expect(page.getByText("没有匹配的 Seedance 素材")).toBeVisible();
  await page.getByRole("button", { name: "清空" }).click();
  await expect(page.getByPlaceholder("搜索名称 / AssetID")).toHaveValue("");
});
