# 画布分组与节点工具栏修复验收

日期：2026-09-29。范围：点击分组显示分组操作；点击单个节点显示节点操作。未提交、未部署。

## 已复现的原因

1. 分组选中时仍保留第一个成员作为主节点。如果该成员来自导入，CanvasInspector 会将 `inspector-imported-node` 错加到分组面板；现有 CSS 对该类应用 `display: none !important`，导致整个分组操作栏被隐藏。
2. CanvasWorkspaceContent 只用主节点 ID 判断 `isSelectedSingle`，没有排除分组和多选，导致分组选择仍显示第一个成员的节点工具栏。
3. 单独选择组内靠上的节点时，其工具栏与分组标题重叠，妨碍再次点击标题选择分组。

## 修改

- CanvasInspector.tsx：只有独立节点面板才能套用导入节点的隐藏类和预览内容；分组面板独立于成员来源。
- CanvasWorkspaceContent.tsx：仅在没有选中分组、选中节点数为 1 且节点为主选中节点时显示节点工具栏。
- CanvasStage.tsx、styles.css：按实际分组标题边界避让节点工具栏，保留约 8 屏幕像素的间隙；缩放、成员移动及工具栏尺寸变化时重新计算。未修改圆角。
- CanvasGroupInspector.test.tsx：增加 5 项回归测试，覆盖图片、视频、音频、文本导入成员，以及分组与独立节点面板切换；验证分组颜色、批量执行、解散操作仍指向分组。

## 实际浏览器验证

本地登录页面：`http://localhost:3100/canvas/proj_4ef6e1850465272f?scope=personal`。

测试分组包含导入图片和生成图片节点。通过实际鼠标点击验证：

- 点击分组标题：显示分组名称、颜色、积分明细、批量执行分组、解散分组；节点工具栏数量为 0。
- 点击组内图片：分组面板数量为 0；节点工具栏数量为 1。
- 再次点击分组标题：恢复完整分组面板，节点工具栏消失。
- 67% 和 37% 缩放下，节点工具栏均位于分组标题上方，实际间隔约 8px；验证后恢复 67%。
- 页面完整刷新后再次验证上述切换，分组面板尺寸为约 822 × 60px，内容完整。
- 实测节点圆角 14px、分组圆角 10px、分组面板圆角 12px，保持原值。
- 实际浏览器只验证选择、缩放和布局，未提交生成、注册或解散指令；操作回调由单元测试验证。

截图与 DOM 测量：

- `output/group-toolbar/group-selected.png`
- `output/group-toolbar/node-selected.png`
- `output/group-toolbar/verification.json`

开发过程曾出现热更新后的画布尺寸观测为零，导致分组面板临时缩小。完整刷新后恢复正常，最终截图和验证数据均来自刷新后的实际页面。本次未修改画布尺寸观测生命周期。

## 验证命令与实际输出

完整日志：`.tmp/group-toolbar-20260929/`。本轮初次测试补齐报价组件隔离后，5 项新增测试在原始实现上均因导入节点隐藏类断言失败；修复后通过。报价组件使用 mock，测试不发出真实报价请求。

### Studio

执行 `pnpm --filter ai-manhua-studio check`、`test`、`build`，均退出 0。最后一次检查在所有代码修改完成后执行。

```text
> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit

Test Files  262 passed (262)
     Tests  2070 passed (2070)
  Duration  14.03s

✓ built in 6.84s
```

构建保留已有大于 500kB 的 chunk 提示。

### API

执行 `go build ./...`、`go vet ./...`、`go test ./...`，均退出 0。build/vet 无输出，测试输出节选：

```text
ok  github.com/ai-manju/api/internal/handler (cached)
ok  github.com/ai-manju/api/internal/provider (cached)
ok  github.com/ai-manju/api/internal/repository (cached)
ok  github.com/ai-manju/api/internal/router (cached)
```

### Canvas Agent / Director Desk

分别执行 `pnpm --filter @basketikun/canvas-agent test` 和 `pnpm --filter @ai-manju/director-desk test`，退出 0。

```text
ℹ tests 5
ℹ pass 5
ℹ fail 0
ℹ duration_ms 94.208

Test Files  87 passed (87)
     Tests  689 passed (689)
  Duration  86.98s
```

### Worker

在已有 Worker 镜像中只读挂载当前源码、关闭网络，执行 `python -m compileall worker` 和 `python -m unittest discover -s tests`，退出 0。

```text
Ran 275 tests in 4.157s
OK (skipped=27)
```

`git diff --check` 通过，无输出。未改动后端、Worker、公开接口、仓库实现或生成逻辑，其他已有未提交修改保留。
