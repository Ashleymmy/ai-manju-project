# /chat 模型选择统一验收

日期：2026-09-11

## 结果

- 剧本创作 `/chat` 页的模型按钮、下拉选项和悬停提示只显示真实模型名，隐藏供应商名称和自定义显示别名。
- 与画布节点、右侧助手复用同一组名称、模型去重及选择恢复函数。同名模型只显示一次，默认仍优先 gpt-5.6-luna。
- 界面去重时保留选中模型的完整标识；仅供应商移除、同一模型仍有其他供应商可用时，保持原模型选择，由后台恢复可用供应商。
- 已验证 `ChatPage → createChatProjectFlow → CanvasBootstrap → AgentPanel → requestAiText` 的模型交接。后续请求沿用现有后台静默重试：每家兼容供应商最多三次，成功即停止，全部失败后才通知；延长等待和主动取消行为沿用已修复的公共请求流程。
- 继续使用接口返回的 Agent 可用模型；加载、登录、空目录、获取失败与重试行为保留。未修改页面整体排版。

本轮仅修改 Studio 展示及共用函数导出，没有修改后端或 Worker，也没有更改两种仓库实现。

## 检查及实际输出

Studio：执行 `pnpm --filter ai-manhua-studio check`、`test`、`build`，退出码均为 0。

```text
> tsc --noEmit
Test Files 111 passed (111)
Tests 545 passed (545)
✓ built in 3.15s
```

ChatPage 的六项组件测试覆盖菜单与按钮名称、悬停提示、同名去重、默认供应商保留、Luna 默认、所选模型传入新画布、供应商移除后的同模型恢复，以及加载/空目录/错误/未登录状态。画布助手、项目创建交接、等待/取消和项目模块边界回归均通过。

API：在 Go 1.23 容器执行 `go build ./... && go vet ./... && go test ./...`，退出码 0；构建和 vet 无错误输出。测试摘录：

```text
ok  github.com/ai-manju/api/internal/handler 10.660s
ok  github.com/ai-manju/api/internal/middleware 0.011s
ok  github.com/ai-manju/api/internal/provider 0.012s
ok  github.com/ai-manju/api/internal/queue 0.004s
ok  github.com/ai-manju/api/internal/repository 0.006s
ok  github.com/ai-manju/api/internal/router 0.291s
ok  github.com/ai-manju/api/internal/service 0.126s
```

Canvas Agent / Director Desk：

```text
pnpm --filter @basketikun/canvas-agent test
ℹ tests 1
ℹ pass 1
ℹ fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 686 passed (686)
Duration 127.34s
```

Worker：在现有依赖镜像内执行 `python -m compileall worker && python -m unittest discover -s tests`，退出码 0。

```text
Ran 59 tests in 0.048s
OK (skipped=1)
```

一项既有 Redis 集成测试因未设置 REDIS_TEST_URL 保持跳过。构建保留既有 Director Desk 大资源包提示。供应商回归使用测试响应，没有调用真实收费模型。

`git diff --check` 通过，无输出。

## 本地运行

前端正在运行的 Vite 服务加载最新源码，刷新 `/chat` 即可使用。本轮无需重启后端。

```text
Chat http://127.0.0.1:3100/chat: HTTP 200
API: success=true, db=ok
Worker: status=ok, db=ok
```
