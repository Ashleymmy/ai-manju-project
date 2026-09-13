# SD-video 第二阶段执行记录

基线：`72b3ab7`。集成分支：`codex/sdvideo-phase2`。

## Beta 集成验收（2026-09-11，当前批次）

用户授权拉取协作者最新代码、合并本地第二阶段改动并推送 GitHub，后续由用户在 ECS 拉取部署。当前定位是 **Beta 云端实测候选版本**，不代表真实 Provider 或生产验收完成。

- 本地原有 200 个文件项保存为 `bd80ae1`；协作者的 10 个提交截至 `5e8e6bc`，包含全局搜索、Canvas 编辑与生成恢复、资产库和关键帧改进。合并提交为 `103713d`，唯一文本冲突是 `asset_service.go` 的 `math` / `os` import，均已保留。没有改写协作者历史。
- 新增代码已执行凭据特征检查；命中的 PEM 标记、示例 URL 和随机测试凭据均核对为解析代码或测试配置。没有将实际 `.env`、私钥、NAS Token、数据库或运行媒体纳入提交。
- 浏览器检查支持 `E2E_PHASE2_WEB_IMAGE`，本批明确使用新构建的 `studio-beta-web:20260911`，不覆盖之前的候选镜像标签。测试仅对未授权外部网络做拦截，同源业务直达真实服务，不替换业务响应。

| 本批实际验证 | 结果 |
| --- | --- |
| Go `build ./...` / `vet ./...` / `test ./...` | 全部通过；额外在新建隔离 PostgreSQL 库执行 repository / service 回归通过 |
| Studio `check` / `test` | 类型检查通过；**104 files / 505 tests** 通过 |
| SD-video `pytest -q tests checks`，Memory + PostgreSQL | **168 passed**，14 个迁移实际应用 |
| 新图片 Worker Linux 镜像 + 只读 tests + 专用 Redis | **65 tests，0 skipped，OK** |
| Linux 运维工具 `pytest -q /tools/tests` | **36 passed** |
| Canvas Agent 协议 / Agent / Director Desk | **4 / 1 / 686 tests** 通过；Director 为 **87 files** |
| Docker 构建：Go / Web / 图片 Worker / SD-video | 四类镜像均通过；Web 构建包含协议、Director 与 Studio，保留既有 Director 大 chunk 警告 |
| 新图片 Worker / SD-video 镜像 `compileall` | 两者均通过 |
| 根 Compose / 独立 SD-video / cloud + Token 覆盖 | 三套配置解析通过；不读取真实运行时凭据 |
| 独立跨服务 Mock E2E | 通过：任务、参考素材、幂等、取消、重启恢复、核对/重试、缩略图、资产导入、作用域与备份恢复 |
| 新 Web 镜像 + cloud Nginx 测试上游的 Playwright | **5 passed**：登录与深链接、跨浏览器视频历史、移动端、mention/取消/重试和越权拒绝 |

过程失败如实保留：Windows 运维测试首次为 35 passed / 1 failed，原因是宿主缺少创建符号链接权限，随后在目标 Linux 环境完整通过，未新增 skip。首次浏览器测试为 4 passed / 1 failed；第二浏览器对话请求在发送阶段被取消，服务端未收到请求。收窄测试网络拦截范围后原有全部断言通过，没有放宽应用超时、增加自动 retry 或改动业务 UI。

最新 Mock 备份为 `.tmp/sdvideo-phase2/e2e/backup-63015a82b3ee49b5896eb338d8c5052d/20260911T080000Z-8cd389b0/`；恢复到独立新库，Studio 35 张表、SD-video 15 张表。测试日志保留在 `.tmp/beta-20260911/`，这些运行产物不入库。

部署边界：用户仍可沿用 GitHub 拉代码、根 Compose 构建的更新流程，不必先开通镜像仓库。现有 ECS 的本地资产卷和数据库必须保留，不能执行 `down -v`；重建时保留服务器已有 override 和 `compose.nas-ipv6.yml`。本次没有修改 ECS 容器或切换存储。根 Compose 默认 `ASSET_STORAGE_BACKEND=local`、`SD_VIDEO_MODE=disabled`；新 SD-video 服务还需显式 profile、独立数据库、服务 JWT/TLS 与 Token 目录挂载，不能把拉取代码等同于链路已经启用。

NAS 基础设施已由用户在真实 ECS/NAS 验证五桶读写、签名 Range、跨身份/公开路径拒绝及 Token 自动投递续期；**应用容器实际使用 NAS、浏览器/Provider 的媒体可达性、OSS/CDN、真实付费任务、完整云栈与回滚仍未验收**。旧本地资产不能通过改一个存储开关自动迁移。下面保留的是各历史批次记录，其中的“未提交／未验证”仅描述当时状态。

最新增量（2026-09-10）：用户明确授权新一轮 Go 镜像构建验证后，**Go 发布镜像构建通过，耗时 10.2 秒**；镜像内 API、导出 Worker、视频 Bridge 在隔离空 PG/Redis、production 配置、只读容器中启动与健康检查通过。此前新图片 Worker、SD-video 镜像、Go build/vet/test、图片 Worker **59 tests**、运维工具 **36 tests**、Studio **88 files / 407 tests** 已通过；客户端 **586 文件零改动**。9 月 9 日的 **5 项 Playwright 浏览器检查**及 Web 镜像结果仍作为上一批证据。**Go 构建阻塞已解除，但 NAS/真实 Provider/云端整栈联测仍未完成**。未提交、push 或部署。各批次实际验证及限制见文末。**旧腾讯云/WireGuard 测试路线已由用户确认停用，不能再作为可用资源或候选通道。**

## 进度（2026-09-08，本轮实测）

本轮已落地主要代码并通过隔离的跨服务 Mock 联通。**第二阶段仍在进行中，不是生产发布或云端内测验收通过。** 下表的“代码落地”不代替真实 Provider、OSS/CDN 和页面验收。

| 节点 | 代码落地 | Mock / 本地验证 | 真实服务 / 云端 |
| --- | --- | --- | --- |
| 1. 视频任务与结果闭环 | 本地 outbox、独立 Bridge、稳定幂等键、租约、取消、重试与结果导入 | 已通过任务流、在途重启、租约恢复、取消阻止迟到导入、并发导入及存储失败补偿 | 付费 Provider 未验证；不确定提交的运维处理入口仍待补齐 |
| 2. 持久化与分发 | 按最新确认，NAS（本地 Supabase Storage）为持久层；两侧适配、受限身份和签名 URL 已落地；OSS 分发待单独确认 | 适配器 Mock、PostgreSQL RLS 及官方 v1.48.26 Storage 容器实测通过，详见文末 | 生产 NAS/Kong、云地通道、浏览器/Provider 签名媒体入口与吞吐未验收；暂停新增 SD-video OSS 桶 |
| 3. 完整业务 | 对话消息、素材注册/轮询/删除、标签关系、持久 MediaKit、模型版本与容量 | 主要 API 与 Worker 场景通过；已删除旧数据库执行模块 | Provider 连通和完整能力对照仍待真实验收；列表 SQL 分页、媒体筛选及运维统计仍需完善 |
| 4. 页面接线 | 视频会话 repository、消息/附件/Job 恢复、管理模型与素材旧入口、擦除入口 | Studio 类型检查、406 个测试、构建通过 | 双浏览器、Canvas 目标节点回写及全页面 Playwright 未执行 |
| 5. 部署运维 | 隔离 Compose、内网 HTTPS/JWT、健康检查、告警规则、小时备份脚本 | 三套 Compose 解析通过；两套隔离库备份/新库恢复通过 | Go 容器构建超时；完整云栈、监控接入、异地备份与 RPO/RTO 未验收 |

已执行清单：

- [x] 保留原工作区，建立客户端哈希基线和独立集成分支。
- [x] Gateway 先持久化 Job/outbox，独立 Bridge 发送、轮询、导入与补偿。
- [x] Worker 租约持有者校验、续租、提交意图、不确定提交禁止自动重复扣费。
- [x] 稳定 Studio Asset 内容地址；SD-video 停服后已导入视频仍能读取。
- [x] 输入登记、完成校验、作用域、素材 Active/namespace 校验和引用保留期清理。
- [x] 素材注册/轮询/删除、标签关系完整性与 MediaKit 持久任务接入。
- [x] 视频服务端会话/消息及账号缓存隔离；部分消息发送失败的草稿恢复。
- [x] 删除旧 Supabase Auth/数据库执行模块和旧页面路由；保留独立 Storage API 适配。
- [x] 集中构建回归、跨服务 Mock、取消/恢复故障场景和隔离备份恢复。
- [ ] 完善并验证下面列出的本地剩余项。
- [ ] 新 OSS/CDN、真实 Provider、双浏览器/Canvas、云端部署与运维验收。

## 约束

- 保留既有未提交内容；不迁移或访问旧 SD-video 数据、存储和密钥。
- 只允许修改必要的数据接入代码和调用点，不修改视觉/CSS/页面 URL。
- 客户端哈希基线由 `scripts/sdvideo-phase2-baseline.mjs` 保存于忽略目录 `.tmp/sdvideo-phase2/`。
- 前端允许范围：视频 repository/service/hooks 的接线、对应 entity API、必要调用点及测试；具体变动在终测时逐文件核对。
- 本地 Mock 测试使用独立环境；云端启动、真实 Provider 付费请求须先具备已确认的连接配置和费用上限。

## 本轮关键改动与兼容性

