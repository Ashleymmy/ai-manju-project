# 工作区整合与推送验收（2026-09-22）

## 范围与来源

- 对照助理 2 的完整对话，以及助理 1、3、6 当天对话整理工作区；同一功能按最后确认的要求整合。
- 助理 6 于 2026-09-22 09:50:06 UTC 完成资产包传输面板修改。本地成果保存为 `30d5041`，包含 100 个文件。
- 合入远端 `a0a0959`、`f9439d3`、`0cee1c9`、`c89496d`、`b38f8a3`：账号通道权限、H3 多参考图及签名原图、SD-video 音视频引用和准入错误。
- 本地修改涵盖提示词库加载、画布面板尺寸与位置、引用目录、节点命名及缩放、视频参数和截帧入口、页面宽度、资产目录 ZIP 跨账号共享及界面优化。
- 保留最终交互：其他素材按文件夹下钻、统一“资产助手”命名、画布工坊在未分类之前、分组缩放补偿截止于 45%、图片工具沿用独立入口。
- 助理 1 的本机服务恢复配置已记录在对应验收文档。Windows 计划任务和 `.tmp` 下的机器运行文件属于本地环境，不作为项目源码提交。

## 合并处理

三个文本冲突位于 `CanvasWorkspaceContent.tsx`、`generationGateway.ts`、`ParamsBar.tsx`。

- 保留 H3 的 9 张参考图、指定分辨率、横竖比例及音频/水印限制。
- 将两个 H3 变体的 1–15 秒范围加入后端模型能力目录；前端仍统一读取目录，避免恢复旧的硬编码时长档位。
- 保留新视频节点默认音频开启、显式关闭可恢复、默认 16:9 和显式比例选择。
- H3 超出目录范围的提交明确拒绝；切换模型或恢复配置时归一化后，界面显示值与请求值一致。增加对应前后端回归断言。

## 项目检查实际输出

所有命令针对合并后的代码执行。完整本地日志位于 `.tmp/push-20260922-*.log`。

### API

使用 Go 1.23 临时容器、只读源码及独立编译缓存执行 `go build ./... && go vet ./... && go test ./...`，退出码 0。build/vet 无输出，测试摘录：

```text
ok  github.com/ai-manju/api/internal/handler    14.264s
ok  github.com/ai-manju/api/internal/repository 0.008s
ok  github.com/ai-manju/api/internal/router    1.394s
ok  github.com/ai-manju/api/internal/service   0.161s
```

另使用本次新建且已清理的 PostgreSQL 16 临时容器验证资产包两套仓库：

```text
=== RUN   TestAssetPackageMemory
--- PASS: TestAssetPackageMemory (0.01s)
=== RUN   TestAssetPackageGormPostgres
--- PASS: TestAssetPackageGormPostgres (0.37s)
PASS
ok  github.com/ai-manju/api/internal/service 0.380s
```

需指定真实账号的远端通道只读核验测试按原设计跳过，未连接生产数据库。

### Studio

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit

pnpm --filter ai-manhua-studio test
Test Files  191 passed (191)
     Tests  1267 passed (1267)
  Duration  10.01s

pnpm --filter ai-manhua-studio build
✓ built in 3.30s
```

三项退出码均为 0。pnpm 提示现有 `pnpm.overrides` 配置位置已弃用；锁文件未变动。

### Canvas Agent / Director Desk

```text
pnpm --filter @basketikun/canvas-agent test
ℹ tests 4
ℹ pass 4
ℹ fail 0

pnpm --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  686 passed (686)
  Duration  93.70s
```

### Worker / SD-video

Worker 在禁用网络的临时容器中只读挂载源码，执行 `python -m compileall worker && python -m unittest discover -s tests`：

```text
Ran 104 tests in 2.198s
OK (skipped=1)
```

跳过项为未配置 `REDIS_TEST_URL` 的 Redis 集成测试。

SD-video 对本次远端修改执行 `python -m pytest -q -p no:cacheprovider tests/test_phase2_business.py`。首轮测试容器缺少 Pillow，补齐容器依赖后：

```text
11 passed, 1 warning in 0.69s
```

警告为现有 Starlette TestClient/httpx 弃用提示。

## 浏览器验收

画布在独立 Vite 测试端口运行，API 全部模拟；资产包测试使用新编译的 API、内存仓库与独立媒体目录，实际创建两个测试账号验证导出、导入、原文件字节、嵌套/空目录、标签、备注和重名独立副本：

```text
one user exports a folder ZIP and another restores files, nested/empty folders, labels and notes (9.0s)
1 passed (10.7s)
```

首轮画布 28 项中 22 项通过。失败集中于旧测试假设：节点长名称已省略，需从悬停标题确认完整名称；缩放后初始面板会覆盖框选起点；用于提示词引用的测试节点会挡住边缘节点的标题。更新测试定位与布局，保留产品行为及原有功能断言。

面板测试还改为等待刷新后的尺寸动画完成，并仅在初始面板存在时关闭它。最终 28 个画布场景均在各自最后一次运行通过：

- 视频历史、时长、音频默认与保存值、模式切换、分组缩放、节点命名等 11 项首轮通过。
- 资产选择器 5 项复核通过，覆盖桌面至 320px 窄屏、搜索筛选、缩略图及插入。
- 框选和连线 11 项最终复核通过，覆盖 50%/80%/100% 缩放、分组端口、双向连接及新建各类节点。
- 面板完整场景最终输出如下，包含三方向缩放、滚动、刷新恢复、边缘夹限、不同缩放及下方优先布局。

```text
ok 1 apps\studio\e2e\canvas-inspector-resize.spec.ts:18:1 › inspector resizes in three directions, expands its editor and restores saved dimensions (20.0s)
1 passed (21.1s)
```

共验证 29 个浏览器场景（含跨账号资产包）。复核期间仅调整测试，未新增产品代码变更。`git diff --check` 与暂存差异检查通过；未修改依赖锁文件。
