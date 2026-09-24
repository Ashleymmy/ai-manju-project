# 画布节点名称：去文件后缀与重名编号

2026-09-23，本地完成。用户截图中的 `1 (2).png` 导入后，节点实际名称与重命名输入框均为 `1 (2)`。

## 行为与范围

- 图片、视频、音频及其他节点共用名称规则，移除已知文件扩展名；导入、生成完成、重命名、复制粘贴、快照保存和重新打开均覆盖。
- 重名使用全角括号：`苹果`、`苹果（1）`、`苹果（2）`。数字名称保留：`苹果1` 重名为 `苹果1（1）`；`001.png`、`001.mp4`、`001.wav` 分别成为 `001`、`001（1）`、`001（2）`。
- 复制仍保留“副本”含义：`苹果副本`、`苹果副本（1）`、`苹果副本（2）`。
- 已有名称优先，预留用户已命名的括号名称；旧名称末尾普通数字不自动改写，以免误改用户名称。
- 批量图片结果不再使用另一套 ` · 2` 编号，统一按同名冲突分配括号编号。批次根的进度汇总名称保持原行为。
- 长名称缩略时保留括号编号，便于区分；存储和输入框保留完整名称。
- 清理的是画布节点标题，资产 ID、媒体内容、格式和下载文件的正确扩展名不受影响。

## 改动

- `apps/studio/client/src/features/canvas/domain/nodeTitles.ts`：统一清理标题、重名与副本编号、缩略显示。
- `apps/studio/client/src/features/canvas/domain/nodes.ts`：读取与保存标题时清理扩展名，包含 imported/titleEdited 节点。
- `apps/studio/client/src/features/canvas/domain/imageTitles.ts`、`generation.ts`：生成结果沿用统一命名空间。
- 对应领域、store 测试，以及 `generationTitles.test.ts`、`e2e/canvas-node-readability-names.spec.ts`。

未改动其他助理正在处理的 Agent 文档导入文件、依赖与配置；无提交、部署或共享服务重启。

## 浏览器验收

本地 Chrome 无头浏览器，访问 `http://127.0.0.1:3100`。接口拦截到独立测试画布，不修改真实项目、不调用收费生成服务。

实际执行文件选择、节点创建、双击重命名、复制、键盘复制粘贴、保存和重新加载。上传接口模拟原样返回 `.png`、`.mp4`、`.mp3` 文件名，断言节点输入框和保存的标题均无扩展名。视频/音频文件内容是测试占位数据，本次验收针对命名，不验证媒体播放编码。生成结果通过领域测试模拟完成回调验证。

```
node node_modules/@playwright/test/cli.js test --config .tmp/canvas-node-names-20260923/playwright.config.ts
1 passed (19.3s)
```

截图：`.tmp/canvas-node-names-20260923/browser/canvas-node-readability-na-05112-ay-readable-when-zoomed-out/imported-title-without-extension.png`，已目视确认输入框为 `1 (2)`。另外验证 25% / 5% 缩放下名称与工具条可读。浏览器运行中无 pageerror。

首次浏览器测试因旧标题的 DOM 选区接收粘贴而未完成；测试聚焦舞台后按现有舞台适配器行为清除旧选区，重跑通过。首次生成标题测试漏传音频配置 model，补齐测试数据后全量通过。

## 项目要求的验证及实际输出

完整日志位于 `.tmp/canvas-node-names-20260923/`。

当前环境全局 pnpm 会触发联网检查，因此使用仓库已安装的 pnpm 运行同名命令，并设置 `npm_config_manage_package_manager_versions=false`。未为本任务安装项目依赖。

### Studio

```
pnpm --filter ai-manhua-studio check
> tsc --noEmit
```

退出码 0。

```
pnpm --filter ai-manhua-studio test
Test Files  205 passed (205)
     Tests  1404 passed (1404)
  Start at  09:46:46
  Duration  10.50s
```

```
pnpm --filter ai-manhua-studio build
✓ built in 5.54s
```

退出码 0。保留现有“大于 500 kB 的构建块”提示，未阻断构建。

### API

使用已有 Go 运行时 `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe` 和模块缓存，在 `apps/api` 执行 `go build ./...`、`go vet ./...`、`go test ./...`。build/vet 无输出，三项退出码均为 0。

```
ok  github.com/ai-manju/api/cmd/asset-export-worker (cached)
ok  github.com/ai-manju/api/internal/assetmigration (cached)
ok  github.com/ai-manju/api/internal/config (cached)
ok  github.com/ai-manju/api/internal/handler (cached)
ok  github.com/ai-manju/api/internal/middleware (cached)
ok  github.com/ai-manju/api/internal/provider (cached)
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

```
pnpm --filter @basketikun/canvas-agent test
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

```
pnpm --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  689 passed (689)
  Duration  126.56s
```

### Worker

复用已有 Worker Docker 镜像，源码只读挂载；临时安装 httpx 到容器 /tmp，字节码缓存也写入 /tmp。在 `/app` 执行 `python -m compileall -q worker` 和 `python -m unittest discover -s tests`。

```
Ran 113 tests in 2.189s
OK (skipped=1)
```

退出码 0。`git diff --check` 通过。