- Go 新服务客户端使用 Ed25519 短期 JWT、生产 HTTPS、CA 文件及禁止重定向；仅独立 Bridge 持有显式 `tasks:drain` scope。关闭新任务入口后，已持久化 outbox 仍能继续完成。
- Job 的远端生成状态与 Bridge 资产同步状态分开。暂时下载/存储失败保留远端成功状态并退避补偿；两个 Bridge 的导入不会产生重复 Asset。取消与导入共用锁，不写整份 Canvas 快照。
- GORM 外部任务锁改用独立 pgx 会话，避免占用业务连接池导致死锁；Memory 实现保留一致的锁语义。
- 已成功视频内容请求转到 Studio 稳定 Asset 内容接口；固定 MP4 扩展名，避免 Windows MIME 映射为 `.m4v` 后导致 Asset 404。
- 重试保留旧任务，新 attempt/Job 与远端任务关联；`submission_uncertain` 拒绝自动重试。输入不随失败立即删除，仅在无活跃/近期引用且保留期到期后清理。
- 素材上传通过 issue / PUT / complete 和 SHA 校验；公网 URL 注册使用逐跳 DNS 校验、固定连接地址和 HTTPS，不透传浏览器凭证。标签删除同步清理 JSON 与 `asset_tags`，团队空间预览地址保留 scope。
- 模型元数据采用 DB 版本；凭证保留在独立服务 Secret 配置中。管理端测试没有可核对的上游任务时返回 `ok=false, probe_task_required`，不假称成功或偷偷发起付费生成。
- MediaKit 不再返回进程内 queued 占位，复用持久任务和 Studio Bridge 导入。未配置凭证的模型明确禁用；未知费用保持 null，不伪造金额。
- 新消息按记录/版本写入；旧 IndexedDB 历史不自动上传。缓存按账号与 scope 隔离；只恢复未发送的新消息，不覆盖服务端新版本或复活已删除会话。
- 删除 13 个旧运行模块：`admin.py`、`supabase_client.py`、旧 `task_worker.py`、`seedance_asset_service.py`、`oss_client.py`、`schemas.py` 以及旧 `routers` 的 7 个文件。Provider 协议保留。相关旧测试迁到新作用域、模型快照和 Storage 适配测试，不通过 skip 隐藏问题；锁文件移除 Supabase Auth/DB SDK 和 Jinja 依赖。未删除旧源项目或任何业务数据。
- 新增迁移 `0005` 至 `0010`；已有迁移未通过覆写替代。本轮 E2E 在独立空库实际应用全部 10 个迁移。

## 实际验证

以下均为本轮执行，不引用 9 月 4 日的历史报告作为通过依据。

| 命令 / 验证 | 实际结果 |
| --- | --- |
| `apps/api`: `go build ./...`、`go vet ./...`、`go test ./...` | 退出码 0；最新 handler `11.581s`、sdvideo `0.677s`、service `2.397s`，其余通过或缓存 |
| `apps/sd-video`: `uv run pytest -q` | **64 passed in 0.97s**，无 skip |
| `apps/sd-video`: `uv run python -m compileall -q api worker` | 退出码 0 |
| `pnpm --filter ai-manhua-studio check` | 退出码 0，TypeScript 零错误 |
| `pnpm --filter ai-manhua-studio test` | **88 files / 406 tests** 通过，17.96 秒 |
| `pnpm --filter ai-manhua-studio build` | 通过，协议与 Director 构建包含在依赖构建中；Studio Vite `7.66s`，Director `11.88s`，Director 保留原大 chunk 警告 |
| `pnpm --filter @basketikun/canvas-agent test` | 本轮较早检查：build 通过，1 个测试通过；之后未修改该应用 |
| `pnpm --filter @ai-manju/director-desk test` | 本轮较早检查：**87 files / 686 tests** 通过，158.65 秒；之后未修改该应用 |
| 图片 Worker 锁定依赖环境：compileall / unittest | compileall 通过；Windows 44 个测试、2 个平台/Redis 既有 skip；下面 Linux 检查已覆盖这两项 |
| 最新 Worker 镜像 + 隔离 Redis：`python -m unittest discover -s /app/tests` | **44 tests，0 skipped，OK** |
| 根 Compose、独立 SD-video Compose、云端 Compose：`config --quiet` | 三套均退出码 0；使用示例 env，不展开真实密钥 |
| SD-video Docker build | 通过；镜像 manifest list `sha256:34714fcd42cec2edd588342eaf3f8d5c12250fdaaf2c1c754ea933e71a6a193e` |
| 图片 Worker Docker build（`--require-hashes` 安装） | 通过；镜像 manifest list `sha256:9fc4625e01044a055fdeabd632a28e5ffa5567854ea69950dba5e79936d7f635` |
| SD-video Linux 只读容器 + 新测试 DB/Redis + tmpfs | 迁移通过，实际健康结果 `{'database': True, 'queue': True, 'storage': True}`；这是本地存储健康，不是 OSS 健康 |
| Go Docker build | **超时跳过**：13:27:27 开始，13:42:29 终止，约 15 分钟；停在 `RUN go build -o /out/ai-manju-api ./cmd/server`，无后续输出。本轮未重跑或换命令复测该镜像构建 |
| `node scripts/sdvideo-phase2-baseline.mjs --verify` | 586 个当前客户端文件；只有下节列出的 11 个允许文件不同，其余哈希一致 |
| `git diff --check` | 退出码 0 |

### 跨服务 Mock 与故障测试

入口：`apps/sd-video/.venv/Scripts/python.exe scripts/sdvideo-phase2-e2e.py`。

使用 `deploy/cloud/compose.mock-deps.yml` 的两套 PostgreSQL / Redis。每轮生成独立 JWT 与测试账号，创建 `phase2_<uuid>` 新空库，不读取项目 `.env`。API、Task Worker、Asset Worker 和 Bridge 为独立进程；Mock 返回包含 `ftyp/moov/mdat` 的 MP4，不是字符串占位。

实际 PASS 摘要：

```text
real JWT + separate PostgreSQL/Redis + Go outbox + Worker + Bridge + asset import + MP4 content
text / multipart image reference / idempotency / pre-dispatch cancellation
server history recovery / owner isolation / expired JWT
model metadata update / stale version conflict / non-fake Provider test
MediaKit durable task and asset import
material upload / tag binding / registration / private preview / Active reference / delete prevents reuse
accepted outbox drains with rollout disabled / tag delete cleanup
imported video survives SD-video API shutdown
in-flight Worker termination / lease expiry recovery without duplicate enqueue
in-flight cancellation blocks late asset import
both databases backed up, SHA verified and restored into NEW databases
```

补偿的单元测试在 `apps/api/internal/service/sdvideo_bridge_failure_test.go`：第一次存储失败后保留任务；两个 Bridge 并发只导入一次；补偿期间取消不产生迟到 Asset；生成的 Asset 可实际读取。这不等同于阿里云 OSS 故障注入已验收。

备份演练使用 `deploy/cloud/backup.py`，恢复到新建的 `restore_check_<uuid>` 库：Studio **35 张表**，SD-video **14 张表**。实际备份保留于忽略目录 `.tmp/sdvideo-phase2/e2e/backup-a68fe11fb5714c6ea147635601ce0426/20260908T060113Z-e1813635/`。没有覆盖源库，没有安装云端 timer；该小规模本地结果不能证明云端 RPO ≤ 1 小时、RTO ≤ 2 小时。

### 客户端允许改动核对

所有路径相对于 `apps/studio/client/src/`，无 CSS 或新产品页面改动：

```text
features/admin/services/adminApi.ts
features/video/VideoPage.tsx
features/video/repositories/conversationRepository.ts
features/video/repositories/cloudConversationRepository.ts
features/video/repositories/cloudConversationRepository.test.ts
features/video/services/generationGateway.ts
features/video/hooks/useVideoToolkit.ts
features/video/ui/ToolkitPanel.tsx
features/video/ui/VideoWorkbenchView.tsx
entities/sd-video/api.ts
entities/sd-video/index.ts
```

## 已知剩余项与发布门禁

- 本地增量已补火山素材/标签分页、旧 Gateway 点查询、工作空间任务/usage 聚合、Bridge 同步失败和临时盘指标、独立缩略图生成及授权读取。不确定提交核对 API/审计/恢复已落地。仍须完成全页面/真实业务能力对照、实际监控采集和告警触达、NAS 全链路及真实 Provider 验收；已提供指标或 API 不等于页面和运维交付完成。
- 双浏览器服务端视频历史、Canvas 指定节点刷新恢复/已删除节点行为、首尾帧/视频/音频/多参考素材、全部现有管理入口与 Director 页面，尚缺本轮完整浏览器自动化与人工验收。API/codec 测试不是页面验收。
- 当前代码存在 OSS/CDN 接口，但新 OSS Bucket、RAM 最小权限、CDN 私有回源与 Type A 时间窗、Range、下载文件名、CORS/Canvas 读取、图片生成/编辑/导出/缩略图的真实端到端链路未运行。
- Seedance、Vidu、Yike、MediaKit 的协议 Mock 回归不证明新付费凭证有效。没有执行真实视频请求、真实取消或付费自动重试。
- Go 容器构建超时阻断可发布镜像验收。完整云 Compose build/up、Nginx HTTPS/深链接、Secret 文件权限、备份异地复制、告警触达、负载测试和回滚演练尚未完成。
- 当前只提供部署模板与备份/告警脚本；没有配置真实 Secret Manager、CDN 控制台、systemd timer 或监控平台，没有对外开放注册和域名流量。

最新执行顺序：剩余本地代码与页面验收 → NAS Storage 隔离及云地网络联通 → 经确认的最低费用真实冒烟 → 云端测试账号内测 → 用户单独批准对外开放。OSS/ESA/CDN 是否承担分发或中转另行确认。

## 环境与工作区交还

- 分支仍为 `codex/sdvideo-phase2`，HEAD 仍为 `72b3ab7`，没有提交、暂存或推送本轮代码。初始 81 项未提交状态保存在基线中；当前 Git 状态同时包含原有内容与本轮改动，不能将全部状态项都当成本轮新增。
- 未重启或修改用户原有本地服务，未启动任何云端服务。
- 验收完成后仅对本轮 `studio-phase2-check` 执行 `docker compose -f deploy/cloud/compose.mock-deps.yml down --volumes`，移除 4 个临时依赖容器、其网络与临时 Redis 卷。测试空库随 tmpfs 回收；本轮备份 dump、日志与镜像仍保留。没有清理其它 Docker 项目、旧 SD-video、Studio 业务数据或用户资产。

## 外部验收前置

服务器已登记为阿里云上海 ECS、Ubuntu 24.04、8 核 16 GiB、5 Mbps。已有 Studio 测试 OSS 桶不删除。仍缺经验证的云地 Storage 通道、媒体 HTTPS 入口、受限身份部署、令牌续发分发链及新 Provider 凭证/费用上限，不能声称云端或真实模型已验证。

## NAS Storage 接入续作（2026-09-08）

用户确认：本地 Supabase Storage 底层是购买的独立 NAS 阵列。宿主机显示 ext4 不能用来否定底层阵列；本轮不使用办公 SMB 共享 `/mnt/nas_public`，也不迁移旧资产。持久化通过 Storage API，不挂载 NAS 文件系统到云端，不接旧 Auth/业务数据库。

### 本轮代码

