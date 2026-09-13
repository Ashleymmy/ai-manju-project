# 画布模型菜单关闭行为验收（2026-09-11）

## 修复

画布节点和拖拽逻辑会停止指针事件冒泡，原模型 Popover 的外部点击监听因此可能收不到事件；原模型选项也没有主动关闭菜单。

将检查器里的模型菜单提取为 `CanvasModelPicker`，保留原样式与模型数据，改用受控打开状态。菜单打开期间在文档捕获阶段监听外部指针和点击，不阻止画布原操作。点模型按钮开关、点菜单外关闭、选中任意模型后关闭；支持 Escape。外部点击关闭时不抢回提示词输入焦点。隐藏检查器或切换节点时清理菜单及监听。

本轮改动仅涉及前端菜单交互，没有修改模型路由、供应商策略、后端接口或仓库行为。

## 行为回归

使用真实 Popover 组件的 jsdom 测试覆盖 8 个场景：鼠标/触摸第一次外部按下（包含停止冒泡的画布事件）、仅 click 的工具栏操作、外部输入框焦点、选择当前/其他模型、按钮切换与 Escape、隐藏面板及切换节点。

```text
✓ src/features/canvas/ui/CanvasModelPicker.test.tsx (8 tests) 364ms
```

## 完整项目检查

以下命令均退出 0。完整日志见 `.codex-logs/canvas-model-dismiss-*.log`。

Studio：`pnpm --filter ai-manhua-studio check`、`test`、`build`。

```text
> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit

Test Files  115 passed (115)
     Tests  568 passed (568)
  Start at  18:02:45
  Duration  5.51s (transform 14.97s, setup 0ms, collect 38.85s, tests 3.74s, environment 16.38s, prepare 12.68s)

✓ 2293 modules transformed.
✓ built in 4.02s
✓ 2053 modules transformed.
✓ built in 2.74s
```

依赖构建仍有既有包体积提示，无构建错误。

API：Go 1.23 临时容器只读挂载源码，执行 `go build ./... && go vet ./... && go test ./...`。

```text
ok  github.com/ai-manju/api/internal/assetmigration          0.003s
ok  github.com/ai-manju/api/internal/config                  0.002s
ok  github.com/ai-manju/api/internal/handler                11.395s
ok  github.com/ai-manju/api/internal/middleware              0.009s
ok  github.com/ai-manju/api/internal/provider                0.010s
ok  github.com/ai-manju/api/internal/providerpresetmigration 0.004s
ok  github.com/ai-manju/api/internal/queue                   0.003s
ok  github.com/ai-manju/api/internal/repository              0.005s
ok  github.com/ai-manju/api/internal/router                  0.291s
ok  github.com/ai-manju/api/internal/service                 0.114s
ok  github.com/ai-manju/api/internal/tagmigration            0.004s
```

Canvas Agent：`pnpm --filter @basketikun/canvas-agent test`。

```text
✔ shared tool definitions and local validators stay aligned (9.2712ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ skipped 0
```

Director Desk：`pnpm --filter @ai-manju/director-desk test`。

```text
Test Files  87 passed (87)
     Tests  686 passed (686)
  Start at  17:59:28
  Duration  89.73s (transform 1.01s, setup 8.26s, import 5.27s, tests 30.27s, environment 37.96s)
```

Worker：现有镜像只读挂载源码，执行 `python -m compileall worker && python -m unittest discover -s tests`。

```text
Compiling 'worker/tasks.py'...
Compiling 'worker/video.py'...
......................................s........................
----------------------------------------------------------------------
Ran 63 tests in 0.076s

OK (skipped=1)
```

跳过项为需要 `REDIS_TEST_URL` 的既有 Redis 集成测试。

修改文件的 `git diff --check` 通过；本地 Studio 返回 HTTP 200。本轮交互验证采用组件测试，没有操作用户画布或发起模型生成。
