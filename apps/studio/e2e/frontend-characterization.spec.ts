import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import {
  authHeaders,
  createProject,
  fetchJob,
  login,
  saveSnapshot,
  seedBrowserAuth,
  unwrap,
  type Job,
  type Session,
} from "./api";
import {
  apiUrl,
  E2E_ADMIN_ACCOUNT,
  E2E_ADMIN_PASSWORD,
  E2E_IMAGE_MODEL,
} from "./env";

type FrontendBaseline = {
  schemaVersion: number;
  source: { commit: string };
  environment: {
    viewports: Array<{ name: string; width: number; height: number }>;
  };
  routes: {
    public: string[];
    authenticatedStudio: string[];
    authenticatedCanvas: string[];
    superAdmin: string[];
    legacyAliases: Record<string, string>;
  };
  storage: {
    localStorage: string[];
    sessionStorage: string[];
    indexedDb: Array<{ database: string; stores: string[] }>;
  };
  canvasDomContracts: Record<string, unknown>;
};

type CanvasNode = {
  id: string;
  kind: string;
  title: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  imageSrc?: string;
  imageAssetId?: string;
  metadata?: Record<string, unknown>;
  future_node_field?: Record<string, unknown>;
};

type CanvasSnapshot = {
  schema: string;
  version: number;
  nodes: CanvasNode[];
  edges: Array<{ id: string; from: string; to: string }>;
  connections: Array<{ id: string; from: string; to: string }>;
  groups: unknown[];
  viewport: { x: number; y: number; k: number };
  zoom: number;
  panX: number;
  panY: number;
  future_extension?: Record<string, unknown>;
};

type SnapshotEnvelope = { data: CanvasSnapshot };

const baseline = JSON.parse(
  readFileSync(
    new URL("../quality/frontend-baseline.json", import.meta.url),
    "utf8"
  )
) as FrontendBaseline;

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const pngDataUrl = `data:image/png;base64,${pngBase64}`;

test("machine-readable baseline inventories the locked routes, storage and viewport contracts", async () => {
  expect(baseline.schemaVersion).toBe(1);
  expect(baseline.source.commit).toMatch(/^[0-9a-f]{40}$/);
  expect(baseline.environment.viewports).toEqual([
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]);
  expect(baseline.routes.public).toEqual(
    expect.arrayContaining(["/", "/chat", "/login", "/register"])
  );
  expect(baseline.routes.authenticatedCanvas).toEqual([
    "/canvas",
    "/canvas/:id",
  ]);
  expect(baseline.routes.superAdmin).toHaveLength(5);
  expect(Object.keys(baseline.routes.legacyAliases)).toHaveLength(10);
  expect(baseline.storage.localStorage).toEqual(
    expect.arrayContaining([
      "ai-manju:auth_token",
      "ai-manju:token-store",
      "ai-manju:rail-open-groups",
      "canvas-agent-conversations:${projectId}",
      "standalone-3d-director-desk-registry-v1",
    ])
  );
  expect(baseline.storage.sessionStorage).toEqual(
    expect.arrayContaining([
      "ai-manju:auth_token",
      "ai-manju:canvas-bootstrap",
      "ai-manju:image-prompt",
      "ai-manju:image-reference-asset",
    ])
  );
  expect(baseline.storage.indexedDb).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ database: "ai-manhua-studio" }),
      expect.objectContaining({
        database: "localforage",
        stores: ["keyvaluepairs"],
      }),
      expect.objectContaining({
        database: "storyai-3d-director-assets",
        stores: ["binary-assets"],
      }),
    ])
  );
  expect(baseline.canvasDomContracts).toMatchObject({
    stage: ".real-canvas-stage",
    node: ".real-canvas-node[data-node-id]",
    uiIsolationAttribute: "data-canvas-ui",
  });
});