- Go `internal/storage/supabase.go` 实现上传、流式读取、HEAD、删除、签名和专属私有桶 Probe；API、导出 Worker、Bridge 共用现有 storage factory。API `/health` 以 3 秒上限实际检查专属桶，存储故障不再被资产解析统一伪装为 404。
- 图片 Worker `worker/supabase_storage.py` 接入同一 Studio bucket/object key；参考输入和生成结果共用现有存储入口。下载有大小限制、完整性检查及原子替换；失败不破坏已有本地文件。新增锁定依赖 httpx 0.28.1（既有包版本保持不变）。
- SD-video `api/app/storage/supabase.py` 按 inputs/results/thumbnails/volcano 分四桶；稳定 object key 不变，结果不依赖短期 URL 持久化。重复上传只在 SHA-256 相同时视为幂等成功，不覆盖不同内容。
- 两侧配置分开内部 HTTPS 读写 origin 和外部签名媒体 origin。仅 `/storage/v1/*` 请求；不使用环境代理、不跟随重定向、不关闭 TLS 校验，可显式配置私有 CA。错误不包含远端原始 body、密钥或签名 URL。
- 拒绝旧 service_role；只接受 `studio_storage_service` / `sdvideo_storage_service` 的未过期、最长 300 秒 JWT，含 sub 和 storage_buckets。客户端解码只是防误配，不是验签；真实签名与权限由 Storage 服务验证。可选 Kong apikey 仅接受公开 anon JWT。
- `storage-token.py` 使用全新 Ed25519 私钥签发受限机器 Token，提供公钥 JWKS 输出和令牌文件原子替换。**工具不是自动续期服务**，未安装 timer、未分发令牌，未读取旧签名密钥。
- 云模板改用 Supabase/NAS；根/独立 Compose 增加相应环境变量转发。根开发 Compose 使用 token 文件时仍需显式增加 Secret 目录挂载；云 Compose 已有各自目录只读挂载。没有修改真实 `.env` 或生产 Compose。

### 隔离模板与运维执行顺序（尚未应用到生产）

1. 在隔离环境审核 `deploy/cloud/storage-isolation.sql`。它要求原 Storage 表已启用 RLS；同名角色/桶会直接失败回滚，禁止认领旧桶。测试桶为 `studio-test-assets` 及 `studio-sdvideo-test-{inputs,results,thumbnails,volcano}`，正式环境必须整体改成另一组名字。
2. SQL 只新建私有桶元数据、专用 NOLOGIN/NOBYPASSRLS 角色及策略。固定角色到桶映射与 JWT claim 求交集；RESTRICTIVE 策略阻止旧 PUBLIC 宽松策略放行新桶，专用角色不能读旧桶、不能修改桶配置。不改旧表业务数据、不删除旧策略。执行前须核对 Storage DB 连接身份是否确为 `supabase_storage_admin`。
3. 仅在受信本地存储端创建全新 Ed25519 私钥。签发工具依赖 cryptography（可用新 SD-video 锁定环境运行），私钥不可复制给云端 Studio/Worker。`--init-key` 拒绝覆盖；`--public-jwks` 只输出公钥。最新运维确认生产尚未配置 `JWT_JWKS`，此次是首次引入；必须保留旧 `AUTH_JWT_SECRET`、算法和 URL 签名配置，不可用新公钥替换旧认证链。若执行时已有 JWKS，应合并而非覆盖。
4. 分别生成固定机器 UUID，用 `--role`、重复 `--bucket`、`--subject`、`--key-file`、`--kid`、`--output` 签发 Token。建议每 60 秒更新，通过已确认的认证加密通道分发至云主机，再原子替换各自 Secret 目录中的 `storage-token`。签发/分发故障必须告警；300 秒过期后应用拒绝使用，而不是回退全权密钥。
5. Token 工具输出默认权限 0600；分发端按容器实际 UID/GID 设置只读权限（例如所属服务组的 0440），不能给所有用户可读。挂载目录而非单文件，避免原子替换后容器继续读旧 inode。两服务不能互读令牌目录。
6. 私网入口只允许新云主机读取/写入 Storage API，不放行旧 Auth、REST、SQL 或管理路由。公网媒体入口只提供签名对象 GET/HEAD；禁止暴露私有对象鉴权路由、上传/删除接口及机器 Token。Kong 或专用反代如何配置，需要运维在本地隔离环境验收。
7. 配置精确浏览器 Origin（目前 `https://studio.clouddo.cc`、`http://47.103.211.217`）；验证 Range/206、Content-Disposition、缩略图、CORS/Canvas 读取和过期 Token。Provider 必须能访问签名 HTTPS 媒体地址，云服务器能够访问私网入口不等于 Provider 可达。
8. 先验证测试桶 CRUD、跨桶/过期/篡改拒绝、Token 连续轮换、NAS 短时离线后的补偿，再执行 Studio 上传/图片生成编辑/视频导入/ZIP 导出/刷新恢复。通过后才考虑真实 Provider 最小冒烟及部署。

协议核对的是 Storage API **v1.48.26** 的 `src/internal/database/connection.ts`、`src/http/plugins/jwt.ts`、`src/internal/auth/jwt.ts`、`src/http/routes/object/getObjectInfo.ts`：支持 JWT role 切换与 `request.jwt.claims`，支持新增 Ed25519 JWKS、authenticated HEAD。此次未在真实 Storage 容器上验证所有 grants、触发器和 Kong 路由，源码核对及下述最小 schema 的 RLS 测试不能替代该验收。

### 本次实际验证（与上文较早一轮区分）

| 命令 / 检查 | 结果 |
| --- | --- |
| Go `go build ./...`、`go vet ./...`、`go test ./...` | 退出码 0；新增 Storage 测试 0.662s、router 0.368s，含 HTTPS CA、健康 200→503→200、CRUD、冲突、签名路径、过期/越权与轮换 |
| SD-video `uv run pytest -q tests ../../deploy/cloud/tests` | **88 passed in 1.27s**（服务 82 + 签发工具 6）；验证真实 Ed25519 验签与篡改拒绝 |
| SD-video compileall | 退出码 0 |
| Windows 锁定 Worker 依赖 compileall/unittest | **51 tests, OK, skipped=2**；原有 Redis/平台限制由下面 Linux 测试补齐 |
| Linux 最新 Worker 镜像 + 独立 Redis、只读挂载测试源码 | **51 tests, 0 skipped, OK**；compileall 通过 |
| Linux 最新 SD-video 镜像，network=none、临时数据/日志、只读挂载测试 | **82 passed in 1.32s** |
| `check-storage-isolation.py` + 新临时 PostgreSQL 16 | PASS：本桶 CRUD、旧桶/另一个服务桶拒绝、旧 PUBLIC 策略隔离、空 claim 拒绝、anon/authenticated 隔离；旧测试对象保持原样 |
| Studio check/test/build | 退出码 0；**88 files / 406 tests**，TypeScript 零错误；Vite 2.65s |
| Canvas Agent / 协议 | build 和 1 个测试通过 |
| Director Desk | build 4.95s；**87 files / 686 tests** 通过，158.83s；保留既有大 chunk 警告 |
| Worker Docker build | 成功，`studio-storage-worker:check`，manifest list `sha256:44ea390c2be734dd4fdac95607f4ab547c3d183f4f973cb721ba5a7ef161b51a` |
| SD-video Docker build | 成功，`studio-storage-sdvideo:check`，manifest list `sha256:87679ad35019e60d7df6e094ebed815966a31f9748e2798ce93b17e60dd44dd4` |
| 根 / SD-video / 云 Compose `config --quiet` | 三套退出码 0，只用示例 env |
| 客户端逐文件哈希 | **586 文件一致**；汇总 SHA256 `5DCD772CE2EA43E1054096A326315D87410F887078EEE2735A7B980461E0C37A` |

Linux Worker 第一次测试命令未挂载测试目录，而镜像按 `.dockerignore` 不包含测试源码，得到 `Start directory is not importable: tests`。补上只读测试目录后真实执行 51 项全部通过，没有修改或跳过测试。Go Docker build 仍遵守上轮超时跳过限制，未重跑、未变相复测。

本轮未执行跨服务 NAS E2E、真实 NAS 请求、云端/公网/Provider 媒体访问或付费生成。旧完整 Mock E2E 使用 local storage，不能算作 NAS E2E。没有应用 SQL/JWKS/权限、没有部署或重启现有服务，没有提交/暂存/push。第二阶段仍在进行中。

结束时核对测试所有权标签后，已停止并移除本轮临时 PostgreSQL、Redis 容器及独立测试网络；tmpfs 测试数据随容器回收，不含真实业务数据。测试镜像保留。`git diff --check` 退出码 0，暂存区仍为空，分支仍为 `codex/sdvideo-phase2`。

## 真实 Storage API 隔离验收续作（2026-09-08）

本次只推进存储集成验证，不冻结其他业务开发，不改前端/业务数据库，不切换现有服务的 backend。共享存储配置、适配器和部署文件由本任务维护；协作者继续功能开发时应避免同时修改这些文件。生产创建桶/角色、引入 JWKS、网关/VPN 变更及 Storage 重建仍需另行批准和执行窗口，不能随代码开发自动应用。

### 新运维事实

“运维部署-本地服务器”仅只读核对后回传：

- 镜像标签为 `supabase/storage-api:v1.48.26`；内部 package version 为 1.11.2，不能混作同一版本号。数据库连接角色已核实为 `supabase_storage_admin`。
- `JWT_JWKS` 未配置；`AUTH_JWT_SECRET` 已配置。没有读取/输出任何密钥值。
- 候选 HTTPS 根入口为 `https://sd.ggwp.cn:18000`，本地主机解析至 `192.168.1.101`，TLS 校验通过；OpenResty → Kong → Storage，5000 未直接发布宿主端口。
- Kong Storage 路由有 cors、request-transformer、post-function；插件内容与新 JWT 的兼容性未验收，不根据根路径 401 推断认证机制，也不绕过网关。
- 上海 ECS 与 Provider 到该入口的 DNS/SNI、IPv4/IPv6、ACL、端口和吞吐当时未实测。后续用户明确确认：腾讯云服务器已不存在，原腾讯云 → WireGuard → 本地服务器仅是停用的测试链路，相关候选全部撤回。Tailscale 的归属和用途未确认，不默认使用或修改。

### 新增测试入口与修正

