# 工作台创作概览设计验收

日期：2026-09-29

## 请求与完成内容

用户希望工作台右侧卡片更好看、更有创作氛围，避免首页突出积分支出。

在同日概览区域压缩的基础上，将“积分消耗”卡改为“本月创作”：

- 两张淡绿、淡紫卡片分别显示本月图片生成次数和视频生成秒数，使用现有图标体系与圆角尺度。
- 点击对应卡片进入图片或视频工作台；“查看作品”进入资产库。
- 不再展示 `monthly_usage.total_credits`，积分余额与“积分明细”入口放在底部。
- 保留真实账单和 `/member/usage` 明细页。
- 数据加载中或缺失时用破折号展示；首次加载失败有明确提示和重试入口。
- 桌面整排仍为 272px；没有修改节点、分组、画布圆角或管理后台。

代码文件仍仅为：

- `apps/studio/client/src/features/dashboard/DashboardPage.tsx`
- `apps/studio/client/src/features/dashboard/styles.css`

## 数据口径

已核对 `apps/api/internal/repository/credit_repository.go` 与 `apps/api/internal/handler/member.go`：

- `monthly_usage.image_count` 是已结算图片任务数，因此显示单位为“次”，不是图片“张”。
- `monthly_usage.video_seconds` 是已结算视频任务的 `duration_sec` 合计，显示“秒”。
- 可用积分依旧为 `limited_available + permanent_available`，不包含冻结积分。
- 没有将支出积分改名冒充创作数据，没有编造作品数或使用额度。

## 浏览器实际验收

使用已有本地会话访问 `http://localhost:3100/dashboard`，只做页面导航，没有发起生成任务。

- 1280px 桌面：卡片正常呈现，所有文字和入口可见。
- 1920 × 945（匹配原参考图桌面宽度）：广告位、工作区统计、创作概览均测得 272px；文档宽度为 1920px。
- 390 × 844：卡片宽度 358px、高度约 254.48px，卡片内没有文字溢出；文档宽度 390px。
- 图片卡片点击进入 `/image`，图片工作台加载成功。
- 视频卡片点击进入 `/video`，视频工作台加载成功。
- “查看作品”点击进入 `/assets`，资产库加载成功。
- “积分明细”点击进入 `/member/usage`，原有明细筛选、消耗明细/积分流水及分页控件正常呈现。
- 临时视口已恢复。当前本地月度数据为图片 0 次、视频 0 秒，最终截图可用积分为真实会话返回的 600。

实际截图：

- `D:/AImanju4.0/output/dashboard-creation/creation-card.png`
- `D:/AImanju4.0/output/dashboard-creation/desktop-page.png`

## 验证结果与实际输出

原始日志：`D:/AImanju4.0/.tmp/dashboard-creation-20260929/`。

### Studio

通过项目已有 pnpm 入口依次执行：

```text
pnpm --filter ai-manhua-studio check
pnpm --filter ai-manhua-studio test
pnpm --filter ai-manhua-studio build

studio check exit: 0
studio test exit: 0
Test Files  262 passed (262)
     Tests  2073 passed (2073)
  Duration  13.98s
studio build exit: 0
✓ built in 9.26s
```

构建仍有超过 500 kB 产物的体积提示，无构建错误。

### API

在 `apps/api` 使用仓库已有 Go 运行时执行：

```text
go build ./...
go vet ./...
go test ./...

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

```text
pnpm --filter @basketikun/canvas-agent test
canvas-agent test exit: 0
ℹ tests 5
ℹ pass 5
ℹ fail 0

pnpm --filter @ai-manju/director-desk test
director-desk test exit: 0
Test Files  87 passed (87)
     Tests  689 passed (689)
  Duration  112.91s
```

### Worker

使用已有镜像 `ai-manju-worker-monitoring:20260923`，禁用网络并只读挂载 `apps/worker`：

```text
python -m compileall worker && python -m unittest discover -s tests
worker compile/test exit: 0
Ran 275 tests in 7.882s
OK (skipped=27)
```

`git diff --check` 通过，无输出。

## 交付状态

本地修改与验证完成，没有提交、部署或重启已有服务。本报告中的卡片设计替代上一份压缩验收记录中的“本月已消耗”展示。