test("public, fallback and protected deep links retain their access policy", async ({
  page,
}) => {
  await page.goto("/chat?origin=e2e#draft");
  await expect(page.getByPlaceholder(/输入你的创作想法/)).toBeVisible();
  await expectLocation(page, "/chat", "?origin=e2e", "#draft");

  await page.goto("/login");
  await expect(page.locator(".auth-page")).toBeVisible();
  await page.goto("/v2-login");
  await expect(page.locator(".auth-page.v2")).toBeVisible();
  await page.goto("/register");
  await expect(page.locator(".auth-page")).toBeVisible();

  await page.goto("/route-that-does-not-exist?probe=e2e#missing");
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();

  await page.goto("/assets?scope=team&filter=recent#library");
  await expect.poll(() => new URL(page.url()).pathname).toBe("/login");
  const next = new URL(page.url()).searchParams.get("next");
  expect(next).toBe("/assets?scope=team&filter=recent#library");
  expect(next).not.toContain("//");
});

test("chat initial network excludes canvas, video, admin and director route code", async ({
  page,
}, testInfo) => {
  const scriptBodies: Array<Promise<{ url: string; source: string }>> = [];
  page.on("response", response => {
    if (response.request().resourceType() !== "script") return;
    scriptBodies.push(
      response
        .body()
        .then(body => ({ url: response.url(), source: body.toString("utf8") }))
    );
  });

  await page.goto("/chat?network=e2e");
  await expect(page.getByPlaceholder(/输入你的创作想法/)).toBeVisible();
  await page.waitForLoadState("networkidle");

  const scripts = await Promise.all(scriptBodies);
  const loadedSource = scripts.map(script => script.source).join("\n");
  for (const routeSignature of [
    "real-canvas-stage",
    "wb-page",
    "real-admin-page",
    "director-frame-shell",
  ]) {
    expect(loadedSource).not.toContain(routeSignature);
  }
  await testInfo.attach("chat-initial-script-network.json", {
    body: JSON.stringify(
      scripts.map(script => ({ url: script.url, bytes: script.source.length })),
      null,
      2
    ),
    contentType: "application/json",
  });
});

test("login keeps the token in the selected storage without changing key names", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByPlaceholder("输入用户名").fill(E2E_ADMIN_ACCOUNT);
  await page.getByPlaceholder("输入密码").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: /进入工作台/ }).click();
  await expect(page).toHaveURL(/\/admin/);

  const remembered = await page.evaluate(() => ({
    localToken: localStorage.getItem("ai-manju:auth_token"),
    sessionToken: sessionStorage.getItem("ai-manju:auth_token"),
    tokenStore: localStorage.getItem("ai-manju:token-store"),
    account: localStorage.getItem("ai-manju:auth_account"),
  }));
  expect(remembered.localToken).toBeTruthy();
  expect(remembered.sessionToken).toBeNull();
  expect(remembered.tokenStore).toBe("local");
  expect(remembered.account).toBe(E2E_ADMIN_ACCOUNT);

  await page.context().clearCookies();
  await page.goto("/login");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.locator(".remember-line .check-box").click();
  await page.getByPlaceholder("输入用户名").fill(E2E_ADMIN_ACCOUNT);
  await page.getByPlaceholder("输入密码").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: /进入工作台/ }).click();
  await expect(page).toHaveURL(/\/admin/);

  const sessionOnly = await page.evaluate(() => ({
    localToken: localStorage.getItem("ai-manju:auth_token"),
    sessionToken: sessionStorage.getItem("ai-manju:auth_token"),
    tokenStore: localStorage.getItem("ai-manju:token-store"),
    account: localStorage.getItem("ai-manju:auth_account"),
  }));
  expect(sessionOnly.localToken).toBeNull();
  expect(sessionOnly.sessionToken).toBeTruthy();
  expect(sessionOnly.tokenStore).toBe("session");
  expect(sessionOnly.account).toBe(E2E_ADMIN_ACCOUNT);
});

test("legacy aliases and tag deep links preserve their observable routing contract", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const session = await login(page.request);
  await seedBrowserAuth(page, session);

  for (const [source, target] of Object.entries(
    baseline.routes.legacyAliases
  )) {
    await page.goto(`${source}?scope=team&probe=alias#anchor`);
    await expectLocation(page, target, "?scope=team&probe=alias", "#anchor");
  }

  const project = await createProject(
    page.request,
    session.token,
    `Alias canvas ${Date.now()}`,
    {}
  );
  await page.goto(
    `/v2-canvas/${encodeURIComponent(project.id)}?scope=personal&probe=dynamic#node`
  );
  await expectLocation(
    page,
    `/canvas/${project.id}`,
    "?scope=personal&probe=dynamic",
    "#node"
  );

  await page.goto(
    "/tags/tag-%E6%B5%8B%E8%AF%95?scope=team&view=tree#tag-library"
  );
  await expect.poll(() => new URL(page.url()).pathname).toBe("/tags");
  const tagUrl = new URL(page.url());
  expect(tagUrl.searchParams.get("scope")).toBe("team");
  expect(tagUrl.searchParams.get("view")).toBe("tree");
  expect(tagUrl.searchParams.get("tag_id")).toBe("tag-测试");
  expect(tagUrl.hash).toBe("#tag-library");
});

