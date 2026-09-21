# 上传剧本后分析超时修复验收

## 问题与证据范围

用户在 `http://localhost:3100/comic-assets` 上传剧本，等待分析后失败。截图同时出现 HTTP 500、504 Gateway Time-out 和“无法连接 API 服务”。

确认的代码问题：

- 首轮分析原本同步等待模型完成后才返回上传请求，期间没有响应，容易超过中间网关的空闲等待上限。浏览器关闭自己的计时器不能改变网关上限。
- HTTP 客户端对 HTML/文本错误页使用 `"error" in envelope`，会抛出类型异常，将实际 504 误报为连接失败。

截图请求 ID `52a09652-3460-47b9-816b-71843ab110d9` 未在所查本地后端已完成请求日志中找到，因此尚不能指定是哪一层网关返回了该 504。早先另一个请求的模型上游 503 有独立证据，不能据此认定这次超时的来源，也未宣称修复了上游模型服务。

## 已完成改动

- 首轮上传新增可选 `async=true`，先保存源文件及处理中的分析会话，返回标准信封 HTTP 202。原同步调用保持 HTTP 201 和既有行为；路径与鉴权不变。
- 后台工作不再依赖上传请求的连接。完成时以原子操作保存首个不可变候选版本；失败保留源文件并记录安全的错误提示。Memory/Gorm 行为一致。
- 整项分析最多 20 分钟；进程中断遗留任务在后续查询时按同一期限转成失败，不会永久显示处理中。后台任务不是可自动恢复的持久队列，重启时尚未完成的模型调用需要重新发起。未确认源文件及会话沿用七天清理期限。
- 页面每两秒查询进度，临时网络故障及 502/503/504 只重试查询，不自动重复提交分析。同一标签页记录任务编号和输入摘要，连续查询失败后可用相同文件及设置继续查看；不保存剧本文本或令牌。
- HTML/文本错误页保留真实 HTTP 状态及请求编号，不再被错误转换为“无法连接 API 服务”。

## 本任务实际验证输出

后端在独立容器执行 `go build ./... && go vet ./... && go test ./...`，退出 0。Gorm 一致性测试使用一次性 PostgreSQL，未连接用户业务数据库。

```text
ok github.com/ai-manju/api/internal/handler     14.021s
ok github.com/ai-manju/api/internal/repository   0.052s
ok github.com/ai-manju/api/internal/service     (cached)
```

新增测试覆盖：慢模型时上传提前返回；上传连接取消后后台继续；跨工作区隔离；模型错误/格式错误/超时/panic；过期任务；并发完成只写一个版本；Memory/Gorm 清理及状态一致性。既有同步创建、修订、确认流程测试通过。

Studio 类型检查退出 0；全量测试与构建：

```text
> tsc --noEmit
Test Files  175 passed (175)
     Tests  1098 passed (1098)
✓ built in 3.10s
```

独立浏览器回归使用端口 43128 和拦截全部真实 API 的测试数据。验证上传 → 202 → 状态查询遇到 HTML 504 → 继续查询 → 显示候选资产，断言提交一次、查询三次、无页面异常。首次测试的拦截范围与公告弹窗定位问题修正后，最终运行：

```text
ok 1 comic-analysis-timeout.spec.ts
  uploaded script survives a gateway error during background polling (11.6s)
1 passed (12.2s)
```

Canvas Agent / Director Desk：

```text
tests 4
pass 4
fail 0
Test Files  87 passed (87)
     Tests  686 passed (686)
```

Worker 在一次性 Linux 容器执行 `python -m compileall worker` 和 `python -m unittest discover -s tests`。旧测试镜像缺少 httpx，仅在一次性容器安装项目指定的 httpx 0.28.1 后重跑：

```text
Ran 82 tests in 0.401s
OK (skipped=1)
```

跳过项需要未配置的 Redis 集成测试环境。未改变运行中的 Worker 或共享依赖。`git diff --check` 通过。完整原始日志位于 `.tmp/comic-analysis-qa/`。

## 生效状态与更新包

修复源码在工作区由并行整合任务纳入 `3968078`，当前构建基于 `7495216`；本任务没有执行提交或推送。保留并行任务的其他改动。

已构建独立镜像 `ai-manju-comic-analysis-fix:7495216`（镜像清单摘要 `sha256:67a4b4c7432259ee849e97a11aedfb897d3f0d1b74ddc461d26e9e3d8529d235`），未覆盖共享镜像标签。

该镜像已在独立 PostgreSQL 上启动，完成迁移且 `/health` 返回 `success: true`、`storage: postgres`、`db: ok`。测试 API、数据库容器及其临时数据已清理，保留更新镜像。

验收时实际 API 容器仍是 2026-09-20 09:21:31 UTC 启动的旧实例。因用户要求不干扰其他助理，本任务未重启或替换共享 API。需要经用户确认后仅更新 API，并检查数据库迁移、健康状态和首轮上传流程；前端开发页刷新即可读取已修改源码。真实模型推理可用性仍需由实际服务验证。

## 用户批准后的部署及真实服务复核

