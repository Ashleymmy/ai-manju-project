# 视频工作台时长与输出开关布局验收

日期：2026-09-29。

## 修改

仅修改 `apps/studio/client/src/features/video/ui/ParamsBar.tsx` 和同目录功能的 `styles.css`。时长区域及音频、水印放在独立的底部行，滑杆使用可用宽度，当前秒数单独显示；两个输出选项改为带图标的独立开关，保留原有参数更新和能力限制，并补充可访问的开关状态。不修改共享时长组件、时长映射算法、模型目录或生成请求。

面板宽度不足时开关排到下行，比例选项允许换行。为右下角 Agent 悬浮入口预留空间，避免覆盖开关。原有图片工作区修改保留；本轮未部署或提交。

## 浏览器验证

本地真实视频页面，使用截图对应的 4–15 秒测试目录数据复现界面，不改变服务端模型配置。对话列表使用空测试数据，拦截页面写入，不提交生成任务。通过以下项目：

- 起点 4 秒、终点 15 秒，中央刻度 7.5 秒，点击中点吸附至支持的 8 秒；方向键更新数值标签。
- 音频、水印分别支持点击和空格键切换，状态相互独立。
- 模型不支持音频时关闭并禁用音频开关；自动时长、离散时长及 H3 无开关模式仍工作。
- 1920 / 1440 / 1024 / 390px 显示正常；窄屏无横向溢出，时长和开关不重叠。1440 / 1024 / 390px 检查开关上的实际点击命中，未被悬浮控件覆盖。
- 浏览器错误 0，提交生成任务 0。已检查桌面和手机尺寸截图。

完整浏览器记录和命令输出位于 `.tmp/video-params-layout-20260929/`；展示截图位于 `output/video-params-layout/`。

## 项目规定检查

所有命令退出码为 0。以下为实际输出摘录。

Studio：`pnpm --filter ai-manhua-studio check`、`test`、`build`。

```text
> tsc --noEmit

 Test Files  261 passed (261)
      Tests  2062 passed (2062)
   Duration  13.84s (transform 29.51s, setup 0ms, collect 119.52s, tests 44.50s, environment 111.21s, prepare 25.36s)

(!) Some chunks are larger than 500 kB after minification. Consider:
✓ built in 6.78s
```

构建成功，有包体积提示。

API：`go build ./...`、`go vet ./...`、`go test ./...`。build、vet 成功且无输出；test 摘录：

```text
ok  	github.com/ai-manju/api/internal/repository	(cached)
ok  	github.com/ai-manju/api/internal/router	(cached)
ok  	github.com/ai-manju/api/internal/sdvideo	(cached)
ok  	github.com/ai-manju/api/internal/service	(cached)
ok  	github.com/ai-manju/api/internal/storage	(cached)
ok  	github.com/ai-manju/api/internal/tagmigration	(cached)
```

Canvas Agent：`pnpm --filter @basketikun/canvas-agent test`。

```text
ℹ tests 5
ℹ pass 5
ℹ fail 0
ℹ skipped 0
ℹ duration_ms 70.1653
```

Director Desk：`pnpm --filter @ai-manju/director-desk test`。

```text
 Test Files  87 passed (87)
      Tests  689 passed (689)
   Duration  143.70s (transform 1.62s, setup 15.35s, import 8.87s, tests 41.03s, environment 64.84s)
```

Worker：临时无网络容器只读挂载当前源码，执行 `python -m compileall worker && python -m unittest discover -s tests`。

```text
Ran 275 tests in 4.154s

OK (skipped=27)
```

`git diff --check` 通过。
