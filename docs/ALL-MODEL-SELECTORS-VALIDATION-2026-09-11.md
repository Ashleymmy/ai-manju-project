# 全项目模型选择与生成重试统一验收（2026-09-11）

## 完成范围

| 入口 | 统一行为 |
| --- | --- |
| 画布节点的文本、图片、视频、音频模型 | 真实模型名、同名去重；悬停提示也不显示供应商 |
| 画布右侧 Agent、Chat 创作入口 | 继续使用相同公共模型选择规则，保留 Luna 默认偏好 |
| 图片工作台 | 名称、去重、已保存选择恢复；共用图片生成/编辑重试 |
| 视频工作台 | 名称、去重、刷新目录保留同一模型；完整后台任务轮询及取消 |
| 漫画剧本分析、修订、提取、提示词优化 | 文本模型列表统一；后台文本调用复用同模型重试 |
| 漫画资产图片生成/编辑 | 列表统一；队列携带同模型候选供应商及各自图片协议 |
| 偏好设置的文本、图片、视频、音频默认模型 | 同名去重、真实名称；供应商删除后可恢复仍可用的同一模型 |
| 图片详情与画布生成历史 | 显示真实模型名，不显示供应商别名 |

扫描了 Studio、Canvas Agent、Director Desk 的业务入口。管理后台的供应商配置属于管理信息；Director Desk 的三维模型库属于素材选择。

## 执行规则

- 共用真实上游模型 ID 判断身份，同一模型在下拉中只显示一次。保存值仍可包含路由标识；已保存供应商被移除时，只要其他启用供应商提供同一模型，原选择继续有效。
- 每个供应商最多尝试三次，成功立即结束；用尽同模型的候选供应商后才返回统一失败信息，不在重试中切换成另一模型。
- 文本单次请求至少 5 分钟，图片/音频/视频单次请求至少 15 分钟；视频提交、等待结果、下载分别计入后台任务预算，另留结果保存时间。
- 漫画同步文本调用和视频页面不再用较短的前端总超时截断整个后台尝试过程；轮询临时断线/服务错误继续等待，鉴权失败与用户取消仍正常处理。
- Seedance/Wan 原生异步视频接入持久化任务。原路由与响应信封保留，新任务返回稳定 job ID；接单后的失败也参与三次尝试和切换，查询/下载不会拿旧供应商任务 ID 去访问新供应商。旧的远端任务 ID 仍可读取。
- 原生视频沿用供应商专用请求参数、Wan 数据转换与异步 Header；下载兼容嵌套结果地址，验证内容类型、限制大小，存储地址不携带供应商认证 Header。
- 音频按请求的模型选择供应商，并补齐自定义认证 Header、查询参数认证和 HTTP 200 中的 JSON 错误识别。
- 候选供应商与密钥仅存于服务端队列参数；模型选择按统一仓库接口读取，并稳定排序，Memory/Gorm 不分叉。

## 验证方式

采用隔离测试用户、内存仓库、模拟供应商 HTTP 响应与实际 Worker 执行函数。覆盖异步 A/A/A/B 成功、A/A/A/B/B/B 全部失败、临时轮询失败不重复创建、不同尝试使用不同幂等键、取消后台 Job、失败提示隐私、原生结果内容归属校验。

未调用付费供应商生成接口；供应商实时可用性以实际生成时的响应为准。Redis gate 集成测试因未提供 REDIS_TEST_URL 跳过 1 项，其余 Worker 测试通过。

## 实际检查输出

后端执行 `go build ./... && go vet ./... && go test ./...`，退出码 0；随后编译本地服务程序。

