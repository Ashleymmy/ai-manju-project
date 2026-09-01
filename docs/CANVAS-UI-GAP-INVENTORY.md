# Canvas UI 能力差距清单

## 口径

- 对照基线：提交 `c0349bdb50864bbcfbd2ec181f199830a1af174f` 中的旧 `apps/web`、Canvas Agent、Director Desk 和真实服务。
- 当前 UI：`ai-manhua-studio/client/**`。本轮冻结该目录，只恢复和补齐后端、Worker、Agent、Director Desk、协议与运行链。
- 状态只使用：`已实现已验证`、`已实现待真实后端验证`、`部分实现`、`完全缺失`、`本轮排除`。
- “待真实后端验证”表示 UI 代码和真实接口已经接线，但仍需在具备真实 Provider 凭据的环境执行媒体生成；不表示 UI 缺失。

## 能力矩阵

| 能力 | 旧提交证据 | 新 UI 证据 | 状态 | 依赖 | 风险 | 优先级 | 测试入口 | 后续前端验收 |
|---|---|---|---|---|---|---|---|---|
| `~` 定位悬停节点、缩放、平移、适配内容和小地图 | 旧画布 `canvas-client-page.tsx:1613,2474` 已有定位与 `Backquote` 热键 | `CanvasWorkspaceView.tsx:1479,2260`；`canvas-minimap.ts` | 已实现已验证 | 项目快照加载、可见节点渲染 | 项目加载中、输入框聚焦、虚拟化边界可能阻止定位 | P0 | Playwright `canvas reload...tilde focuses a node` 已在真实 API/PostgreSQL 项目运行态通过；`canvas-minimap.test.ts`、`canvas-hotkeys.test.ts` | 打开真实大画布，分别悬停屏内/屏外边缘节点按 `~`；验证不在输入框触发，缩放后中心稳定 |
| 框选、多选、复制粘贴、节点连线与删线 | 旧画布的 selection/clipboard/connection 逻辑及对应测试 | `CanvasWorkspaceView.tsx:842,991,1880,1908`；`canvas-selection.test.ts`、`canvas-clipboard.test.ts`、`canvas-connections.test.ts` | 已实现已验证 | 浏览器 Pointer Events、快照序列化 | 大量节点时命中和磁吸性能；跨画布粘贴必须继续隔离 | P0 | Studio Vitest；真实项目快照往返 | 多选后复制/粘贴，拖动连接柄，双击和菜单删线；刷新后比较节点与边集合 |
| 分组、拖动/缩放分组、解散与组内顺序生成 | 旧画布分组与批量执行逻辑 | `CanvasWorkspaceView.tsx:959,2052,7186`；`canvas-groups.test.ts` | 已实现待真实后端验证 | Job/Worker、节点生成配置 | 组内部分失败、取消与重试时状态一致性 | P1 | Studio Vitest；Mock Provider 组内顺序生成手测 | 建组后整体拖动/缩放，执行混合文本/图片组，失败后只重试失败节点，刷新核对分组 |
| 画布撤销/重做 | 旧画布保留历史栈与快捷键 | `CanvasWorkspaceView.tsx:1013,1618,1633,7131`；`canvas-history.test.ts` | 已实现已验证 | 本地历史栈 | 异步生成结果与手动编辑同时落盘时历史边界复杂 | P0 | Studio Vitest；工具栏与快捷键手测 | 连续执行移动、连线、分组、删除并逐步撤销/重做；确认服务端自动保存最终态 |
| 快照写入队列、自动保存、切换前 flush 与作用域保护 | 旧画布保存/切换保护逻辑 | `CanvasWorkspaceView.tsx:964,2047,2488,2515,2602`；`canvas-snapshot-roundtrip.test.ts` | 已实现待真实后端验证 | Go 项目/快照 API、PostgreSQL | 快速切换项目时写入错误 `personal/team` 空间或旧写覆盖新写 | P0 | Playwright 项目与快照测试；Go project repository tests | 快速编辑后切换项目/作用域，断网重连，再刷新并比较完整扩展字段、节点、边、分组和视口 |
| Job 入队、Worker 进度与结果资产 | 旧 API/Worker Job 链路和旧 E2E `image-generate.spec.ts` | `CanvasWorkspaceView.tsx:4870`；`services/api/jobs.ts`；真实 `apps/api`、`apps/worker` | 已实现待真实后端验证 | Redis、Celery、PostgreSQL、Provider、资产存储 | Worker 重启、Provider 超时和结果资产落盘失败 | P0 | Playwright Mock Provider generation/edit；Go Job tests；Worker tests | 用真实图片模型生成 1 张图，观察 queued/running/progress/succeeded，核对资产内容、metadata 和画布恢复 |
| 页面刷新后恢复图片/视频 Job | 旧画布 `canvas-client-page.tsx:739` 与 `refresh-recovery.spec.ts` | `CanvasWorkspaceView.tsx:5430` | 已实现待真实后端验证 | Job 查询、图片 Worker；视频 Provider 任务 API | 刷新竞态导致重复消费结果；视频 Provider 状态差异 | P0 | Playwright `canvas reload resumes...` | 任务 running 时刷新两次，确认同一 `jobId`、单份结果资产、进度恢复且没有重复节点 |
| 删除节点取消任务、手动取消与失败重试 | 旧画布 `canvas-client-page.tsx:618`，旧 `cancel.spec.ts`、`error-retry.spec.ts` | `CanvasWorkspaceView.tsx:4043,5148,5166,5225,5266,5317,6326` | 已实现待真实后端验证 | Job cancel、Worker revoke/终态保护、Provider | Provider 请求已发出时只能阻止结果回写；取消和成功终态竞争 | P0 | Playwright cancel；Go Job tests；Worker cancellation tests | running 时删除节点、队列页取消、制造单次失败后重试；刷新确认 canceled 不回写成功结果 |
| Job SSE 实时进度与轮询降级 | 旧 `apps/web/src/services/api/jobs.ts:84,104` 使用 SSE，并在断流后降级 | `services/api/image.ts:153` 当前固定约 2.5 秒轮询；后端 `GET /api/jobs/:id/stream` 已恢复 | 部分实现 | 浏览器 EventSource、鉴权传递、Job SSE | 高频并发节点产生额外轮询；弱网反馈延迟 | P1 | Go SSE tests；浏览器 Network 观察 | 前端恢复 “SSE 优先，断流后 8 秒轮询”，验证代理缓冲关闭、断线重连和终态只处理一次 |
| 资产血缘、画布来源与 `@mention` 输入 | 旧资产 lineage/reference API 和画布输入组装 | `canvas-mentions.ts:9,120,201`；`CanvasWorkspaceView.tsx:6296,6479`；真实 asset lineage API | 已实现待真实后端验证 | 资产、引用、lineage 仓储；作用域 | 删除/移动资产后 mention 失效；跨作用域引用泄漏 | P0 | Playwright 资产上传/lineage；Go Memory/GORM tests；`canvas-mentions.test.ts` | 从个人/团队资产库各插入素材，用 `@` 引用节点和资产生成，核对请求输入、血缘父子和权限拒绝 |
| 图片上传、编辑、遮罩、标注、裁剪、切图、翻转、扩图和放大 | 旧画布图片工具及 image edit API | `CanvasWorkspaceView.tsx:268,273`；`CanvasImageMaskDialog.tsx`、`CanvasImageAnnotationDialog.tsx`；`canvas-image-data.test.ts` | 已实现待真实后端验证 | Canvas API、图片 edit Job、浏览器编码、资产存储 | 大图内存峰值、透明通道、EXIF 方向和多输入顺序 | P1 | Studio 图片工具单测；Playwright image edit；真实图片最小 smoke | 对同一真实图片逐项操作，下载结果比对尺寸/透明度；执行一次真实 edit 并核对父资产血缘 |
| Agent `run_generation`、变更确认与撤销 | 旧 Canvas Agent 工具执行和画布补丁协议 | `CanvasWorkspaceView.tsx:6177,6251`；`AgentPanel.tsx` SSE 连接；`apps/canvas-agent` tests | 已实现待真实后端验证 | 本地 Canvas Agent、共享协议、浏览器回传桥 | Agent 与用户同时编辑时 patch 基线过期；重复确认 | P0 | Protocol build/lint；Agent tests；本地 Agent + Studio 手测 | 让 Agent 新建并生成节点，分别确认/拒绝，确认后撤销；核对同一项目、选择集、视口和快照 |
| Agent thread/history/workspace 服务端恢复 | 旧 `apps/canvas-agent/src/http-server.ts:42-89` 提供 thread/history/workspace | `AgentPanel.tsx:58,69` 以浏览器 localStorage 伪历史替代 | 部分实现 | Agent HTTP API、用户/项目身份映射 | 跨设备、清缓存、多人协同时历史丢失或串线 | P1 | Agent HTTP tests；浏览器清缓存/换设备手测 | 前端改回服务端 thread/history/workspace，验证项目隔离、分页、重连和旧本地记录迁移策略 |
| Agent 附件真实传输与工作区落盘 | 旧 `apps/canvas-agent/src/agents.ts:443` 将附件写入受控工作区 | 新 Agent 面板只把附件文件名插入消息占位，没有二进制上传链路 | 完全缺失 | 新前端上传 UI、Agent multipart/stream API、大小/类型限制 | 文件名伪装、路径穿越、大文件耗尽磁盘、隐私泄漏 | P0 | 待新增前端 E2E 与 Agent 安全测试 | 增加上传/进度/取消/删除；验证内容哈希、隔离目录、允许类型、上限和对话重放 |
| Agent 详细事件、usage 与 MCP 工具过程呈现 | 旧 `apps/canvas-agent/src/agents.ts:225,239` 产生 usage，Agent 事件流含工具生命周期 | 新 `AgentPanel.tsx:213` 接 SSE，但只呈现部分过程和汇总 | 部分实现 | Agent 事件协议、UI 事件时间线 | 未知事件被丢弃；token/cost 汇总不准确；工具失败缺上下文 | P1 | Agent protocol/tests；录制 SSE fixture | 前端完整呈现 queued/start/delta/tool/result/error/usage，验证重连去重、未知事件兼容和敏感字段脱敏 |
| Director Desk 加载、消息握手、截图回传与快照落盘 | 旧画布 Director 节点和 `director-node.spec.ts` | `DirectorDeskView.tsx:70,245`；`/director-desk/index.html`；真实 `apps/director-desk` | 已实现待真实后端验证 | Director 静态构建、postMessage、项目快照/资产 | Origin 校验、重复保存、WebGL 资源加载失败 | P0 | Director build/lint/test；Playwright iframe 测试 | 创建 Director 节点，拖动后进入导演台，保存两次；确认只生成一份输出节点/连线且刷新可恢复 |
| 画布视频节点、上传、抽帧、归档、任务恢复 | 旧画布视频节点和 Provider 兼容接口 | `CanvasWorkspaceView.tsx:5035,5430,5743,7181,9647`；`canvas-video.test.ts` | 已实现待真实后端验证 | 旧视频兼容 API、Provider 配置、资产存储 | 不同 Provider 的任务/结果格式、长任务取消与大文件传输 | P2 | Studio video tests；Mock API 契约；只做非计费手测 | 使用已存在的测试视频上传、抽帧、归档；有明确授权后再用真实视频模型验证生成/刷新/取消 |
| 首页 `/video` 视频生成 | 旧后端仅能支撑画布节点兼容，不存在与新首页交互匹配的正式契约 | 新首页保留视频入口与交互，但本轮不接线 | 本轮排除 | 新产品契约、真实视频 Provider、计费与安全策略 | 误触发高成本模型、请求字段与状态模型尚未锁定 | P2 | 无；本轮禁止调用真实视频模型 | 先由前后端共同冻结首页请求、异步状态、参考素材、计费确认和取消语义，再单独立项 |

## 本轮后端支持面

- 已恢复真实 Go API、Python Worker、Canvas Agent、Director Desk 和 `canvas-agent-protocol`，并保留既有鉴权、作用域、路由及响应信封。
- 已增加公开只读 `GET /api/prompts`；成功响应按冻结客户端契约返回 `{items,tags,categories,total}`。
- 已增加原始响应 `POST /webdav-proxy`，包含 Origin、方法、目标 allowlist、DNS/重定向重校验、固定目标 IP、超时和请求体上限。
- 首页 `/video` 不接线；画布视频兼容代码保留，但本轮验证不调用真实视频模型。

## 后续 UI 补齐顺序

1. P0：Agent 附件真实上传；完成 Agent 操作确认/撤销和真实画布协同验收。
2. P1：图片 Job 恢复 SSE 优先、8 秒轮询降级；Agent 服务端 thread/history/workspace；详细工具事件和 usage。
3. P2：首页 `/video` 先冻结契约再开发；随后独立验证画布视频真实 Provider。
