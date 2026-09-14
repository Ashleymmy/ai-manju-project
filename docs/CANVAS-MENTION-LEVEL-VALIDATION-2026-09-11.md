# @ 弹窗系统归档上移验收

日期：2026-09-11

## 本次修订

根据最新截图，删除 @ 菜单的虚拟“其他资产库”层，将真实“系统归档”目录直接提升到首页，位于当前画布文件夹、收藏夹之后。点击“系统归档”直接展示原有子目录，返回一次即回到首页。

如资产库另有用户创建的根目录，仍显示在系统归档之后。此次仅调整菜单导航层级，没有移动或删除资产库中的真实目录及素材，也不需要后端重启。

更新已有目录排序及组件交互测试，检查：首页直接显示系统归档、发送实际目录 ID、展开子目录、逐级返回和一步回首页。类型检查、Studio 534 项测试及构建通过；前端服务 HTTP 200，开发页面热更新可用。

本文件的导航层级取代 CANVAS-MENTION-LIBRARY-VALIDATION-2026-09-11.md 中此前的“其他资产库”中间层。

## 实际检查输出

### Studio check

```text

> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit

```

### Studio test

```text
 ✓ src/features/canvas/ui/CanvasPreviewDialogs.test.tsx (5 tests) 174ms
 ✓ src/features/chat/ChatPage.test.tsx (4 tests) 208ms

 Test Files  110 passed (110)
      Tests  534 passed (534)
   Start at  15:48:42
   Duration  4.84s (transform 12.76s, setup 0ms, collect 34.44s, tests 2.34s, environment 11.65s, prepare 11.44s)

```

### Studio build

```text
../dist/public/assets/index-BSc56URo.js                           77.97 kB │ gzip:  21.56 kB
../dist/public/assets/styles-BHtldfAp.js                          91.52 kB │ gzip:  30.57 kB
../dist/public/assets/CanvasPage-BDcRtsj0.js                     314.32 kB │ gzip:  95.66 kB
../dist/public/assets/index-CTD__Ez6.js                          355.13 kB │ gzip: 113.34 kB
✓ built in 2.70s
```

### API build / vet / test

```text
go: downloading github.com/leodido/go-urn v1.4.0
go: downloading golang.org/x/sync v0.10.0
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
ok  	github.com/ai-manju/api/internal/handler	10.449s
ok  	github.com/ai-manju/api/internal/middleware	0.011s
ok  	github.com/ai-manju/api/internal/provider	0.011s
ok  	github.com/ai-manju/api/internal/providerpresetmigration	0.005s
ok  	github.com/ai-manju/api/internal/queue	0.003s
ok  	github.com/ai-manju/api/internal/repository	0.009s
ok  	github.com/ai-manju/api/internal/router	0.290s
ok  	github.com/ai-manju/api/internal/service	0.124s
ok  	github.com/ai-manju/api/internal/tagmigration	0.006s
```

### Canvas Agent test

```text
✔ shared tool definitions and local validators stay aligned (1.9141ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 62.4696
```

### Director Desk test

```text

 RUN  v4.1.11 D:/AImanju4.0/apps/director-desk


 Test Files  87 passed (87)
      Tests  686 passed (686)
   Start at  15:49:42
   Duration  91.77s (transform 1.06s, setup 8.45s, import 5.45s, tests 30.58s, environment 39.07s)

```

### Worker compileall / unittest

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
Ran 50 tests in 0.016s

OK (skipped=1)
```
