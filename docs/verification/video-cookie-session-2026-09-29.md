# 视频工作台 Cookie 登录被误报 Session changed

状态：本地修复完成，未提交、未部署。

## 原因与复现

网站统一请求层携带 credentials: include，后端 RequireAuth 接受 ai_manju_session Cookie；因此 /api/auth/me 可以在浏览器没有独立令牌的情况下正常返回已登录用户。视频专用客户端额外把 !token 当作会话变化，在对话请求发出前抛出 AbortError("Session changed")，导致页面只剩错误与重试按钮。

在隔离浏览器中设置 HttpOnly 测试 Cookie，保持 localStorage/sessionStorage 无令牌，模拟受 Cookie 鉴权的接口：修复前复现相同错误，/api/sd-video/conversations 请求数为 0。修复后正常取得测试对话列表，工作台/视频页切换两次与刷新都成功。该验收使用模拟数据，不涉及用户真实对话或付费生成。

## 修改

- apps/studio/client/src/entities/sd-video/api.ts：移除无本地令牌即拒绝请求的条件。仍保留实例取消与本地令牌快照变化检查，Cookie 有效性继续由服务端鉴权。
- 新增 api.test.ts：11 项回归覆盖 Cookie 分页加载、消息/对话写入和工具接口、Bearer 登录、令牌切换/移除、实例销毁、分页中途凭证变化、401/503 真实错误返回。修复前 4 项失败、7 项通过，修复后 11 项通过。
- 不修改鉴权路由、响应信封、服务端权限语义，不删错误详情或伪造空对话掩盖异常。
- 同一轮用户先前要求的输入框留白调整已完成：展开输入区 104px 改为 80px，总高度约 189px 改为 165px，收起态与按钮排布保持不变。对应浏览器及完整验证日志：D:\AImanju4.0\.tmp\chat-composer-height-20260929。

## 验证

以下最终检查均退出码 0。完整日志与前后截图：D:\AImanju4.0\.tmp\video-cookie-session-20260929。Worker 保留 27 个环境相关跳过项。

### 修复前浏览器复现

```text
REPRODUCED: authenticated by HttpOnly cookie, no browser token; frontend Session changed blocks the conversation request before it reaches the API.
```

### 修复后浏览器验收

```text
PASS: cookie-only login loads actual API fixture history; route switching twice and reload succeed; 4 conversation GETs; no generated jobs or user-data writes.
```

### 视频相关定向测试

```text

 ✓ src/features/video/repositories/cloudConversationRepository.test.ts (9 tests) 7ms
 ✓ src/entities/sd-video/api.test.ts (11 tests) 14ms
 ✓ src/features/video/ui/VideoWorkbenchView.test.tsx (11 tests) 272ms

 Test Files  3 passed (3)
      Tests  31 passed (31)
   Start at  13:24:16
   Duration  1.74s (transform 438ms, setup 0ms, collect 770ms, tests 294ms, environment 1.00s, prepare 315ms)

```

### Studio check

```text

> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit

```

### Studio test

```text
 ✓ src/features/canvas/controllers/generation-jobs/browser-services.test.ts (3 tests) 6ms

 Test Files  260 passed (260)
      Tests  2052 passed (2052)
   Start at  13:25:21
   Duration  13.05s (transform 24.65s, setup 0ms, collect 99.79s, tests 39.66s, environment 117.14s, prepare 25.98s)

```

### Studio build

```text
../dist/public/assets/index-RCR-7kYk.js                           69.79 kB │ gzip:  23.40 kB
../dist/public/assets/index-BcmjcVJb.js                           88.03 kB │ gzip:  28.25 kB
../dist/public/assets/styles-DXkOeCWh.js                         151.64 kB │ gzip:  50.43 kB
../dist/public/assets/index-Bq7P7WI4.js                          167.31 kB │ gzip:  46.91 kB
../dist/public/assets/CanvasPage-BnuSwUEZ.js                     373.80 kB │ gzip: 114.05 kB
../dist/public/assets/MonitoringPanel-BVS_Jtxw.js                408.40 kB │ gzip: 113.82 kB
../dist/public/assets/index-BLb4XfIO.js                          763.10 kB │ gzip: 261.79 kB
✓ built in 6.49s
```

### Go build

无输出，退出码 0。

### Go vet

无输出，退出码 0。

### Go test

```text
?   	github.com/ai-manju/api/cmd/migrate-asset-library	[no test files]
?   	github.com/ai-manju/api/cmd/migrate-asset-tags	[no test files]
?   	github.com/ai-manju/api/cmd/migrate-provider-presets	[no test files]
?   	github.com/ai-manju/api/cmd/reconcile-asset-usage	[no test files]
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

### Canvas Agent test

```text
✔ reconnecting the same client replaces the old stream without deleting the new one (0.4982ms)
✔ shared tool definitions and local validators stay aligned (1.9647ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 88.3272
```

### Director Desk test

```text


 Test Files  87 passed (87)
      Tests  689 passed (689)
   Start at  13:25:18
   Duration  89.69s (transform 1.01s, setup 8.08s, import 5.23s, tests 31.07s, environment 37.38s)

```

### Worker compileall + unittest

```text
......................................................sssssss..........s.................reference transfer optimization unavailable
.......
----------------------------------------------------------------------
Ran 275 tests in 5.497s

OK (skipped=27)
```