test("authenticated routes keep the Studio, Canvas and Admin layout boundaries", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const session = await login(page.request);
  await seedBrowserAuth(page, session);

  for (const route of baseline.routes.authenticatedStudio) {
    await page.goto(route);
    const studio = page.locator(".studio-app:not(.canvas-focus)");
    await expect(
      studio,
      `${route} should render inside the Studio layout`
    ).toBeVisible();
    await expect(studio.locator(":scope > .side-rail")).toBeVisible();
    await expect(
      studio.locator(":scope > main.main-stage .topbar")
    ).toBeVisible();
  }

  await page.goto("/canvas");
  const canvas = page.locator(".studio-app.canvas-focus.canvas-focus-direct");
  await expect(canvas).toBeVisible();
  await expect(canvas.locator(":scope > main.main-stage")).toBeVisible();
  await expect(canvas.locator(".side-rail")).toHaveCount(0);
  await expect(canvas.locator(".topbar")).toHaveCount(0);

  const adminRoutes: Array<[string, RegExp, RegExp]> = [
    ["/admin", /运行监控/, /系统运行监控/],
    ["/admin/users", /用户/, /用户与权限/],
    ["/admin/model-provider", /模型提供商/, /模型提供商/],
    ["/admin/announcements", /系统公告/, /系统公告/],
    ["/admin/seedance-assets", /Seedance 素材/, /Seedance 素材/],
  ];
  for (const [route, tab, heading] of adminRoutes) {
    await page.goto(route);
    await expect(page.locator(".real-admin-page")).toBeVisible();
    await expect(page.locator(".admin-nav button.selected")).toContainText(tab);
    await expect(
      page.locator(".real-admin-section h2").filter({ hasText: heading })
    ).toBeVisible();
  }

  const member = await createMemberSession(page.request, session.token);
  await page.context().clearCookies();
  await page.goto("/login");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await seedBrowserAuth(page, member);
  await page.goto("/admin/users?probe=forbidden#admin");
  await expect.poll(() => new URL(page.url()).pathname).toBe("/canvas");
  await expect(page.locator(".real-admin-page")).toHaveCount(0);
  await expect(page.locator(".studio-app.canvas-focus")).toBeVisible();
});

