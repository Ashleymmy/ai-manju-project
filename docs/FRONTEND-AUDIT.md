# 前端全模块审计报告（后端建设依据）

> 审计时间：2026-09 · 审计范围：`apps/studio/client/src` 全部前端模块 + `apps/api` Go 后端路由交叉核对
> 验证基线：`tsc` 仅 3 个存量错误（见 §6）；`vitest` 39 文件 209 测试全过；`vite build` 通过
> 总体结论：**后端路由对前端 ~90 个 HTTP 调用 100% 覆盖，无"前端有后端无"的路由，无占位 handler**。真正的后端工作集中在：契约统一、本地数据域服务端化、少数能力补全。

---

## 1. 模块完善度总表

| 模块 | 完善度 | 主要缺口 |
|---|---|---|
| 资产库 AssetLibraryView | 95% | 回收站筛选被前端裁剪（只传 4 参）；无批量永久删除端点；expired 导出批次无"重新导出"入口 |
| 公告 Announcements | 95% | SSE + REST 完整 |
| 管理后台 Admin | 90% | 用户/Provider/公告/监控/Seedance 素材五面板全真实 API |
| 标签库 TagLibraryView | 90% | **标签→提示词绑定只有 GET 查询、无写入端点**（UI 自述"待后端开放"） |
| 提示词库 PromptLibraryView | 90% | 个人预设走 preferences **整组覆盖写**，无独立主键，多端并发互相覆盖；`/api/prompts` Go/Node 双实现待二选一 |
| 真人素材 SeedanceAssetPanel | 90% | limit=100 无分页；预览依赖公网 source_url |
| 个人主页 ProfileView | 90% | 统计仅 personal scope 硬编码；卡片文案有乱序错字 |
| 图像生成（关键帧） | 85% | UI 13 档比例/自定义 W×H 与后端 size 枚举不匹配（存量 tsc 错误根源） |
| 导航/外壳 Home | 85% | 命令面板、通知铃为 Mock |
| 认证 Auth | 80% | **无 refresh token**（401 即强制重登）；无密码重置；token 明文存 localStorage |
| 视频工作台 VideoWorkbench | 80% | **会话/消息/历史全在 IndexedDB，后端无表**；Seedance 任务无取消 |
| 队列 Queue | 80% | 3s 轮询，未用后端已有的 `/api/jobs/:id/stream` SSE |
| 画布核心 CanvasWorkspace | 82% | 快照无乐观锁（last-write-wins）；文本资产/Agent 会话/技能库本地化；预设硬编码 |
| 偏好设置 Settings | 85% | 通知设置 tab 是 Mock；偏好白名单前后端已逐字段对齐 |
| 漫剧资产助手 ComicAssets | 75% | 存量 bug：`createComicProject` 未导入（628 行）+传参形状不符；"解析进度"是 Mock（文件未真正上传） |
| 3D 导演台 DirectorDesk | 75% | iframe + postMessage v1 协议，导出帧走 /api/assets、回写走 projects/snapshot，均已通 |
| 音频 TTS | 60% | 同步长请求，无 job 化/进度，仅画布使用 |
| 工具箱 ToolkitPanel | 5% | 字幕擦除/视频增强为纯占位 |

---

## 2. 后端真正的空白（路由级缺失 = 0，数据域缺失 = 4）

前端刻意本地化、后端完全没有对应资源的 4 个数据域（按价值排序）：

| # | 数据域 | 现状 | 后端待建 |
|---|---|---|---|
| 1 | 视频工作台会话/消息/媒体 | IndexedDB（`services/video-conversations.ts:6-8` 自述"后端无对话/消息表"） | conversations/messages 表 + CRUD；表结构可直接参考 `video-conversations.ts:33-66` 的类型 |
| 2 | 视频生成历史 | IndexedDB v3 + 媒体仓（`services/video-history.ts`，含 localStorage 一次性迁移） | history 表 + 媒体引用 |
| 3 | 技能库 | localStorage `ai-manju:canvas_skills`（`lib/skill-library.ts:3` 自述无后端） | 技能资源表 + CRUD + enabled 标志；导入导出兼容 `{app:"ai-manju-studio",version:1,skills[]}` |
| 4 | WebDAV 配置 | localStorage，**含明文密码**（`lib/webdav-config.ts:30`） | 若托管需复用 `provider.SecretBox` 加密 |

次级本地化项：Agent 对话历史（`canvas-agent-conversations:<pid>`，每项目 20 条）、Agent 桥接 URL/token、文本资产"加入素材库"（`lib/canvas-text-assets.ts`，**名不副实**：toast 说已入素材库，实际只写 localforage）、目录树折叠状态、已读版本号。

---

## 3. 能力补全清单（后端需新增/修改的端点）

