# 页面加载动画居中验收

## 修改范围

- 根因：公共页面加载容器使用 `min-height: 50vh`，只在半屏高的区域内居中。
- 改为填满当前布局的剩余内容区；自动扣除顶栏、移动端导航和公告栏实际占用的高度。
- 仅加载中临时使用纵向弹性布局，页面加载完成后恢复原布局，不改各页面业务逻辑。
- 画布在功能样式尚未加载时也使用完整画布宽度；无外层布局的路由保留全屏居中。
- 未更改接口、鉴权、积分、数据或生成请求；未提交、未推送；未重启共享服务。

生产文件：`PageLoader.css`、`AppRouter.tsx`。

## 浏览器验收

运行已存在的 `http://127.0.0.1:3100`，使用独立 Playwright 配置；模拟全部业务 API，没有执行付费生成或写入真实业务数据。为隔离路由加载过程，仅在测试浏览器内暂停目标路由的动态导入，不阻塞导航壳依赖的公共导出。

```text
pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio exec playwright test --config e2e/playwright.loading-layout.config.ts

9 passed (10.4s)
```

覆盖：

- 标签库 1920x1080、390x844。
- 提示词库 1280x900，包含公告栏。
- 技能库 1280x900，折叠侧栏。
- 设置页 900x900，窄屏布局。
- 画布 1280x900、390x844。
- 独立模型管理页的全屏加载状态。
- 已加载设置页切换到标签库加载状态，再切回设置页，导航可用且页面布局恢复。
- 上述七种内容区场景再缩小窗口高度 180px，重新验证居中。

每项验证加载区四边与实际内容区一致、标志与文字整体中心偏差小于 2px、标志图片实际加载成功。人工核看桌面和手机截图，未见居中偏差。

截图位于 `test-results/loading-layout/*/loading-centered.png`；无布局页面截图为 `standalone-loading.png`。

## 项目检查

以下为本轮实际输出摘要，命令均退出 0。

### Studio

```text
pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio check
$ tsc --noEmit

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio test
Test Files  223 passed (223)
     Tests  1613 passed (1613)
  Duration  21.95s

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio build
vite v7.3.6 building client environment for production...
2972 modules transformed.
built in 10.16s
```

新增路由回归用例验证无布局页面不使用局部加载容器；原有加载期间导航及异常恢复测试全部通过。

### API

使用本机已有 Go：`.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe`，工作目录 `apps/api`。

```text
go build ./...   (退出 0，无输出)
go vet ./...     (退出 0，无输出)
go test ./...
ok github.com/ai-manju/api/cmd/asset-export-worker (cached)
ok github.com/ai-manju/api/internal/assetmigration (cached)
ok github.com/ai-manju/api/internal/config (cached)
ok github.com/ai-manju/api/internal/handler (cached)
ok github.com/ai-manju/api/internal/middleware (cached)
ok github.com/ai-manju/api/internal/monitoring (cached)
ok github.com/ai-manju/api/internal/provider (cached)
ok github.com/ai-manju/api/internal/providerhub (cached)
ok github.com/ai-manju/api/internal/providerpresetmigration (cached)
ok github.com/ai-manju/api/internal/queue (cached)
ok github.com/ai-manju/api/internal/repository (cached)
ok github.com/ai-manju/api/internal/router (cached)
ok github.com/ai-manju/api/internal/sdvideo (cached)
ok github.com/ai-manju/api/internal/service (cached)
ok github.com/ai-manju/api/internal/storage (cached)
ok github.com/ai-manju/api/internal/tagmigration (cached)
```

### Agent 和 Director Desk

```text
pnpm --config.verify-deps-before-run=warn --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --config.verify-deps-before-run=warn --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  689 passed (689)
  Duration  149.04s
```

### Worker

使用现有镜像 `ai-manju-worker-monitoring:20260923`，只读挂载当前 `apps/worker` 到 `/app`，Python 缓存输出到容器临时目录。

```text
python -m compileall worker
Listing 'worker'...
Compiling 'worker/__init__.py'...
...
Compiling 'worker/video_references.py'...

python -m unittest discover -s tests
Ran 131 tests in 2.134s
OK (skipped=9)
```

## 非阻塞提醒

- pnpm 提示已安装依赖与锁文件不同步，使用 `verify-deps-before-run=warn` 运行已有环境，未安装依赖、未改锁文件。
- 构建仍提示大体积 chunk 和 assets 模块同时静态/动态导入。本次没有修改打包策略。
- Worker 的 9 项跳过保留，未声称这些跳过用例已验证。