`apps/sd-video/.venv/Scripts/python.exe deploy/cloud/check-storage-api.py` 自行建立临时 PostgreSQL、Storage 容器、专属网络和测试对象卷，生成临时 JWT/TLS 密钥；不读取 `.env`、不访问生产。固定官方 Storage 镜像 digest：`sha256:86487b496499561225c1f79c546645421890125539a8d9e00da45dee0a834314`，PostgreSQL 为 `postgres@sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb`。容器端口仅绑定 127.0.0.1。

官方迁移先创建完整 schema，再应用本项目隔离 SQL。应用阶段实际使用 `supabase_storage_admin` 连接，不依赖 postgres 超级用户来验证请求权限。Go 真实测试通过 `-tags storageintegration` 显式开启，普通测试不会新增 skip。

实际发现并修复：v1.48.26 对缺失对象的 HEAD 返回 HTTP 400 且无响应体。Go 现在仅在 HEAD 400 时补查 `/object/info/authenticated/...` 的轻量元数据接口，依据真实错误区分缺失与权限/服务故障，避免直接把所有 400 当作 404。正常 HEAD 不增加请求。

### 实际结果

最终隔离测试退出码 **0**：

```text
PASS: fresh isolated PostgreSQL started
PASS: official Storage API v1.48.26 migrations and startup
PASS: runtime database connection uses supabase_storage_admin
PASS: Studio Worker TLS/private bucket/CRUD/idempotent upload
PASS: SD-video four-bucket upload/sign/Range/download/delete
PASS: JWT/old-bucket denial, legacy HS256 compatibility, rotation, Storage restart persistence
PASS: Go storage adapter against live TLS/Storage API
```

旧认证回归只使用新临时库中的合成旧桶/旧用户 fixture：新增 JWKS 后旧 HS256 身份仍可读取其旧对象，但不能读取新专属桶；不是读取真实旧用户资产。Storage 重启后从测试对象卷读取的内容一致。检查覆盖 Worker 与 SD-video 实际适配器及 Go HTTPS/CA、上传冲突、HEAD、签名 Range、删除后不存在语义。

过程失败如实记录：首次 Docker internal 网络未发布宿主端口；第二次随机宿主端口在 restart 后重新分配，测试反代仍用旧端口；第三次暴露上述 HEAD 400 实际兼容问题。已分别修正测试网络/端口追踪、核对官方错误和 info 实现后修正 Go，再执行最终集成验证通过。无超 15 分钟命令；未重跑上轮已超时的 Go Docker build。

后续 `go build ./...`、`go vet ./...`、`go test ./...` 全部退出码 0，handler 11.736s、router 0.364s、service 1.804s、storage 0.657s。测试脚本 py_compile 和 `git diff --check` 均通过。前端仍为 586 文件，汇总 SHA256 与前节完全相同；本次未重复跑无改动的全套前端/Director 回归，前节结果仍作为其基线。

结束时已清理每次测试创建的容器、对象卷、临时 JWT/TLS 密钥及网络，标签查询无残留；仅保留官方镜像缓存。未改生产、未部署、未重启现有服务、未提交或 push。剩余门禁是实际 NAS/Kong、云地网络、令牌定时续发分发及业务全链路/浏览器验收，不能将本次 Storage 组件集成测试称为云端 NAS 全链路验收。

## 网关只读核对与短期令牌续期准备（2026-09-09）

### 已核实与尚未核实

“运维部署-本地服务器”本日通过配置文件及容器 loopback Kong Admin API 的只读查询核对当前生效行为，没有执行对象写入、登录、业务数据读取或服务重启：

- OpenResty 的 `/usr/local/openresty/nginx/conf/conf.d/supabase.conf:2-4` 监听 IPv4/IPv6 18000；`/www/sites/supabase/proxy/root.conf:2-10` 转发 Kong 8000，没有覆盖 `Authorization` 或 `apikey`。全局 1Panel WAF 尚未全面审计。
- Kong `storage-v1-all` 匹配 `/storage/v1/`、`strip_path=true`、`methods=null`。对应宿主模板 `/home/hexun/supabase-project/volumes/api/kong.yml:257-284`，容器生成配置 `/usr/local/kong/kong.yml:255-282`。路由没有方法白名单，不代表所有 Storage 端点支持所有方法。
- 生效 `request-transformer` 保留普通 `Authorization: Bearer <JWT>`，不按 Ed25519/kid 将其替换为旧身份。Authorization 缺失或以大小写敏感的 `Bearer sb_` 开头时才取调用者的 apikey；没有注入服务器持有的旧密钥。后置 `post-function` 对原始 Authorization 缺失、空或纯空白的请求清除该头，所以不能依赖 apikey 自动代替 JWT。
- 因此，当前新适配器明确发送 `Bearer <受限 JWT>` 的方式与该转换规则相容，没有证据要求为此修改旧路由。这仍是配置与合成表达式核对，不能代替真实受限身份请求和 WAF 验收。
- 本地 18000 双栈监听已确认，但公网 A/AAAA、NAT/ACL、ECS 出站与 Provider 可达性未确认。工作站 DNS 返回代理 fake-IP，不能据此作公网可达结论。
- 现有本地运维任务没有 `47.103.211.217` 的已授权 SSH 入口，没有猜用或索取其他项目凭据。下一步需要用户指定 ECS 运维入口，或由用户在 ECS 执行不携带 Token 的 DNS/TCP/TLS 检查；保留 `sd.ggwp.cn` 的 SNI，不关闭 TLS 校验。

### 本地实现

- `deploy/cloud/storage-token-sync.py` 增加 `publish / receive / check`。本地签发 300 秒令牌，通过 SSH stdin 发送，令牌和私钥不进命令参数或日志；固定主机指纹、禁交互认证、禁转发、禁用户 SSH 配置，单次发送上限 35 秒。
- `storage-token-publish.service/.timer` 提供本地每 60 秒续期模板。它不是 Codex 自动化，也没有在任何服务器安装或启动。SSH 仅是经审核的分发候选，不假定云地通道已经存在。
- 云端只持公钥 JWKS，验证签名、固定机器 subject、角色、精确桶列表、iat/exp 和最长 300 秒有效期；收到时至少剩余 180 秒。两份令牌全部验证后才安装，使用进程间锁拒绝并发安装，用 iat/exp 阻止旧批次覆盖新批次。
- 单文件替换使用原子 rename 和 0440 服务组只读权限；失败保留该文件原值并返回失败。两文件不是一个文件系统事务：第二份写失败时第一份可以已更新，发送端不会获得成功回执，下一次 timer 用新批次补齐。没有回退 service_role 或延长 Token 有效期。
- `check` 验签并检查两份令牌至少剩余 120 秒，否则退出 1，可接现有监控。发布失败会令 systemd unit 失败并写脱敏 journal；**外部告警接收器、云端定时健康检查和 NTP 状态仍未配置**，不能称为完整告警闭环。
- 增加发布/接收 JSON 示例和受限 sshd 示例。接收账户只拥有两个 token-only 目录；配置、代码、JWKS、authorized_keys 由管理员维护，账户不能写它们，也不能读写数据库密码、应用 Secret 或签发私钥。拒绝未知远端命令、客户端指定路径、重复 JSON 字段、同 subject/目录/读组和嵌套目录。
- `compose.storage-tokens.yml` 作为 NAS 模式的显式覆盖文件：仅额外挂载独立令牌目录到 `/run/storage-credentials:ro` 并增加各自读组，不修改原有业务 Secret 挂载。部署时必须同时指定基础 Compose 和该覆盖文件；不改现有线上 Compose 或真实 env。

### 经批准后的安装边界（本轮未执行）

1. 先确定 ECS 运维入口及网络路线，实测 ECS → Storage HTTPS，以及本地签发主机 → ECS 受限 SSH；公钥主机指纹走独立可信通道核验，不能用首次连接自动信任。
2. 在新专用目录安装两份 Python 工具及锁定 cryptography 依赖（当前 SD-video 的 `uv.lock` 可提供锁定版本，不依赖旧 SD-video）。准备专用签发用户与新 SSH Key；Ed25519 签名私钥和 SSH 私钥只留本地签发端。签名私钥不使用旧 Storage `AUTH_JWT_SECRET`。
3. ECS 建立专用接收账户和两个经核对不冲突的读组（模板 21001/21002 只是示例），token-only 目录由接收账户持有、各自读组所有、0750；接收账户加入两组。镜像内应用通过各自 `group_add` 读取，不互相加入另一组。应用仍只读挂载，接收账户不加入 docker 组、不授 sudo。
4. 安装 root 管理的 receiver 配置/JWKS/程序、authorized_keys 和严格的 SSH `Match User` 段；限制已验证来源、禁止密码和转发。先 `sshd -t` 再申请定向 reload，不能直接覆盖整份 sshd 配置。
5. 使用新固定机器 UUID，签发端和接收端保持一致；JWKS 引入/五桶 SQL 是独立审批动作，保留旧 HS256 认证。更换新公钥时先重叠保留旧 kid，等所有已安装令牌更新且旧令牌过期后再移除。已有令牌损坏或旧 kid 提前删除会拒绝安装，需受信运维核对后恢复，不自动绕过校验。
6. 首次分发并 `check` 成功，再启用 timer、外部告警和应用挂载；监控超过 120 秒未获得新令牌与发行/接收失败。确认两端时间同步。NAS 离线、传输失败及连续轮换仍须在真实测试桶验收。

### 本轮实际验证

- 独立 Linux Docker 容器，`--network none --read-only`，仅只读挂载本地 `deploy/cloud`、tmpfs 临时目录；没有访问真实 NAS/ECS。使用已缓存 `studio-storage-sdvideo:check`，没有重新构建 Go Docker 镜像。
- `python -m pytest -p no:cacheprovider -q /tools/tests`：**28 passed**。覆盖真实 Ed25519 验签、轮换、作用域拒绝、时间限制、旧批次回退、进程锁、原子写入失败恢复、SSH stdin/固定指纹参数、回执验证、超时和错误输出脱敏。SSH 传输在此处为替身，不是实际 SSH 连接验收。
- `python /tools/check-storage-token-permissions.py`：**3 项 PASS**。真实 Linux 非 root 接收进程加载配置并两次安装；两个不同服务读组分别只能读本方令牌、不能改写或读另一方；非 root 健康检查通过。合成密钥和文件仅存在临时容器，退出自动清理。
- `docker compose --env-file deploy/cloud/compose.env.example -f deploy/cloud/compose.yml -f deploy/cloud/compose.storage-tokens.yml config --no-env-resolution --quiet`：退出码 0。额外检查全部 7 个服务各自只挂载 1 个令牌目录、读组正确且原 Secret 挂载保留；`--no-env-resolution` 不读取真实 runtime env。
- 首次工具测试挂载为 `/tools` 时，6 个既有测试使用仓库根相对层数找文件，发生路径越界；已改为同目录工具定位，后续通过。没有跳过测试或把失败算作通过。
- 本轮只改部署工具、模板、相关测试和本节记录，不改 Go/Worker/Studio 业务实现；不重复无改动的前端/Director 全套测试，9 月 8 日结果仍标为历史基线。云端/NAS 全链路及真实 Provider 仍未验证，第二阶段继续进行中。

