import { expect, test, type Page } from "@playwright/test";

function makeTag(id: string, name: string, extra = {}) {
  return { id, name, scope_type: "workspace", parent_id: "", description: "", asset_enabled: true,
    prompt_enabled: true, inherit_mode: "auto", status: "active", sort_order: 0, aliases: [],
    asset_count: 0, prompt_count: 0, children_count: 0, editable: true, ...extra };
}

async function setup(page: Page, options: { stale?: boolean; archived?: boolean; loseResponse?: boolean; selection?: boolean } = {}) {
  const items = [makeTag("a", "a"), makeTag("b", "b", { status: options.archived ? "archived" : "active" })];
  if (options.selection) items.push(makeTag("c", "c"), makeTag("d", "d"), makeTag("locked", "locked", { editable: false, scope_type: "system" }));
  const creates: Array<Record<string, any>> = [];
  const updates: Array<Record<string, any>> = [];
  const moves: Array<{ tag_ids: string[] }> = [];
  const attempts = new Map<string, ReturnType<typeof makeTag>>();
  let loseResponse = options.loseResponse;
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "qa-token");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (!path.startsWith("/api/")) return route.continue();
    const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "authorization,content-type,x-request-id", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS" };
    const reply = (data: unknown, status = 200) => route.fulfill({ status, headers, json: { success: true, data } });
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (request.headers().accept === "text/event-stream") return route.fulfill({ headers, contentType: "text/event-stream", body: ":ok\n\n" });
    if (path === "/api/auth/me") return reply({ id: "qa", account: "qa", role: "super_admin", status: "active" });
    if (path === "/api/announcements/current") return reply(null);
    if (path === "/api/user/preferences") return reply({});
    if (path === "/api/tags/bulk-move") {
      moves.push(request.postDataJSON());
      return reply({ items, count: request.postDataJSON().tag_ids.length });
    }
    if (path === "/api/tags" && request.method() === "POST") {
      const input = request.postDataJSON();
      creates.push(input);
      if (attempts.has(input.idempotency_key)) return reply(attempts.get(input.idempotency_key), 201);
      if (items.some(tag => tag.name.toLowerCase() === input.name.toLowerCase() && tag.parent_id === (input.parent_id || "") && tag.scope_type === input.scope_type)) {
        return route.fulfill({ headers, status: 409, json: { success: false, error: "tag already exists", request_id: "internal-request" } });
      }
      const created = makeTag(`created-${items.length}`, input.name, { ...input, parent_id: input.parent_id || "" });
      items.push(created);
      attempts.set(input.idempotency_key, created);
      if (loseResponse) { loseResponse = false; return route.abort("failed"); }
      return reply(created, 201);
    }
    if (path === "/api/tags") {
      const includeArchived = url.searchParams.get("include_archived") === "true";
      let visible = items.filter(tag => includeArchived || tag.status === "active");
      if (options.stale && !includeArchived) visible = visible.filter(tag => tag.id !== "b");
      if (url.searchParams.has("parent")) visible = visible.filter(tag => tag.parent_id === url.searchParams.get("parent"));
      if (url.searchParams.has("tag_scope")) visible = visible.filter(tag => tag.scope_type === url.searchParams.get("tag_scope"));
      return reply({ items: visible, total: visible.length, page: 1, page_size: 100 });
    }
    if (path === "/api/tags/b" && request.method() === "PUT") {
      const input = request.postDataJSON(); updates.push(input);
      Object.assign(items[1], input);
      return reply(items[1]);
    }
    return reply({ items: [], total: 0 });
  });
  await page.goto("/tags");
  await page.getByRole("button", { name: "知道了", exact: true }).click();
  await expect(page.locator(".tag-tree .tag-group")).toContainText("a");
  await page.getByRole("button", { name: "新建标签", exact: true }).click();
  return { items, creates, updates, moves };
}

test("creates different names once, then locates an existing normalized sibling", async ({ page }, testInfo) => {
  const state = await setup(page);
  const panel = page.locator(".tag-create-panel");
  await panel.getByLabel("名称", { exact: true }).fill("c");
  await panel.getByRole("button", { name: "创建标签", exact: true }).dblclick();
  await expect(panel).toHaveCount(0);
  expect(state.creates).toHaveLength(1);
  expect(state.creates[0].idempotency_key).toBeTruthy();
  await expect(page.locator(".tag-tree .selected")).toContainText("c");
  await page.getByRole("button", { name: "新建标签", exact: true }).click();
  await panel.getByLabel("名称", { exact: true }).fill(" B ");
  await panel.getByRole("button", { name: "创建标签", exact: true }).click();
  await expect(page.getByText("同一位置已有标签「b」，无需重复创建。", { exact: true })).toBeVisible();
  expect(state.creates).toHaveLength(1);
  await page.screenshot({ path: testInfo.outputPath("existing-tag-feedback.png") });
  await page.getByRole("button", { name: "查看标签", exact: true }).click();
  await expect(page.locator(".tag-tree .selected")).toContainText("b");
});

