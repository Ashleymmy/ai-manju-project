# 运行监控错误明细与用户隔离验收

## 范围

- 参考项目：<https://github.com/Wei-Shaw/sub2api>，参考其 OpsErrorLogTable、OpsErrorDetailModal 的筛选、趋势、错误分类和详情布局；未复制其实现。
- 后台 `/admin` 的“运行监控”改为真实查询；登录用户可从侧栏 `/monitoring` 查看自己的记录。
- 新增持久化 `runtime_errors`，汇总现存 AI 调用日志、异步任务最终状态、API HTTP 错误、Worker 每次失败尝试、浏览器异常。重试成功不会删除已经记录的失败尝试。
- 支持时间窗口与自定义历史时间、来源、状态、错误码、模型、关键词、分页、错误趋势、来源分布、详情、复制诊断及 CSV 全量筛选导出。
- 保存可用的请求、任务、项目、节点编号与耗时、尝试次数；没有原始信息的字段显示“未记录”，不编造诊断。

## 权限与安全

- 服务端强制绑定当前登录用户；member、ops_admin、auditor 只能查本人。伪造他人 user_id 返回 403，CSV 导出同样校验。
- 仅 super_admin 可以查询全局、指定用户和用户筛选列表。匿名请求不可查询；无登录身份的接口错误仅在全局记录中出现。
- 旧 `/api/admin/monitoring` 全局接口同步限制为超级管理员，移除未经身份归属处理的原始日志尾部，过滤超出窗口的旧请求。
- 前端查询缓存包含当前账号、角色及完整筛选范围；切换用户不沿用旧范围的明细。详情随范围切换关闭。
- 诊断脱敏：常见密钥、Bearer、密码、Cookie/token 字段、URL 用户信息及签名查询串、内嵌媒体；不收集请求体、完整提示词或图片内容。
- Worker 私有诊断及服务端 panic 栈仅超级管理员可见；普通用户的搜索在私有内容移除之后执行，不能通过搜索推测隐藏内容。
- CSV 对以 `= + - @` 开头的单元格做公式注入防护。
- 客户端上报限制 16 KiB、每账号每分钟 30 条，重复 ID 幂等；浏览器短时间同类异常去重，退出登录清理归属，不保存跨账号待发队列。
- 数据库异常不能替换原本的生成结果或阻断重试；诊断写入有超时，失败仅记录安全的写入失败标记。

## 统计口径与边界

- “错误记录”统计错误事件，包含失败尝试与最终失败，不等于去重后的失败任务数。
- 图表和概览统计当前时间、用户、来源、模型、错误码及关键词范围的全部状态；状态下拉仅筛选明细。
- 图片提交成功只是入队确认，不作为成功生成重复计数；生成结果以任务终态为准。
- 任务记录按完成时间（未完成按创建时间）；错误事件按发生时间。时间归一化为 UTC，前端以本地时间显示。
- 查询单次最多 30 天；超过 50,000 条基础记录明确要求缩短时间或选定用户，不静默截断总量。历史任意日期可分段查询。
- 之前已经被覆盖、未曾保存的重试细节无法恢复。新采集从更新后开始；历史 AI 日志和任务结果仍可查询。
- 浏览器完全离线、进程被强制终止或数据库不可用时，不能保证错误上报送达；本次没有新增可靠离线日志队列。未关联用户的 OS/容器原始日志不冒充用户错误。

## 实际验证

使用独立 PostgreSQL 容器 `runtime-monitoring-qa-20260923`（55441）与测试 API（3118），未在用户数据库中注入测试错误或生成任务，未调用收费模型。

### Go API

`go build ./...`、`go vet ./...`：退出码 0，无错误输出。

`go test ./...`：退出码 0，所有包含测试的包通过。关键实际输出：

```text
ok github.com/ai-manju/api/internal/handler
ok github.com/ai-manju/api/internal/middleware
ok github.com/ai-manju/api/internal/monitoring
ok github.com/ai-manju/api/internal/repository
ok github.com/ai-manju/api/internal/router
ok github.com/ai-manju/api/internal/service
```

独立数据库一致性测试实际输出：

```text
--- PASS: TestRuntimeMonitoringRepositoryParity (0.73s)
    --- PASS: TestRuntimeMonitoringRepositoryParity/memory (0.00s)
    --- PASS: TestRuntimeMonitoringRepositoryParity/postgres (0.73s)
PASS
```

覆盖用户越权、匿名查询、CSV 越权、客户端伪造身份、限流、脱敏、去重、panic、成功媒体响应不变、重复记录避免、历史时间过滤、跨时区趋势合计、85 条记录跨页查询及全页导出。

### Studio

`pnpm --filter ai-manhua-studio check`：`tsc --noEmit` 退出码 0。

`pnpm --filter ai-manhua-studio test` 实际输出：

```text
Test Files  209 passed (209)
     Tests  1441 passed (1441)
```

`pnpm --filter ai-manhua-studio build`：退出码 0，`built in 6.31s`。仍有原有 500 kB bundle 提示、pnpm lockfile/dependencies 不同步提示，没有为本任务升级依赖。

浏览器真实 API 验证实际输出：

```text
ok real API isolation, filtering, details, export and responsive monitoring
ok member sees own records and page errors are actually persisted
2 passed (11.6s)
```

1440px 桌面、390px 手机截图已检查。表格只在自身横向滚动，整页不溢出；详情可滚动、关闭，导出文件内容与用户范围一致。浏览器异常真实 POST 入库后可刷新查到。

### Agent / Director Desk

```text
Canvas Agent: tests 4, pass 4, fail 0
Director Desk: Test Files 87 passed (87), Tests 689 passed (689)
```

### Worker

`python -m compileall worker`：退出码 0。

Windows 全量存在此前已有的图像校验/SIGKILL 环境问题（9 failures、17 errors）；新增监控用例通过。使用 Worker 实际运行的 Linux 镜像复验：

```text
Ran 118 tests in 3.684s
OK (skipped=2)
```

新监控测试连接独立 PostgreSQL 后：

```text
Ran 5 tests in 0.084s
OK
```

包括真实 SQL 持久化及重复 ID、不暴露凭据、每次失败独立 ID、在重试掩码覆盖前记录、监控写入失败不妨碍正常重试。

## 本地运行

- 本地 API 已更新为 `ai-manju-runtime-monitoring:20260923`，迁移新增表；原数据库及资产卷保持不变。
- 本地 Worker 原处于停止状态，确认没有 queued/running 任务后更新并恢复为 `ai-manju-worker-monitoring:20260923`；两者健康检查通过。
- API 环境配置与更新前逐项比较，无配置值变化。实际超级管理员登录后 `/api/monitoring` 返回 `success=true, can_view_all=true`。
- Studio 继续使用已有开发服务 <http://localhost:3100>。
- 本地 compose 增量覆盖：`.tmp/runtime-monitoring-qa/compose.override.json`；部署时应正常重建仓库 API/Worker 镜像，不能只替换前端。
- 全部原始验收输出与截图在 `.tmp/runtime-monitoring-qa/`。
- 未提交、未推送；保留其它任务的未提交修改。
