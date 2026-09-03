import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { createProject, login, saveSnapshot, seedBrowserAuth } from "./api";
import { E2E_BASE_URL } from "./env";

type FrontendBaseline = {
  routes: {
    authenticatedCanvas: string[];
    authenticatedStudio: string[];
    legacyAliases: Record<string, string>;
    public: string[];
    superAdmin: string[];
  };
  storage: {
    indexedDb: Array<{
      database: string;
      dynamicKeys?: string[];
      fixedKeys?: string[];
      stores: string[];
    }>;
    localStorage: string[];
    sessionStorage: string[];
  };
};

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(currentDirectory, "..");
const repositoryRoot = path.resolve(studioRoot, "..", "..");
const baseline = JSON.parse(
  readFileSync(
    path.join(studioRoot, "quality", "frontend-baseline.json"),
    "utf8"
  )
) as FrontendBaseline;
const acceptanceSearch = "?acceptance=frontend-decoupling";
const acceptanceHash = "#deep-link";

async function expectLocation(
  page: Page,
  pathname: string,
  search = acceptanceSearch,
  hash = acceptanceHash
) {
  await expect
    .poll(() => {
      const url = new URL(page.url());
      return { pathname: url.pathname, search: url.search, hash: url.hash };
    })
    .toEqual({ pathname, search, hash });
}

async function openDeepLink(page: Page, pathname: string) {
  const response = await page.goto(
    `${pathname}${acceptanceSearch}${acceptanceHash}`
  );
  expect(response, `${pathname} 应返回文档响应`).not.toBeNull();
  expect(response?.ok(), `${pathname} HTTP ${response?.status()}`).toBeTruthy();
  await expectLocation(page, pathname);
  await expect(page.locator("#root")).not.toBeEmpty();
}

test("public Chat deep link does not eagerly request isolated feature chunks", async ({
  page,
}) => {
  const firstPartyAssets: string[] = [];
  const scriptBodies: Array<Promise<string>> = [];
  const studioOrigin = new URL(E2E_BASE_URL).origin;
  page.on("request", request => {
    if (!["script", "stylesheet"].includes(request.resourceType())) return;
    const url = new URL(request.url());
    if (url.origin === studioOrigin) {
      firstPartyAssets.push(decodeURIComponent(url.pathname));
    }
  });
  page.on("response", response => {
    if (response.request().resourceType() !== "script") return;
    scriptBodies.push(
      response
        .body()
        .then(body => body.toString("utf8"))
        .catch(() => "")
    );
  });

  await openDeepLink(page, "/chat");
  await expect(page.getByPlaceholder(/输入你的创作想法/)).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(
    firstPartyAssets.some(asset => /\.(?:css|js)$/.test(asset))
  ).toBeTruthy();
  expect(
    firstPartyAssets.filter(asset =>
      /(?:^|[-_/])(canvas|video|admin|director)(?:[-_.\/]|$)/i.test(asset)
    )
  ).toEqual([]);
  const loadedSource = (await Promise.all(scriptBodies)).join("\n");
  for (const isolatedRouteSignature of [
    "real-canvas-stage",
    "wb-page",
    "real-admin-page",
    "director-frame-shell",
  ]) {
    expect(loadedSource).not.toContain(isolatedRouteSignature);
  }
});

