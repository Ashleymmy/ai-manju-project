# 画布空媒体节点与提示词面板避让（2026-09-23）

## 本地修改

用户要求：提示词编辑框不要覆盖节点，未生成的媒体节点参考空文件样式；视频和图片都适用。

- 无媒体预览的图片/视频节点显示类型图标、“尝试上传或生成…”和上传按钮。节点不再重复显示 content / composerContent 中的长提示词。双击打开提示词面板，不再进入节点内的重复编辑器。
- 上传复用既有文件输入与替换流程；提示词、引用、错误重试、进度、已有图片与视频播放均保留。
- 提示词面板优先在节点下方，空间不足时寻找侧边/上方；完全无可用区域时先平移、必要时缩小画布视野腾出空间，再显示面板。节点坐标、尺寸及提示词不变。
- 去掉覆盖节点的 fallback 位置及可能越界的弹性缩放入场效果。
- 画布舞台使用 overflow: clip，避免浏览器 focus / scrollIntoView 原生滚动舞台而未同步旁边的面板坐标。
- 长错误信息限制在可滚动区域内，提示词至少保留一行可编辑空间；特别矮的窗口允许面板内容滚动，避免控件把编辑区挤没。

本次文件：CanvasNodeCard.tsx 与测试、inspectorSize.ts 与测试、CanvasWorkspaceContent.tsx 的 selectedPanelStyle 计算及视野避让 effect、CanvasInspector.tsx 中图片状态信息的位置、inspectorResize.css、canvas/styles.css 的舞台与空媒体样式，以及既有 canvas-inspector-resize.spec.ts。

其他助理同时修改同一工作区的缩略图导航、批量下载、引用断连等逻辑；其改动均保留。没有提交、部署、重启共享服务或请求实际生成。

## 专项验证

```text
vitest run client/src/features/canvas/domain/inspectorSize.test.ts client/src/features/canvas/ui/CanvasNodeCard.test.tsx
Test Files  2 passed (2)
     Tests  39 passed (39)
```

新增用例验证无空间时不返回重叠面板、视野调整后保持间距且节点数据不变；失败图片/视频的长提示词不出现在节点内，上传与双击编辑仍可用。

浏览器：隔离 Chrome 上下文，拦截全部业务 API，不写入用户项目。复用并扩展已有面板缩放回归。

```text
node node_modules/@playwright/test/cli.js test --config .tmp/canvas-prompt-clearance/playwright.config.ts
1 passed (41.3s)
```

该用例覆盖：宽、高、自由缩放，保存后刷新恢复；编辑器滚动；左右贴边；50%/100%/200% 缩放；节点下方优先；846×555 中失败图片/视频及长错误；1600×1000 大节点超出窗口；390×640 手机视口；拖动节点后不重叠；原生 scrollTo 不再改变舞台偏移；提示词和节点数据未被清除。已人工查看相关截图。

截图：`.tmp/canvas-prompt-clearance/video-result.png`、`image-result.png`。完整截图位于 `.tmp/canvas-prompt-clearance/browser/`。

## 项目规定检查及实际结果

日志位于 `.tmp/canvas-prompt-clearance/`。

Studio 首轮类型检查、全量测试通过：

```text
$ tsc --noEmit
Test Files  200 passed (200)
     Tests  1348 passed (1348)
  Duration  10.97s
```

其后其他助理添加引用断连测试，最终类型检查与全量测试发现同一兼容问题：

```text
CanvasInspectorMentionInsertion.test.tsx(76,24): error TS2339:
Property 'toHaveBeenCalledExactlyOnceWith' does not exist on type 'Assertion<Mock<Procedure>>'.

Test Files  1 failed | 199 passed (200)
     Tests  8 failed | 1349 passed (1357)
  Duration  9.90s
```

八个失败均为 CanvasInspectorMentionInsertion.test.tsx 的新断连断言使用当前 Vitest 2 不支持的 `toHaveBeenCalledExactlyOnceWith`。未改动其他助理的测试；已记入交接。整个工作区不能宣称全量检查通过。

Studio 最终构建：`pnpm --filter ai-manhua-studio build`，退出码 0。

```text
../dist/public/assets/CanvasPage-BJLR5rcd.js 342.17 kB | gzip: 105.48 kB
✓ built in 4.31s
```

首次构建遇到输出目录 `dist/public/director-desk` 的 ENOTEMPTY（共享输出目录并发修改），正常重跑完成，未手动清除共享目录。仍有大于 500 kB 的已有分包提示。

API：使用已安装的本地 Go 和模块缓存，`go build ./...`、`go vet ./...`、`go test ./...`，均退出码 0。

```text
ok github.com/ai-manju/api/internal/handler (cached)
ok github.com/ai-manju/api/internal/repository (cached)
ok github.com/ai-manju/api/internal/router (cached)
ok github.com/ai-manju/api/internal/service (cached)
ok github.com/ai-manju/api/internal/storage (cached)
```

Canvas Agent：`pnpm --filter @basketikun/canvas-agent test`，退出码 0。

```text
tests 4
pass 4
fail 0
```

Director Desk：`pnpm --filter @ai-manju/director-desk test`，退出码 0。

```text
Test Files 87 passed (87)
Tests 686 passed (686)
Duration 132.19s
```

Worker：独立临时容器只读挂载源码，临时安装缺少的 httpx，`python -m compileall -q worker && python -m unittest discover -s tests`，退出码 0。

```text
Ran 105 tests in 2.655s
OK (skipped=1)
```

`git diff --check` 通过，pnpm 自动删除的 overrides 已精确恢复。
