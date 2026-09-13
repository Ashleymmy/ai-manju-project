# 画布模型选择与供应商重试验收

日期：2026-09-11

## 本次行为

- 画布节点的模型按钮和菜单仅显示真实模型 ID 的名称部分，隐藏供应商与供应商别名；同一模型合并为一个选项。
- 保留已有画布中的供应商限定模型值。保存的供应商被删除或停用后，仍可匹配其他已启用供应商的同一模型。
- 图片生成、图片编辑、文本生成和 OpenAI-compatible 视频任务，按当前选择优先、其他供应商稳定排序的方式尝试。其他候选必须明确配置相同模型 ID 和能力，不根据显示别名切换到不同模型。
- 每个候选最多三次请求（首次加两次重试）。图片/视频任务每次 Celery 投递执行一次生成；并发排队不消耗次数；成功后停止切换。
- 图片请求至少等待 15 分钟；每次投递另留 5 分钟保存结果，硬限制再留 1 分钟退出余量。视频队列为提交、等待、下载额外预留额度。各次重试拥有独立时限。
- 文本请求每次至少等待 5 分钟；前端等待服务器完成整个尝试序列，保留主动取消。
- 图片轮询遇到临时网络错误或 5xx 会继续查询任务，避免把查询失败误认为生成失败。
- 中间错误不进入公开任务错误字段；公开任务接口隐藏供应商排队/退避细节，已开始的任务继续显示生成中。所有候选耗尽后返回统一失败提示。
- 候选凭据仅通过服务端队列 kwargs 传递，不写入公开任务 payload。客户端传入的候选不能覆盖服务端候选。
- 用户取消会阻止后续尝试；终态任务的重复投递不会重新生成；生成成功后的资产保存错误不会触发再次调用供应商。

## 实现范围与一致性

候选选择在公共 Handler 层、任务额度在公共 JobService 层处理，Memory/Gorm 仓库共用同一逻辑，没有新增数据库字段。候选按供应商 ID 排序以消除两种仓库返回顺序差异。原有响应信封、路由和鉴权中间件保持不变。

本次重试接入 `/api/ai/text`、图片生成/编辑路由以及 `/api/ai/videos` 队列任务。供应商专用的 Seedance/Wan 任务代理和语音代理未纳入这次队列改造。

## 验证及实际输出

API：在 Go 1.23 容器中执行 `go build ./... && go vet ./... && go test ./...`，退出码 0。构建和 vet 无错误输出；测试输出摘录：

```text
ok  github.com/ai-manju/api/internal/handler 10.632s
ok  github.com/ai-manju/api/internal/middleware 0.009s
ok  github.com/ai-manju/api/internal/provider 0.010s
ok  github.com/ai-manju/api/internal/queue 0.004s
ok  github.com/ai-manju/api/internal/repository 0.005s
ok  github.com/ai-manju/api/internal/router 0.288s
ok  github.com/ai-manju/api/internal/service 0.121s
```

新增测试验证同模型/能力候选过滤、停用/删除供应商兼容、任务六次总额度、凭据不进入公开响应、每次投递延长时限、文本 A/A/A/B 成功与 A/A/A/B/B/B 全失败、取消和中间状态隐藏。

Studio：执行 `pnpm --filter ai-manhua-studio check`、`test`、`build`，均退出码 0：

```text
> tsc --noEmit
Test Files 111 passed (111)
Tests 538 passed (538)
✓ built in 2.67s
```

新增测试覆盖模型名称去重、旧供应商选择兼容、文本等待超过普通请求时限、图片临时轮询失败后的成功恢复。构建仍有既有的 Director Desk 大资源包提示，不影响构建通过。

Canvas Agent / Director Desk：

```text
pnpm --filter @basketikun/canvas-agent test
ℹ tests 1
ℹ pass 1
ℹ fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 686 passed (686)
Duration 141.76s
```

Worker：在现有 Worker 依赖环境中执行 `python -m compileall worker && python -m unittest discover -s tests`，退出码 0：

```text
Compiling 'worker/generation_failover.py'...
Compiling 'worker/tasks.py'...
Ran 59 tests in 0.054s
OK (skipped=1)
```

新增九项回归包括完整六次尝试、第四次成功、首次成功立即停止、超时切换、取消、保存失败不重复生成、第二个供应商排队不计次数、客户端不能注入候选，以及真实 Celery eager 重试入口保留候选列表。供应商响应使用本地模拟；没有调用真实收费模型进行生成。既有一项依赖真实 Redis 的集成测试保持跳过。

`git diff --check` 通过，无输出。

## 本地运行状态

更新前确认当前项目 Worker：`active=0, reserved=0, scheduled=0`。标准 Compose 构建因 Docker Hub 基础镜像请求 EOF 失败，随后使用已安装的同项目运行镜像装入新代码/新编译的 API 程序完成构建。只更新 `ai-manju-40` 的 Worker 和 API；未更改依赖版本或数据卷。

```text
worker: attempts_per_provider=3, responding_workers=1
API: success=true, storage=postgres, db=ok, public_signup=true
Worker health: status=ok, db=ok
Studio http://127.0.0.1:3100: HTTP 200
```

前端通过现有 Vite 服务加载最新源码，后台新任务使用更新后的候选与重试策略。更新之前已投递的旧任务保留原始队列参数。