用户回复“允许”后，仅更新并重建 `ai-manju-40-api-1`。新容器于 `2026-09-21T01:13:59.221086324Z` 启动，镜像为上文已验证的 `ai-manju-comic-analysis-fix:7495216`。部署前比较现有容器与 Compose 的环境和启动命令，差异为空；网络、端口、数据卷沿用现状。Worker、数据库、Redis 和其他项目容器的 ID 保持不变。

旧 API 镜像保留为 `ai-manju-comic-analysis-rollback:20260920`。本次镜像覆盖文件为 `.tmp/comic-analysis-qa/api-image-override.json`；采用 `compose -p ai-manju-40 -f docker-compose.yml -f .tmp/comic-analysis-qa/api-image-override.json up -d --no-deps --no-build api`，没有重启依赖服务。`analysis_error` 数据库字段迁移完成，API 容器为 healthy，数据库状态为 ok。

部署复核发现独立的本机连接故障：`localhost:3101` 的 IPv6 环回由 `wslrelay.exe` 监听，请求在五秒内无响应；IPv4 `127.0.0.1:3101/health` 正常返回。前端未配置显式 API 地址时仍直接使用 localhost:3101。因此补充修改 `shared/config/api.ts`：开发环境通过当前页面同源地址调用已有的 Vite `/api` 代理（其目标是 127.0.0.1），避免有问题的 IPv6 转发，并保留 Cookie 同源行为。显式 API 配置与生产回退行为不变。前端源文件已热更新，没有重启前端服务。

补充修改之后的实际验证：

```text
Studio check: tsc --noEmit, exit 0
Test Files  178 passed (178)
     Tests  1113 passed (1113)
✓ built in 3.01s
comic-analysis-timeout.spec.ts: 1 passed (11.7s)
localhost:3100/health: success=true, storage=postgres, db=ok
```

使用当前配置账户正常登录，经真实 Studio 代理提交一条独立合成剧本（不是用户剧本），首轮 POST 在 **10 毫秒**内返回 **202 / processing**。两秒后查询能正常返回任务状态；随后登出本次测试会话。仅本次合成测试会话及其源文件已精准清理，没有创建正式项目，也没有改动用户资产。

**尚未恢复的是上游模型推理。** 真实后台任务返回 failed，提示“模型服务未能完成剧本分析”。对原配置服务发送最小的 `Reply only OK.` 请求，得到：

```text
http://192.168.0.36:18080/v1/responses
model: gpt-5.6-luna
HTTP 503, 39 ms
{"error":{"message":"Service temporarily unavailable","type":"api_error"}}
```

其 `/health` 返回 ok，首页确认为 **Sub2API - AI API Gateway**。因此应用更新及连接修复已上线，但不能宣称真实剧本分析已经成功。模型服务仍需检查上游账户、路由与错误日志；已向用户询问其管理入口或部署位置。真实凭据仅在进程内存用于原有服务，未输出或落盘。

## 获准继续后的上游排查

用户允许继续，但表示不知道远端机器的管理方式。只进行了读取与最小合成请求，没有重置服务、修改远端账户、替换模型或更换调用密钥。

- 本机网卡地址为 192.168.0.49；Sub2API 在另一台机器 192.168.0.36，不属于本机 Docker 的运行容器。该 IP 的反向 DNS 名称为 **PC-20231204DSTH**，可作为寻找部署机器的线索。本机没有可用的 SSH 连接配置。
- 两个已配置供应商的 `/v1/usage` 均返回 200、`isValid: true`、`status: active`，密钥额度未耗尽。未记录具体余额或使用明细。
- 两个密钥的模型目录都返回 200。仅对当前供应商额外测试目录内的两个替代模型，均失败：

```text
gpt-5.6-sol: HTTP 503, 16 ms
request_id: b3f7ee9c-abb7-4fdc-bd83-4572a46f2dc7
client_request_id: 1ffbe498-406f-4d72-8e70-b6f072fee015

gpt-5.4: HTTP 503, 10 ms
request_id: a7f33a27-8830-4d19-9c07-ac7ae0329241
client_request_id: 19e54293-ad93-45ff-b363-c1626d641252

共同响应：{"error":{"message":"Service temporarily unavailable","type":"api_error"}}
```

这排除了“重新填写相同密钥”作为当前有效修复，也没有发现可用的替代文本模型。参考 Sub2API 公开主干代码，同一错误可来自无可调度账号或 Responses 内部依赖未就绪；实际部署版本未确认，仍需服务器错误日志区分，不能直接断言为令牌过期或账号额度问题。

管理页面为 `http://192.168.0.36:18080/`，公开前端路由包含 `/admin/accounts` 和 `/admin/ops`。可用上述请求编号定位错误记录。检查现有浏览器登录态的工具连续初始化失败（`failed to write kernel assets`），未取得管理会话，也未绕过登录。已请求在 Codex 显示管理首页，工具状态为 queued。

当前剩余阻断：需要该机器可用的管理连接、已登录管理页中的账号状态，或对应错误日志，才能确定并实施上游修复。新的诊断摘要位于 `.tmp/comic-analysis-qa/gateway-diagnosis.json`。
