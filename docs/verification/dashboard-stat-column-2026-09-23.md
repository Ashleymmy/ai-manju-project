# 工作台统计区竖向布局（2026-09-23）

用户要求：将工作台横向四项统计移动至截图蓝框位置，竖着排列。

## 本地修改

- 将“进行中任务 / 漫剧项目 / 可调用资产 / 画布项目”从整行横条移动至广告区右侧、积分面板左侧的独立一列。
- 四项上下分布，使用横向分隔线；广告、统计和积分面板顶部对齐，整体高度由内容撑开。
- 桌面为三列，1100px 及以下为广告和统计并排、积分另起一行；760px 及以下按单列排列，统计仍竖向分布。
- 保留真实数据读取、数字字号、大标题和所有现有按钮行为。仅修改 `features/dashboard/DashboardPage.tsx` 和 `features/dashboard/styles.css`。
- 没有提交、部署或重启共享服务。pnpm 自动删除的锁文件 overrides 已精确恢复。

## 页面验证

复用现有 `small-text-readability.spec.ts`，没有为纯布局新增持久化测试。测试使用隔离 Chrome 上下文并拦截业务 API，不写入真实项目。

```text
node node_modules/@playwright/test/cli.js test --config .tmp/dashboard-stat-column/playwright.config.ts
4 passed (27.6s)
```

1920×1080、1280×800、390×844 视口检查通过：统计和控件不截字，工作台没有横向溢出，大标题与数字字号保持原值；同时通过六个页面的已有显示回归和本地字体加载检查。

人工查看桌面、较窄桌面及手机截图，确认竖向排列与广告/积分的位置关系正确。

- 桌面截图：`.tmp/dashboard-stat-column/dashboard-desktop.png`
- 手机截图：`.tmp/dashboard-stat-column/dashboard-mobile.png`
- 各尺寸完整截图：`.tmp/dashboard-stat-column/after/`

## 项目规定检查：实际输出

完整日志位于 `.tmp/dashboard-stat-column/`。

Studio：`pnpm --filter ai-manhua-studio check`、`test`、`build` 均退出码 0。

```text
$ tsc --noEmit
Test Files  198 passed (198)
     Tests  1327 passed (1327)
  Duration  11.65s
✓ built in 4.94s
```

构建仍提示部分产物超过 500 kB，不影响构建成功。

API：使用已有本地 Go 与模块缓存，依次执行 `go build ./...`、`go vet ./...`、`go test ./...`，均退出码 0。

```text
ok github.com/ai-manju/api/internal/handler     17.039s
ok github.com/ai-manju/api/internal/repository  (cached)
ok github.com/ai-manju/api/internal/router       1.633s
ok github.com/ai-manju/api/internal/service     10.228s
ok github.com/ai-manju/api/internal/storage     (cached)
```

Canvas Agent：`pnpm --filter @basketikun/canvas-agent test`，退出码 0。

```text
tests 4
pass 4
fail 0
```

Director Desk：`pnpm --filter @ai-manju/director-desk test`，退出码 0。

```text
Test Files  87 passed (87)
     Tests  686 passed (686)
  Duration  141.50s
```

Worker：独立临时容器只读挂载源码，临时目录补齐 httpx，执行 `python -m compileall -q worker && python -m unittest discover -s tests`，退出码 0。

```text
Ran 105 tests in 2.205s
OK (skipped=1)
```

`git diff --check` 通过。