test("Chat creates a real project, hands bootstrap to Canvas once and opens the online Agent", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const session = await login(page.request);
  await seedBrowserAuth(page, session);
  await page.addInitScript(() => {
    const events: Array<{
      area: "local" | "session";
      operation: "set" | "remove";
      key: string;
      value?: string;
    }> = [];
    Object.defineProperty(window, "__e2eStorageEvents", {
      configurable: true,
      value: events,
    });
    const originalSet = Storage.prototype.setItem;
    const originalRemove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      events.push({
        area: this === window.sessionStorage ? "session" : "local",
        operation: "set",
        key,
        value,
      });
      return originalSet.call(this, key, value);
    };
    Storage.prototype.removeItem = function removeItem(key: string) {
      events.push({
        area: this === window.sessionStorage ? "session" : "local",
        operation: "remove",
        key,
      });
      return originalRemove.call(this, key);
    };
  });
  await page.route(/\/api\/projects\?scope=personal$/, async route => {
    await new Promise(resolve => setTimeout(resolve, 300));
    await route.continue();
  });
  await page.goto("/chat");

  const prompt = `E2E Chat bootstrap ${Date.now()}`;
  const createRequest = page.waitForRequest(
    request =>
      request.method() === "POST" &&
      request.url().includes("/api/projects?scope=personal")
  );
  await page.getByPlaceholder(/输入你的创作想法/).fill(prompt);
  await page.getByPlaceholder(/输入你的创作想法/).press("Enter");
  await expect(page.getByText("正在为你准备画布…")).toBeVisible();

  const request = await createRequest;
  const payload = request.postDataJSON() as {
    title: string;
    data: { nodes: Array<{ kind: string; content: string }>; edges: unknown[] };
  };
  expect(payload.title).toBe(prompt.slice(0, 50));
  expect(payload.data.nodes.map(node => node.kind)).toEqual(["text", "image"]);
  expect(
    payload.data.nodes.every(node => node.content === prompt)
  ).toBeTruthy();
  expect(payload.data.edges).toHaveLength(1);

  await expect(page).toHaveURL(/\/canvas\/[^?]+\?scope=personal/);
  await expect(page.locator(".real-canvas-node")).toHaveCount(2);
  await expect(page.locator(".agent-panel")).toBeVisible();
  await expect(page.locator(".agent-panel .agent-msg-user")).toContainText(
    prompt
  );
  await expect(page.locator(".agent-panel .agent-msg-assistant")).toContainText(
    "e2e mock response",
    { timeout: 30_000 }
  );

  const handoff = await page.evaluate(() => ({
    value: sessionStorage.getItem("ai-manju:canvas-bootstrap"),
    events: (
      window as unknown as {
        __e2eStorageEvents: Array<{
          area: string;
          operation: string;
          key: string;
          value?: string;
        }>;
      }
    ).__e2eStorageEvents,
  }));
  expect(handoff.value).toBeNull();
  expect(handoff.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        area: "session",
        operation: "set",
        key: "ai-manju:canvas-bootstrap",
      }),
      expect.objectContaining({
        area: "session",
        operation: "remove",
        key: "ai-manju:canvas-bootstrap",
      }),
    ])
  );
});

