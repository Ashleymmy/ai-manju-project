# 导入导出任务与左侧入口验收

后续画布入口调整：画布内已按用户指定改为右下角 Agent 左侧的纯图标入口，原生悬浮提示“导入任务”；非画布页面仍保留左侧入口。最新验收见 `canvas-import-task-entry-2026-09-28.md`。

状态：代码实现、本地隔离测试与真实服务验收完成；已更新本地 3101 API 和导出 Worker。未提交、未推送、未部署线上。

## 实现

- 资产库「导出任务」旁增加「导入任务」，各自支持展开/收起，空记录也有明确空状态。
- 导出、导入面板固定高度 380px，低视口限制为 65dvh；内容区单独滚动，标题与操作留在面板内。覆盖全局隐藏滚动条样式。
- 导出取消只截取最近 5 条的限制，按 20 条一页渲染，可翻到更早任务。删除操作有二次确认、请求中状态与失败反馈。
- 导入面板同时用于资产库与全局弹窗。已完成任务可删除记录，未完成任务可结束并删除，本地 IndexedDB 的任务与源包在同一事务中清理，不删除已经导入的素材。
- 全局导入入口移到左侧同步卡片上方，并缩短左侧导航滚动区，避免入口遮挡导航。窄侧栏使用图标，手机限制入口宽度；右下角 Agent 入口未改动。
- 新增 `DELETE /api/asset-exports/:exportId?scope=...`，沿用原鉴权、工作区隔离和统一响应。进行中的任务拒绝直接删除，须先取消。终态任务清理专用打包文件，再事务删除记录和条目；不会操作原资产。
- Memory/Gorm 仓库实现一致。补上任务取消删除恰好与打包最终写入并发时的文件回收。存储清理失败保留记录供重试。

主要前端：`AssetImportTaskPanel.tsx`、`AssetImportTaskHost.tsx`、`AssetTransferStatus.tsx`、`importTask.css`、`assetTransfer.css`、`AssetsPage.tsx`、`importTaskManager.ts`、`queries.ts`。
主要后端：`asset_export.go`、`asset_export_repository.go`、`asset_export_service.go`、`router.go`。

## 缓存结论

1. 导出列表在浏览器保存任务信息，不预加载 ZIP。下载沿用原生浏览器下载，不为每条历史任务常驻分配整个压缩包。文件在服务器保留 7 天，过期后清理文件，但历史记录原先会继续留存；现在可主动删除记录及仍存在的打包文件。已经下载到用户电脑的文件不会被远程删除。
2. 导入每账号保留当前/最近一条任务，原包与检查点分库存于 IndexedDB。暂停或失败时保留源包用于恢复，可能占用较大磁盘空间；完成时原逻辑会自动删除源包。删除任务会连同源包和检查点一起清理。
3. 磁盘存储占用不等同于页面运行内存，不能直接把用户卡顿归因于历史文字记录。极多记录、频繁重新请求和渲染可能加重负担。
4. 本轮减少后台负担：导出面板及详情导出页均关闭时查询禁用；每页最多渲染 20 条；导入管理器仍轮询以支持跨标签页接续，但闲置记录不变时不再发布相同状态，避免整个资产库重复重绘。
5. 为保持 API 行为兼容，服务端列表仍返回任务数组；本次翻页是前端渲染分页，不宣称完成服务端分页或实测证明所有卡顿消失。

## 验证

使用 pnpm 参数 `--config.verify-deps-before-run=warn`，没有重新安装依赖或更改锁文件。

### Studio

`pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio check`

```text
$ tsc --noEmit
exit 0
```

`pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio test`

```text
Test Files  228 passed (228)
     Tests  1653 passed (1653)
  Duration  10.77s
```

`pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio build`

```text
✓ 2294 modules transformed.
✓ built in 3.98s
✓ 2978 modules transformed.
✓ built in 6.38s
```

沿用现有依赖/锁文件不同步、pnpm.overrides、chunk 大小和 assets 静态/动态导入警告。

### 浏览器

`pnpm --config.verify-deps-before-run=warn exec playwright test --config apps/studio/e2e/playwright.transfer-tasks.config.ts`

```text
18 passed (52.3s)
```

最终滚动条样式调整后重跑 `asset-transfer-tasks`：

```text
7 passed (40.1s)
```

关闭测试浏览器默认隐藏滚动条参数后，三种视口截图专项再次通过：`3 passed (16.5s)`。已查看最终截图，确认滚动条实际可见。

覆盖 42 条导出任务分页、删除确认/取消确认/失败保留/刷新后不再出现、completed/paused 导入的真实 IndexedDB 删除及另一账号数据保留、空状态、按钮展开收起、1920/1000/390px 固定高度和滚动、左侧入口与同步卡/导航不相交。包含前一轮分类标签与批量编辑回归。
浏览器 API 用模拟数据，IndexedDB 为测试浏览器的真实独立存储，没有操作用户资产。任务面板截图位于 `.tmp/transfer-task-qa`；截图配置关闭 headless 默认隐藏滚动条参数，以核对实际滚动条。

### API 与数据库

使用现有本地 Go 工具链，`go build ./...`、`go vet ./...` 退出 0，`go test ./...` 最终通过。实际输出摘录：

```text
ok  github.com/ai-manju/api/internal/handler     14.819s
ok  github.com/ai-manju/api/internal/repository (cached)
ok  github.com/ai-manju/api/internal/router     (cached)
ok  github.com/ai-manju/api/internal/service    8.068s
```

