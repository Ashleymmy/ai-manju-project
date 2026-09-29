# 图片生成工作区样式统一验收

日期：2026-09-29。

## 修改范围

在上次提示词快捷栏优化基础上，仅修改 `apps/studio/client/src/features/image/styles.css`。以 `.image-page` 限定样式，统一整个图片生成工作区的圆角、输入背景及边框：外框 16px、区域 12px、控件 8px；生成按钮取消切角。模型选择框占满一行，质量和数量对齐，比例按钮随宽度排布。补充键盘焦点，并修正中等屏宽下历史区宽度及隐藏历史区后的列布局。

保留原有深色风格、大标题、导航和生成逻辑。共享样式不会将这次外观变更应用到视频页面。保留结果缩略图的选中边框。本轮不修改接口、仓库或鉴权，不部署线上。

## 浏览器验收

使用本地真实页面；快捷项通过拦截偏好响应提供测试数据，页面写入请求被拦截。未修改用户偏好，未提交生成任务。

已通过：快捷项应用及选中状态、提示词库打开关闭、质量切换、数量增减、尺寸交换、本地参考图上传移除、资产选择器打开关闭；1920 / 1440 / 1024 / 820 / 390px 下工作区无横向溢出，长标题正常省略换行。浏览器错误为零。

实际计算样式确认外框 16px，提示词框和参考图区 12px，模型、质量、数量和尺寸交换控件 8px；生成按钮 12px 且 `clip-path: none`。已查看桌面顶部、参数区、1024px 及手机尺寸截图。

验证脚本、结果及完整日志：`.tmp/workbench-rounded-20260929/`。展示截图：`output/image-workbench-rounded/`。

## 项目检查（均退出 0）

Studio：`pnpm --filter ai-manhua-studio check`、`test`、`build`。

```text
> tsc --noEmit

 Test Files  261 passed (261)
      Tests  2062 passed (2062)
   Duration  14.55s (transform 31.89s, setup 0ms, collect 116.18s, tests 41.75s, environment 125.76s, prepare 28.97s)

(!) Some chunks are larger than 500 kB after minification. Consider:
✓ built in 9.35s
```

构建成功，仍有包体积提示。

API：`go build ./...`、`go vet ./...`、`go test ./...`。build、vet 无输出；test 摘录：

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
ℹ duration_ms 99.7307
```

Director Desk：`pnpm --filter @ai-manju/director-desk test`。

```text
 Test Files  87 passed (87)
      Tests  689 passed (689)
   Duration  92.70s (transform 1.32s, setup 8.38s, import 5.81s, tests 32.35s, environment 38.14s)
```

Worker：临时无网络容器只读挂载当前源码，执行 `python -m compileall worker && python -m unittest discover -s tests`。运行中的 Worker 未重启。

```text
Ran 275 tests in 11.763s

OK (skipped=27)
```

`git diff --check` 通过。
