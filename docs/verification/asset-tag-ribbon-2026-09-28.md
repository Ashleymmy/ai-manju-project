# 资产库分类标签 C 方案验收

状态：本地实现、测试与截图核对完成；未提交、未推送、未部署。

## 本次范围

- 用户选择 C「紧凑标签带」，替换上一版多级树形展示。
- 一级标签紧凑排列，名称点击高亮，再次点击取消；不使用勾选框。
- 独立箭头在下方展开子标签；路径导航可返回上级，浏览层级不改变筛选条件。
- 已选标签保留完整路径，支持跨分类多选、单项移除、清空、交集/并集。
- 保留名称/路径/别名搜索、全量分页加载、包含后代的 API 筛选语义。
- 根据用户追加截图意见，分类标签始终展开，删除右上角整体折叠按钮及对应状态；保留每个标签的子级展开箭头。
- 继承上一轮非资产祖先仅作为上下文、批量绑定只允许资产标签的处理。本轮无后端或数据迁移改动。

主要实现：`AssetTagFilter.tsx`、`AssetTagFilter.css`、`assetTagTree.ts`，及对应单元测试与 `asset-tag-hierarchy.spec.ts`。
此前树形设计记录见 `asset-tag-hierarchy-2026-09-27.md`；当前界面以本报告为准。

## 验证结果

所有命令均在现有工作区运行。pnpm 使用 `--config.verify-deps-before-run=warn`，未重装依赖或修改锁文件。
以下为实际输出摘录；命令退出码均为 0。

### Studio

`pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio check`

```text
$ tsc --noEmit
```

`pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio test`

```text
Test Files  227 passed (227)
     Tests  1652 passed (1652)
  Start at  14:59:39
  Duration  10.59s
```

`pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio build`

```text
vite v6.4.3 building for production...
✓ 2294 modules transformed.
✓ built in 3.85s
vite v7.3.6 building client environment for production...
✓ 2977 modules transformed.
✓ built in 6.41s
```

保留现有依赖与锁文件不同步、pnpm.overrides 读取规则、产物大于 500 kB、assets 模块静态/动态导入同时存在的警告，未扩大任务修改构建配置。

### 浏览器

`pnpm --config.verify-deps-before-run=warn exec playwright test --config apps/studio/e2e/playwright.asset-tags.config.ts`

```text
Running 11 tests using 1 worker
11 passed (31.9s)
```

使用 124 条模拟标签、跨页加载、四级从属关系、同名标签和长名称覆盖：浏览与筛选分离、键盘操作、父级包含后代、搜索恢复、关闭子级后的焦点返回，以及始终展开且没有整体折叠按钮。包含 4 项既有资产批量编辑回归。

1600px、390px、320px 布局边界检查与截图通过；已人工查看最新 `panel-1600.png`、`panel-390.png`、`panel-320.png`，确认标题、控件及长名称未互相遮挡，整体折叠按钮已移除。截图目录：`D:/AImanju4.0/.tmp/asset-tag-ribbon-qa`。

浏览器请求采用隔离模拟数据，不修改用户资产，不代表生产环境验收。

### API

在 `apps/api` 使用现有本地 Go：`.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe`。
分别执行 `go build ./...`、`go vet ./...`、`go test ./...`；前两项无输出，均退出 0；测试包全部通过或标记无测试文件。输出摘录：

```text
ok  github.com/ai-manju/api/internal/handler       (cached)
ok  github.com/ai-manju/api/internal/middleware    (cached)
ok  github.com/ai-manju/api/internal/monitoring    (cached)
ok  github.com/ai-manju/api/internal/repository    (cached)
ok  github.com/ai-manju/api/internal/router        (cached)
ok  github.com/ai-manju/api/internal/tagmigration  (cached)
```

### Canvas Agent 与 Director Desk

`pnpm --config.verify-deps-before-run=warn --filter @basketikun/canvas-agent test`

```text
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

`pnpm --config.verify-deps-before-run=warn --filter @ai-manju/director-desk test`

```text
Test Files  87 passed (87)
     Tests  689 passed (689)
  Duration  92.17s
```

### Worker

现有镜像 `ai-manju-worker-monitoring:20260923` 只读挂载 `apps/worker`，设置 `PYTHONPYCACHEPREFIX=/tmp/pycache`，分别执行 `python -m compileall worker`、`python -m unittest discover -s tests`。

```text
Listing 'worker'...
Compiling 'worker/__init__.py'...
Compiling 'worker/video_references.py'...
Ran 131 tests in 2.146s
OK (skipped=9)
```

### 工作区

`git diff --check` 退出 0，只有 AssetsPage.tsx 的既有 CRLF/LF 提示。其他未提交修改保留原状。
复用现有 `http://localhost:3100/assets`，没有重启服务或部署线上。
此前线上创建标签的 409 约束原因仍未确认，本次界面改动不宣称修复该错误。
