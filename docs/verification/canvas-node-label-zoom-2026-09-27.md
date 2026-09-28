# 节点名沿用分组名缩放规则

## 修改方向

生产改动仅在 `apps/studio/client/src/features/canvas/styles.css`：

- 节点名原本在低至 5% 时仍保持屏幕字号；现在与分组名共用 45% 的缩放补偿下限。
- 45% 至 100% 保持原字号；低于 45% 随画布缩小；高于 100% 随画布放大。
- 名称图标、名称输入框和名称到节点的间距使用同一缩放比例。
- 分组顶部预留空间同步使用新的名称比例，避免极小缩放时留下过大空白；分组连接点仍锚定原成员几何位置。
- 名称层级高于节点缩放手柄，防止极小比例时手柄延伸到名称区域、截获点击。工具栏和其他按钮的尺寸规则不变。
- 保留分组标题窄宽度保护、节点命名规则、复制与重命名逻辑，不更改数据和生成请求。

## 浏览器验证

先以原代码复现：画布 25% 时节点名实际屏幕比例仍为 1，分组名比例为 0.5556，新用例失败。修复后：

```text
pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio exec playwright test --config e2e/playwright.label-zoom.config.ts
7 passed (27.7s)
```

- 分组测试覆盖 100%、45%、25%、5%：标题贴合边框，不遮挡成员名，连接点位置不变，解绑按钮可点击。
- 1600px 桌面和 390px 手机通过实际加减按钮连续缩放，检查 45%、25%、5%、75%、105%、155% 的字号比例及名称间距。
- 图片、视频、音频、文本、提示词、备注、配置、导演节点均覆盖；高倍放大时按画布正常屏外卸载规则检查仍渲染的节点。
- 命名与可读性回归覆盖导入去后缀、重名、复制粘贴、重命名、刷新恢复，以及 25%/5% 下名称点击、工具栏尺寸和复制按钮操作。
- 等待入场动画结束后测量实际屏幕尺寸，包含节点边框对名称间距的影响。
- 人工核看桌面和手机截图。截图位于 `test-results/canvas-label-zoom`。

使用已有 3100 服务、独立 Playwright 配置，业务 API 全部模拟，无真实项目写入、积分消耗或付费生成；没有重启服务。

## 项目验收

以下为本轮实际输出摘要，命令全部退出 0。pnpm 均附加 `--config.verify-deps-before-run=warn`，未更换依赖或修改锁文件。

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit

pnpm --filter ai-manhua-studio test
Test Files  223 passed (223)
     Tests  1620 passed (1620)
  Duration  11.13s

pnpm --filter ai-manhua-studio build
vite v7.3.6 building client environment for production...
2972 modules transformed.
built in 9.15s

pnpm --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  689 passed (689)
  Duration  89.18s
```

API 在 `apps/api` 使用已有 `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe`：

```text
go build ./...  (退出 0，无输出)
go vet ./...    (退出 0，无输出)
go test ./...   (全部通过，输出节选)
ok github.com/ai-manju/api/internal/handler (cached)
ok github.com/ai-manju/api/internal/provider (cached)
ok github.com/ai-manju/api/internal/repository (cached)
ok github.com/ai-manju/api/internal/router (cached)
ok github.com/ai-manju/api/internal/service (cached)
```

Worker 在已有 `ai-manju-worker-monitoring:20260923` 容器中，只读挂载当前源码运行：

```text
python -m compileall worker
Listing 'worker'...
Compiling 'worker/__init__.py'...
...
Compiling 'worker/video_references.py'...

python -m unittest discover -s tests
Ran 131 tests in 2.124s
OK (skipped=9)
```

保留现有依赖/锁文件不同步、大 chunk 及 assets 静态/动态混合导入提醒；9 项 Worker 跳过不计为已验证通过。

本轮未提交、未推送。前两轮页面加载居中和视频模式手动选择改动保留。