额外在本次创建的独立 PostgreSQL 15 容器/数据库运行 `TestGormAssetExportDeleteIntegration`，7 种状态的删除规则、跨空间拒绝和条目清理全部通过：

```text
--- PASS: TestGormAssetExportDeleteIntegration (0.96s)
PASS
ok  github.com/ai-manju/api/internal/repository 1.082s
```

独立测试容器 `ai-manju-transfer-qa-20260928` 已移除；未连接业务 PostgreSQL 数据库。
服务层测试还验证两种导出存储清理、保留原素材、文件删除失败可重试、取消删除与最终写入并发不遗留文件；处理器测试验证响应、404 隔离和 409 进行中保护。

### 其他规定检查

```text
Canvas Agent: tests 4; pass 4; fail 0
Director Desk: Test Files 87 passed (87); Tests 689 passed (689)
Worker compileall: exit 0
Worker unittest: Ran 131 tests in 2.107s; OK (skipped=9)
git diff --check: exit 0
```

Worker 使用现有镜像 `ai-manju-worker-monitoring:20260923` 只读挂载代码执行 `python -m compileall worker` 和 `python -m unittest discover -s tests`。检查中仅保留现有 CRLF/LF 提示。

## 交付边界

界面通过现有 Studio 开发服务 `http://localhost:3100/assets` 可预览。本地 API 和导出 Worker 已更新为 `ai-manju-transfer-tasks:20260928`，健康检查正常。线上站点未部署本次更新。现有工作区其他修改全部保留。

## 追加修复：导入栏统一与本地删除 404

### 变更

- 导入、导出共用 `AssetTransferPanel` 标题、计数、滚动区域和固定底栏，任务使用同一行布局、状态徽标和右侧操作区。
- 移除导入专用的大块进度摘要和标题栏文字删除按钮，改为任务行内的紧凑进度、暂停/继续/重试和删除图标。
- 导入警告与失败详情可展开，长内容在统一内容区滚动；资产库内嵌面板与全局弹窗同步生效。
- 保留真实导入状态及 IndexedDB 清理逻辑，没有虚构导入历史或日期。

### 404 根因与运行环境

本地日志中请求 `31704a1a-ed20-4466-aff7-34f65f6dc7a5` 为 `DELETE /api/asset-exports/asset_export_f35d27fe3337b3ab78912746` 返回 404。旧镜像 `ai-manju-runtime-monitoring:20260923` 未加载新增 DELETE 路由。

本轮从当前源码构建 Linux API 和导出 Worker，基于原本地镜像生成新镜像，只重建这两个本地服务。保留 API 的原环境、导出 Worker 的原环境快照、挂载卷和服务配置。未重建 PostgreSQL、Redis、生成 Worker，未重置业务数据库。

未登录的无效 ID 探针修复前为 `404 page not found`，更新后为 401 的统一鉴权响应，证明路由已加载。未用用户截图中的真实任务执行删除测试。

### 本轮实际验证输出

```text
Studio check: $ tsc --noEmit; exit 0
Studio test: Test Files 229 passed (229); Tests 1659 passed (1659)
Studio build: vite v7.3.6; built in 6.52s; exit 0
Playwright transfer/bulk-details/tag-hierarchy: 18 passed (1.1m)
API go build ./...: exit 0
API go vet ./...: exit 0
API go test ./...: exit 0; all tested packages ok (cached)
Canvas Agent: tests 4; pass 4; fail 0
Director Desk: Test Files 87 passed (87); Tests 689 passed (689)
Worker compileall: exit 0
Worker unittest: Ran 131 tests in 2.073s; OK (skipped=9)
git diff --check: exit 0 (existing CRLF warning only)
```

新增 6 项导入面板测试覆盖运行/暂停/失败/完成状态、真实控制回调、删除确认及取消、准备中禁用操作和存储异常。浏览器覆盖 1920/1000/390px，断言两栏标题高度一致、展开详情不增加面板高度、内层可滚动且不横向溢出，已查看桌面和窄屏截图。

### 真实删除闭环

使用新建隔离测试账号和 1 个测试 PNG，在本地真实服务完成上传、异步打包、浏览器点击删除并确认、刷新资产库。没有模拟 API。

```text
PASS: real browser DELETE=200; reload empty; database batch/items removed;
archive removed; original pixels intact; cross-account DELETE=404.
QA cleanup: only generated test assets/tasks removed;
isolated account user_d61b3d86a7527378 disabled.
/ai-manju-40-api-1 ai-manju-transfer-tasks:20260928 healthy
/ai-manju-40-asset-export-worker-1 ai-manju-transfer-tasks:20260928 healthy
```

原素材通过内容接口按字节核验不变；只在测试结束后清理新建测试素材，测试账号已禁用，保留审计记录。原业务导出任务更新前后仍为 expired=2、succeeded=3。

真实流程脚本在 `.tmp/transfer-task-runtime/verify-local.cjs`，只连接本地端口。镜像、Compose 本地覆盖文件和运行环境快照在 `.tmp/transfer-task-runtime`（Git 忽略，含配置快照不得提交或分享）。截图在 `.tmp/transfer-task-qa/real-export-before-delete.png` 与 `real-export-after-reload.png`。

保留既有依赖同步提示和构建包体积警告，本轮没有改动依赖或锁文件。