test("Canvas preserves unknown snapshot fields while dragging, mentioning, switching and refreshing", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const session = await login(page.request);
  const first = await createProject(
    page.request,
    session.token,
    `Canvas contract A ${Date.now()}`,
    {}
  );
  const second = await createProject(
    page.request,
    session.token,
    `Canvas contract B ${Date.now()}`,
    {}
  );
  const firstSnapshot = canvasSnapshot(
    [
      {
        id: "source-node",
        kind: "image",
        title: "Reference source",
        content: pngDataUrl,
        imageSrc: pngDataUrl,
        x: 120,
        y: 140,
        width: 260,
        height: 190,
        metadata: {
          status: "success",
          generationMode: "image",
          prompt: "source",
          futureMetadata: { preserve: "metadata-sentinel" },
        },
      },
      {
        id: "target-node",
        kind: "text",
        title: "Mention target",
        content: "",
        x: 520,
        y: 180,
        width: 300,
        height: 180,
        metadata: { status: "idle", generationMode: "text", prompt: "" },
      },
    ],
    [{ id: "source-target", from: "source-node", to: "target-node" }]
  );
  firstSnapshot.future_extension = { preserve: "root-sentinel" };
  await saveSnapshot(page.request, session.token, first.id, firstSnapshot);
  await saveSnapshot(
    page.request,
    session.token,
    second.id,
    canvasSnapshot([])
  );
  await seedBrowserAuth(page, session);
  await installPointerCaptureAudit(page);

  await page.goto(`/canvas/${first.id}?scope=personal`);
  await expect(
    page.getByText(first.title, { exact: true }).first()
  ).toBeVisible();
  const stage = page.locator(".real-canvas-stage");
  const sourceNode = page.locator(
    '.real-canvas-node[data-node-id="source-node"]'
  );
  const targetNode = page.locator(
    '.real-canvas-node[data-node-id="target-node"]'
  );
  await expect(sourceNode).toBeVisible();
  await expect(targetNode).toBeVisible();
  await expect(stage.locator("[data-canvas-ui]")).not.toHaveCount(0);
  await expect(
    sourceNode.locator(
      '.canvas-connection-handle.source[aria-label="从此节点连接"]'
    )
  ).toHaveCount(1);
  await expect(
    sourceNode.locator(
      '.canvas-connection-handle.target[aria-label="连接到此节点"]'
    )
  ).toHaveCount(1);

  const box = await sourceNode.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error("source node has no bounding box");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width * 0.5 + 72,
    box.y + box.height * 0.75 + 36,
    { steps: 8 }
  );
  await page.mouse.up();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __e2ePointerCaptures: string[] })
          .__e2ePointerCaptures
    )
  ).toContain("source-node");

  await targetNode.click();
  const mentionEditor = page.locator(
    ".canvas-floating-inspector .canvas-mention-editor"
  );
  await expect(mentionEditor).toBeVisible();
  const textarea = mentionEditor.locator("textarea");
  await textarea.fill("@");
  const sourceMention = page.locator(
    ".canvas-mention-menu .canvas-mention-item",
    { hasText: "Reference source" }
  );
  await expect(sourceMention).toBeVisible();
  await sourceMention.click();
  await expect(textarea).not.toHaveValue(/source-node/);
  await expect(textarea).toHaveValue(/Reference source/);
  await expect(
    mentionEditor.locator(".canvas-mention-overlay .reference")
  ).toHaveCount(1);
  await expect(mentionEditor.locator(".mention-chip-thumb")).toBeVisible();

  await page.locator(".canvas-switcher-trigger").click();
  await page
    .locator(".canvas-switcher-item", { hasText: second.title })
    .click();
  await expectLocation(page, `/canvas/${second.id}`, "?scope=personal", "");

  await expect
    .poll(async () => {
      const saved = await loadSnapshot(page.request, session.token, first.id);
      const moved = saved.data.nodes.find(node => node.id === "source-node");
      const mentioned = saved.data.nodes.find(
        node => node.id === "target-node"
      );
      return {
        moved: Boolean(moved && moved.x > 140),
        mention:
          typeof mentioned?.metadata?.prompt === "string"
            ? mentioned.metadata.prompt.trim()
            : undefined,
        root: saved.data.future_extension?.preserve,
        metadata: (
          moved?.metadata?.futureMetadata as Record<string, unknown> | undefined
        )?.preserve,
        edges: saved.data.edges.length,
        connections: saved.data.connections.length,
      };
    })
    .toEqual({
      moved: true,
      mention: "@[node:source-node]",
      root: "root-sentinel",
      metadata: "metadata-sentinel",
      edges: 1,
      connections: 1,
    });

  await page.locator(".canvas-switcher-trigger").click();
  await page.locator(".canvas-switcher-item", { hasText: first.title }).click();
  await expectLocation(page, `/canvas/${first.id}`, "?scope=personal", "");
  await page.reload();
  await page.locator('.real-canvas-node[data-node-id="target-node"]').click();
  const restoredMention = page.locator(
    ".canvas-floating-inspector .canvas-mention-editor"
  );
  await expect(restoredMention.locator("textarea")).not.toHaveValue(
    /source-node/
  );
  await expect(restoredMention.locator("textarea")).toHaveValue(
    /Reference source/
  );
  await expect(
    restoredMention.locator(".canvas-mention-overlay .reference")
  ).toHaveCount(1);
});

test("dropping media creates a real asset and reuses then revokes the Canvas object URL", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const session = await login(page.request);
  const project = await createProject(
    page.request,
    session.token,
    `Canvas media ${Date.now()}`,
    {}
  );
  await saveSnapshot(
    page.request,
    session.token,
    project.id,
    canvasSnapshot([])
  );
  await seedBrowserAuth(page, session);
  await installObjectUrlAudit(page);
  await page.goto(`/canvas/${project.id}?scope=personal`);
  const stage = page.locator(".real-canvas-stage");
  await expect(stage).toBeVisible();

  const uploaded = page.waitForResponse(
    response =>
      response.request().method() === "POST" &&
      /\/api\/assets\?scope=personal$/.test(response.url())
  );
  await stage.evaluate((element, encodedPng) => {
    const bytes = Uint8Array.from(atob(encodedPng), value =>
      value.charCodeAt(0)
    );
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "drag-baseline.png", { type: "image/png" })
    );
    element.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      })
    );
    element.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      })
    );
  }, pngBase64);
  expect((await uploaded).ok()).toBeTruthy();

  const mediaNode = page.locator(
    '.real-canvas-node.image:has(img[alt="drag-baseline.png"])'
  );
  await expect(mediaNode).toBeVisible();
  const image = mediaNode.locator("img");
  const initialSrc = await image.getAttribute("src");
  expect(initialSrc).toMatch(/^blob:/);
  await mediaNode.click();
  await expect(image).toHaveAttribute("src", initialSrc || "");
  await page.waitForTimeout(400);
  expect(await image.getAttribute("src")).toBe(initialSrc);

  const beforeLeave = await page.evaluate(
    () =>
      (
        window as unknown as {
          __e2eObjectUrls: { created: string[]; revoked: string[] };
        }
      ).__e2eObjectUrls
  );
  expect(beforeLeave.created.filter(url => url === initialSrc)).toHaveLength(1);
  expect(beforeLeave.revoked).not.toContain(initialSrc);

  await page.getByRole("button", { name: "返回首页" }).click();
  await expectLocation(page, "/dashboard", "", "");
  await expect
    .poll(async () =>
      page.evaluate(
        url =>
          (
            window as unknown as {
              __e2eObjectUrls: { revoked: string[] };
            }
          ).__e2eObjectUrls.revoked.includes(url),
        initialSrc
      )
    )
    .toBeTruthy();
});

