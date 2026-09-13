# 右侧画布助手模型选择验收

日期：2026-09-11

## 修改结果

- 右侧 AgentPanel 与左侧节点选择器复用同一套模型名称和去重函数。
- 当前模型按钮、“精选推荐”、“更多模型”均只显示模型名，删除供应商副标题及其样式。不同供应商的同一模型只出现一次，默认仍优先 gpt-5.6-luna。
- 保留实际请求中的供应商限定模型值和已选中状态。旧供应商已移除，但目录仍有其他供应商的同一模型时，允许将原选择交给后台恢复；整个模型都不存在时仍保留原提示词并报不可用，不擅自替换其他模型。
- 右侧在线对话通过现有 `requestAiText → /api/ai/text` 使用后台静默重试：同一模型每家兼容供应商最多三次，成功即停止，全部失败后仅显示一次最终错误。
- 保留上一轮的文本等待策略：每次上游文本请求至少 5 分钟；前端不再用普通请求的 15 秒时限截断整个序列，仍支持主动取消。
- 补充后台工具能力检查：带画布工具的请求，在切换供应商时跳过不支持工具调用的接口，并保持模型、工具定义和 tool_choice 不变。
- 不修改左右面板的整体布局和其他画布功能。

供应商选择使用共用 Handler，Memory/Gorm 两种存储沿用相同逻辑，无仓库结构或数据库迁移变更。

## 验证命令和实际输出

API（Go 1.23 容器）：`go build ./... && go vet ./... && go test ./...`，退出码 0。构建和 vet 无错误输出，测试摘录：

```text
ok  github.com/ai-manju/api/internal/handler 10.641s
ok  github.com/ai-manju/api/internal/middleware 0.010s
ok  github.com/ai-manju/api/internal/provider 0.012s
ok  github.com/ai-manju/api/internal/queue 0.003s
ok  github.com/ai-manju/api/internal/repository 0.006s
ok  github.com/ai-manju/api/internal/router 0.293s
ok  github.com/ai-manju/api/internal/service 0.120s
```

新增 Agent 回归验证 A/A/A/B 的实际本地 HTTP 请求顺序，跳过不支持工具的候选，B 成功后返回真实 canvas_get_state 工具调用，并验证等待时间没有缩短。

Studio：`pnpm --filter ai-manhua-studio check`、`test`、`build` 均通过：

```text
> tsc --noEmit
Test Files 111 passed (111)
Tests 543 passed (543)
✓ built in 2.73s
```

AgentPanel 组件测试实际展开推荐和更多模型菜单，检查供应商文字不出现、同名项去重、选择高亮、Luna 默认、旧供应商交接，以及等待期间无提前错误、最终只显示一次错误。原有类型、模块边界、请求等待与取消检查继续通过。构建保留既有 Director Desk 大资源包提示。

Canvas Agent / Director Desk：

```text
pnpm --filter @basketikun/canvas-agent test
ℹ tests 1
ℹ pass 1
ℹ fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 686 passed (686)
Duration 92.43s
```

Worker：`python -m compileall worker && python -m unittest discover -s tests`，退出码 0：

```text
Ran 59 tests in 0.054s
OK (skipped=1)
```

一项依赖 REDIS_TEST_URL 的既有 Redis 集成测试保持跳过。供应商响应使用本地测试服务，没有发起真实收费模型生成。

`git diff --check` 通过，无输出。

## 本地生效状态

使用已安装的运行镜像装入新编译后端，仅更新 `ai-manju-40` 的 API。前端由正在运行的 Vite 服务加载新代码；Worker 保留已验证的运行版本。

```text
API: success=true, storage=postgres, db=ok
Worker: status=ok, db=ok
Studio http://127.0.0.1:3100: HTTP 200
```