## 业务列表分页与筛选增量（2026-09-09）

用户暂停云资源开通，批准继续本地未完开发。本节为新的后端实现与实测，不将前面日期的结果冒充当前终测。

### 本批完成

- 新增 `api/app/catalog_queries.py`，集中定义分页上限、稳定排序、媒体组合筛选和统计规则。任务、会话、消息及普通媒体接口均返回 `items/total/page/pageSize`，保留响应信封及既有字段。默认 50 条、上限 200 条；mention 默认/上限 20 条，支持后续页。
- PostgreSQL 使用带 owner/workspace 条件的 `COUNT` 和 `LIMIT/OFFSET`，两次查询处于同一个只读 REPEATABLE READ 快照，不拉取全部记录后再切页。排序用时间加 ID，避免同时间记录排序不确定。Memory 使用同一分页/筛选规则。
- 媒体支持名称/提示词 keyword、kind、精确 tag 和 category 的组合过滤；统计针对完整匹配集，不随当前页截断，并增加 `size_bytes`。`%`、`_` 按字面搜索，用户输入绑定为 SQL 参数。非文本 prompt/category、非数组 tags 不会误成为可搜索文本。
- 新增迁移 `0011_catalog_pagination.sql` 的作用域分页索引及 tags GIN 索引；没有覆写 0001–0010。仅在本轮独占测试库实际应用 11 个迁移，没有迁移任何用户数据库。
- 生成成功事务内的媒体登记现在同时保存 prompt，Worker 后续中断也不影响按提示词检索；后续幂等登记合并生成元数据，保留用户已编辑的标签/分类。
- 没有修改前端和 Go Gateway 的 URL/视觉。现有白名单已转发对应分页/筛选参数，视频会话客户端原有逐页读取仍兼容。

### 实际验证

所有 Python 验证设置 `SDVIDEO_LOAD_ENV_FILE=false`，使用 Mock/本地存储配置，无真实 Provider 请求。专项 PostgreSQL 只连接 `compose.mock-deps.yml` 的 loopback 测试端口，并新建 `catalog_test_<uuid>` 空库；结束删除本轮库，不清理既有业务表。专项只有显式设置 `SDVIDEO_CATALOG_TEST_POSTGRES=1` 才启用第二套仓储，不通过 skip 隐藏失败。

| 命令 / 入口 | 实际结果 |
| --- | --- |
| SD-video `.venv/Scripts/python.exe -m pytest -q tests checks`，开启上述 PostgreSQL 专项开关 | **118 passed in 2.98s**，无失败或 skip；包含全量现有测试、Memory/PG 同契约及专用 PG 并发回归 |
| SD-video `python -m compileall -q api worker` | 退出码 0 |
| `apps/api`: `go build ./...`、`go vet ./...`、`go test ./...` | 三项退出码 0，测试包使用本地缓存；未重新执行已超时的 Go Docker build |
| `apps/sd-video/.venv/Scripts/python.exe scripts/sdvideo-phase2-e2e.py` | 退出码 0；实际应用 11 个迁移；真实 JWT、两套 PG/Redis、Go outbox、Worker、Bridge、MP4/Asset、取消及重启恢复均 PASS |
| E2E 的隔离备份/恢复 | SHA 校验通过，恢复到新库；Studio 35 表、SD-video 14 表。不是云端 RPO/RTO 验收 |
| `apps/studio/client` 全文件 SHA256 | **586 文件**，汇总 `5DCD772CE2EA43E1054096A326315D87410F887078EEE2735A7B980461E0C37A`，与本批开始一致，前端零修改 |
| `git diff --check` | 退出码 0 |

新的测试入口：`apps/sd-video/tests/test_catalog_queries.py` 与 `apps/sd-video/checks/test_catalog_postgres.py`。覆盖筛选前分页顺序、空页仍返回总数、mention 分页上限、owner/workspace 隔离、非法参数与 SQL 注入字面搜索、非文本 metadata、同时间稳定顺序、并发提交时 count/items 同快照、生成登记保留用户标签。

本批未修改图片 Worker、Studio、Canvas Agent 或 Director，因此没有重复这些模块的全套测试/构建；9 月 8 日结果仍只作历史基线。当前没有浏览器双端/Canvas、真实 NAS/CDN、付费 Provider 或云端发布验收。

### 后续开发与云配置边界

- 在本次分页批次结束时，不确定提交的人工核对恢复尚未实现：SD-video Worker 写 `submission_uncertain` 并禁止 retry；Studio Bridge 将失败写成终态并结束同步，Job retry 也会拒绝。此项随后已整体处理，见下一节；不能仅清除错误或把失败改回 queued，以免重复扣费。
- 火山素材旧 Gateway 仍一次取全量列表进行详情/mention/Active 转换；不能直接给远端列表加默认截断。后续先提供作用域点查询，再一起迁移旧兼容入口。其他尚欠项继续以“已知剩余项与发布门禁”为准。
- ECS 已分配 IPv6，Ubuntu 已获取地址与默认路由；用户提供的连通测试仍为连接超时。公网 IPv6 带宽购买/配置尚未完成，本批不继续操作、不开通资源或重启线上服务。
- 持久层仍按用户最新决定使用本地 Supabase Storage 底层 NAS；不恢复废弃腾讯云链路、不登录旧腾讯云、不擅用 Tailscale。本批仅本地隔离测试，不访问生产 Storage 或密钥。
- 本批测试生成的 API/Worker/Bridge 进程由 E2E 退出清理。临时数据库备份保留于 `.tmp/sdvideo-phase2/e2e/backup-01b44fb1d9534a7f9c813685e1b8d61e/20260909T053322Z-f6781aea/`；测试 Compose 的清理结果见本节最后记录。没有暂存、提交或推送。
- 清理结果：`docker compose -f deploy/cloud/compose.mock-deps.yml down` 退出码 0，仅移除本批创建的 4 个测试容器及专属网络。tmpfs 内的合成数据库和恢复演练库随容器移除；上述 E2E 备份仍可用于恢复测试数据。未删除用户业务库、资产或现有服务容器。

## 不确定提交的人工核对与恢复（2026-09-09，后续批次）

### 已实现的业务规则

- 新增管理员 API：`GET/POST /api/admin/sd-video/jobs/:id/reconciliation`。只挂在现有 `RequireSuperAdmin` 路由组，服务层再次检查超级管理员角色。可处理成员任务；目标 owner、workspace、远端 task ID 一律来自持久化 Studio Job，浏览器不能覆盖身份、服务地址或 JWT。
- Go 使用现有短期服务 JWT 调用固定 SD-video 路由 `GET/POST /v1/admin/owners/{owner_subject}/tasks/{task_id}/reconciliation`。JWT `sub` 始终为真实操作者，远端同时要求 `role=admin` 和 `admin` scope；任务读写查询校验目标 owner、JWT workspace 和 task ID。
- `GET` 返回任务状态、attempt、Provider 任务 ID、提交意图时间和已有审计，不返回模型密钥、素材 Token 或完整内部 request。
- `POST` 只允许两种决策，并强制 `confirmed=true`、当前 `expected_attempt` 和不含 URL 的运维证据编号 `evidence_ref`：
  - `bind_existing`：必须提供 Provider 任务 ID，先通过原 Provider 适配器执行一次有 15 秒上限的只读查询，再绑定原任务并恢复 Worker 查询/下载。不会调用创建生成接口；同一 Provider/namespace/upstream 的远端 ID 不可重复绑定到其他任务。
  - `confirm_not_submitted`：记录操作者人工核对结论，旧任务仍为 failed，只将错误改为明确的已核对类别。不会自动入队或调用 Provider；之后仍须用户点击现有 retry，产生新的幂等 attempt，旧任务与审计保留。
- **人工证据不是程序自动证明**：`confirm_not_submitted` 依赖管理员先查上游控制台/运维记录。一次 404、超时或“没看到任务”不能直接视为未创建/未扣费。系统不会将查询失败自动转成该结论。`bind_existing` 的只读查询验证任务存在与状态，任务归属对应关系仍须管理员依据证据确认。
- 新增迁移 `0012_task_reconciliation.sql`：每个原任务一条不可覆盖的核对记录，记录操作者、attempt、决策、Provider ID/状态、原错误、证据编号、request_id 和时间。审计、任务状态及 task event 同事务提交；重放完全相同的操作幂等，冲突决策/陈旧 attempt 返回 409。
- PostgreSQL 行锁和远端 ID 认领锁防止并发核对覆盖；活跃 Worker 租约时拒绝核对。Memory 保持相同状态规则。
- Bridge 对 `submission_uncertain` 保留低频核对同步，不重复累加失败次数；兼容旧版本 `bridge_state=done` 的不确定记录。只有远端带匹配 attempt 的核对标记时才解除本地失败/重试阻断，恢复原 Job 的进度与 Asset 导入。
- 等待核对期间可以取消。取消与核对按条件更新协调：取消先完成则拒绝绑定，绑定先完成则进入正常 Worker 取消；本地已取消的 Job 永不导入迟到结果。**不知道上游 ID 时只能保证停止本地恢复/导入，不能宣称上游已实际取消或没有扣费。** 此类取消保留不确定错误，不放行自动重试。
- 本轮只增加现有后端管理操作 API，没有新增页面或修改前端。管理员交互式入口若需界面设计，另行确认；当前按原计划“无现有页面的能力按 API 验收”交付。

### 集中验证结果

