# 画布 @ 引用目录验收

日期：2026-09-11

## 修改结果

弹窗首页顺序：前置连线节点 → 当前画布同名文件夹（标记“当前画布”）→ 收藏夹 → 其他资产库。

- 按输入连线方向识别前置节点，直接前置优先，其次上游前置；下游和旁支不列入首选。已有 @ token 的解析及生成输入语义保持兼容。
- 当前画布目录通过 source_ref_id 与画布 ID 精确关联，避免同名画布串目录。展开时呈现实际直接子文件夹和当前层素材，支持继续展开、返回及 Escape 逐级返回。
- 收藏夹使用服务端 smart_view=favorite，读取当前账号在当前空间的收藏。
- 其他资产库从实际根目录逐层进入，例如系统归档 → 未分类 → 子文件夹；当前画布文件夹不重复列入其他目录分支。
- 空目录、加载失败和重试有明确状态；素材列表支持加载更多；目录搜索可查找后代目录中的素材。
- 已插入引用的缓存与菜单当前查询结果分离，切换目录或查询时取消旧请求，迟到结果不会覆盖当前列表。虚拟入口不作为 folder_id 发送；已删除的目录会显示提示，不沿用上次素材。
- 内联编辑节点显式订阅引用目录状态，修复节点 memo 缓存导致列表无法更新的问题。
- 打开旧画布时，后端在事务中补齐当前画布目录及角色、场景、道具，不改变画布名称、内容或更新时间。Memory 与 PostgreSQL 行为一致。

## 验证

前端新增 10 项测试（总数 534），覆盖顺序、真实目录、相同名称不同画布、仅前置节点、循环连线、缓存隔离、收藏、无效目录、迟到查询、分页、点击和键盘交互；节点渲染边界原测试补充目录状态断言。此前提示词恢复及已插入引用测试继续通过。

后端新增旧画布打开场景，分别在内存和临时 PostgreSQL 的独立 schema 中验证：跨空间拒绝、幂等补齐、原名和快照保留、更新时间不变化。后端全部 build/vet/test 通过。

浏览器验证通过临时公开页面加载生产 CanvasResourceMentionTextarea、CanvasAssetsMentionsController 及完整项目样式，服务数据使用合成目录和素材。实际输入 @ 后检查首屏截图并依次点击当前画布 → 角色、收藏夹、其他资产库 → 系统归档 → 未分类，确认子目录、素材及 Escape 返回。没有登录或操作用户受保护的画布数据。临时页面和测试文件已移除。

截图里既有生成节点的 asset folder not found 请求，在当前 API 最近日志中未匹配到。本次验证覆盖引用目录查询和旧画布目录补齐，未重新执行该历史生成任务。

API 已在 ai-manju-40-api-1 重建启动并处于 healthy，数据库健康，前端 3100 返回 HTTP 200。临时测试数据库已清理，未提交 Git。

## 实际输出

### Studio 类型检查

```text

> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit

```

### Studio 全部测试

```text
 ✓ src/components/AgentPanel.test.tsx (3 tests) 110ms
 ✓ src/features/canvas/ui/CanvasNodeCard.test.tsx (5 tests) 38ms
 ✓ src/features/canvas/ui/CanvasPreviewDialogs.test.tsx (5 tests) 207ms
 ✓ src/features/chat/ChatPage.test.tsx (4 tests) 223ms

 Test Files  110 passed (110)
      Tests  534 passed (534)
   Start at  15:31:09
   Duration  4.70s (transform 10.67s, setup 0ms, collect 31.83s, tests 2.53s, environment 10.82s, prepare 11.48s)

```

### Studio 构建

```text
../dist/public/assets/index-DVZ8YHCq.js                           77.97 kB │ gzip:  21.56 kB
../dist/public/assets/styles-57hXXhWS.js                          91.43 kB │ gzip:  30.55 kB
../dist/public/assets/CanvasPage-DtkEXihP.js                     314.32 kB │ gzip:  95.66 kB
../dist/public/assets/index-DY0E1ezv.js                          355.13 kB │ gzip: 113.33 kB
✓ built in 3.06s
```

### 后端 go build ./... / go vet ./... / go test ./...

```text
go: downloading github.com/ugorji/go/codec v1.2.12
go: downloading github.com/pelletier/go-toml/v2 v2.2.2
go: downloading golang.org/x/sync v0.10.0
go: downloading github.com/go-playground/universal-translator v0.18.1
go: downloading golang.org/x/sys v0.28.0
go: downloading github.com/leodido/go-urn v1.4.0
go: downloading github.com/gabriel-vasile/mimetype v1.4.3
go: downloading github.com/go-playground/locales v0.14.1
?   	github.com/ai-manju/api/cmd/asset-export-worker	[no test files]
?   	github.com/ai-manju/api/cmd/migrate-asset-library	[no test files]
?   	github.com/ai-manju/api/cmd/migrate-asset-tags	[no test files]
?   	github.com/ai-manju/api/cmd/migrate-provider-presets	[no test files]
?   	github.com/ai-manju/api/cmd/reconcile-asset-usage	[no test files]
?   	github.com/ai-manju/api/cmd/server	[no test files]
?   	github.com/ai-manju/api/internal/auth	[no test files]
?   	github.com/ai-manju/api/internal/database	[no test files]
ok  	github.com/ai-manju/api/internal/assetmigration	0.004s
ok  	github.com/ai-manju/api/internal/config	0.003s
?   	github.com/ai-manju/api/internal/model	[no test files]
?   	github.com/ai-manju/api/internal/response	[no test files]
?   	github.com/ai-manju/api/internal/storage	[no test files]
ok  	github.com/ai-manju/api/internal/handler	10.428s
ok  	github.com/ai-manju/api/internal/middleware	0.014s
ok  	github.com/ai-manju/api/internal/provider	0.011s
ok  	github.com/ai-manju/api/internal/providerpresetmigration	0.006s
ok  	github.com/ai-manju/api/internal/queue	0.004s
ok  	github.com/ai-manju/api/internal/repository	0.097s
ok  	github.com/ai-manju/api/internal/router	0.297s
ok  	github.com/ai-manju/api/internal/service	0.892s
ok  	github.com/ai-manju/api/internal/tagmigration	0.006s
```

### Canvas Agent

```text
✔ shared tool definitions and local validators stay aligned (1.9691ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 66.5073
```

### Director Desk

```text

 RUN  v4.1.11 D:/AImanju4.0/apps/director-desk


 Test Files  87 passed (87)
      Tests  686 passed (686)
   Start at  15:32:31
   Duration  89.72s (transform 1.06s, setup 8.29s, import 5.33s, tests 29.64s, environment 38.34s)

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

### API 重建启动

```text
#21 DONE 0.0s
 Image ai-manju-40-api Built
 Container ai-manju-40-api-1 Recreate
 Container ai-manju-40-api-1 Recreated
 Container ai-manju-40-api-1 Starting
 Container ai-manju-40-api-1 Started
```

### 运行健康检查

```text
{
  "data": {
    "auth_bootstrap": true,
    "db": "ok",
    "persistent_required": true,
    "public_signup": true,
    "request_id": "c9ee085b77c6e345f4aa0d2c",
    "service": "AI Manju API (Go)",
    "storage": "postgres"
  },
  "success": true
}
```
