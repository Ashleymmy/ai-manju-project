import { expect, test, type Page } from "@playwright/test";

const tag = (id: string, name: string, parentId = "", sortOrder = 0, assetEnabled = true) => ({
  id, name, parent_id: parentId, sort_order: sortOrder, asset_enabled: assetEnabled,
  aliases: [] as { id: string; tag_id: string; alias: string }[], status: "active", asset_count: 12,
});
const longName = "这是一个用来核对多级从属关系和长名称换行的分类标签";
const tags = [
  tag("people", "角色"), tag("leads", "主角", "people"), tag("detective", "侦探", "leads"),
  { ...tag("detail", longName, "detective"), aliases: [{ id: "alias", tag_id: "detail", alias: "detective-detail" }] },
  tag("support", "配角", "people", 1), tag("flat", "测试1"), tag("flat2", "测试2"),
  tag("places", "场景", "", 1), tag("other-leads", "主角", "places"),
  tag("context", "创作分类", "", 2, false), tag("context-child", "素材参考", "context"),
  tag("prompt-only", "仅用于提示词", "", 3, false),
  ...Array.from({ length: 14 }, (_, index) => [
    tag(`root-${index}`, `素材分类 ${index + 1}`, "", index + 4),
    ...Array.from({ length: 7 }, (_, child) => tag(`child-${index}-${child}`, `子标签 ${child + 1}`, `root-${index}`, child)),
  ]).flat(),
];

async function openLibrary(page: Page) {
  const requests: URL[] = [], tagRequests: URL[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("ai-manju:auth_token", "tag-hierarchy-test");
    localStorage.setItem("ai-manju:token-store", "local");
  });
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (request.headers().accept === "text/event-stream") return route.fulfill({ contentType: "text/event-stream", body: ":ok\n\n" });
    let data: unknown = { items: [], total: 0 };
    if (url.pathname === "/api/auth/me") data = { id: "qa", role: "super_admin", status: "active", display_name: "QA" };
    else if (url.pathname === "/api/user/preferences") data = {};
    else if (url.pathname === "/api/asset-folders" || url.pathname === "/api/asset-exports") data = [];
    else if (url.pathname === "/api/tags") {
      tagRequests.push(url);
      const page = Number(url.searchParams.get("page") || 1), size = Number(url.searchParams.get("page_size") || 100);
      data = { items: tags.slice((page - 1) * size, page * size), total: tags.length, page, page_size: size };
    } else if (url.pathname === "/api/assets/library") {
      requests.push(url);
      data = { items: [], total: 0, page: 1, page_size: 30 };
    } else if (url.pathname === "/api/assets") data = [];
    return route.fulfill({ json: { success: true, data, request_id: "tag-ribbon-qa" } });
  });
  await page.goto("/assets");
  const panel = page.getByRole("region", { name: "分类标签", exact: true });
  await expect(page.locator('.asset-taxonomy [data-tag-id="people"]')).toBeVisible();
  const notice = page.getByRole("button", { name: "知道了", exact: true });
  if (await notice.isVisible()) await notice.click();
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("button", { name: "筛选标签 角色", exact: true })).toBeVisible();
  return { panel, requests, tagRequests, errors };
}

