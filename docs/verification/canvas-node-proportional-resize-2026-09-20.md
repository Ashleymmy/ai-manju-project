# Canvas 图片与视频节点等比缩放验收

后续补充：用户要求仅修正视频显示比例。视频现已改为无需选中即可读取元数据并适配，覆盖下文初版的“选中或悬停时读取”策略。见 `canvas-video-native-ratio-2026-09-20.md`。

## 修改范围

- 右下角拖动此前分别更新宽高，导致媒体节点被拉成长条并出现空白。本次图片、视频统一锁定宽高比，文本等其他节点继续自由缩放。
- 优先采用已读取的媒体尺寸；媒体尚未加载时采用节点当前比例。鼠标横向、纵向、斜向移动均按同一比例计算，最小/最大尺寸整体限幅，不再分别截断宽高。
- 图片加载时纠正旧的拉伸框；正常等比调整后的尺寸保持不变，不会每次加载都重置。初次适配超宽/超高图片也保留真实比例。
- 视频在选中或悬停时读取元数据，复用图片的框体校正与比例记录；闲置视频仍不主动预加载。视频显示完整画面，不使用裁切掩盖框体比例问题。
- 保留现有指针捕获、画布缩放换算、批量帧更新、撤销/重做和持久化路径。未修改 API、鉴权或两套仓库实现。
- 未提交、推送或部署，未回滚工作区其他任务的修改。

## 自动验证实际输出

Studio 使用现有依赖，执行时加 `--config.verify-deps-before-run=warn`，未安装依赖或修改锁文件。

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit
Exit code: 0

pnpm --filter ai-manhua-studio test
Test Files  179 passed (179)
     Tests  1129 passed (1129)
  Duration  8.16s

pnpm --filter ai-manhua-studio build
Director Desk: built in 4.01s
Studio: built in 3.12s
Exit code: 0

pnpm --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  686 passed (686)
  Duration  89.12s
```

新增用例覆盖图片/视频、无媒体尺寸时的回退、横向/纵向/反向拖动、方图与极端比例、尺寸上下限、50%/100%/200% 画布缩放、仅点击不产生历史记录、旧拉伸框校正和重复加载幂等。首次定向测试有三项使用了当前 Vitest 不支持的断言，已改为兼容断言并通过上述全量测试。

构建保留 Director Desk 既有大 chunk 警告，以及 pnpm 依赖与锁文件不同步、package.json pnpm 配置字段的提示。

后端复用 `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe` 和已有模块缓存，执行 `go build ./...`、`go vet ./...`、`go test ./...`，均退出 0。测试输出摘录：

```text
ok github.com/ai-manju/api/internal/handler     14.173s
ok github.com/ai-manju/api/internal/provider     0.561s
ok github.com/ai-manju/api/internal/repository   0.228s
ok github.com/ai-manju/api/internal/router       0.625s
ok github.com/ai-manju/api/internal/service      2.287s
ok github.com/ai-manju/api/internal/storage      0.509s
```

Worker `python -m compileall worker` 退出 0。默认 Python 缺少多项 Worker 依赖，第一次 unittest 结果为 22 项、10 个错误、1 个跳过；改用已有 `.tmp/canvas-quality-qa/worker-venv/Scripts/python.exe` 后执行 `python -m unittest discover -s tests`：

```text
Ran 82 tests in 0.237s
FAILED (errors=1, skipped=2)
AttributeError: module 'signal' has no attribute 'SIGKILL'
```

剩余错误来自既有 `test_shutdown_has_shared_deadline_and_kills_stuck_pool` 使用 Windows 不支持的 SIGKILL。本次未改 Worker，未为前端任务扩展修改平台兼容逻辑。

## 浏览器验收

通过 `apps/studio/e2e/canvas-node-resize.spec.ts`，使用真实 Chrome 指针事件和隔离 API mock，不读取或修改用户真实项目、不发起付费生成：

```text
image 640:360 keeps source proportions through drag, undo and reload: passed
image 360:640 keeps source proportions through drag, undo and reload: passed
video 640:360 keeps source proportions through drag, undo and reload: passed
video 360:640 keeps source proportions through drag, undo and reload: passed
4 passed (26.7s)
```

覆盖 1440x1000 桌面、390x844 窄屏，在 50% 画布缩放下实际拖动，验证比例、撤销/重做、自动保存、刷新恢复及可触及的缩放手柄，页面无未捕获异常。视频素材为测试内录制的 MP4。截图在 `.tmp/node-resize-qa/`，已目视检查竖版视频和窄屏横版图片，媒体完整显示、圆形未变形。`git diff --check` 通过。

本地前端继续运行于 http://localhost:3100 ，未重启已有服务。