| 命令 / 场景 | 实际结果 |
| --- | --- |
| SD-video `.venv/Scripts/python.exe -m pytest -q tests checks`，`SDVIDEO_LOAD_ENV_FILE=false`、`SDVIDEO_CATALOG_TEST_POSTGRES=1` | **142 passed in 5.32s**，无失败或 skip；Memory/PG 双后端含新增核对回归 |
| SD-video `python -m compileall -q api worker` | 退出码 0 |
| `apps/api`: `go build ./...`、`go vet ./...`、`go test ./...` | 全部退出码 0；最终 service `1.476s`、router `0.368s`，其余通过或缓存 |
| `apps/sd-video/.venv/Scripts/python.exe scripts/sdvideo-phase2-e2e.py` | 最终退出码 0，实际应用全部 **12** 个迁移；原全链路与新增核对场景均 PASS |
| 实际 JWT + Go 管理权限 + PostgreSQL + Worker/Bridge | 超管处理成员任务、普通成员 403、伪造 owner 字段 400、审计不可覆盖、显式 retry、旧 done 恢复及取消不复活均 PASS |
| SD-video 重启后重复相同核对 | 保持同一远端 task ID，审计可从数据库恢复；随后原 Studio Job 结果导入 Asset，PASS |
| 新库备份 / SHA 校验 / 新库恢复 | Studio **35** 表，SD-video **15** 表，包含新审计表；PASS，不代表云端 RPO/RTO |
| `apps/studio/client` 哈希 | 586 文件；汇总 SHA256 仍为 `5DCD772CE2EA43E1054096A326315D87410F887078EEE2735A7B980461E0C37A`，本批零修改 |
| `git diff --check` | 退出码 0 |

新增主要入口：`apps/sd-video/tests/test_task_reconciliation.py`、`apps/api/internal/service/sdvideo_reconciliation_test.go`。覆盖只读探测失败不解锁/不泄密、活跃租约阻断、双决策竞态、同上游 ID 防重复绑定、核对中取消、绑定后真实取消路径、失败缺审计不解锁、原终态恢复和旧同步关闭兼容。

E2E 使用新增的 `scripts/sdvideo-phase2-mock-api.py`，仅允许 development/mock，Provider 查询为可核对的固定替身；生产代码没有“无条件成功”的查询分支。Worker Provider-mode 单测另用 fake query/download 验证绑定后从不调用 `_create_upstream`。没有发送付费请求，也没有验证真实上游的任务归属或账单。

首次扩展 E2E 在核对 POST 返回 502：实际检查本轮隔离数据库确认该模型 `enabled=false`，是早先元数据回归留下的测试状态。随后通过真实管理接口显式启用合成模型，重跑通过；没有放宽生产的模型不可用保护，没有将失败算作通过。最终追加 SD-video 重启/审计恢复场景后再次通过。

最终备份保留于 `.tmp/sdvideo-phase2/e2e/backup-1a0c261ff9b843e5a3d5f512290861d0/20260909T064936Z-4402b578/`。测试使用本批独占 Compose 和随机新库，未访问旧数据库/NAS、未读取真实 `.env`、未部署云端；Go Docker build 仍按超时纪律不重跑。前端、图片 Worker、Agent/Director 无代码改动，不重复其历史全套回归。

**下一批剩余重点**：火山素材/标签 SQL 分页与旧兼容 Gateway 点查询、缩略图链路、用量/运行统计和 Bridge/磁盘告警。真实 Provider、浏览器全页面、NAS/云端通道与发布验收仍未完成，第二阶段保持进行中。没有暂存、提交或推送。

结束清理：测试 API/Worker/Bridge 进程随 E2E 退出清理；`docker compose -f deploy/cloud/compose.mock-deps.yml down` 退出码 0，移除本批 4 个隔离测试容器及网络。tmpfs 内合成库随容器释放，最终测试数据仍可由上述备份恢复；用户现有服务和业务数据未删除。

## 火山库、缩略图和运行可观测性（2026-09-09，续推批次）

### 代码完成

- 火山素材使用 PostgreSQL `COUNT + LIMIT/OFFSET` 同一 REPEATABLE READ 快照，Memory 同契约；支持 `page/pageSize` 及旧页面任意 `limit/offset`，筛选在分页之前执行。名称搜索按字面匹配，kind/status/tag 精确筛选，时间加 ID 稳定排序。新增迁移 `0013_volcano_catalog.sql`。
- 旧 `/api/admin/seedance-assets` 和 mention 路径保留，Go 转换 `search/type/tag_id/Processing`；后者对应 queued/processing/delete_requested 聚合状态。列表返回真实 total，不把当前页数量当总数。
- 详情、媒体读取、Active/namespace 校验均改作用域点查询，不能再因列表首页截断而找不到素材。标签元数据按当前页关联 ID 批量读取；绑定标签只查指定 ID，不依赖前 50 个标签。旧标签下拉框没有分页契约，Go 为它逐页汇总完整列表；通用 `/api/sd-video/volcano/tags` 保持真正分页。
- 单标签增删使用原子 SQL 更新，不再由 Go 先读整份 tags 再覆盖。批量 poll 直接调度数据库待处理记录，保留正在执行的租约。已 deleted 的素材不能通过编辑恢复。
- 缩略图在 Asset Worker 内独立处理，覆盖生成媒体库和火山素材的图片/MP4。新增迁移 `0014_thumbnails.sql`；独立持有者租约、过期认领、存储失败延迟重试，付费视频任务状态不受预览失败影响。源记录删除或租约过期后回写失败，不重建原记录。
- 预览存入现有 StorageAdapter 的 `thumbnails/` 命名空间（NAS 模式使用专用缩略图桶）；数据库保存稳定 object key。经 Studio `/api/sd-video/media/:id/thumbnail` 和 `/api/sd-video/volcano/assets/:id/thumbnail` 鉴权代理，浏览器不直连 SD-video。未就绪返回 409，不支持/损坏媒体返回 422，越权和已删除返回 404。
- 预览源文件上限 128 MiB、图片像素上限 4000 万；临时目录自动清理；ffmpeg 单线程、30 秒超时、强制 MOV/MP4 demuxer、禁外部 data reference 和网络协议，避免把播放列表当作任意 URL/本地文件读取入口。输出最大 640×360 JPEG，Gateway 下载上限 2 MiB。不支持的输入保留原媒体，不假装预览成功。
- 管理统计按 JWT workspace 汇总持久任务状态和 usage 记录；未知费用明确返回 `unknown_price_tasks`，已知金额按币种分组，不跨币种相加。不增加前端统计页面，也不臆造 Provider 账单。
- Bridge 新增内部 `/health/ready`、`/metrics`：读取持久 pending/retrying/uncertain 数量，并检查同步循环最近进展。未完成首轮扫描、数据库失败或超过 5 分钟无进展不再报告就绪；云 Compose 已将“仅 pgrep”健康检查替换为该接口，端口未映射公网。
- SD-video metrics 增加零值任务状态、最老排队时间、过期租约、缩略图失败、data/tmp 可用空间；Worker heartbeat 标识改用启动 UUID，避免不同容器同 PID 相互覆盖。告警规则加入 Bridge 停滞/补偿、抓取失败、队列等待和临时盘不足。规则尚未安装到真实采集/告警系统，宿主机其他磁盘不在该进程指标覆盖内。

### 集中验证

| 入口 | 实际结果 |
| --- | --- |
| SD-video `pytest -q tests checks`，Memory + 独占 PostgreSQL | **168 passed in 10.49s**；14 个迁移实际应用 |
| ffmpeg 安全参数补齐后，`pytest -q tests/test_thumbnails.py`，双仓储 | **9 passed in 1.33s** |
| Linux 缓存运行镜像 + 本次源码只读挂载，network none，`pytest -q tests` | **127 passed in 2.54s**，真实 Linux ffmpeg 解码；不是新镜像构建验收 |
| SD-video `compileall -q api worker` | 退出码 0 |
| Go build / vet / test | 最终全部退出码 0；新增 handler 契约、持久统计和健康进展测试 |
| Studio check / test / build | 退出码 0；**88 files / 406 tests**；Vite 主构建 **7.44s** |
| Canvas Agent 协议、Agent、Director Desk | 协议 **4 tests**；Agent 构建 + **1 test**；Director 构建 + **87 files / 686 tests** 全通过。Director 大 chunk 警告保留，不在本轮优化范围 |
| 图片 Worker compileall / unittest | Windows **51 tests，2 个既有 skip**（Redis URL 未设、Windows symlink）；随后 Linux 隔离容器连接专用测试 Redis，**51 tests 全通过，无 skip** |
| Compose 基础 + NAS token 覆盖文件 `config --no-env-resolution --quiet` | 退出码 0；不读取真实 runtime env |
| 前端文件哈希 | **586 文件**，汇总 SHA256 `5DCD772CE2EA43E1054096A326315D87410F887078EEE2735A7B980461E0C37A`，本批零修改 |

跨服务 E2E 新增真实 JPEG 的图片/视频预览、工作空间 usage、Bridge HTTP 健康及 metrics，已与原真实 JWT、Go outbox、双 PG/Redis、Worker/Bridge、取消/恢复、超管核对和备份还原场景共同通过。最终安全参数版本的复测/清理结果补在本节末尾。

过程问题如实记录：测试端口 55439 被 Windows 拒绝绑定，未停止其他服务；确认 55449 可绑定后，仅为专属测试 Compose/fixture 增加两个固定 loopback 端口的允许列表。首次 Linux 测试以 development 模式只读挂载全部目录，旧调试日志无法创建；补充容器 tmpfs 测试日志/数据目录后通过，生产本已有 stdout JSON 分支，未改生产日志行为。新增 Go 统计用例第一次因测试数据复用空幂等键只创建了一条 Job 而失败，改成每条 Job 独立测试幂等键后通过；没有放宽业务幂等规则。

### 仍然不能宣称已完成的部分

- 新 API 提供了预览能力，但没有改前端视觉或强制现有页面换用新预览；具体页面请求及 Canvas 图片读取须浏览器验收。视频原件仍按原 Bridge 导入 Studio Asset；缩略图保存在 SD-video 专用存储，通过授权 Gateway 读取，没有伪装为已导入的 Studio 独立资产。
- Worker 崩溃发生在缩略图对象写入之后、数据库回写之前时，可能留下无引用缩略图对象；不会覆盖/删除别的持有者的对象，也不影响原视频。正式环境仍需落实新桶生命周期/孤儿清理策略；不能任意删除整个 NAS 桶。
- NAS/Kong 真实受限身份、云地 IPv6 通道、Token 续发与故障恢复、Provider 对参考素材签名 URL 的访问、CDN 分发策略尚未现场验收。
- Go Docker build 的历史超时仍按纪律不重跑；本地 Go build 通过不代表云端发布镜像通过。完整云栈、监控采集和告警触达、备份异地复制/RPO/RTO、浏览器全页面及负载验收仍欠。
- 未调用付费模型、未访问旧业务库/密钥、未操作云资源或用户现有服务；没有暂存、提交、push。第二阶段仍在进行中，下一节点应收敛本地浏览器/发布包验收，再由用户配合云端网络和真实凭证门禁。