```text
?   	github.com/ai-manju/api/cmd/asset-export-worker	[no test files]
?   	github.com/ai-manju/api/cmd/migrate-asset-library	[no test files]
?   	github.com/ai-manju/api/cmd/migrate-asset-tags	[no test files]
?   	github.com/ai-manju/api/cmd/migrate-provider-presets	[no test files]
?   	github.com/ai-manju/api/cmd/reconcile-asset-usage	[no test files]
?   	github.com/ai-manju/api/cmd/server	[no test files]
?   	github.com/ai-manju/api/internal/auth	[no test files]
?   	github.com/ai-manju/api/internal/database	[no test files]
ok  	github.com/ai-manju/api/internal/assetmigration	0.003s
ok  	github.com/ai-manju/api/internal/config	0.003s
?   	github.com/ai-manju/api/internal/model	[no test files]
?   	github.com/ai-manju/api/internal/response	[no test files]
?   	github.com/ai-manju/api/internal/storage	[no test files]
ok  	github.com/ai-manju/api/internal/handler	11.086s
ok  	github.com/ai-manju/api/internal/middleware	0.010s
ok  	github.com/ai-manju/api/internal/provider	0.010s
ok  	github.com/ai-manju/api/internal/providerpresetmigration	0.006s
ok  	github.com/ai-manju/api/internal/queue	0.003s
ok  	github.com/ai-manju/api/internal/repository	0.006s
ok  	github.com/ai-manju/api/internal/router	0.287s
ok  	github.com/ai-manju/api/internal/service	0.119s
ok  	github.com/ai-manju/api/internal/tagmigration	0.006s
```

Studio 检查、测试、构建均退出码 0：

```text
> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit
 ✓ src/features/chat/ChatPage.test.tsx (6 tests) 363ms

 Test Files  113 passed (113)
      Tests  553 passed (553)
   Start at  17:25:51
   Duration  5.25s (transform 13.60s, setup 0ms, collect 35.98s, tests 2.85s, environment 11.64s, prepare 11.95s)
../dist/public/assets/index-C9nJXdro.js                          355.13 kB │ gzip: 113.34 kB
✓ built in 3.30s
```

Canvas Agent 测试退出码 0：

```text
✔ shared tool definitions and local validators stay aligned (3.3534ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 211.1231
```

Director Desk 测试退出码 0：

```text

 Test Files  87 passed (87)
      Tests  686 passed (686)
   Start at  17:21:38
   Duration  102.01s (transform 1.16s, setup 12.90s, import 11.34s, tests 30.18s, environment 38.93s)
```

Worker 执行 `python -m compileall worker && python -m unittest discover -s tests`，退出码 0：

```text
Listing 'worker'...
Compiling 'worker/__init__.py'...
Compiling 'worker/app.py'...
Compiling 'worker/assets.py'...
Compiling 'worker/config.py'...
Compiling 'worker/db.py'...
Compiling 'worker/errors.py'...
Compiling 'worker/generation_failover.py'...
Compiling 'worker/provider.py'...
Compiling 'worker/provider_gate.py'...
Compiling 'worker/staged_inputs.py'...
Compiling 'worker/tasks.py'...
Compiling 'worker/video.py'...
......................................s........................
----------------------------------------------------------------------
Ran 63 tests in 0.079s

OK (skipped=1)
```

构建仍有既有的大包体积提示，无构建错误。`git diff --check` 通过。

## 本地服务

更新前 Worker active/reserved/scheduled 均为 0。仅更新 Compose 项目 `ai-manju-40` 的 Worker 和 API；Studio 热更新与生产构建均完成。

更新后健康检查：

```json
{
  "worker": {
    "service": "AI-Manju Worker",
    "status": "ok",
    "queue": "celery",
    "broker": "redis://redis:6379/0",
    "db": "ok",
    "worker_concurrency": 8,
    "provider_rate_limit": null
  },
  "studio": 200,
  "api": {
    "data": {
      "auth_bootstrap": true,
      "db": "ok",
      "persistent_required": true,
      "public_signup": true,
      "request_id": "4b2bdd03bebdcd0a089dcd4a",
      "service": "AI Manju API (Go)",
      "storage": "postgres"
    },
    "success": true
  }
}
```
