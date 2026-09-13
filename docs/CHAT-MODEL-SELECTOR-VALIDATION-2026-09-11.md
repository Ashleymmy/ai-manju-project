# 剧本创作页真实模型选择器验收

日期：2026-09-11

## 修复结果

- `/chat` 通过共享模型目录请求 `/api/ai/models`，移除硬编码的六个示例模型。
- 创作输入会交给画布助手，因此候选项使用接口的 `agent_text_models`；只显示已启用服务商返回的、支持助手工具调用的文本模型。显示模型名称和服务商，内部保留完整的 `provider::model` 标识。
- 默认优先选择可用列表中的 `gpt-5.6-luna`，与画布助手共用默认模型规则；不存在时回退到接口默认模型，再回退到列表首项。用户手动选择仍然优先。打开菜单和页面重新获得焦点时刷新目录。加载失败、没有可用模型时显示提示与重试入口，并阻止发送。
- 选中的模型和原始输入一起交接给画布助手。首轮实际文本请求使用该模型；若跳转后模型已不可用，保留输入并提示重新选择，不自动替换后发送。
- 空文本列表不会回退到包含图片模型的混合列表。长模型菜单可滚动，长名称不会撑破输入栏。
- 未修改后端响应信封、路由、鉴权或仓库实现。

## 网页验收

在本地 `http://localhost:3100/chat` 使用关闭“记住本次登录”的临时管理员会话验收：

- 未登录时显示“登录后查看模型”，没有示例选项。
- 首次修复的网页验收默认显示 `gpt-5.6-sol · 新 Provider`；随后按用户要求调整为优先选中 `gpt-5.6-luna`。
- 展开后显示接口实际返回的 12 个创作模型，包含 `gpt-6`、`gpt-5.6-luna`、`gpt-6-astra`、`gpt-5.2` 等，不混入图片模型。
- 已检查菜单截图；菜单高度受限且可以滚动。选择列表末尾 `gpt-5.2 · 新 Provider` 后，菜单关闭，选择器正确更新。
- 本次未逐个调用外部生成接口；候选可用范围以项目模型目录及助手能力字段为准，模型选择传递和发送请求使用回归测试验证。

## 验证环境

Windows 当前默认 pnpm 命令存在自动切换版本的问题。验证使用项目已安装的 pnpm 10.34.5，并通过临时 `.codex-logs/chat-model-pnpm.npmrc` 禁用自动切换版本；未修改项目依赖清单和锁文件。

Go 验证使用本机已有的 `golang:1.23-alpine` 临时容器及只读源码挂载。Worker 验证使用本机已有的 Worker 镜像、只读源码挂载、禁网临时容器。未改动运行中的后端、数据库或生成任务。

## 实际验证输出

### Studio 类型检查：pnpm --filter ai-manhua-studio check

```text

> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit

```

### Studio 测试：pnpm --filter ai-manhua-studio test

```text
 ✓ src/features/canvas/ui/CanvasNodeCard.test.tsx (5 tests) 27ms
 ✓ src/features/chat/ChatPage.test.tsx (4 tests) 216ms

 Test Files  105 passed (105)
      Tests  507 passed (507)
   Start at  10:09:56
   Duration  4.28s (transform 10.79s, setup 0ms, collect 30.18s, tests 1.77s, environment 6.53s, prepare 10.25s)

```

### Studio 构建：pnpm --filter ai-manhua-studio build

```text
../dist/public/assets/index-QmuzRVmR.js                           77.97 kB │ gzip:  21.56 kB
../dist/public/assets/styles-B9fF3SC0.js                          89.36 kB │ gzip:  29.75 kB
../dist/public/assets/CanvasPage-BFBcPKVA.js                     312.76 kB │ gzip:  95.08 kB
../dist/public/assets/index-CuthF0-n.js                          354.89 kB │ gzip: 113.27 kB
✓ built in 2.70s
```

### 后端：go build ./... && go vet ./... && go test ./...

```text
go: downloading github.com/leodido/go-urn v1.4.0
go: downloading github.com/go-playground/locales v0.14.1
?   	github.com/ai-manju/api/cmd/asset-export-worker	[no test files]
?   	github.com/ai-manju/api/cmd/migrate-asset-library	[no test files]
?   	github.com/ai-manju/api/cmd/migrate-asset-tags	[no test files]
?   	github.com/ai-manju/api/cmd/migrate-provider-presets	[no test files]
?   	github.com/ai-manju/api/cmd/reconcile-asset-usage	[no test files]
?   	github.com/ai-manju/api/cmd/server	[no test files]
?   	github.com/ai-manju/api/internal/auth	[no test files]
?   	github.com/ai-manju/api/internal/database	[no test files]
ok  	github.com/ai-manju/api/internal/assetmigration	0.003s
ok  	github.com/ai-manju/api/internal/config	0.002s
?   	github.com/ai-manju/api/internal/model	[no test files]
?   	github.com/ai-manju/api/internal/response	[no test files]
?   	github.com/ai-manju/api/internal/storage	[no test files]
ok  	github.com/ai-manju/api/internal/handler	10.380s
ok  	github.com/ai-manju/api/internal/middleware	0.009s
ok  	github.com/ai-manju/api/internal/provider	0.011s
ok  	github.com/ai-manju/api/internal/providerpresetmigration	0.004s
ok  	github.com/ai-manju/api/internal/queue	0.004s
ok  	github.com/ai-manju/api/internal/repository	0.006s
ok  	github.com/ai-manju/api/internal/router	0.209s
ok  	github.com/ai-manju/api/internal/service	0.113s
ok  	github.com/ai-manju/api/internal/tagmigration	0.005s
```