test("recovers a stale-list conflict without technical errors or losing the draft", async ({ page }) => {
  const state = await setup(page, { stale: true });
  const panel = page.locator(".tag-create-panel");
  await panel.getByLabel("名称", { exact: true }).fill("b");
  await panel.getByRole("button", { name: "创建标签", exact: true }).click();
  await expect(page.getByText("同一位置已有标签「b」，无需重复创建。", { exact: true })).toBeVisible();
  await expect(panel.getByLabel("名称", { exact: true })).toHaveValue("b");
  await expect(page.locator("body")).not.toContainText("tag already exists");
  await expect(page.locator("body")).not.toContainText("request_id");
  await panel.getByLabel("名称", { exact: true }).fill("c");
  await panel.getByRole("button", { name: "创建标签", exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(state.creates[0].idempotency_key).not.toBe(state.creates[1].idempotency_key);
});

test("offers explicit restoration of a hidden archived tag and preserves its settings", async ({ page }) => {
  const state = await setup(page, { archived: true });
  const panel = page.locator(".tag-create-panel");
  await panel.getByLabel("名称", { exact: true }).fill("b");
  await panel.getByRole("button", { name: "创建标签", exact: true }).click();
  await expect(page.getByRole("button", { name: "恢复标签", exact: true })).toBeVisible();
  expect(state.updates).toHaveLength(0);
  await page.getByRole("button", { name: "恢复标签", exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(state.updates).toEqual([{ name: "b", description: "", asset_enabled: true, prompt_enabled: true,
    inherit_mode: "auto", status: "active", sort_order: 0 }]);
  expect(state.items).toHaveLength(2);
  await expect(page.locator(".tag-tree .selected")).toContainText("b");
});

test("retries a lost response with the same creation key", async ({ page }) => {
  const state = await setup(page, { loseResponse: true });
  await page.evaluate(() => Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true }));
  const panel = page.locator(".tag-create-panel");
  await panel.getByLabel("名称", { exact: true }).fill("c");
  await panel.getByRole("button", { name: "创建标签", exact: true }).click();
  await expect(page.getByText("暂未确认创建结果，请重试；相同内容不会重复创建。", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "创建标签", exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(state.creates).toHaveLength(2);
  expect(state.creates[0].idempotency_key).toBe(state.creates[1].idempotency_key);
  expect(state.items.filter(tag => tag.name === "c")).toHaveLength(1);
});

test("allows the same name under another parent", async ({ page }) => {
  const state = await setup(page);
  const panel = page.locator(".tag-create-panel");
  await panel.getByLabel("名称", { exact: true }).fill("b");
  await panel.getByLabel(/^父级/).selectOption("a");
  await panel.getByRole("button", { name: "创建标签", exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(state.creates[0].parent_id).toBe("a");
});

for (const width of [1600, 390]) {
  test(`select-all, filtered selection, shift ranges and bulk requests at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await setup(page, { selection: true });
    await page.locator(".tag-create-panel").getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("checkbox", { name: "选择标签 a", exact: true }).click();
    await page.getByRole("checkbox", { name: "选择标签 d", exact: true }).click({ modifiers: ["Shift"] });
    await expect(page.getByText("已选 4 个标签", { exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "选择标签 locked", exact: true })).toBeDisabled();
    await page.getByPlaceholder("检索标签").fill("c");
    await page.getByRole("checkbox", { name: "全选当前结果", exact: true }).uncheck();
    await expect(page.getByText("已选 3 个标签", { exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: "全选当前结果", exact: true }).check();
    await expect(page.getByText("已选 4 个标签", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "清空选择", exact: true }).click();
    await expect(page.getByText("已选 0 个标签", { exact: true })).toBeVisible();
    await page.getByPlaceholder("检索标签").fill("");
    await page.getByRole("checkbox", { name: "全选", exact: true }).check();
    await expect(page.getByText("已选 4 个标签", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`selection-${width}.png`) });
    await page.getByRole("button", { name: "批量移动", exact: true }).click();
    await expect.poll(() => state.moves.length).toBe(1);
    expect(state.moves[0].tag_ids).toEqual(["a", "b", "c", "d"]);
    await expect(page.getByText("已选 0 个标签", { exact: true })).toBeVisible();
  });
}