最终复核：SD-video 全套双仓储 **168 passed in 10.22s**、compileall 退出码 0；安全参数版跨服务 E2E 退出码 0，全部旧场景及新缩略图/统计/健康场景通过。最终备份保留于 `.tmp/sdvideo-phase2/e2e/backup-4b41f42c0e584299a037c180e77eec71/20260909T074500Z-865dedd2/`；还原新库分别为 Studio 35 表、SD-video 15 表。正式环境没有执行任何迁移。

`git diff --check` 及本批未跟踪源码的逐文件 whitespace 检查无诊断，暂存区未改；前端最终哈希与上表相同。测试进程随 E2E 清理；专属 `compose.mock-deps.yml down` 退出码 0，移除本轮 4 个测试容器及网络，tmpfs 合成库释放，备份可恢复。测试端口无监听，用户现有服务和业务数据未删除。没有重新执行已超时的 Go Docker build。

## 浏览器闭环与 Web 发布包（2026-09-09，续推批次）

### 本批改动

- 新增 `playwright.phase2.config.ts`、`apps/studio/e2e/sdvideo-phase2.spec.ts` 和现有隔离脚本的 `--browser` / `--browser-image` 入口。专用随机空库、临时账号/JWT、双 PG/Redis、真实 Go/SD-video/Worker/Bridge 和 Nginx；不使用旧浏览器测试中伪造业务响应的方式。固定 loopback 入口 `33110`，不占用用户 `3100`。进程环境只继承系统路径变量，不继承 Provider/Storage/数据库/代理配置。
- `apps/studio/scripts/build-phase2.mjs` 不读取本机 `.env`，输出到忽略目录；Director 复制插件尊重实际 outDir，且只在 build 执行，避免 Vitest/开发服务器结束时复制产物。
- 保留客户端原有空值回退语义；新增明确的 `VITE_API_URL=/` 同源选项，将其解析为当前浏览器 origin，使既有 `new URL()` 调用可用。Docker/Compose 默认采用该选项，空 Docker build 参数直接报错。本批客户端只修改 `shared/config/api.ts` 及对应测试，未动页面/CSS/交互。
- `.dockerignore` 的密钥、依赖及产物排除规则移至应用重新包含规则之后，防止本机 `.env`、node_modules、虚拟环境或旧 dist 被重新包含。Web Dockerfile 使用官方 Node 22 和 Nginx 的固定 digest，校验 Node 主版本，保持锁定 pnpm/lockfile。
- 本地资产采用 `http.ServeContent` 支持 Range、suffix Range、If-Range 和 416，仍先执行 owner/workspace 鉴权。对象存储正常媒体的既有签名 URL 分发保持不变；未将非随机读取流整体缓存到内存来模拟 Range。
- Go 访问日志改为结构化、仅路径日志，不再打印含 `access_token` 的 query。异常恢复不转储 Header/Body/panic 原文，保留 request_id、调用栈和统一 500 响应；新增敏感 query/Header/Cookie/Body/panic 值不进入日志的测试。本批真实 Mock SSE 访问日志已不含 `access_token=`。这不是对所有 Provider 日志的完整安全审计。

### 实际验收

| 入口 | 结果 |
| --- | --- |
| `go build ./...`、`go vet ./...`、`go test ./...` | 最终退出码 0；新增 Range/鉴权及访问日志/异常脱敏回归 |
| Studio `check`、`test` | 退出码 0；**88 files / 407 tests**，最终 Vitest **3.04s** |
| 隔离 Vite build | 退出码 0；不读取本机 env，Director 复制到指定测试输出目录 |
| Web Docker build | 锁定官方 Node 22 后退出码 0；完整 Studio/协议/Director 构建，不是挂载旧源码冒充新镜像 |
| `scripts/sdvideo-phase2-e2e.py --browser-image` | **5 passed (40.7s)**；新 Web 镜像 + 当前源码编译的本地 Go API/Bridge + 独立 SD Mock 栈 |
| `scripts/sdvideo-phase2-e2e.py` | 退出码 0；此前全链、取消/在途重启、人工核对、素材/缩略图/统计、备份恢复全部通过 |
| 客户端逐文件对照 | **586 文件，584 不变；仅同源 API 配置与测试 2 文件变化**。既有协作者/Phase 2 接线改动保留 |

浏览器覆盖：真实登录及 next/query/hash；资产、标签、提示词、队列、项目、管理模型/素材入口；Canvas 舞台及 Director iframe/WebGL canvas；纯文本视频进入 Go Job/Studio Asset、可解码 MP4 和 Range；刷新及无 IndexedDB 历史的新浏览器恢复对话和结果；图片上传/mention、取消、刷新后显式重试，原取消任务无迟到 Asset；新成员不可读取他人的对话/媒体或访问管理员 API。仅允许同源业务请求，另允许原页面的 Google Fonts GET；没有 SD-video/旧服务/真实 Provider 浏览器直连。资源页仅检查入口加载，不等同于每项 CRUD 均已完成页面验收。

证据：`.tmp/sdvideo-phase2/browser/` 下保留 `report/`、`browser-final.log`、`studio-tests-final.log`、Docker build 日志、`api-e2e-final.log` 以及 `video-restored.png`、`video-mobile.png`、`director.png`。临时测试账号不用于真实环境。最新 API E2E 备份为 `.tmp/sdvideo-phase2/e2e/backup-e4b059ec1e0041a7b4a612cf52a1c701/20260909T085951Z-cbf1b968/`，还原分别为 Studio 35 表、SD-video 15 表。

过程问题未算作通过：初次检查被原 Google Fonts 和本地产物的绝对 API 地址阻断；空 API 值仍回退 localhost，同源相对路径又使原 `new URL` 报错，现均有明确处理。测试还修正了首次版本弹窗、默认停用的 Mock 模型、Director 双 canvas selector 和会话标题 24 字截断等 fixture 假设。构建复制 hook 曾在 Vitest 下产生 `client/dummy-non-existing-folder`，已修复触发条件，逐文件核实其 991 个文件与 Director dist 一致后移到 `.tmp/sdvideo-phase2/browser/vitest-unexpected-output/`，可恢复，不包含用户源码。后续 Vitest 没有再生成该目录。

一次 Web 复建的 pnpm 安装以 **139** 退出；只读核实本地 `node:22-alpine` 标签实际为 **Node v24.18.0**，官方 Node 22 digest 与之不同。改为官方固定 digest 并校验主版本后构建通过；无法仅凭这些证据断言该标签错配就是 segfault 的唯一原因。未改动用户原镜像标签/服务。**Go Docker build 历史超时仍不重跑**，本地 Go 编译及 Web 镜像通过不能替代 Go 发布镜像验收。

### 上云前仍需完成

- 本次不调整视觉。截图中移动端侧栏与内容重叠、输入提示叠字仍可见；移动端“页面可加载”不是视觉通过。没有执行完整像素基线比较，也未覆盖所有 Chat/Canvas 手势、Agent、Director 导出回写或全部资源 CRUD。
- NAS/Kong 真实受限身份、云地 IPv6/媒体入口、Token 续发故障恢复、CDN 和大媒体吞吐仍需用户完成网络配置后联测。未访问旧 NAS/业务数据。
- 真实 Provider 仍未调用；须先确认新凭证、模型与费用上限。新 Go/Worker/SD 镜像、云端完整 Compose/TLS、告警触达、异地备份/RPO/RTO 与恢复回滚仍是独立门禁。
- 没有提交、push、重启用户测试服务或部署云端。第二阶段继续进行，不能标记为云端内测已交付。

最终收尾：固定 Node/Nginx digest 的 Web 复建退出码 0，保留本地测试镜像 `studio-phase2-web:check`（manifest list `sha256:8f1c74522e3e160f0db9600ec8d00e0d572c681a0ef717b18a92bf671925bb6a`）。其运行 manifest `sha256:fde80d5bc3eb648d555e50afd05aa85e4daaea8599fd8e4d781bf323282f5048` 与上述浏览器终测镜像一致；未推到 registry。访问日志修复后的 Go 全套检查及浏览器 5 项再次通过。`git diff --check` 和本批新文件 whitespace 检查无诊断，暂存区不变。

本批 API/Worker/Bridge/Web 测试进程已退出；只移除专属 `studio-phase2-check` 的 4 个依赖容器及网络，tmpfs 合成库随之释放，API E2E 备份仍保留。隔离端口已无监听，客户端恢复为 586 文件。没有删除或停止用户的业务数据/现有服务。

## 后端发布镜像与启动保障（2026-09-10）

### 本批收口

- `apps/worker/worker/runtime.py` 共同监管 Uvicorn 和 Celery。常驻子进程任意退出（包括意外 exit 0）时停止另一进程并返回 1；SIGTERM/SIGINT 进入统一 30 秒收尾，必要时终止本实例创建的进程组。Compose 使用 init 和 45 秒 stop grace，不修改任务协议、重试次数或前端。
- 图片 Worker `/health` 除队列、数据库、Storage 外，精确向当前容器的 Celery 节点发 ping，不接受其他 Worker 的 pong；Broker 探测不无限重试。Docker 的 `unhealthy` 本身不会自动触发 `restart: unless-stopped`，无响应但未退出的任务进程仍需告警/运维处理，不能宣称健康探针等于自动修复。
- 导出 Worker 增加仅内部监听的 `/health/ready`（默认 loopback `3104`），检查数据库、Storage、临时目录可写性和实际调度进度。首次队列扫描前/超过 2 分钟无进度时不就绪；下载、ZIP 上传和清理的真实进展更新原子时间戳，续租心跳不伪装为媒体传输进度。响应不包含异常正文。Memory/GORM 的业务接口不变，原导出内容与进度测试继续通过。
- 本地 Compose 和云 Compose 均改用新的 Worker runtime、导出健康接口；本地 Web 不再因导出 Worker 不健康而不能启动。云 Web/Edge 增加显式探针，Edge 的 HTTP 探针只监听容器 loopback `8080`，不增加宿主 HTTP 端口。
- Go、Alpine、Python、uv 基础镜像已核对上游 manifest 并固定 digest；Python 启动版本断言为 3.12。SD-video 使用 `uv sync --frozen --no-dev`，修正 README 构建路径，发布镜像不再安装 pytest。OS 软件包仍由 apt/apk 仓库安装；固定基础镜像和锁文件不等于 bit-for-bit 可复现，也不等于漏洞扫描通过。Go 1.23/Alpine 3.20 等原版本的支持周期与升级验证尚需发布前安全评估，本批没有顺带升级语言大版本。
- 新增 `deploy/cloud/check-release.py` 只读预检：使用显式 Compose 参数文件和 `--no-env-resolution`，不加载实际 runtime env，也不继承本机业务/模型变量；拦截占位/未固定镜像、缺健康检查、公开数据库端口、非只读应用、共享两侧 runtime env 和阻断 Studio 的可选视频依赖。不会 build/pull/up/push。只检查结构，不证明镜像内容、密钥、TLS、NAS 和运行健康。

