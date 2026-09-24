# 画布图片参数防呆与错误提示

日期：2026-09-24。仅修改图片生成校验和错误展示；积分部分只读核查，没有调整计费代码、数据库或运行配置。未提交、未推送。

## 原因与修改

- 截图请求 2560×1440，供应商返回 1672×941，未达到所选规格。不能据此断言“16:9 + 中精细度”互相冲突，因此不封禁这两个正常选项。
- 当前画布已有的可用分辨率列表仅为 1K，参数按钮已禁用 2K/4K，但旧节点保留的高分辨率仍可通过生成和重试进入请求。本次统一检查已保存的参数，不静默降级。
- 普通生成、批量重试、直接生成入口、AI 图片编辑和 Agent 入口均补上校验。批量重试在任何参考图读取和节点清理前检查所有失败目标；Agent 对不支持的参数返回 blocked。
- 参数不支持时禁用面板的生成/重试，显示调整提示；节点上的重试入口也会在实际请求之前拦截。已接受的后台任务仍可恢复等待，不受新请求校验影响。
- 节点、悬停提示、面板、错误通知、Agent 结果对这类历史尺寸错误显示简洁文案，不再直接输出原始像素诊断。
- Worker 对尺寸不符、原图不可读两个错误码返回友好提示，保持 failed、错误码和不可自动重试的语义。运行监控仍记录完整的原始异常、要求/实际尺寸、用户与任务关联。未更改监控权限或隔离规则。
- 保留原图真实性验证，不拉伸低分辨率图片冒充高分辨率成功，不因输出不合格再次自动调用付费生成。

主要位置：`imageGenerationSettings.ts`、`imageGenerationError.ts`、生成 controller、`CanvasInspector.tsx`、`CanvasNodeCard.tsx`、`CanvasImageOutputStatus.tsx`、`CanvasWorkspaceContent.tsx`、`worker/errors.py`。

## 积分现状（只读）

1. 计费启用时：`ReserveForJob` 先冻结；成功由 `CreditReconciler` 调用 Settle；failed/canceled 调用 Release。创建/入队失败及取消路径也有主动释放。
2. 默认每 15 秒核对，单轮最多 200 条，失败释放会在后续轮次重试，因此不是点击失败瞬间保证到账。前端余额另有 10 秒轮询。
3. Memory/Gorm 的释放规则一致且幂等。永久积分解除冻结；未过期限时积分解除冻结；任务期间已过期的限时积分按过期核销，不恢复有效期。
4. 如果后台已经 succeeded，仅前端下载、展示或网络环节报错，仍按后台成功结算，不能把所有页面错误等同于后台失败。截图对应的 Worker 原图验证异常发生在成功前，属于 failed 释放路径。
5. 本机 `ai-manju-40-api-1` 环境没有 `BILLING_ENABLED`，也没有 `/app/.env`；当前源码默认 false。Compose 声明默认 true，但现有容器没有该环境变量，两者不一致。未擅自启用或重建服务。
6. 本机 PostgreSQL 的只读汇总 `SELECT status, COUNT(*) FROM task_consumptions GROUP BY status;` 输出 `(0 rows)`。没有实际任务消费记录可核验截图任务是否曾扣费；以上不代表远端生产配置或某个用户已完成退款。

核查位置：`apps/api/internal/service/billing_hooks.go`、`job_service.go`、`credit_reconciler.go`、`credit_ledger_service.go`、两套 `credit_repository`、`internal/config/config.go`、`internal/router/router.go`、`useMemberOverview.ts`。这些计费文件和配置没有本次修改。

## 验证记录

所有命令退出码为 0。pnpm 使用 `--config.verify-deps-before-run=warn`，沿用现有依赖，不执行安装或更新锁文件。

### Studio

`pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio check`

```text
$ tsc --noEmit
```

`pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio test`

```text
Test Files  218 passed (218)
     Tests  1561 passed (1561)
  Duration  10.49s
```

`pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio build`

```text
vite v7.3.6 building client environment for production...
✓ 2967 modules transformed.
✓ built in 6.38s
```

依赖同步、pnpm 字段、构建大分包和混合动态/静态导入提示仍存在，未在本任务内修改。

### API

在 `apps/api` 以 `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe` 执行 `build ./...`、`vet ./...`、`test ./...`。build/vet 无输出，退出 0。test 全部通过，输出节选：

```text
ok  github.com/ai-manju/api/internal/handler    (cached)
ok  github.com/ai-manju/api/internal/monitoring (cached)
ok  github.com/ai-manju/api/internal/repository (cached)
ok  github.com/ai-manju/api/internal/service    (cached)
ok  github.com/ai-manju/api/internal/router     (cached)
```

### Agent / Director Desk

分别执行 `pnpm --config.verify-deps-before-run=warn --filter @basketikun/canvas-agent test` 与 `pnpm --config.verify-deps-before-run=warn --filter @ai-manju/director-desk test`：

```text
tests 4
pass 4
fail 0

Test Files  87 passed (87)
     Tests  689 passed (689)
  Duration  85.40s
```

### Worker

本机 Python 是不可用的 Windows 别名，使用已有镜像 `ai-manju-worker-monitoring:20260923`，将 `apps/worker` 只读挂载到 `/app`。分别执行 `python -m compileall worker`（缓存写入临时容器 `/tmp/pycache`）与 `python -m unittest discover -s tests`：

```text
Listing 'worker'...
Compiling 'worker/errors.py'...
Ran 118 tests in 2.063s
OK (skipped=2)
```

新增截图尺寸组合的生成/编辑回归断言；确认无资产注册、无额外付费调用、原图字节不变、公开提示友好、监控含完整尺寸及用户/任务关联。

### 页面验证

`pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio exec playwright test --config e2e/playwright.image-preflight.config.ts`

```text
ok 1 ... saved image parameters and public errors at 1600px (16.4s)
ok 2 ... saved image parameters and public errors at 1024px (15.9s)
2 passed (32.9s)
```

使用现有 3100 服务，Chrome，全部 `/api/` 请求拦截，不调用真实付费模型、不改用户画布或模型配置。检查旧 2K 被拦截、调整 1K 后发送 1280x720/medium、失败文案与悬停内容、控制台无页面异常。出现背景资源 `ERR_CONNECTION_CLOSED` 提示，未影响断言；不据此声称所有外部资源无网络问题。

截图已检查：`test-results/canvas-image-preflight/` 下各尺寸用例的 `blocked-saved-2k.png` 与 `friendly-failure.png`，文字无重叠。`git diff --check` 无输出。

## 生效边界

前端已在当前开发服务验证。未重启共享 API/Worker，也未替换运行镜像；Worker 的公开错误分流随下次部署生效。前端已兼容旧 Worker 及旧快照中的原始错误文本，因此当前画布展示不依赖先更新 Worker。未知供应商行为仍由后台原图验证兜底，不承诺仅靠前置校验消除所有生成失败。
