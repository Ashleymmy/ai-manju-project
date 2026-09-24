# 画布节点类型图标与名称长度

2026-09-23，本地完成。

## 改动

- 所有节点的名称前标记改为 14px 线条图标：图片、视频、音频、文本、提示词、备注、配置、导演台均有映射。保留中文悬浮说明和无障碍名称。
- 视频“截取当前帧”按钮改为 28px 方形圆角图标按钮，继续位于右上角；保留原点击操作、禁用状态与中文悬浮说明，截取中显示旋转图标。
- 节点名称统一显示前 8 个 Unicode 字符，超出后加省略号。保留完整编辑名称、完整悬浮名称和可见的重名括号编号。
- 文件：`CanvasNodeCard.tsx`、`canvas/styles.css`、`domain/nodeTitles.ts`，同步已有标题和浏览器检查的期望值。保留同一组件中其他助理新增的生成重试状态修复。

未提交、未部署、未重启共享服务。

## 页面验证

复用 `canvas-node-readability-names.spec.ts`，访问 `http://127.0.0.1:3100`，使用独立模拟 API 和测试画布。验证命名、导入、复制粘贴、双击编辑、保存刷新及 25% / 5% 缩放。媒体使用测试占位数据；本次验证显示和交互入口，不调用生成服务。

```
node node_modules/@playwright/test/cli.js test --config .tmp/canvas-node-icons-20260923/playwright.config.ts
1 passed (15.5s)
```

已目视检查 `.tmp/canvas-node-icons-20260923/browser/canvas-node-readability-na-05112-ay-readable-when-zoomed-out/video-capture-icon.png`：名称前为图标，视频右上角只显示相机图标，标题显示前 8 字并省略余下部分。页面无 pageerror。

## 项目验证输出

日志目录：`.tmp/canvas-node-icons-20260923/`。使用已安装的 pnpm CLI 执行下列项目命令，环境变量 `npm_config_manage_package_manager_versions=false`；未安装新的项目依赖。

```
pnpm --filter ai-manhua-studio check
> tsc --noEmit
```

退出码 0。

```
pnpm --filter ai-manhua-studio test
Test Files  205 passed (205)
     Tests  1418 passed (1418)
  Duration  10.98s
```

```
pnpm --filter ai-manhua-studio build
✓ built in 5.52s
```

退出码 0；构建仍有现有大于 500kB 的分包提示。

API 在 `apps/api` 使用已有 Go 运行时执行 `go build ./...`、`go vet ./...`、`go test ./...`，三项退出码均为 0。build/vet 无输出，test 输出节选：

```
ok  github.com/ai-manju/api/internal/handler (cached)
ok  github.com/ai-manju/api/internal/provider (cached)
ok  github.com/ai-manju/api/internal/repository (cached)
ok  github.com/ai-manju/api/internal/router (cached)
ok  github.com/ai-manju/api/internal/service (cached)
```

完整输出见 `api-test.log`。

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
  Duration  129.96s
```

Worker 使用现有 Docker 镜像、只读源码挂载和临时依赖目录，执行 `python -m compileall -q worker`、`python -m unittest discover -s tests`：

```
Ran 113 tests in 1.982s
OK (skipped=1)
```

退出码 0。`git diff --check` 通过。