| 优先级 | 项 | 说明 |
|---|---|---|
| P0 | 成功信封补 `request_id` | 现在仅错误响应带（`response.go:5-48`），成功响应无法埋点 |
| P0 | 分页统一 | 现状三套并存：assets/tags 用 `page`+`page_size`；jobs 只用 `limit` 且返回**裸数组**无 total；seedance-assets 用 `limit`/`offset`。前端被迫逐端点适配。文档 `api-contract.ts:22` 宣称 jobs 支持 page/pageSize——**文档不实** |
| P1 | 快照乐观锁 | `PUT /api/projects/:id/snapshot` 是裸 upsert（`project.go:185-210`），前端持有 `snapshotVersion` 但不回传。加 `expected_version` 防多标签页互相覆盖 |
| P1 | Seedance 任务取消 | 新增 `POST /api/ai/contents/generations/tasks/:id/cancel`；前端目前只对非 Seedance 调 cancelJob（`CanvasWorkspaceView.tsx:5233`） |
| P1 | 标签→提示词绑定写入口 | 只有 `GET /api/tags/:id/prompts`（router.go:354），缺绑定/解绑 |
| P1 | 认证 refresh + 密码重置 | 无 `POST /api/auth/refresh`；忘记密码是 Mock |
| P2 | 图像 size 枚举扩充 | 前端 UI 有 13 档比例 + 自定义 W×H，契约只收 5 档（`image.ts:25` vs `RealFeatureViews.tsx:560`）——同时是存量 tsc 错误根源 |
| P2 | 回收站筛选对齐 | `GET /api/assets/trash/library` 只接受 4 个参数，建议与 `/library` 筛选对齐 |
| P2 | 批量永久删除 | 前端现在循环 N 次调单个 `DELETE /api/assets/:id/permanent` |
| P2 | 火山透传信封归一化 | seedance tasks/materials 原样返回上游 `{code,msg,data}`，前端双解包兜底——归一化应在后端做 |
| P2 | `GET /api/dashboard/summary` | 首屏 4 扇出聚合（projects/jobs/assets/comic）可合一 |
| P3 | 提示词预设独立资源 | 从 preferences 整组覆盖写迁移为独立 CRUD 资源，解决并发覆盖 |
| P3 | 音频生成 job 化 | TTS 同步长请求 → 异步 job + 进度 |
| P3 | 运营化预设 | 风格预设 20 个、视频子模式 6 个、反推提示词模板、Agent 技能提示词全部硬编码在前端（`CanvasWorkspaceView.tsx:587,8742-8793`；`AgentPanel.tsx:48-54`，注释自述"待后端技能/应用体系适配"） |

---

## 4. 后端有而前端未用（去留决策）

| 路由 | 说明 |
|---|---|
| `GET /api/jobs/:id/stream`（SSE，job.go:151-199） | 前端全部 2.5s 轮询（图片/视频/导出三路）。**建议推广 SSE 替代轮询** |
| `GET /api/assets/:id/stats` | 前端无调用 |
| `GET /api/assets/trash`（平铺列表）、`DELETE /api/assets/:id` | 前端只用 /trash/library 和 bulk-trash |
| `GET /api/ai/videos/:id[+/content]` | OpenAI 视频轮询走 /api/jobs/:id，结果取资产 content |
| `POST /api/ai/images/generations|edits`（复数别名） | 前端只用单数 image/* |
| `GET /api/ping` | 无调用 |

---

## 5. 前端侧待办（不属于后端但影响联调）

1. **死代码 8 处可删**：`FeatureViews.tsx`（旧原型）、`RealFeatureViews.tsx.bak`（95KB）、`Dashboard.tsx`、`Login.tsx`、`ModulePage.tsx`、`StudioShell.tsx`、`Map.tsx`、`ManusDialog.tsx`——均无引用
2. **7 处裸 fetch 绕过 request.ts**：audio.ts:133、catalog.ts:23、assets.ts:289/310、comic-assets.ts:188、video.ts:719/742、webdav-sync.ts:95——各自重复实现鉴权/401/超时，行为易漂移
3. **`/api/prompts` 双实现**：Go handler（router.go:169，PromptCatalog 远程聚合 + 1h 缓存）与前端注释所称的 Node 中间件（catalog.ts:17，已过时）；且该端点裸 JSON 绕过信封、参数驼峰 pageSize，与全站 snake_case 不一致
4. **存量 tsc 错误 3 个**（非新改动引入）：
   - `ComicAssetsView.tsx:628` `createComicProject` 未导入 + 传参形状不符 `ComicProjectInput`
   - `RealFeatureViews.tsx:417` 宽高比类型（图像 size 枚举不匹配）
   - `RealFeatureViews.tsx:527` `createdAt` 应为 `created_at`
5. **ComicAssetsView 解析进度 Mock**：新建项目对话框 603-624 行进度动画是假的，文件未真正上传
6. **工程债**：CanvasWorkspaceView.tsx 单文件 10152 行；批次 v1→v2 数据迁移逻辑仍在（batchModelV2）

---

## 6. 后端建设建议路线（按前端依赖密度）

| 阶段 | 内容 |
|---|---|
| P0 契约统一 | 信封 request_id、分页统一、修 api-contract 文档；影响全部 ~90 调用 |
| P1 保持兼容 + 补能力 | assets/tags/folders/exports（~45 调用，最高密度）已完整，补快照乐观锁、Seedance 取消、标签↔提示词绑定写入、auth refresh |
| P2 数据域服务端化 | 视频会话/消息/历史（唯一真正空白）、技能库、文本资产正名；图像 size 枚举对齐 |
| P3 已有面维护 | admin（~25）、comic 全套（~25）、announcements、preferences、webdav-proxy（防 SSRF 白名单保留）均完整 |
| P4 可选 | WebDAV 配置托管（SecretBox 加密）、运营化预设体系 |

---

## 7. 特殊链路备忘

- **canvas-agent**：不走 Go API。前端 EventSource 直连用户本机 agent 服务 `/events`（AgentPanel.tsx:213），模型列表仍取自 `/api/ai/models`
- **worker 分工**：Python Celery worker，Go 经 Redis 派发（`internal/queue/celery_redis.go`）；postgres 部署下 asset-export 由独立 `cmd/asset-export-worker` 消费；memory 模式进程内派发
- **仓库双套**：Memory*/Gorm* 各 16 个仓库一一对应（router.go:404-466），按 `STORAGE_DRIVER` 二选一——改任何一处逻辑须同步另一处
- **信封约定**：`{success,data,error,request_id}` + `X-Request-Id` 头双向透传 + 401 广播 `ai-manju:auth-unauthorized`——不得破坏