### 实际验证及候选镜像

| 入口 | 实际结果 |
| --- | --- |
| `apps/api`: `go build ./...`、`go vet ./...`、`go test ./...` | 最终均退出码 0；包含新导出健康与传输进度测试、旧导出回归 |
| 额外 `go test -race ./cmd/asset-export-worker ./internal/service -run 'TestExportHealth\|TestExportReader\|TestAssetExport' -count=1` | **未验证**：`-race requires cgo; enable cgo by setting CGO_ENABLED=1`，本机未发现 gcc；没有把普通测试当作 race 通过 |
| `docker build -f apps/worker/Dockerfile -t studio-release-worker:phase2-20260910 .` | 最终完整构建退出码 0，Linux/amd64，非 root 用户 `aiworker`；后续监管收尾修正后增量复建通过 |
| `docker build -f apps/sd-video/Dockerfile -t studio-release-sdvideo:phase2-20260910 apps/sd-video` | 完整构建退出码 0，Linux/amd64，非 root 用户 `sdvideo`；没有超时 |
| 新图片 Worker 镜像 + 只读 tests 挂载 + 专用 Redis，`python -m unittest discover -s /tests` | **59 tests，全部通过，无 skip**；无 Redis 首跑的 1 个既有 skip 不作为终测结果 |
| 运维工具现有测试 + 新发布预检测试，Linux Python 测试运行时 `pytest -p no:cacheprovider -q /tools/tests` | **36 passed in 0.42s**；工具源码只读挂载，network none |
| 两份新镜像分别 `python -m compileall -q worker` / `python -m compileall -q api worker` | 均退出码 0；SD-video 镜像中 `find_spec('pytest') is None` |
| 图片 Worker 实际进程故障 | SIGSTOP Celery → `/health` **503**；SIGCONT → **200**；停止健康子进程 → supervisor 退出、容器 **exit 1**；显式正常 SIGTERM → **exit 0** |
| 新 SD-video 镜像的 API / Task Worker / Asset Worker | 专用新 PostgreSQL 实际应用 **14 个迁移**，独立 Redis；production/provider 模式、rollout disabled、只读容器，各健康接口 **200**，DB/queue/storage 均 true |
| Compose 本地模板、云模板 + Storage Token 覆盖 | `config --quiet` / `config --no-env-resolution --quiet` 退出码 0；只用 `.env.example` / `compose.env.example`，不读取真实配置 |
| 发布预检对 `compose.env.example` | **按预期拒绝**占位镜像和测试域名；模板解析通过不再被误报为可发布 |
| Edge Nginx 配置 | 固定 Nginx 镜像 + 临时自签测试证书，`nginx -t` 输出 `syntax is ok` / `test is successful`；没有验证云证书、CF 或真实 HTTPS 业务请求 |
| Studio check / test | check 零错误；**88 files / 407 tests**，Vitest **14.76s** |
| 客户端哈希 / Git | 与本批开工时逐文件比对 **586 文件零改动**；`git diff --check` 无诊断；暂存区仍为空 |

候选镜像仅保存在本机，尚未推送 registry：

- 图片 Worker：`studio-release-worker:phase2-20260910`，manifest list `sha256:f0f3d081601763ef863c4c6bb8beea04efd3fa72d970b0537f2476ca422a967d`，运行 manifest `sha256:24dc8683b84a7dc655711461ea2afaf66864a38045196c2cde8a3e401ed9f62c`。
- SD-video：`studio-release-sdvideo:phase2-20260910`，manifest list `sha256:280b31e104f11dc800bb08d30c313bb19b46453bb1aa9a1d444544cdb1eb59d2`，运行 manifest `sha256:c3e1a829af1884bc879cfc60db19e1eddf3865a2c01d3af6430b61f9359f7a9f`。

构建日志位于 `.tmp/sdvideo-phase2/release/worker-build.log`、`worker-build-final.log`、`sdvideo-build.log`。本批 Nginx 自签证书只用于本地语法检查，不是服务器部署证书，不进入 Git 或构建上下文。

过程失败：预检最初清理环境变量时遗漏 Windows `ProgramFiles`，导致 Docker 找不到 Compose 插件；补充系统路径白名单后正常解析。运维工具首次误用不带 pytest 的本机 Python/unittest，随后使用已有 Linux pytest 运行时执行 36 项通过。SD-video Worker 首次以 development 模式运行，旧开发文件日志写入只读 `/app/api/logs` 失败；改为实际生产模式、独立空 PG/Redis 验证生产 stdout 日志及依赖，没有放宽只读挂载或修改生产日志逻辑。

### 发布边界与剩余门禁

- **Go Docker build 仍遵守历史超时禁重跑纪律**。本地 Go build/vet/test 不是 Go 发布镜像验收；本批没有换路径、交叉编译打包等方式规避限制。
- SD-video 本批启动检查使用新空库、关闭新任务入口和本地临时 Storage；内部网络无公网出口、不配置 Provider 密钥、不执行付费生成。它验证新镜像可启动，不替代真实 NAS、Provider、JWT/TLS 全链或云 Compose `up`。
- 导出 Worker 新健康逻辑仅完成本地 Go 测试，尚未随新 Go 镜像启动验收；大 ZIP 与当前云 `/tmp` 256 MiB tmpfs 的容量匹配需单独验证，不能凭小文件探针宣称大批量导出可用。
- 本批没有重跑未改代码的完整浏览器/Agent/Director/SD-video 业务回归，其 9 月 9 日结果仍是历史证据，不改日期。整套云发布仍需收口 Git 版本、Go 镜像、NAS 通道/权限、真实新凭证与费用上限、TLS、告警触达及备份恢复。
- 本批 6 个专属测试容器和内部网络已按 `studio.check=phase2-release` 标签核对后移除；tmpfs 新空库与合成测试 Redis 随容器释放，没有保留需要恢复的业务数据。候选镜像与日志保留。没有停止或删除用户原服务、旧数据库/NAS、真实资产；未提交、push 或部署。

## Go 镜像重新构建验证（2026-09-10，用户明确授权）

本节是用户明确表示“可以重新验证构建”后的新一轮验证，不改写前几批“超时跳过”的历史结果。构建使用现有 Dockerfile、固定基础镜像和本机构建缓存，没有修改业务源码；设置 890 秒构建上限，预留进程树终止时间，不循环重试。

- 实际命令：`docker build --progress=plain -f apps/api/Dockerfile -t studio-release-api:phase2-20260910 .`。
- 看门狗记录：开始 `2026-09-10T05:49:49.327393+00:00`，结束 `exit=0 elapsed_seconds=10.2`。本次没有超时；不能据此断言历史超时的唯一原因。
- 构建三个程序均通过：`ai-manju-api`、`ai-manju-asset-export-worker`、`ai-manju-sd-video-bridge`。新镜像 `linux/amd64`，三个可执行文件存在。
- 候选镜像：`studio-release-api:phase2-20260910`。Manifest list：`sha256:1bf1c73825be88409f3bdf161dd7d16f27c3e5478a6bdd4dcebe9d9c05926168`；运行 manifest：`sha256:a4f5f4ae86dc7e4d1d52ded250679deaf5f8a8de3e46b98ec7f6254234e2ec95`。
- 原始日志：`.tmp/sdvideo-phase2/release/go-build-recheck-20260910.log`。

### 新镜像启动验证

使用专属内部网络、全新 tmpfs PostgreSQL/Redis；不开放宿主端口，不配置真实 Provider 或 NAS。API/导出/Bridge 均为 production 配置、只读容器和有上限的临时文件目录，使用新生成的临时管理员密码、App Secret、Bridge Ed25519 测试密钥。视频新任务入口 disabled，Bridge 上游为不可达测试域名，数据库无待发送/付费任务。

| 检查 | 实际结果 |
| --- | --- |
| API `/health` | 200；`db=ok`、`storage=postgres`、`persistent_required=true`、`public_signup=false` |
| 导出 Worker `/health/ready` | 200；database/dispatcher/storage/temporary 均 true，`ready=true` |
| 视频 Bridge `/health/ready` | 200，`ok` |
| 视频 Bridge `/metrics` | `probe_up=1`、`progress_age_seconds=0`、pending/retrying/uncertain 均 0 |
| 容器状态 | API、导出 Worker、Bridge 均 running |
| Git | `git diff --check` 无诊断；暂存区未变，不提交、不推送 |

首次 API 启动用例未提供管理员密码，被既有 production 安全校验拒绝；补充随机测试管理员凭证后启动通过，没有放宽弱密码校验或修改应用代码。数据库、Redis、密钥和所有运行配置均属于本次新测试环境，不来自已有业务环境。

**结论与边界**：Go 发布镜像构建及三个进程的基本启动门禁已通过，替代上一批 Go 镜像“未验证”的当前状态；历史超时记录保留。这不是新镜像全量跨服务 E2E、真实 NAS、上游 JWT/TLS、Provider 生成、大 ZIP 或云端部署验收。四类候选镜像（Web、Go、图片 Worker、SD-video）现均已有本地构建证据，仍需统一发布版本和完整云栈联测。

已按 `studio.check=go-recheck` 标签核对并移除本批 5 个临时容器及内部网络；tmpfs 中仅测试结构、临时管理员和合成队列随之释放，没有需要保留的业务数据。镜像及构建日志保留；用户原有容器、数据库、NAS 和资产未改动。
