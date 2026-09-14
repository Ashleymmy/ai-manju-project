# 画布默认编号与资产库联动验收

日期：2026-09-11

## 用户可见行为

- 新建画布保留默认名称“未命名画布”时，后端在当前空间分配从 1 开始的最小空闲正整数，保存为“未命名画布1、未命名画布2……”；个人空间独立编号，团队空间共用编号。
- 分配时同时避开已有画布和仍保留的画布归档文件夹名称。旧的无编号画布不会被批量改名。
- 新画布创建时，在对应空间的“资产库 → 系统归档 → 画布工坊”下生成同名文件夹，包含“角色、场景、道具”。
- 文件夹按画布 ID 关联。画布改名同步修改同一文件夹，保留文件夹 ID、子文件夹、已有资产及链接。旧画布改名时会复用其原有归档并补齐三个分类。
- 自定义画布名称保持现有接口行为，允许重复标题及长标题；不同画布仍具有独立文件夹，不合并资产。保护的画布目录使用画布 ID 作为唯一名称键，显示名与画布完整一致，普通用户目录的重名规则不变。
- 已开始的生成任务携带旧画布名时，只会复用已有目录，不会覆盖最新名称。现有按日期归档路径继续保留。
- 新建对话框补充编号和资产文件夹说明；返回资产库浏览器标签页时重新获取目录。

## 实现与验证

ProjectService 将编号分配、画布、初始快照和文件夹创建/改名放入同一事务。PostgreSQL 使用事务级工作空间锁，覆盖多个 API 实例；Memory 使用统一锁顺序和私有副本提交，失败不会留下半成品。

新增服务对照测试覆盖：默认编号、旧个人工作空间兼容、个人/团队隔离、团队跨用户共用编号、12 个并发创建、8 个并发改名、同名自定义标题、长标题和特殊字符、创建失败回滚、改名失败回滚、失败重试、子目录幂等、保留资产和快照、旧标题生成任务、旧画布归档复用及跨工作空间拒绝。相同场景在 Memory 和真实 PostgreSQL 上通过。

新增内存 HTTP 集成测试使用独立普通成员，验证真实路由的注册、连续创建、资产目录查询、改名联动及响应信封。

数据库测试在临时 PostgreSQL 容器及独立 schema 中完成，不使用项目业务数据。没有登录或写入用户的受保护画布进行验收。

全部规定检查通过：API build/vet/test；Studio check、524 项测试和 build；Canvas Agent 1 项测试；Director Desk 686 项测试；Worker compileall 和 50 项测试（1 项按原条件跳过）。本机 Python 缺少 Worker 依赖，最终 Worker 检查使用项目已有镜像和只读源码挂载执行。

运行中的 ai-manju-40-api-1 已通过 Compose 重新构建并启动。健康接口返回 success=true、storage=postgres、db=ok；前端 3100 返回 HTTP 200。没有提交 Git。

## 实际输出

### API：go build ./...、go vet ./...、go test ./...

```text
?   	github.com/ai-manju/api/cmd/asset-export-worker	[no test files]
?   	github.com/ai-manju/api/cmd/migrate-asset-library	[no test files]
?   	github.com/ai-manju/api/cmd/migrate-asset-tags	[no test files]
?   	github.com/ai-manju/api/cmd/migrate-provider-presets	[no test files]
?   	github.com/ai-manju/api/cmd/reconcile-asset-usage	[no test files]
?   	github.com/ai-manju/api/cmd/server	[no test files]
?   	github.com/ai-manju/api/internal/auth	[no test files]
?   	github.com/ai-manju/api/internal/database	[no test files]
ok  	github.com/ai-manju/api/internal/assetmigration	(cached)
ok  	github.com/ai-manju/api/internal/config	(cached)
?   	github.com/ai-manju/api/internal/model	[no test files]
ok  	github.com/ai-manju/api/internal/handler	(cached)
ok  	github.com/ai-manju/api/internal/middleware	(cached)
ok  	github.com/ai-manju/api/internal/provider	(cached)
?   	github.com/ai-manju/api/internal/response	[no test files]
ok  	github.com/ai-manju/api/internal/providerpresetmigration	(cached)
ok  	github.com/ai-manju/api/internal/queue	(cached)
ok  	github.com/ai-manju/api/internal/repository	(cached)
?   	github.com/ai-manju/api/internal/storage	[no test files]
ok  	github.com/ai-manju/api/internal/router	0.288s
ok  	github.com/ai-manju/api/internal/service	0.670s
ok  	github.com/ai-manju/api/internal/tagmigration	(cached)
```

### Memory / PostgreSQL 联动和回滚定向测试

```text
=== RUN   TestCanvasProjectLibraryParity
=== RUN   TestCanvasProjectLibraryParity/memory
=== RUN   TestCanvasProjectLibraryParity/postgres
--- PASS: TestCanvasProjectLibraryParity (0.21s)
    --- PASS: TestCanvasProjectLibraryParity/memory (0.00s)
    --- PASS: TestCanvasProjectLibraryParity/postgres (0.21s)
=== RUN   TestCanvasProjectLibraryRollbackParity
=== RUN   TestCanvasProjectLibraryRollbackParity/memory
=== RUN   TestCanvasProjectLibraryRollbackParity/postgres
--- PASS: TestCanvasProjectLibraryRollbackParity (0.15s)
    --- PASS: TestCanvasProjectLibraryRollbackParity/memory (0.00s)
    --- PASS: TestCanvasProjectLibraryRollbackParity/postgres (0.15s)
PASS
ok  	github.com/ai-manju/api/internal/service	0.362s
```

### Studio check

```text

> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit

```

### Studio test

```text
 ✓ src/features/canvas/ui/CanvasPreviewDialogs.test.tsx (5 tests) 182ms
 ✓ src/features/chat/ChatPage.test.tsx (4 tests) 218ms

 Test Files  109 passed (109)
      Tests  524 passed (524)
   Start at  14:39:13
   Duration  18.99s (transform 10.62s, setup 0ms, collect 35.56s, tests 2.23s, environment 192.42s, prepare 20.63s)

```

### Studio build

```text
../dist/public/assets/index-D-OiDCHm.js                           77.97 kB │ gzip:  21.56 kB
../dist/public/assets/styles-BI5mTsOi.js                          88.80 kB │ gzip:  29.59 kB
../dist/public/assets/CanvasPage-B5pCDu-8.js                     312.66 kB │ gzip:  95.10 kB
../dist/public/assets/index-DVyt4i0e.js                          355.13 kB │ gzip: 113.33 kB
✓ built in 5.61s
```

### Canvas Agent test

```text
✔ shared tool definitions and local validators stay aligned (1.9647ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 169.215
```

### Director Desk test

```text

 RUN  v4.1.11 D:/AImanju4.0/apps/director-desk


 Test Files  87 passed (87)
      Tests  686 passed (686)
   Start at  14:41:01
   Duration  98.61s (transform 1.05s, setup 11.58s, import 10.98s, tests 29.95s, environment 37.74s)

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
Ran 50 tests in 0.017s

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
    "request_id": "42012af2e468f97defb79246",
    "service": "AI Manju API (Go)",
    "storage": "postgres"
  },
  "success": true
}
```
