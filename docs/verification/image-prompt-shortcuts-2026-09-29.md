# 图片生成页提示词快捷栏优化验收

日期：2026-09-29。

## 范围与结果

仅修改 `/image` 页面截图红框内的提示词快捷栏。上行显示“常用提示词”和提示词库入口，下行显示圆角快捷标签；去掉标签常驻的“普通”前缀，优先级仍在悬浮提示中保留。标签增加选中反馈，编辑提示词后同步取消选中；长名称省略显示，标签随可用宽度换行。增加空状态、键盘焦点与减少动画支持。

修改文件：

- `apps/studio/client/src/features/image/ImagePage.tsx`
- `apps/studio/client/src/features/image/styles.css`

未修改生成服务、模型参数、资产数据、后端仓库或鉴权。未部署线上。

## 浏览器验收

在本地真实页面验证，使用拦截的测试偏好数据提供快捷项；页面的写入请求被拦截，没有写入用户偏好或提交生成任务。已检查完整桌面截图和窄屏长名称截图。

实际输出：

```json
{"result":"passed","fixturePreferences":true,"submittedGenerationJobs":0,"checks":["preset applies to prompt","selection follows prompt edits","library opens and closes","long names fit at 1920/1440/1024/390","empty state"],"browserErrors":[]}
```

截图及浏览器验证记录保存在 `.tmp/prompt-shortcuts-20260929/`；展示截图复制到 `output/prompt-shortcuts-preview/`。

## 项目要求的检查

全部命令退出码为 0。完整日志在 `.tmp/prompt-shortcuts-20260929/`。

### Studio

执行 `pnpm --filter ai-manhua-studio check`、`test`、`build`，实际输出摘录：

```text
> tsc --noEmit

 Test Files  261 passed (261)
      Tests  2062 passed (2062)
   Duration  14.03s (transform 29.41s, setup 0ms, collect 122.38s, tests 45.22s, environment 109.98s, prepare 26.30s)

(!) Some chunks are larger than 500 kB after minification. Consider:
✓ built in 9.33s
```

构建成功，有包体积提示。

### API

在 `apps/api` 执行 `go build ./...`、`go vet ./...`、`go test ./...`。build、vet 成功且无输出；test 实际输出摘录：

```text
ok  	github.com/ai-manju/api/internal/provider	(cached)
ok  	github.com/ai-manju/api/internal/repository	(cached)
ok  	github.com/ai-manju/api/internal/router	(cached)
ok  	github.com/ai-manju/api/internal/service	(cached)
ok  	github.com/ai-manju/api/internal/storage	(cached)
```

### Canvas Agent / Director Desk

执行 `pnpm --filter @basketikun/canvas-agent test` 和 `pnpm --filter @ai-manju/director-desk test`，实际输出摘录：

```text
ℹ tests 5
ℹ pass 5
ℹ fail 0
ℹ skipped 0

 Test Files  87 passed (87)
      Tests  689 passed (689)
   Duration  123.46s (transform 1.47s, setup 11.59s, import 7.74s, tests 42.89s, environment 50.50s)
```

### Worker

使用现有 Worker 镜像创建临时无网络容器，只读挂载当前源码，执行 `python -m compileall worker && python -m unittest discover -s tests`；未重启运行中的 Worker。实际输出摘录：

```text
Ran 275 tests in 4.364s

OK (skipped=27)
```

另已通过 `git diff --check`。
