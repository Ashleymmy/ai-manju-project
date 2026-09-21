# Canvas 视频原始比例显示验收

## 确认范围

用户明确确认“只修正画布显示比例”。不修改视频生成请求的比例参数，不重新编码、裁切、拉伸视频，不改 API、鉴权或仓库实现。此前等比拖动逻辑保留。

## 修复

- 视频节点通过 `preload="metadata"` 自动读取实际 `videoWidth/videoHeight`，无需选中、悬停或播放后才适配框体。不自动播放。
- 显示比例只取当前文件的解码尺寸，不从 `metadata.size` 的生成参数或旧视频节点框推断；保持 `object-fit: contain`。
- 覆盖生成、上传替换时清除旧媒体的自然尺寸记录；原视频尺寸仍随生成历史保存。
- 视频地址变化时重新创建播放器，读取新文件尺寸；忽略已被替换视频的迟到元数据事件。
- 正常等比缩放后的节点尺寸继续保留，刷新后不会重置回默认框。

## 自动验证实际输出

Studio 使用已有依赖，pnpm 附加 `--config.verify-deps-before-run=warn`，未改锁文件或安装依赖。

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit
Exit code: 0

pnpm --filter ai-manhua-studio test
Test Files  179 passed (179)
     Tests  1129 passed (1129)
  Duration  8.65s

pnpm --filter ai-manhua-studio build
Director Desk: built in 3.96s
Studio: built in 3.01s
Exit code: 0

pnpm --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  686 passed (686)
  Duration  91.02s
```

后端复用已有 `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe` 及模块缓存，执行 `go build ./...`、`go vet ./...`、`go test ./...`，均退出 0；测试包均为 cached，通过。

Worker 使用已有 `.tmp/canvas-quality-qa/worker-venv/Scripts/python.exe`：

```text
python -m compileall worker
Listing 'worker'...
Exit code: 0

python -m unittest discover -s tests
Ran 82 tests in 0.228s
FAILED (errors=1, skipped=2)
AttributeError: module 'signal' has no attribute 'SIGKILL'
```

剩余错误是既有 `test_shutdown_has_shared_deadline_and_kills_stuck_pool` 的 Windows 兼容问题，与画布修改无关。构建保留既有大 chunk、pnpm 配置及依赖不同步提示。

## 浏览器验收

运行 `canvas-node-resize.spec.ts` 与 `canvas-video-history.spec.ts`，Chrome 隔离所有 API 请求，仅使用测试录制媒体，不修改真实项目，不调用付费生成。

```text
image 640:360 proportional drag, undo and reload: passed
image 360:640 proportional drag, undo and reload: passed
video 640:360 proportional drag, undo and reload: passed
video 360:640 proportional drag, undo and reload: passed
overwritten videos survive refresh, play in history and apply independently: passed
5 passed (34.5s)
```

重点断言：未点击/悬停节点之前即匹配源比例；桌面与窄屏拖动比例不变；同节点从 320x180 横版覆盖为 180x320 竖版，再覆盖为 240x240 方形时显示随文件变化，生成参数保持 `1280x720` 不变；历史视频可播放和独立应用；刷新保持正确框体；无未捕获页面错误。

截图保存在 `.tmp/video-native-ratio-qa/`，包含覆盖后的竖版/方形视频和桌面/窄屏节点。`git diff --check` 通过。前端沿用 http://localhost:3100 已运行服务，未提交、推送或部署。

## 等比放大复查

用户再次要求确认“保持真实比例，但仍可以放大”。复查发现竖版视频在首次按源比例适配后可达到旧的 720 画布像素高度上限，因此继续向外拖动只有很小甚至没有放大空间。

本次将媒体拖动尺寸上限与初始适配框分离：图片/视频统一按长边 3840 画布像素限幅，横竖方向规则一致；文本等非媒体节点仍保留 960x720 旧边界。放大计算始终使用实际媒体比例，未修改生成参数或原视频。该上限只用于画布显示，不改变视频文件的像素分辨率。

新增三种视频比例的回归验证：16:9、9:16、1:1 在原来的尺寸上限处仍可等比放大 1.5 倍，元数据再次加载、保存反序列化后不会重置尺寸。浏览器测试强化为明确断言横向/纵向向外拖动时宽高都增大、向内拖动时都缩小，竖版视频放大后高度超过旧的 720 上限且刷新后保留，真实 videoWidth/videoHeight 不变。

复查后的实际输出：

```text
Studio check: tsc --noEmit, exit 0
Studio test: 179 passed files, 1132 passed tests, Duration 8.54s
Studio build: Director Desk built in 4.16s; Studio built in 3.13s; exit 0
Browser: 5 passed (36.2s)
Canvas Agent: tests 4, pass 4, fail 0
Director Desk: 87 passed files, 686 passed tests, Duration 112.20s
Go build ./...: exit 0
Go vet ./...: exit 0
Go test ./...: exit 0, cached
Worker compileall: Listing 'worker'..., exit 0
Worker unittest: Ran 82 tests in 0.215s; FAILED (errors=1, skipped=2)
AttributeError: module 'signal' has no attribute 'SIGKILL'
git diff --check: exit 0
```

Worker 仍为上述既有 Windows 兼容问题。已目视检查此次横版/竖版视频放大后的截图，圆形保持圆形、源画面完整。未提交、推送、部署或重启已有服务。
