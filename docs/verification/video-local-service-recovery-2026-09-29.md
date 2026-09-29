# 本地视频页 503：恢复独立服务与服务间认证

状态：本地服务已实际运行并验证。没有发布线上、没有提交 Git。此次未改应用源码，修复运行环境。

## 证据与原因

用户截图 request_id：6b1988e2-e682-46e7-868d-1d4c95c9ee27。实际 API 日志确认 GET /api/sd-video/conversations 返回 503。现有 API 指向 http://sd-video-api:8201，但不存在视频服务容器，且 SD_VIDEO_JWT_PRIVATE_KEY 为空；Gateway 的 Enabled() 检查因此拒绝请求。SD_VIDEO_MODE 原值为 disabled（该值主要控制任务提交，并非本次会话接口的直接拒绝条件）。

上一轮 Cookie 客户端修复解决的是请求发送前的 AbortError；本轮修复的是请求到达服务器后的真实环境故障。

## 已实施

1. 从 apps/sd-video/Dockerfile 构建 ai-manju-sdvideo-local:20260929，使用真实 provider 执行模式，LOCAL_DEMO_MODE=false。
2. 新增独立 PostgreSQL、Redis、视频 API 容器和持久卷；执行全部 14 个迁移。健康检查 database/queue/storage 全部 true。新增容器配置 unless-stopped。
3. 生成本地专属 Ed25519 服务密钥与独立数据库随机密码。私钥以只读文件挂载到 API，服务只持有公钥；密钥和环境覆盖文件在 Git 忽略路径中，不输出、不提交。
4. 在确认现有 jobs 中 queued/running/pending 数量为 0 后，仅重建 API 容器以载入认证文件。保持原有 ai-manju-transfer-tasks:20260928 镜像，已校验镜像摘要完全一致，所有原环境变量保持一致，保留全部现有 Compose 覆盖文件。
5. 原数据库、资产卷、Worker、资产导出 Worker 未重建或清理。未提交任何生成任务。

本地运行文件：D:\AImanju4.0\.tmp\sdvideo-runtime-20260929\
- compose.override.json：本轮最终覆盖，包含本地机密，不可提交或贴出内容。
- runtime-manifest.json：当前/原 Compose 文件列表、项目名和原 API 镜像摘要，供后续维护核对。
- studio-private.pem / service-public.pem / database-password.txt：当前服务依赖，不能当作普通临时测试文件删除。

后续维护：保留现有 Docker volumes。重建 API 时先检查容器标签 com.docker.compose.project.config_files，沿用所有已有覆盖并包含本轮 compose.override.json。更新应用镜像时应明确更新本轮覆盖中的 image，不能无意回退到旧镜像。不要执行 down -v。

## 实际验收与限制

使用本地正常登录接口建立一次独立 Cookie 会话，直接访问运行中的 3100/3101 服务，未 mock 任何请求。/api/auth/me、/api/sd-video/conversations、/api/ai/models、/health 均 HTTP 200。实际页面显示完整视频工作台；点击切换页面并刷新后，对话接口三次均 200，页面异常数为 0。验收完已注销该次测试登录，不操作用户当前浏览器会话。

截图：.tmp/sdvideo-runtime-20260929/video-live.png
数据：.tmp/sdvideo-runtime-20260929/live-verification.json

当前本地没有可用的视频生成模型，页面真实显示“未配置”。SD-video 新任务开关仍保持 disabled，未填入任何供应商凭据、未启动模拟生成来伪装结果。已恢复会话加载，不宣称已经验证上游视频生成。正式启用 SD-video 生成还需对应模型凭据、配置和 Worker/Bridge。

## 检查实际输出

下列命令均退出码 0。前端现有包体积提示及 Worker 的 27 个跳过项保留。首次浏览器切换验证被版本公告挡住，在验收脚本中正常关闭公告后验证通过。

### 实际接口与浏览器

```text
{"mockedRequests":false,"endpoints":[{"endpoint":"/api/auth/me","status":200},{"endpoint":"/api/sd-video/conversations?page=1&pageSize=100&scope=personal","status":200,"total":0},{"endpoint":"/api/ai/models","status":200},{"endpoint":"/health","status":200}],"conversationResponses":[200,200,200],"browserErrors":[],"routeSwitchAndReload":"passed","generatedJobs":0}
```

### SD-video compileall 与 pytest

```text
Downloading pygments (1.2MiB)
 Downloaded pygments
Installed 5 packages in 10ms
Bytecode compiled 2477 files in 257ms
........................................................................ [ 33%]
........................................................................ [ 67%]
......................................................................   [100%]
214 passed in 2.32s
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
   Start at  13:37:47
   Duration  14.16s (transform 29.21s, setup 0ms, collect 122.07s, tests 44.33s, environment 111.59s, prepare 26.84s)

```

### Studio build

```text
../dist/public/assets/MonitoringPanel-BVS_Jtxw.js                408.40 kB │ gzip: 113.82 kB
../dist/public/assets/index-BLb4XfIO.js                          763.10 kB │ gzip: 261.79 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 9.11s
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
✔ reconnecting the same client replaces the old stream without deleting the new one (0.3038ms)
✔ shared tool definitions and local validators stay aligned (2.1696ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 75.4423
```

### Director Desk test

```text


 Test Files  87 passed (87)
      Tests  689 passed (689)
   Start at  13:37:47
   Duration  142.57s (transform 1.84s, setup 15.19s, import 9.06s, tests 40.00s, environment 64.64s)

```

### Worker compileall + unittest

```text
......................................................sssssss..........s.................reference transfer optimization unavailable
.......
----------------------------------------------------------------------
Ran 275 tests in 7.884s

OK (skipped=27)
```
