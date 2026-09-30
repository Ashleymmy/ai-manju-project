# 工作台概览区域压缩验收

日期：2026-09-29

## 请求与范围

将 `/dashboard` 广告位、工作区统计、积分消耗卡这一排缩短至用户截图框选的高度，移除积分卡下方的逐条消耗记录。

仅修改：

- `apps/studio/client/src/features/dashboard/DashboardPage.tsx`
- `apps/studio/client/src/features/dashboard/styles.css`

## 完成内容

- 桌面三列共享 272px 最小高度，常规内容下实际等高 272px，最近项目区域随之上移。
- 四项工作区统计继续纵向排列，标签和说明放左侧，数值放右侧，全部保留。
- 移除工作台的逐条消耗记录及其专用查询、辅助函数和样式。
- 保留真实会员总览数据、本月消耗、剩余可用积分和“积分明细”入口。统计口径仍为 `monthly_usage`，没有改成日统计。
- `/member/usage` 完整明细页保持原样。
- 窄屏沿用响应式换行；较小屏幕广告位高度缩短为 200px。
- 未修改画布、节点、分组、管理后台或后端。

## 浏览器实际验收

地址：`http://localhost:3100/dashboard`，使用已有本地登录会话，没有生成任务或更改业务数据。

| 检查项 | 实际结果 |
| --- | --- |
| 1280 × 720 桌面 | 广告位、四项统计、积分卡均为 272px；文档宽度 1280px，无横向溢出 |
| 1000 × 800 窄屏 | 广告位和统计 272px；积分卡自动换至下一排，高度约 184.19px；文档宽度 1000px |
| 720 × 900 单列 | 广告位 200px、统计 272px、积分卡约 184.19px；文档宽度 720px |
| 积分明细入口 | 点击后进入 `/member/usage`，显示消耗明细、积分流水、筛选和翻页控件 |
| 返回工作台 | 正常恢复；`.credit-list` 不存在 |

临时视口已恢复。实际截图：`D:/AImanju4.0/output/dashboard-compact/actual-page.png`。

本地账号明细为 0 条，已确认完整明细页面和控件可访问；未用伪造数据代替实际记录。

## 验证命令及实际输出

日志目录：`D:/AImanju4.0/.tmp/dashboard-compact-20260929/`。

### Studio

使用本地 pnpm 入口依次执行 `--filter ai-manhua-studio check`、`test`、`build`。

```text
> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit
studio check exit: 0

Test Files  262 passed (262)
     Tests  2073 passed (2073)
  Duration  18.42s
studio test exit: 0

✓ built in 10.81s
studio build exit: 0
```

构建有产物超过 500 kB 的体积提醒，不影响本次构建通过。

### API

在 `apps/api` 使用仓库已有 Go 运行时执行 `go build ./...`、`go vet ./...`、`go test ./...`。

```text
go build exit: 0
go vet exit: 0
go test exit: 0
ok  github.com/ai-manju/api/internal/providerhub (cached)
ok  github.com/ai-manju/api/internal/providerpresetmigration (cached)
ok  github.com/ai-manju/api/internal/queue (cached)
ok  github.com/ai-manju/api/internal/repository (cached)
ok  github.com/ai-manju/api/internal/router (cached)
ok  github.com/ai-manju/api/internal/sdvideo (cached)
ok  github.com/ai-manju/api/internal/service (cached)
ok  github.com/ai-manju/api/internal/storage (cached)
ok  github.com/ai-manju/api/internal/tagmigration (cached)
```

### Canvas Agent / Director Desk

执行 `pnpm --filter @basketikun/canvas-agent test` 与 `pnpm --filter @ai-manju/director-desk test`。

```text
canvas-agent test exit: 0
ℹ tests 5
ℹ pass 5
ℹ fail 0

director-desk test exit: 0
Test Files  87 passed (87)
     Tests  689 passed (689)
  Duration  118.98s
```

### Worker

使用已有 `ai-manju-worker-monitoring:20260923` 镜像，只读挂载 `apps/worker`、禁用网络，执行 `python -m compileall worker && python -m unittest discover -s tests`。

```text
worker compile/test exit: 0
Ran 275 tests in 5.804s
OK (skipped=27)
```

`git diff --check`：退出码 0，无输出。

## 交付状态

本地代码与浏览器验收完成；没有提交、部署或重启已有服务。