test("declarative route inventory preserves auth, layout and every deep link", async ({
  page,
}) => {
  test.setTimeout(240_000);

  for (const route of baseline.routes.public) {
    await openDeepLink(page, route);
  }

  const protectedPath =
    baseline.routes.authenticatedStudio.find(route => route === "/assets") ??
    baseline.routes.authenticatedStudio[0];
  await page.goto(`${protectedPath}${acceptanceSearch}${acceptanceHash}`);
  await expect.poll(() => new URL(page.url()).pathname).toBe("/login");
  const redirect = new URL(page.url()).searchParams.get("next");
  expect(redirect).toBe(`${protectedPath}${acceptanceSearch}${acceptanceHash}`);

  const session = await login(page.request);
  const project = await createProject(
    page.request,
    session.token,
    `Frontend decoupling acceptance ${Date.now()}`,
    {}
  );
  await saveSnapshot(page.request, session.token, project.id, {
    schema: "ai-manhua-studio-canvas",
    version: 3,
    nodes: [],
    edges: [],
    connections: [],
    groups: [],
    viewport: { x: 0, y: 0, k: 1 },
    zoom: 100,
    panX: 0,
    panY: 0,
  });
  await seedBrowserAuth(page, session);

  for (const route of baseline.routes.authenticatedStudio) {
    await openDeepLink(page, route);
    await expect(page.locator(".studio-app:not(.canvas-focus)")).toBeVisible();
  }

  for (const route of baseline.routes.superAdmin) {
    await openDeepLink(page, route);
    await expect(page.locator(".real-admin-page")).toBeVisible();
  }

  for (const routeTemplate of baseline.routes.authenticatedCanvas) {
    const route = routeTemplate.replace(":id", project.id);
    await openDeepLink(page, route);
    await expect(page.locator(".studio-app.canvas-focus")).toBeVisible();
    if (routeTemplate.includes(":id")) {
      await expect(page.locator(".real-canvas-stage")).toBeVisible();
    }
  }

  for (const [alias, destination] of Object.entries(
    baseline.routes.legacyAliases
  )) {
    await page.goto(`${alias}${acceptanceSearch}${acceptanceHash}`);
    await expectLocation(page, destination);
  }

  await page.goto(
    `/v2-canvas/${encodeURIComponent(project.id)}${acceptanceSearch}${acceptanceHash}`
  );
  await expectLocation(page, `/canvas/${project.id}`);

  await page.goto(
    `/tags/tag-%E6%B5%8B%E8%AF%95${acceptanceSearch}&view=tree${acceptanceHash}`
  );
  await expect.poll(() => new URL(page.url()).pathname).toBe("/tags");
  const tagUrl = new URL(page.url());
  expect(tagUrl.searchParams.get("acceptance")).toBe("frontend-decoupling");
  expect(tagUrl.searchParams.get("view")).toBe("tree");
  expect(tagUrl.searchParams.get("tag_id")).toBe("tag-测试");
  expect(tagUrl.hash).toBe(acceptanceHash);
});

function collectProductionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") return [];
      return collectProductionSources(entryPath);
    }
    if (
      !entry.isFile() ||
      !/\.(?:js|jsx|mjs|ts|tsx)$/.test(entry.name) ||
      /\.(?:test|spec)\.(?:js|jsx|mjs|ts|tsx)$/.test(entry.name) ||
      /\.d\.ts$/.test(entry.name)
    ) {
      return [];
    }
    return [readFileSync(entryPath, "utf8")];
  });
}

function stableStorageToken(identifier: string) {
  const interpolation = identifier.indexOf("${");
  return (interpolation >= 0 ? identifier.slice(0, interpolation) : identifier)
    .replace(/:+$/, "")
    .trim();
}

test("persistent storage identifiers remain byte-for-byte compatible", async () => {
  const sourceCorpus = [
    ...collectProductionSources(path.join(studioRoot, "client", "src")),
    ...collectProductionSources(
      path.join(repositoryRoot, "apps", "director-desk", "src")
    ),
  ].join("\n");

  const identifiers = new Set([
    ...baseline.storage.localStorage,
    ...baseline.storage.sessionStorage,
    ...baseline.storage.indexedDb.flatMap(database => [
      database.database,
      ...database.stores,
      ...(database.fixedKeys ?? []),
      ...(database.dynamicKeys ?? []),
    ]),
  ]);

  // keyvaluepairs 是 localForage 未配置 storeName 时的库默认值，不存在于业务源码。
  identifiers.delete("keyvaluepairs");
  for (const identifier of identifiers) {
    const token = stableStorageToken(identifier);
    expect(
      sourceCorpus.includes(token),
      `持久化标识已丢失或改名：${identifier}`
    ).toBeTruthy();
  }
});
