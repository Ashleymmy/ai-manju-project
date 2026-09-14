# 新建漫剧资产项目弹窗验收（2026-09-11）

## 修改结果

- 模型选择与首轮分析要求改为独立分区，保持页面的暗色风格。下拉菜单使用暗色组件，增加刷新、加载中、空目录及请求失败提示。
- 删除弹窗写死的三个模型选项。通过现有 `useComicTextModelsQuery` 获取 `/api/ai/models` 的文本模型目录，只显示模型名，同模型跨供应商合并展示，提交时保留后台路由标识。
- 仅在接口返回 `gpt-5.6-luna` 时优先选择它，否则选择接口目录的默认模型；模型目录未就绪时不能提交剧本分析。
- 原确认操作只有模拟进度，最终总是创建空项目。现改为调用现有 `analyzeComicSource`：上传剧本使用所选模型创建真实分析会话并展示候选资产，上传 XLSX 执行实际导入，只有明确选择空项目模式才创建空项目。
- 移除写死的耗时、百分比、文件信息；处理时显示实际文件名和所选模型。失败保留输入，处理期间禁止重复提交、关闭弹窗及替换文件。
- 本轮不涉及 API、Worker 或仓库实现的业务修改，沿用已有模型重试和供应商切换实现。

## 专项验证

新增弹窗集成测试覆盖真实目录数据的传递、同模型去重、实际模型切换、真实分析结果预览、加载/空列表/失败禁用、失败保留草稿、显式空项目创建及无模型时 XLSX 导入。

```text
✓ src/features/comic/controllers/source.test.ts (3 tests) 4ms
✓ src/features/comic/ui/ComicCreateDialog.test.tsx (7 tests) 413ms
Test Files  2 passed (2)
     Tests  10 passed (10)
```

浏览器使用真实组件的临时隔离预览检查暗色菜单、选中项、输入框、字数显示和页脚按钮。预览加载与应用一致的全局及布局样式；临时页面已关闭，两个预览文件已删除。

目录响应和分析结果在自动测试与隔离预览中使用明确的测试数据。本轮未登录管理账户、未读取经过认证的在线目录，也未发起付费模型调用；因此供应商当前能否成功生成不属于本次实测结论。

## 项目要求的完整检查

所有命令退出码为 0。完整日志保存在 `.codex-logs/comic-create-*.log`，下列为实际输出节选。

### Studio

执行 `pnpm --filter ai-manhua-studio check`、`test`、`build`：

```text
> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit

Test Files  114 passed (114)
     Tests  560 passed (560)
  Start at  17:50:36
  Duration  5.54s (transform 13.20s, setup 0ms, collect 36.22s, tests 3.30s, environment 12.51s, prepare 11.94s)

✓ 2293 modules transformed.
✓ built in 4.86s
✓ 2052 modules transformed.
✓ built in 2.65s
```

构建包含 Director Desk 依赖构建；其既有大包体积提示仍存在，无构建错误。

### API

使用 Go 1.23 临时容器、只读源码挂载，执行 `go build ./... && go vet ./... && go test ./...`：

```text
ok  github.com/ai-manju/api/internal/assetmigration          0.003s
ok  github.com/ai-manju/api/internal/config                  0.002s
ok  github.com/ai-manju/api/internal/handler                10.949s
ok  github.com/ai-manju/api/internal/middleware              0.009s
ok  github.com/ai-manju/api/internal/provider                0.009s
ok  github.com/ai-manju/api/internal/providerpresetmigration 0.004s
ok  github.com/ai-manju/api/internal/queue                   0.003s
ok  github.com/ai-manju/api/internal/repository              0.005s
ok  github.com/ai-manju/api/internal/router                  0.288s
ok  github.com/ai-manju/api/internal/service                 0.110s
ok  github.com/ai-manju/api/internal/tagmigration            0.005s
```

### Canvas Agent

执行 `pnpm --filter @basketikun/canvas-agent test`：

```text
✔ shared tool definitions and local validators stay aligned (1.9655ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ skipped 0
```

### Director Desk

执行 `pnpm --filter @ai-manju/director-desk test`：

```text
Test Files  87 passed (87)
     Tests  686 passed (686)
  Start at  17:41:49
  Duration  139.92s (transform 1.43s, setup 15.33s, import 8.53s, tests 37.20s, environment 65.30s)
```

### Worker

使用现有 Worker 镜像与只读源码挂载，执行 `python -m compileall worker && python -m unittest discover -s tests`：

```text
Compiling 'worker/tasks.py'...
Compiling 'worker/video.py'...
......................................s........................
----------------------------------------------------------------------
Ran 63 tests in 0.073s

OK (skipped=1)
```

保留既有 Redis 集成测试跳过条件。

### 工作区与服务

`git diff --check` 通过。临时预览文件不存在。健康检查实际结果：

```json
{"url":"http://127.0.0.1:3101/health","status":200}
{"url":"http://127.0.0.1:8101/health","status":200}
{"url":"http://127.0.0.1:3100/comic-assets","status":200}
```