test("a recovered Canvas job can be canceled from the UI and becomes retryable", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const session = await login(page.request);
  const prompt = `e2e-characterization-slow UI cancellation ${randomUUID()}`;
  const pending = await unwrap<Job>(
    await page.request.post(apiUrl("/api/ai/images/generations"), {
      headers: authHeaders(session.token),
      data: { model: E2E_IMAGE_MODEL, prompt, size: "1024x1024", n: 1 },
    }),
    "UI cancellation generation"
  );
  const jobId = pending.job_id || pending.id || "";
  expect(jobId).not.toBe("");
  const project = await createProject(
    page.request,
    session.token,
    `Canvas cancel ${Date.now()}`,
    {}
  );
  await saveSnapshot(
    page.request,
    session.token,
    project.id,
    canvasSnapshot([
      {
        id: "cancel-node",
        kind: "image",
        title: "Cancel this image",
        content: prompt,
        x: 180,
        y: 150,
        width: 320,
        height: 238,
        metadata: {
          status: "loading",
          jobId,
          prompt,
          model: E2E_IMAGE_MODEL,
          generationMode: "image",
        },
      },
    ])
  );
  await seedBrowserAuth(page, session);
  await page.goto(`/canvas/${project.id}?scope=personal`);

  const node = page.locator('.real-canvas-node[data-node-id="cancel-node"]');
  await expect(node).toBeVisible();
  await node.dispatchEvent("click");
  const cancel = page.locator(
    '.canvas-floating-inspector .node-send-cancel[title="取消任务"]'
  );
  await expect(cancel).toBeVisible();
  const canceled = page.waitForResponse(
    response =>
      response.request().method() === "POST" &&
      response.url().includes(`/api/jobs/${jobId}/cancel`)
  );
  await cancel.click();
  expect((await canceled).ok()).toBeTruthy();
  await expect(
    page.locator(".canvas-floating-inspector .node-send-button", {
      hasText: "重试",
    })
  ).toBeVisible();
  await expect
    .poll(
      async () => (await fetchJob(page.request, session.token, jobId)).status
    )
    .toBe("canceled");
});