test("compact ribbon separates browsing from filtering and preserves cross-category selections", async ({ page }) => {
  const { panel, requests, tagRequests, errors } = await openLibrary(page);
  await expect(panel.getByRole("region", { name: "子标签", exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "展开标签 角色", exact: true }).click();
  await panel.getByRole("button", { name: "展开标签 角色 / 主角", exact: true }).click();
  expect(requests.at(-1)?.searchParams.get("tag_ids")).toBeNull();
  await panel.getByRole("button", { name: "筛选标签 角色 / 主角 / 侦探", exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("tag_ids")).toBe("detective");
  expect(requests.at(-1)?.searchParams.get("include_tag_descendants")).toBe("true");
  expect(requests.at(-1)?.searchParams.get("tag_match")).toBe("and");
  await panel.getByRole("button", { name: "返回标签 角色", exact: true }).click();
  await expect(panel.getByRole("button", { name: "筛选标签 角色 / 主角", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "展开标签 场景", exact: true }).click();
  await panel.getByRole("button", { name: "筛选标签 场景 / 主角", exact: true }).click();
  await panel.getByRole("button", { name: "并集", exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("tag_match")).toBe("or");
  expect(requests.at(-1)?.searchParams.get("tag_ids")).toBe("detective,other-leads");
  await panel.getByRole("button", { name: "收起子标签", exact: true }).click();
  await expect(panel.getByRole("region", { name: "子标签", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "取消筛选 角色 / 主角 / 侦探", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: /^(收起|展开)分类标签$/ })).toHaveCount(0);
  await expect(panel.getByRole("list", { name: "一级标签", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "取消筛选 角色 / 主角 / 侦探", exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("tag_ids")).toBe("other-leads");
  await panel.getByRole("button", { name: "清空", exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("tag_ids")).toBeNull();
  expect(tagRequests.some(url => url.searchParams.get("page") === "2")).toBe(true);
  expect(tagRequests.every(url => !url.searchParams.has("usage"))).toBe(true);
  expect(errors).toEqual([]);
});

test("search finds aliases and later pages with complete paths and preserves the browsed parent", async ({ page }) => {
  const { panel, requests, errors } = await openLibrary(page);
  await expect(panel.getByRole("button", { name: "筛选标签 创作分类", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "展开标签 创作分类", exact: true }).click();
  await expect(panel.getByRole("button", { name: "筛选标签 创作分类 / 素材参考", exact: true })).toBeEnabled();
  await expect(panel.getByText("仅用于提示词", { exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "筛选标签 角色", exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("tag_ids")).toBe("people");
  await panel.getByRole("textbox", { name: "搜索分类标签" }).fill("detective-detail");
  await expect(panel.getByRole("button", { name: /^筛选标签 / })).toHaveCount(1);
  await expect(panel.getByRole("button", { name: `筛选标签 角色 / 主角 / 侦探 / ${longName}`, exact: true })).toBeVisible();
  await panel.getByRole("textbox", { name: "搜索分类标签" }).fill("不存在");
  await expect(panel.getByText("没有匹配的标签")).toBeVisible();
  await expect(panel.getByRole("button", { name: "取消筛选 角色", exact: true })).toBeVisible();
  await panel.getByRole("textbox", { name: "搜索分类标签" }).fill("素材分类 14 / 子标签 7");
  await expect(panel.getByRole("button", { name: /^筛选标签 / })).toHaveCount(1);
  await expect(panel.getByRole("button", { name: "筛选标签 素材分类 14 / 子标签 7", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "清空标签搜索" }).click();
  await expect(panel.getByRole("region", { name: "子标签", exact: true })).toContainText("素材参考");
  await panel.getByRole("textbox", { name: "搜索分类标签" }).fill("素材分类 14");
  await panel.getByRole("button", { name: "展开标签 素材分类 14", exact: true }).click();
  await expect(panel.getByRole("textbox", { name: "搜索分类标签" })).toHaveValue("");
  await expect(panel.getByRole("region", { name: "子标签", exact: true })).toContainText("子标签 7");
  expect(requests.at(-1)?.searchParams.get("tag_ids")).toBe("people");
  expect(errors).toEqual([]);
});

test("standalone tags use click highlight and keyboard selection without checkboxes", async ({ page }) => {
  const { panel, requests, errors } = await openLibrary(page);
  await expect(panel.getByRole("checkbox")).toHaveCount(0);
  const option = panel.getByRole("button", { name: "筛选标签 测试1", exact: true });
  const background = await option.evaluate(element => getComputedStyle(element).backgroundColor);
  await option.locator(".asset-taxonomy-count").click();
  await expect(option).toHaveAttribute("aria-pressed", "true");
  expect(await option.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(background);
  await expect.poll(() => requests.at(-1)?.searchParams.get("tag_ids")).toBe("flat");
  await option.click();
  await expect(option).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => requests.at(-1)?.searchParams.get("tag_ids")).toBeNull();
  await option.focus();
  await page.keyboard.press("Space");
  await expect(option).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(option).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});

test("all-category filtering uses the same parent ID and Escape restores the root trigger", async ({ page }) => {
  const { panel, requests } = await openLibrary(page);
  await panel.getByRole("button", { name: "展开标签 角色", exact: true }).click();
  await panel.getByRole("button", { name: "筛选全部 角色", exact: true }).click();
  await expect(panel.getByRole("button", { name: "筛选标签 角色", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => requests.at(-1)?.searchParams.get("tag_ids")).toBe("people");
  await panel.getByRole("button", { name: "展开标签 角色 / 主角", exact: true }).click();
  await panel.getByRole("button", { name: "筛选全部 角色 / 主角", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("region", { name: "子标签", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "展开标签 角色", exact: true })).toBeFocused();
  expect(requests.at(-1)?.searchParams.get("tag_ids")).toBe("people");
});

for (const viewport of [{ width: 1600, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 844 }]) {
  test(`compact band, breadcrumbs and long names fit at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { panel, errors } = await openLibrary(page);
    for (const path of ["角色", "角色 / 主角", "角色 / 主角 / 侦探"]) {
      await panel.getByRole("button", { name: `展开标签 ${path}`, exact: true }).click();
    }
    await panel.getByRole("button", { name: `筛选标签 角色 / 主角 / 侦探 / ${longName}`, exact: true }).click();
    await expect(panel.getByRole("button", { name: `取消筛选 角色 / 主角 / 侦探 / ${longName}`, exact: true })).toBeVisible();
    const metrics = await panel.evaluate(element => {
      const root = element.getBoundingClientRect();
      const ribbon = element.querySelector(".asset-taxonomy-ribbon")!;
      const subpanel = element.querySelector(".asset-taxonomy-subpanel")!;
      return {
        width: element.clientWidth, scrollWidth: element.scrollWidth, left: root.left, right: root.right,
        ribbonHeight: ribbon.clientHeight, ribbonWidth: ribbon.clientWidth, ribbonScrollWidth: ribbon.scrollWidth,
        subWidth: subpanel.getBoundingClientRect().width,
        contained: Array.from(element.querySelectorAll("button,input,.asset-taxonomy-name,.asset-taxonomy-breadcrumb")).every(child => {
          const rect = child.getBoundingClientRect();
          return rect.left >= root.left && rect.right <= root.right;
        }),
      };
    });
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width + 1);
    expect(metrics.ribbonScrollWidth).toBeLessThanOrEqual(metrics.ribbonWidth + 1);
    expect(metrics.left).toBeGreaterThanOrEqual(0);
    expect(metrics.right).toBeLessThanOrEqual(viewport.width);
    expect(metrics.ribbonHeight).toBeLessThanOrEqual(160);
    expect(metrics.subWidth).toBeLessThanOrEqual(480);
    expect(metrics.contained).toBe(true);
    await panel.evaluate(element => element.scrollIntoView({ block: "center" }));
    await panel.screenshot({ path: `.tmp/asset-tag-ribbon-qa/panel-${viewport.width}.png` });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `.tmp/asset-tag-ribbon-qa/page-${viewport.width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}
