# 运行监控真实错误诊断修复验收

## 修复内容

- 浏览器原先在捕获 fetch 异常后只上报公共提示，丢失原始异常、方法和耗时；上报的 endpoint 还是当前页面。现在分别保存失败 API 与发生页面，采集异常类型、原始信息、堆栈、实际耗时、超时设置和是否收到响应。
- 客户端日志原先使用“提交日志”这个请求的 request_id。现在原失败请求编号与日志上报编号分开保存，避免管理员沿错误编号排查。
- 非 JSON 网关错误保留实际 HTTP 状态与响应摘要。明确取消请求不上报为故障；公共取消提示保持兼容，采集阶段区分超时与连接失败。监控自己的请求不上报，避免递归。
- AI 调用、API 错误、Worker 失败新增结构化 diagnostics，保存实际获得的上游 HTTP 状态、URL/方法、请求编号、错误字段及原始异常。状态和编号不根据报错文字猜测。
- Worker 在包装为公共错误前保存传输异常；等待恢复、提交结果待核对等提前返回分支也保存该次诊断。记录失败不会改变生成结果、付费提交或恢复重试流程。
- 视频服务转发和后台对账使用单次请求/对账独立的观察容器，采集 HTTP 错误及 HTTP 200 中的明确任务失败；不共用跨用户诊断状态。
- 失败任务详情可关联同一用户、同一任务最后一次已记录的失败尝试，避免公共失败提示覆盖了管理员需要的细节。
- 详情展示真实采集字段，处理建议仅供排查参考。按用户后续复核要求，原有 17 个字段、名称、顺序和双列布局全部保留，缺少值时显示“未记录”等明确说明；新增采集信息附加在原字段之后。可复制诊断 JSON；CSV 增加结构化诊断内容。完整性复核见 `runtime-details-preserved-2026-09-28.md`。

## 信息真实性和权限

- 没有收到响应时明确显示“未收到 HTTP 响应”，不生成 HTTP 状态、供应商错误或响应内容。
- 浏览器只能提供 `TypeError: Failed to fetch` 时，保存这一真实异常；不能据此断言 DNS、CORS 或具体上游故障。
- 历史未采集内容无法追溯恢复。受权限限制和历史未采集分别提示。
- 保留现有权限：仅 super_admin 可读取全局、上游/Worker 私有诊断；member、ops_admin、auditor 保持本人范围，搜索与导出也不能读取私有字段。
- 两种仓库在写入时执行相同诊断清理。JSON 响应只保留常见错误字段，支持 message/msg、嵌套 Error/Response 等结构；剔除媒体、提交参数等字段。密钥、Cookie、Bearer、签名 URL 查询参数被脱敏，文本有长度限制。
- 无法安全筛选的残缺 JSON 不作为完整错误体保存；原始异常和实际 HTTP 状态仍保留。流式媒体响应不为日志提前消费。
- 浏览器完全无法访问 API、进程被强制终止、数据库无法写入等情况下，无法保证该条诊断落库；未新增跨登录会话的持久重发队列。

## 验证与实际输出

原始日志：`.tmp/runtime-diagnostics-20260928/`。

### Go API

`go build ./...`、`go vet ./...` 均退出码 0，无错误输出。
`go test ./...` 全部通过，覆盖 provider、handler、middleware、repository、service、router、sdvideo 等包。

独立 PostgreSQL 16 验证实际输出：

```text
--- PASS: TestRuntimeMonitoringRepositoryParity (1.11s)
    --- PASS: TestRuntimeMonitoringRepositoryParity/memory (0.00s)
    --- PASS: TestRuntimeMonitoringRepositoryParity/postgres (1.11s)
PASS
```

新增验证包括：真实响应与连接异常、错误摘要脱敏及再次读取、残缺/超长 JSON、客户端原请求编号与失败 API、伪造上游字段拒收、最终任务按所有者关联、非管理员私有字段隔离、视频服务 HTTP 422 与 HTTP 200 异步失败。

### Studio

`pnpm --filter ai-manhua-studio check`：`tsc --noEmit` 退出码 0。

```text
Test Files  255 passed (255)
     Tests  2014 passed (2014)
```

`pnpm --filter ai-manhua-studio build` 退出码 0：

```text
✓ built in 9.05s
```

保留原有大于 500 kB 的 bundle 提示，没有为本任务升级依赖。

新增验证覆盖真实异常保留、超时与主动取消、非 JSON 504、读取响应失败时保留 HTTP 状态、对象形式错误信封、上报脱敏与递归保护、权限提示。

### 浏览器

```text
ok upstream details remain readable, copyable and responsive
ok a real browser fetch failure reports original exception and request correlation
2 passed (4.2s)
```

使用受控接口响应验证 1440px/390px 详情布局、滚动/关闭和复制诊断；实际阻断浏览器 fetch，验证上报的原始 `TypeError: Failed to fetch`、方法、接口、耗时、未收到响应标记及请求编号。测试数据没有写入用户的数据库，没有发起生成请求。截图已查看，位于日志目录的 `browser/` 中。

尝试启动临时测试 API 服务被自动审批拒绝，工具只返回“blocked by policy”，未提供更具体原因。没有启动该服务或更换方式重试；改用浏览器受控响应测试，后端和 Worker 的落库分别使用真实独立 PostgreSQL 验证。已有真实 API 浏览器测试补充了新字段断言，本轮没有运行该套测试。

### Canvas Agent / Director Desk

```text
Canvas Agent: tests 4, pass 4, fail 0
Director Desk: Test Files 87 passed (87), Tests 689 passed (689)
```

### Worker

在与 Worker 匹配的 Linux 镜像运行 `python -m compileall -q worker` 和 `python -m unittest discover -s tests`：

```text
Ran 268 tests in 4.491s
OK (skipped=27)
```

全量中的环境依赖用例按原条件跳过。监控测试另外连接独立 PostgreSQL，无跳过：

```text
Ran 9 tests in 0.056s
OK
```

覆盖真实 SQL 保存、幂等、上游响应/编号/状态持久化、包装前的连接异常、恢复提前返回、脱敏，以及日志写入或诊断读取失败不改变业务结果。

## 生效条件

本次只修改本地代码，未部署线上，未重启现有 API/Worker。现有用户数据库、账号、任务与资产没有改动。

部署需同时更新 API、Studio、Worker；先启动新版 API 完成现有 AutoMigrate，为 `runtime_errors` 和 `ai_request_logs` 增加 `diagnostics` JSONB，再更新 Worker/独立视频对账进程。只更新前端无法产生新的后端诊断。新采集从新版服务启用后开始，旧记录保留原样。