test("Director bridge is same-origin and reaches its connected state", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const session = await login(page.request);
  const project = await createProject(
    page.request,
    session.token,
    `Director bridge ${Date.now()}`,
    {}
  );
  await saveSnapshot(
    page.request,
    session.token,
    project.id,
    canvasSnapshot([])
  );
  await seedBrowserAuth(page, session);
  const returnTo = `/canvas/${project.id}?scope=personal`;
  await page.goto(
    `/director?canvasId=${project.id}&nodeId=director-node&instanceId=director-e2e&scope=personal&returnTo=${encodeURIComponent(returnTo)}`
  );

  const iframe = page.locator('iframe[title="3D 导演台"]');
  await expect(iframe).toBeVisible();
  const src = await iframe.getAttribute("src");
  const iframeUrl = new URL(src || "", page.url());
  expect(iframeUrl.pathname).toBe("/director-desk/index.html");
  expect(iframeUrl.origin).toBe(new URL(page.url()).origin);
  await expect(iframe.contentFrame().locator("#root")).not.toBeEmpty();
  await expect(page.getByText("已连接", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await dismissReleaseNotes(page);
  await expect(page.getByRole("button", { name: /保存当前帧/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /保存并返回画布|送入画布/ })
  ).toBeVisible();
});

test("local Canvas Agent bridge handshake runs when an Agent endpoint is supplied", async ({
  page,
}) => {
  const agentUrl = process.env.E2E_CANVAS_AGENT_URL;
  const agentToken = process.env.E2E_CANVAS_AGENT_TOKEN;
  test.skip(
    !agentUrl || !agentToken,
    "default E2E Compose does not start apps/canvas-agent"
  );
  const session = await login(page.request);
  const project = await createProject(
    page.request,
    session.token,
    `Local Agent ${Date.now()}`,
    {}
  );
  await saveSnapshot(
    page.request,
    session.token,
    project.id,
    canvasSnapshot([])
  );
  await seedBrowserAuth(page, session);
  await page.addInitScript(
    ({ url, token }) => {
      localStorage.setItem("canvas-agent-url", url);
      localStorage.setItem("canvas-agent-token", token);
    },
    { url: agentUrl || "", token: agentToken || "" }
  );
  await page.goto(`/canvas/${project.id}?scope=personal`);
  await page.getByTitle("画布对话 Agent（本机桥接）").click();
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /连接本地Agent/ }).click();
  await page.getByTitle("设置").click();
  await expect(page.locator(".agent-panel")).toContainText("已连接", {
    timeout: 30_000,
  });
});

function canvasSnapshot(
  nodes: CanvasNode[],
  edges: Array<{ id: string; from: string; to: string }> = []
): CanvasSnapshot {
  return {
    schema: "ai-manhua-studio-canvas",
    version: 3,
    nodes,
    edges,
    connections: edges.map(edge => ({ ...edge })),
    groups: [],
    viewport: { x: 0, y: 0, k: 1 },
    zoom: 100,
    panX: 0,
    panY: 0,
  };
}

async function loadSnapshot(
  request: APIRequestContext,
  token: string,
  projectId: string
) {
  return unwrap<SnapshotEnvelope>(
    await request.get(
      apiUrl(`/api/projects/${projectId}/snapshot?scope=personal`),
      {
        headers: authHeaders(token),
      }
    ),
    `load snapshot ${projectId}`
  );
}

async function createMemberSession(
  request: APIRequestContext,
  adminToken: string
): Promise<Session> {
  const account = `e2e_member_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const password = "member-password-123";
  await unwrap(
    await request.post(apiUrl("/api/admin/users"), {
      headers: authHeaders(adminToken),
      data: {
        username: account,
        display_name: "E2E Member",
        role: "member",
        status: "active",
        password,
      },
    }),
    "create E2E member"
  );
  return unwrap<Session>(
    await request.post(apiUrl("/api/auth/login"), {
      data: { account, password },
    }),
    "member login"
  );
}

async function expectLocation(
  page: Page,
  pathname: string,
  search: string,
  hash: string
) {
  await expect
    .poll(() => {
      const url = new URL(page.url());
      return { pathname: url.pathname, search: url.search, hash: url.hash };
    })
    .toEqual({ pathname, search, hash });
}

async function dismissReleaseNotes(page: Page) {
  const dialog = page.getByRole("dialog", { name: /版本 .* 已上线/ });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: "知道了" }).click();
  }
}

async function installPointerCaptureAudit(page: Page) {
  await page.addInitScript(() => {
    const captures: string[] = [];
    Object.defineProperty(window, "__e2ePointerCaptures", {
      configurable: true,
      value: captures,
    });
    const original = Element.prototype.setPointerCapture;
    Element.prototype.setPointerCapture = function setPointerCapture(
      pointerId: number
    ) {
      const nodeId =
        (this as HTMLElement)
          .closest?.(".real-canvas-node")
          ?.getAttribute("data-node-id") || this.nodeName;
      captures.push(nodeId);
      return original.call(this, pointerId);
    };
  });
}

async function installObjectUrlAudit(page: Page) {
  await page.addInitScript(() => {
    const audit = { created: [] as string[], revoked: [] as string[] };
    Object.defineProperty(window, "__e2eObjectUrls", {
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
