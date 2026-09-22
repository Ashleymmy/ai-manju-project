import { expect, test } from '@playwright/test';

for (const zoom of [100, 45, 25, 5]) {
  test(`group header stays attached and clear of member names at ${zoom}%`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const project = { id: 'group-responsive-qa', title: '分组工具栏验收', scope: 'personal', owner_id: 'qa' };
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let snapshot: any = {
      schema: 'ai-manhua-studio-canvas', version: 3,
      nodes: [
        { id: 'a', kind: 'image', title: '图一', content: '', x: 180, y: 260, width: 200, height: 180 },
        { id: 'b', kind: 'video', title: '视频节点名称', content: '', x: 650, y: 300, width: 200, height: 180 },
      ],
      groups: [{ id: 'group', title: '分组 2', nodeIds: ['a', 'b'], position: { x: 152, y: 214 }, width: 726, height: 294, color: '#7dd3fc' }],
      edges: [], zoom, panX: 300, panY: 350, viewport: { x: 300, y: 350, k: zoom / 100 },
    };
    await page.addInitScript(() => {
      localStorage.setItem('ai-manju:auth_token', 'qa-token');
      localStorage.setItem('ai-manju:token-store', 'local');
    });
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (!path.startsWith('/api/')) return route.continue();
      const headers = { 'Access-Control-Allow-Origin': new URL(page.url()).origin, 'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': 'authorization,content-type,x-request-id', 'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS' };
      if (request.method() === 'OPTIONS') return route.fulfill({ headers, status: 204 });
      if (request.headers().accept === 'text/event-stream') return route.fulfill({ headers, contentType: 'text/event-stream', body: ':ok\n\n' });
      let data: unknown = { items: [], total: 0 };
      if (path === '/api/auth/me') data = { id: 'qa', account: 'qa', role: 'super_admin', status: 'active' };
      else if (path === '/api/announcements/current') data = null;
      else if (path === '/api/user/preferences') data = { canvas: { promptPresets: [] } };
      else if (path === `/api/projects/${project.id}/snapshot`) {
        if (request.method() === 'PUT') snapshot = request.postDataJSON().data;
        data = { project_id: project.id, version: 1, data: snapshot };
      } else if (path === `/api/projects/${project.id}`) data = { ...project, data: snapshot };
      else if (path === '/api/projects') data = { items: [project], total: 1 };
      if (path === '/api/prompts') return route.fulfill({ headers, json: { items: [], total: 0 } });
      return route.fulfill({ headers, json: { success: true, data, request_id: 'group-qa' } });
    });
    await page.goto(`/canvas/${project.id}?scope=personal`);
    const header = page.locator('.canvas-group-header');
    await expect(header).toBeVisible();
    const closeInspector = page.getByRole('button', { name: '关闭面板', exact: true });
    if (await closeInspector.isVisible()) await closeInspector.click();
    await expect(page.locator('.canvas-bottom-tools b')).toHaveText(`${zoom}%`);
    const box = (await header.boundingBox())!;
    const screenScale = zoom < 45 ? zoom / 45 : 1;
    expect(box.height).toBeCloseTo(38 * screenScale, 0);
    const frame = (await page.locator('.canvas-group-frame').boundingBox())!;
    const gridTop = await page.locator('.real-canvas-grid').evaluate(element => element.getBoundingClientRect().top);
    // Header space must not move connection ports away from member geometry.
    for (const port of await page.locator('.canvas-group-connection-handle').all()) {
      const portBox = (await port.boundingBox())!;
      expect(portBox.y + portBox.height / 2).toBeCloseTo(gridTop + (214 + 294 / 2) * zoom / 100, 0);
    }
    expect(box.x).toBeCloseTo(frame.x, 0);
    expect(box.y).toBeCloseTo(frame.y, 0);
    expect(box.width).toBeCloseTo(frame.width, 0);
    for (const button of await header.locator('button').all()) {
      const buttonBox = (await button.boundingBox())!;
      expect(buttonBox.width).toBeCloseTo(28 * screenScale, 0);
      expect(buttonBox.height).toBeCloseTo(28 * screenScale, 0);
      expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(frame.x + frame.width);
    }
    for (const title of await page.locator('.real-canvas-node .node-float-label').all()) {
      const nodeTitle = (await title.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(nodeTitle.y);
    }
    await page.screenshot({ path: testInfo.outputPath(`group-${zoom}.png`) });
    await header.getByRole('button', { name: '解绑组', exact: true }).click();
    await expect(page.locator('.canvas-group-frame')).toHaveCount(0);
    await expect(page.locator('.real-canvas-node')).toHaveCount(2);
    expect(errors).toEqual([]);
  });
}