### Canvas Agent：pnpm --filter @basketikun/canvas-agent test

```text
$ tsc -p tsconfig.json
✔ shared tool definitions and local validators stay aligned (1.8659ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 182.1692
```

### Director Desk：pnpm --filter @ai-manju/director-desk test

```text
 RUN  v4.1.11 D:/AImanju4.0/apps/director-desk


 Test Files  87 passed (87)
      Tests  686 passed (686)
   Start at  10:17:19
   Duration  97.31s (transform 1.02s, setup 11.59s, import 10.79s, tests 29.52s, environment 37.10s)

```

### Worker：python -m compileall worker && python -m unittest discover -s tests

```text
Listing 'worker'...
Compiling 'worker/__init__.py'...
Compiling 'worker/app.py'...
Compiling 'worker/assets.py'...
Compiling 'worker/config.py'...
Compiling 'worker/db.py'...
Compiling 'worker/errors.py'...
Compiling 'worker/provider.py'...
Compiling 'worker/provider_gate.py'...
Compiling 'worker/staged_inputs.py'...
Compiling 'worker/tasks.py'...
Compiling 'worker/video.py'...
.........................s........................
----------------------------------------------------------------------
Ran 50 tests in 0.011s

OK (skipped=1)
```

## 默认 Luna 调整后的验证

本次仅复用画布助手已有的默认模型规则，并通过 feature 公共入口提供给剧本创作页；重新运行 Studio 类型检查、全部测试和构建，均通过。此前后端、Worker、Canvas Agent 和 Director Desk 验证记录见上文。

```text

> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit

 ✓ src/features/canvas/ui/CanvasNodeCard.test.tsx (5 tests) 27ms
 ✓ src/features/chat/ChatPage.test.tsx (4 tests) 220ms

 Test Files  105 passed (105)
      Tests  507 passed (507)
   Start at  10:34:55
   Duration  4.68s (transform 10.95s, setup 0ms, collect 30.99s, tests 1.70s, environment 6.62s, prepare 10.06s)

../dist/public/assets/CanvasPage-5ccXB6ek.js                     312.76 kB │ gzip:  95.09 kB
../dist/public/assets/index-CnQL9UJR.js                          354.90 kB │ gzip: 113.29 kB
✓ built in 2.65s
```

## 发送按钮 UI 调整与验证

- 原因：图标按钮同时使用通用文字主按钮样式，34px 宽度叠加左右 15px 内边距及切角裁剪，挤压了箭头的显示空间。
- 修复：移除通用文字按钮类，使用独立 36×36px 圆角按钮、18×18px 居中箭头和零内边距。禁用态使用清晰的灰色箭头与深色底，启用态使用浅底深色箭头；增加悬停、按压、键盘焦点、加载与减弱动效状态。
- 工具提示说明空输入或模型不可用的原因，保留原有发送与鉴权行为。
- 已在本地浏览器检查空输入和有输入两种状态的实际截图。读取实际布局结果：width=36、height=36、padding=0px、clipPath=none、iconWidth=18、iconHeight=18；启用背景 rgb(242,241,237)，图标 rgb(23,24,26)。此次视觉验证未提交生成请求。
- 本次仅涉及 Studio；类型检查、全部 507 项测试和构建通过，其他模块沿用上文已完成的验证记录。

```text

> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit

 ✓ src/features/canvas/ui/CanvasNodeCard.test.tsx (5 tests) 27ms
 ✓ src/features/chat/ChatPage.test.tsx (4 tests) 212ms

 Test Files  105 passed (105)
      Tests  507 passed (507)
   Start at  10:42:52
   Duration  4.22s (transform 10.34s, setup 0ms, collect 29.50s, tests 1.70s, environment 6.54s, prepare 10.05s)

../dist/public/assets/styles-CZcqSqOS.js                          89.38 kB │ gzip:  29.76 kB
../dist/public/assets/CanvasPage-Q_qp7fuW.js                     312.76 kB │ gzip:  95.09 kB
../dist/public/assets/index-NdVKfnYS.js                          354.90 kB │ gzip: 113.28 kB
✓ built in 2.68s
```
