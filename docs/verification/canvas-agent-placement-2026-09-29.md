# 画布 Agent 生成落点统一

状态：本地修复完成；未发布线上、未提交 Git。

## 原因与行为

原来的生成工具在缺省坐标时使用整张画布的最右端；模型传入 x/y 时直接使用模型坐标。因此普通对话生成既可能向右无限延伸，也可能跳到左侧旧坐标。

本轮把在线和本地 Agent 的新生成流程标记为同一类流程，在浏览器真正应用操作时按最新画布排布：

- 新的一组接在上一组下方、左侧对齐；没有历史标记时从已有内容下方开始，空画布从原点开始。
- 组内保持“提示词 → 配置 → 结果”的从左到右顺序。图片、视频、音频、文本以及独立配置工具采用同一规则。
- 组间至少留 80 个画布单位，遇到已有节点继续向下寻找空位，预留异步结果和批量图片/文本的位置。
- 排布标记随节点保存，刷新后继续沿用。生成完成只更新对应结果；普通创建和显式移动已有节点保持原有行为。用户明确要求移动时使用 canvas_move_nodes。
- 创建后定位到新一组，并在视图定位时扣除 Agent 浮层占用的宽度，包含尚未创建的结果区域。空间足够时保持当前缩放。
- 保存过程中若切换画布，停止原生成指令后续的定位和生成，避免落到新画布。

未整理、移动或删除用户已有的历史节点；未改生成供应商、参数和计费。

## 验证范围

10 项新增 Studio 排布回归：四类生成、模型坐标变化、视口/选区变化、工具准备后新增障碍、已生成高图、批量占位、保存重载、同请求多组、本地 ops 路径、普通创建/显式移动和完成更新。另增 1 项本地 Agent 工具测试覆盖四类流程标记传递。

浏览器通过真实页面交互连续执行三次 Agent 生成，其中第二次后刷新再生成；断言三组横向坐标一致、旧节点坐标/内容保留、结果在配置右侧并且未被 Agent 面板遮挡。浏览器测试使用隔离的 API/模型/生成结果响应，未调用付费供应商、未修改真实项目，不代表上游生成服务验证。

截图：`.tmp/agent-placement-20260929/browser/canvas-agent-placement-suc-50292-cross-completion-and-reload/agent-flow-placement.png`。

首次本地 Python 运行缺少匹配的媒体依赖并出现版本差异，后改用现有 Worker 镜像启动一次性测试容器，只读挂载当前源码并禁用网络，275 项通过（27 项跳过）。没有改动或重启现有 Worker。开发中发现的 TypeScript 类型依赖循环已拆开，最终完整 Studio 检查通过。

## 最终检查实际输出

完整日志保存在 `.tmp/agent-placement-20260929/`。以下为各项命令实际输出摘要。

### Studio 类型检查

```text

> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit

```

### Studio 测试

```text
 ✓ src/features/canvas/controllers/generation-jobs/browser-services.test.ts (3 tests) 6ms

 Test Files  261 passed (261)
      Tests  2062 passed (2062)
   Start at  14:03:34
   Duration  12.70s (transform 22.35s, setup 0ms, collect 96.69s, tests 38.71s, environment 113.75s, prepare 26.33s)

```

### Studio 构建

```text
../dist/public/assets/styles-BhPQDZpT.js                         154.00 kB │ gzip:  51.30 kB
../dist/public/assets/index-BVB-fuu6.js                          167.31 kB │ gzip:  46.91 kB
../dist/public/assets/CanvasPage-CFxLUBsj.js                     374.49 kB │ gzip: 114.30 kB
../dist/public/assets/MonitoringPanel-C9UMVEnR.js                408.40 kB │ gzip: 113.82 kB
../dist/public/assets/index-BDHw-feB.js                          763.10 kB │ gzip: 261.79 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 6.42s
```

### 浏览器隔离验证

```text

Running 1 test using 1 worker

(node:41740) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ok 1 e2e\canvas-agent-placement.spec.ts:4:1 › successive Agent generations keep one column across completion and reload (6.4s)

  1 passed (7.1s)
```

### API build / vet / test（均退出 0，build 与 vet 无输出）

```text
?   	github.com/ai-manju/api/cmd/migrate-asset-library	[no test files]
?   	github.com/ai-manju/api/cmd/migrate-asset-tags	[no test files]
?   	github.com/ai-manju/api/cmd/reconcile-asset-usage	[no test files]
?   	github.com/ai-manju/api/cmd/migrate-provider-presets	[no test files]
?   	github.com/ai-manju/api/cmd/sd-video-bridge	[no test files]
?   	github.com/ai-manju/api/cmd/server	[no test files]
?   	github.com/ai-manju/api/internal/auth	[no test files]
?   	github.com/ai-manju/api/internal/database	[no test files]
?   	github.com/ai-manju/api/internal/model	[no test files]
?   	github.com/ai-manju/api/internal/response	[no test files]
ok  	github.com/ai-manju/api/cmd/asset-export-worker	(cached)
ok  	github.com/ai-manju/api/internal/assetmigration	(cached)
ok  	github.com/ai-manju/api/internal/config	(cached)
ok  	github.com/ai-manju/api/internal/handler	(cached)
ok  	github.com/ai-manju/api/internal/httpsecurity	(cached)
ok  	github.com/ai-manju/api/internal/middleware	(cached)
ok  	github.com/ai-manju/api/internal/monitoring	(cached)
ok  	github.com/ai-manju/api/internal/provider	(cached)
ok  	github.com/ai-manju/api/internal/providerhub	(cached)
ok  	github.com/ai-manju/api/internal/providerpresetmigration	(cached)
ok  	github.com/ai-manju/api/internal/queue	(cached)
ok  	github.com/ai-manju/api/internal/repository	(cached)
ok  	github.com/ai-manju/api/internal/router	(cached)
ok  	github.com/ai-manju/api/internal/sdvideo	(cached)
ok  	github.com/ai-manju/api/internal/service	(cached)
ok  	github.com/ai-manju/api/internal/storage	(cached)
ok  	github.com/ai-manju/api/internal/tagmigration	(cached)
```

### Canvas Agent

```text
$ tsc -p tsconfig.json
✔ keeps canvas tool calls and snapshots isolated per client (3.4882ms)
✔ disconnecting one client rejects only its pending tool call (0.894ms)
✔ reconnecting the same client replaces the old stream without deleting the new one (0.2472ms)
✔ local generation flows carry the same browser placement identity for every media type (1.3436ms)
✔ shared tool definitions and local validators stay aligned (1.8348ms)
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 66.5249
```

### Director Desk

```text
 RUN  v4.1.11 D:/AImanju4.0/apps/director-desk


 Test Files  87 passed (87)
      Tests  689 passed (689)
   Start at  13:55:45
   Duration  97.03s (transform 1.62s, setup 9.11s, import 6.66s, tests 32.82s, environment 40.03s)

```

### Worker compileall / unittest（只读挂载当前源码的容器）

```text
worker child exited index=1 code=2
worker child exited index=1 code=-9
......................................................sssssss..........s.................reference transfer optimization unavailable
.......
----------------------------------------------------------------------
Ran 275 tests in 3.722s

OK (skipped=27)
```
