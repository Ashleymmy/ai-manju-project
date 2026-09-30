# 工作台图片生成按张计数验收

## 请求与实现

将工作台“本月创作 / 图片生成”的单位从“次”改为“张”，同时保证显示的数量确实是图片数量。

- 新增 `monthly_creation.image_count`，统计当前账号本月完成的 `image.generate` / `image.edit` 成功任务中实际保存的图片输出。
- 一次生成多张按实际结果累计，忽略请求参数中的预期 `n`；免费任务同样计数。
- 失败、取消、排队、运行中任务及其他账号、其他媒体类型不计入。
- 月份按 UTC 完成时间计算，范围为当月起点（含）至下月起点（不含）；旧任务没有完成时间时回退到创建时间。
- 同任务重复的输出标识去重，只读 `outputs`，不重复累加结果中复制的 `assets` 元数据。
- 原 `monthly_usage.image_count` 继续表示计费任务次数，原有会员和管理员统计的含义不变。
- Memory 与 Gorm 仓库使用相同结果计数函数；Gorm 在用户、状态、类型和时间范围过滤后流式读取结果，没有最近 50/100 条的截断。
- 前端显示“张”；旧后台没有新字段时显示“—”，不会把旧任务次数作为图片数量。

## 修改文件

- `apps/api/internal/repository/job_repository.go`
- `apps/api/internal/repository/job_image_count.go`
- `apps/api/internal/repository/job_image_count_test.go`
- `apps/api/internal/handler/member.go`
- `apps/api/internal/handler/member_test.go`
- `apps/api/internal/router/router.go`
- `apps/studio/client/src/features/member/model/types.ts`
- `apps/studio/client/src/features/dashboard/DashboardPage.tsx`
- `apps/studio/client/src/features/projects/ProjectCardActions.test.tsx`

## 专项验证

使用独立 PostgreSQL 15 测试容器验证，两种仓库跑同一组用例：批量、多余请求数量、重复结果、编辑任务、免费任务、跨月、时间边界、旧记录、用户隔离、失败/取消/进行中、超过 100 条历史和取消请求。

```text
--- PASS: TestImageOutputCountValidatesActualResults
--- PASS: TestMonthlyImageOutputsMemory
--- PASS: TestMonthlyImageOutputsPostgres
--- PASS: TestMemberOverviewAndDetails
```

接口测试同时验证旧计费任务数 2 保持不变、新实际图片数为 3。

前端专项验证：旧任务数为 2、新图片数为 7 时显示“7张”；新字段缺失显示“—张”；真实零值显示“0张”。

```text
Test Files  1 passed (1)
     Tests  30 passed (30)
```

## 项目要求的验证

完整日志：`D:/AImanju4.0/.tmp/dashboard-image-count-20260930/`。

### API

在 `apps/api` 使用已有 Go 运行时执行：

```text
go build ./...
go build exit: 0
go vet ./...
go vet exit: 0
go test ./...
go test exit: 0
ok  github.com/ai-manju/api/internal/repository 0.581s
ok  github.com/ai-manju/api/internal/router 1.624s
ok  github.com/ai-manju/api/internal/service 16.889s
```

上述全量测试也启用了新增统计的独立 PostgreSQL 集成测试。

### Studio

```text
pnpm --filter ai-manhua-studio check
studio check exit: 0
```

初次 `pnpm --filter ai-manhua-studio test` 中，未修改的 `operationTask.test.ts` 发生超时及后续状态串扰，共 14 项失败；保留原日志。该文件单独复查 21 项通过。随后限制为 4 个执行进程复跑全部测试：

```text
pnpm --filter ai-manhua-studio exec vitest run --maxWorkers=4 --minWorkers=1
Test Files  262 passed (262)
     Tests  2074 passed (2074)
  Duration  35.98s
studio recheck exit: 0

pnpm --filter ai-manhua-studio build
✓ built in 9.38s
studio build exit: 0
```

构建仍有超过 500 kB 产物的体积提示，无编译错误。

### Canvas Agent、Director Desk、Worker

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
  Duration  92.35s

python -m compileall worker && python -m unittest discover -s tests
worker compile/test exit: 0
Ran 275 tests in 4.674s
OK (skipped=27)
```

Worker 在已有镜像中禁网、只读挂载源码执行。`git diff --check` 通过。

## 本地运行状态与交接

用户明确回复“现在重载本地后台”后，已将经过验证的 Linux 程序替换到本地 API 容器并重载。重载前保留原程序备份，没有重启 Worker、数据库或其他服务。

实际验证：

- API 容器启动时间 `2026-09-30T01:54:24.18090458Z`，状态 `running`。
- `/health` 返回 `success: true`、`db: ok`、`storage: postgres`。
- 容器内程序 SHA-256 与准备的程序一致：`0cc93ecbbc84c349498d7b5784867bf51c8a521e98347b8952ba5f4a8a4c0bcd`。
- 浏览器重新加载 `/dashboard` 后，新字段已返回，显示“图片生成 0 张”，提示“本月成功生成的图片张数”。本地账号当月统计确实为 0；未制造图片或测试生成任务充当真实数据。
- 卡片高度依然为 272px，可用积分仍为 600。

Linux 程序及原容器程序备份：

- `.tmp/dashboard-image-count-20260930/ai-manju-api`（Linux 构建退出码 0）
- `.tmp/dashboard-image-count-20260930/ai-manju-api.rollback`

没有 Git 提交或线上部署。当前容器已加载本次程序；以后重新创建 API 容器应按仓库 Dockerfile 重新构建镜像，不能继续使用旧镜像内的程序。

实际完成截图：`output/dashboard-image-count/actual-page.png`、`output/dashboard-image-count/actual-card.png`。更新前的兼容状态截图另留存为 `pending-backend.png`。
