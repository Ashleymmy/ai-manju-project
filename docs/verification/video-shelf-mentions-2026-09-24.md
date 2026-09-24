# 视频输入区引用与光标修复验证

后续排列需求已更新：短引用自适应同行，不固定四个；长引用单独一行。最新结果见 `video-reference-flow-2026-09-24.md`，本文件保留上一轮验证记录。

日期：2026-09-24。范围：`/video` 视频生成界面，不修改画布编辑器、积分、鉴权或后端接口。未提交、未推送。

## 修改方向

- 点击下方素材架中的图片、视频或音频，插入到提示词的当前选区；失焦后保留上次选区，从未聚焦时追加到末尾。移除按钮独立工作，不触发引用、预览或生成。
- 按最新要求，每条引用独占一行。旧草稿、历史重新编辑、粘贴引用都使用同一规则，历史消息本身不改写。
- 提示词存储和提交仍使用原始 `@[ref:id]`。输入框中改用短的不可断行占位，避免长内部编号决定引用宽度、跨行拆分。
- 原生输入与视觉覆盖层使用相同字体、行高、换行规则及可用宽度，并同步滚动。缩略图、图标只作装饰，不改变文本排版。
- 点击引用内部吸附至边界；左右键跳过整条引用；复制、剪切、粘贴保留真实引用 ID。回车换行，中文输入法合成期间不触发快捷生成。
- 底部操作区独立于输入区，长文本滚动时不会被生成按钮遮挡。
- 修复资产库混合批量导入的陈旧状态校验：后续素材校验包含本批已接受的素材，图片/视频先于音频检查，避免先选音频被误判为单独音频，也避免绕过批量数量限制。

## 本次文件

- `apps/studio/client/src/features/video/ui/Composer.tsx`
- `apps/studio/client/src/features/video/styles.css`
- `apps/studio/client/src/features/video/model/promptEditor.ts`
- `apps/studio/client/src/features/video/model/promptEditor.test.ts`
- `apps/studio/client/src/features/video/ui/Composer.test.tsx`
- `apps/studio/client/src/features/video/ui/VideoWorkbenchView.tsx`
- `apps/studio/client/src/features/video/ui/VideoWorkbenchView.test.tsx`
- `apps/studio/e2e/video-shelf-mentions.spec.ts`
- `apps/studio/e2e/playwright.video-shelf.config.ts`
- `apps/studio/e2e/fixtures/video-shelf-reference.mp4`

## 验证结果

所有 pnpm 命令使用 `--config.verify-deps-before-run=warn`，保留工作区现有依赖，未自动安装或改动锁文件。

### 本项测试

```text
pnpm --filter ai-manhua-studio exec vitest run client/src/features/video/ui/Composer.test.tsx client/src/features/video/model/promptEditor.test.ts client/src/features/video/ui/VideoWorkbenchView.test.tsx client/src/features/video/model/referenceEngine.test.ts
Test Files  4 passed (4)
     Tests  27 passed (27)

pnpm --filter ai-manhua-studio exec playwright test --config e2e/playwright.video-shelf.config.ts
ok 1 ... prompt references at 1920px
ok 2 ... prompt references at 1280px
ok 3 ... prompt references at 390px
3 passed (9.0s)
```

浏览器测试：先选音频，再同时导入两张图片及一个视频；鼠标和键盘插入、多次引用、独立移除；逐行标签；原生文字镜像与标签坐标差小于 1px；点击定位、左右键、鼠标拖拽选区；复制原始 ID；40 条引用滚动同步；操作栏与输入区不重叠；提交请求包含真实图片、视频和音频数据，而非只有标签文本。

所有 API 请求被拦截，未创建真实生成任务、未消费积分或改动真实账号配置。最终稳定测试隔离 Google 字体 CDN，以避免外网字体加载阻塞截图；之前的桌面验证也已使用正常加载的页面字体通过。

截图位于 `D:/AImanju4.0/test-results/video-shelf-mentions/`，各视口分别有 `shelf-inserts-media-mentions.png` 与 `scrolled-reference-caret.png`。

### 全项目检查

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit_code: 0

pnpm --filter ai-manhua-studio build
Director Desk: built in 8.51s
Studio: built in 10.92s
exit_code: 0

pnpm --filter @basketikun/canvas-agent test
tests 4; pass 4; fail 0

pnpm --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  689 passed (689)

go build ./...
exit_code: 0
go vet ./...
exit_code: 0
go test ./...
ok github.com/ai-manju/api/internal/handler 14.755s
ok github.com/ai-manju/api/internal/router 1.509s
ok github.com/ai-manju/api/internal/service 8.343s
其余含测试包均为 ok；exit_code: 0

python -m compileall worker
exit_code: 0
python -m unittest discover -s tests
Ran 118 tests in 1.909s
OK (skipped=2)
```

Go 使用工作区 `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe`。Worker 使用 `ai-manju-worker-monitoring:20260923` 的 Python，以只读方式挂载当前源码；未重启服务或部署 Worker。

### 全量 Studio 测试的并行工作区变更

```text
16:38:55 本轮全量测试：
Test Files  223 passed (223)
     Tests  1593 passed (1593)

16:47:07 收尾重跑：
Test Files  1 failed | 222 passed (223)
     Tests  1 failed | 1592 passed (1593)
```

剩余失败：`features/canvas/controllers/assets-mentions/controller.test.ts:179`，预期节点类型顺序 `[image, video, image]`，实际为 `[image, image, video]`。单独重跑可复现。工作期间该画布控制器增加了 `compareAssetTypes` 排序（文件修改时间 16:42:04），而对应测试仍断言旧顺序。本任务没有编辑或回滚该控制器及其测试。本次视频相关 27 项及三种视口测试均通过，但不能将当前全量工作区测试声称为全绿。

构建保留现有大包体积和动态/静态混合导入警告；pnpm 提示已安装依赖与锁文件不完全同步，未作无关依赖更新。
