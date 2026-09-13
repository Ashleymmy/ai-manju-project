# 分类提交与远端整合验收（2026-09-13）

## 提交分类

用户要求将项目累积改动分类提交至现有仓库 `Ashleymmy/ai-manju-project`，目标分支为 `master`。

| 提交 | 分类 | 内容 |
| --- | --- | --- |
| `69117e6` | 注册与登录 | 普通成员注册入口、统一认证表单和样式 |
| `38c6716` | 画布与资产目录 | 未命名画布编号、同名资产目录及分类子目录、重命名联动 |
| `86bec6f` | 模型调用与任务容错 | 供应商重试、故障切换、媒体任务处理与公开状态 |
| `a51d63e` | 模型选择 | 工作台统一真实模型目录、模型名称及选择行为 |
| `9a15db6` | 画布交互 | 文本保存、图片信息、素材引用层级、点击外部关闭弹层 |
| `2704b01` | 漫剧项目 | 创建与分析流程接入真实模型选择 |

六个提交覆盖 116 个不同文件，包含对应功能的历史验收记录。未纳入本地环境文件、凭据、依赖目录、运行数据和临时日志。

## 远端整合

拉取时发现远端新增 `bd80ae1`、`103713d`、`e3da872`，包含 SD-video 二阶段、NAS/对象存储及验收改动。采用合并保留双方历史。

解决 `apps/api/internal/handler/ai.go` 和 `apps/studio/client/src/features/video/services/generationGateway.ts` 的冲突：

- 视频创建保留 SD-video 分流和原生供应商重试逻辑。
- 查询状态与下载内容先识别 SD-video 任务，再处理原生任务，避免两类 `job_` 标识相互误判。
- 前端保留临时查询错误的容错行为，同时传递远端新增的对话和消息标识。
- 检查自动合并的路由、模型目录、任务服务、资产目录和视频工作台，保留双方改动。

新增 `TestVideoRoutesKeepSDVideoAndNativeJobsSeparate`，覆盖普通视频/Seedance 的状态与内容接口以及原生/SD-video 两种任务，共 8 个子场景。内容使用本地测试资产，签名密钥即时生成，不调用真实模型。

## 最终验证

以下规定命令均退出 0。完整本地日志位于 `.codex-logs/classified-merge-*-2026-09-13.log`，此处保存实际输出摘要。

### API

Go 1.23 临时容器只读挂载 `apps/api`，运行 `go build ./... && go vet ./... && go test ./...`。合并文件及新增测试的 `gofmt` 检查通过。

```text
ok  github.com/ai-manju/api/cmd/asset-export-worker          0.006s
ok  github.com/ai-manju/api/internal/assetmigration          0.004s
ok  github.com/ai-manju/api/internal/config                  0.003s
ok  github.com/ai-manju/api/internal/handler                11.268s
ok  github.com/ai-manju/api/internal/middleware              0.019s
ok  github.com/ai-manju/api/internal/provider                0.011s
ok  github.com/ai-manju/api/internal/providerpresetmigration 0.006s
ok  github.com/ai-manju/api/internal/queue                   0.003s
ok  github.com/ai-manju/api/internal/repository              0.008s
ok  github.com/ai-manju/api/internal/router                  0.343s
ok  github.com/ai-manju/api/internal/sdvideo                  0.005s
ok  github.com/ai-manju/api/internal/service                 0.130s
ok  github.com/ai-manju/api/internal/storage                 0.043s
ok  github.com/ai-manju/api/internal/tagmigration            0.005s
```

### Studio

运行 `pnpm --filter ai-manhua-studio check`、`test`、`build`。

```text
> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit

 Test Files  118 passed (118)
      Tests  585 passed (585)
   Start at  11:35:23
   Duration  5.87s (transform 13.62s, setup 0ms, collect 39.05s, tests 5.00s, environment 20.57s, prepare 12.75s)

✓ 2293 modules transformed.
✓ built in 4.42s
✓ 2059 modules transformed.
✓ built in 3.54s
```

Director Desk 依赖构建仍有既有的 500 kB 包体积提示，无构建错误。

### Canvas Agent / Director Desk

运行 `pnpm --filter @basketikun/canvas-agent test` 和 `pnpm --filter @ai-manju/director-desk test`。

```text
✔ shared tool definitions and local validators stay aligned (1.843ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ skipped 0

 Test Files  87 passed (87)
      Tests  686 passed (686)
   Start at  11:35:20
   Duration  91.12s (transform 1.03s, setup 8.57s, import 5.42s, tests 29.41s, environment 39.39s)
```

### Worker

一次性 `ai-manju-40-worker` 容器只读挂载源码，在容器临时目录安装合并后新增的 `httpx==0.28.1`、`oss2==2.19.1`，运行 `python -m compileall worker && python -m unittest discover -s tests`。

```text
Compiling 'worker/object_storage.py'...
Compiling 'worker/runtime.py'...
Compiling 'worker/supabase_storage.py'...
Compiling 'worker/tasks.py'...
Compiling 'worker/video.py'...
----------------------------------------------------------------------
Ran 78 tests in 0.162s

OK (skipped=1)
```

跳过的是要求 `REDIS_TEST_URL` 的既有 Redis 集成测试。初次验证使用的旧镜像缺少新增 `httpx`，补齐一次性测试环境后完整检查通过；未修改运行中的 Worker。

`git diff HEAD --check` 通过，源码无遗留合并冲突标记。本次验收包含上述构建和测试，不包含真实供应商生成、SD-video 独立端到端测试或生产存储部署。
