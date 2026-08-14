# AI 漫工坊 UI 重构计划

> 基准代码：`ai-manhua-studio/`（影印分镜室原型）
> 硬性约束：样式、布局、设计语言 100% 来自原型，旧 webui 仅作功能实现参考
> 主线流程：重构 → 全量验证 → 替换旧 UI → 旧 UI 存档 → 新 UI 上线

---

## 总体路线图

```
Phase 0  框架迁移        Vite SPA → Next.js App Router        1–2 天
Phase 1  基础层接通       服务层 + Auth + Shell + Token         2 天
Phase 2  页面数据层       12 条路由逐路由接入真实 API            5–7 天
Phase 3  Canvas 重实现   Leafer.js 移植 + 生成流水线           7–10 天
Phase 4  全量验证测试     功能核对 + E2E + 边界测试             3–4 天
Phase 5  切换上线         归档旧 UI + 替换 + 灰度验证           1–2 天
```

总估算：**约 20–25 工作日**

---

## Phase 0：框架迁移（Vite → Next.js）

> 目标：原型在 Next.js App Router 下正常运行，样式零变化。

### 0.1 初始化 Next.js 项目结构

```
ai-manhua-studio/
├── app/                    ← Next.js App Router 根目录
│   ├── layout.tsx          ← 全局 layout，引入 globals.css、字体
│   ├── globals.css         ← 直接复制原型 index.css + final-refinement.css
│   ├── (auth)/             ← 登录 / 注册路由组（不带 shell）
│   │   ├── login/page.tsx
│   │   ├── v2-login/page.tsx
│   │   └── register/page.tsx
│   └── (studio)/           ← 带 SideRail 的主应用路由组
│       ├── layout.tsx      ← 挂载 StudioShell
│       ├── page.tsx        ← 工作台 /
│       ├── projects/page.tsx
│       ├── canvas/page.tsx
│       ├── canvas/[id]/page.tsx
│       ├── director/page.tsx
│       ├── comic-assets/page.tsx
│       ├── image/page.tsx
│       ├── assets/page.tsx
│       ├── tags/page.tsx
│       ├── tags/[tagId]/page.tsx
│       ├── prompts/page.tsx
│       ├── queue/page.tsx
│       ├── settings/page.tsx
│       └── admin/page.tsx
├── components/             ← 直接复制原型 client/src/components/
├── lib/                    ← 直接复制原型 client/src/lib/
├── hooks/                  ← 直接复制原型 client/src/hooks/
├── services/               ← 直接复制原型 client/src/services/
├── contexts/               ← 直接复制原型 client/src/contexts/
└── next.config.ts
```

### 0.2 构建配置适配

| 原型配置 | Next.js 等价 |
|---------|-------------|
| `@tailwindcss/vite` 插件 | `@tailwindcss/postcss`，新建 `postcss.config.mjs` |
| `vite.config.ts` 路径别名 `@/` → `client/src/` | `tsconfig.json` paths + `next.config.ts` aliases |
| `react()` 插件 | Next.js 内置 |
| Wouter `<Route>` | Next.js 文件系统路由（删除 Wouter 依赖） |
| `client/src/main.tsx` 入口 | Next.js `app/layout.tsx` |

### 0.3 清理 Manus 专有依赖

- 删除：`vite-plugin-manus-runtime`、`vitePluginManusDebugCollector`、`vitePluginStorageProxy`
- 删除：`@builder.io/vite-plugin-jsx-loc`
- 替换：所有 `/manus-storage/xxx.png` 引用 → 本地 `public/` 资产
- 保留：`components.json`（shadcn/ui CLI 配置），路径改为 Next.js 对应位置

### 0.4 字体处理

```tsx
// app/layout.tsx
import { Noto_Sans_SC, IBM_Plex_Mono } from "next/font/google";

const notoSansSC = Noto_Sans_SC({ subsets: ["latin"], weight: ["400","500","700"] });
const ibmPlexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400","500"] });
```

CSS 中的 `--font-sans` / `--font-mono` 变量保持不变，字体变量名注入即可。

### 0.5 验收标准

- `pnpm dev` 启动正常，所有路由可访问
- 原型视觉效果在 Next.js 下与 Vite 下像素级一致
- 无 Manus 相关报错

---

## Phase 1：基础层接通

> 目标：Auth 可用、Shell 展示真实用户信息、Token 统一。

### 1.1 Token Key 统一

```ts
// services/api/request.ts
const TOKEN_KEY = "ai-manju:auth_token";      // 从 "ai-manju:token" 改为与旧 webui 一致
```

### 1.2 StudioShell 接入路由

- `(studio)/layout.tsx` 挂载 `StudioShell`（原型已有真实 `getCurrentUser()` 调用）
- 删除 `Home.tsx` 中重复的 `SideRail` 实现
- Shell 用户信息区域改为动态渲染（名字、头像由 `AuthUser` 填充）
- 额度区域（"61%"）先占位，Settings 阶段再对接 `getPreferences()`

### 1.3 登录页接入真实 Auth

- `/login` 使用原型已有的 `pages/Login.tsx`（已对接真实 `login()` 调用）
- `/register` 实现注册表单 → `register()` 调用
- `/v2-login` 复用登录组件，仅改视觉标签（"GLACIER SESSION"）
- 登录成功后 redirect 到 `/`
- 未登录访问 studio 路由 → Next.js middleware redirect 到 `/login`

### 1.4 全局 401 处理

```ts
// 在 StudioShell 挂载时监听
window.addEventListener("ai-manju:auth-unauthorized", () => {
  router.push("/login");
});
```

### 1.5 验收标准

- 真实账号可登录、登出
- 刷新后 token 持久（localStorage）或清除（sessionStorage）
- 未登录访问 `/` 自动跳转 `/login`
- Shell 展示真实用户名，无硬编码"林叙"

---

## Phase 2：页面数据层（按复杂度排序）

> 原则：每个路由独立完成，不交叉。页面 JSX 骨架保留原型不动，只替换数据来源。
> 旧 webui 参考位置：`apps/web/src/app/(user)/<module>/`

### P2-A：简单页面（1 天）

#### 工作台 `/`

参考旧文件：`apps/web/src/app/(user)/page.tsx`、`workspace-data.ts`

- 将 `pages/Dashboard.tsx` 接入 `(studio)/page.tsx`
- `useWorkspaceDashboardData()` 已就绪，直接用
- 移除 `Home.tsx` 中硬编码的 `projectCards[]`、`StatStrip`、`Timeline`
- 最近项目列表改为 `getProjects()` 取前 3 条，卡片封面图用 `asset url` 或默认占位
- SSE 公告接入：`GET /api/announcements/current`（新增 `announcements.ts`）

#### 设置 `/settings`

参考旧文件：`apps/web/src/app/(user)/settings/`（1 file）

- 页面加载：`getPreferences()` → 填充表单初始值
- 模型选项：`getModels()` 动态获取
- 保存：`updatePreferences()` → toast 成功/失败
- "滚轮缩放需要 Ctrl"、"背景参考"等 canvas 设置对应 `canvas.*` 字段

#### 渲染队列 `/queue`

参考旧文件：`apps/web/src/app/(user)/queue/`（1 file）

- 替换静态 `jobs[]` → `getJobs()` 分页 + 筛选
- 实现 `services/api/jobs.ts`（参考下方新增服务列表）
- SSE 订阅：对当前"running"任务建立 `EventSource`
- 取消按钮：`POST /api/jobs/:id/cancel`
- 轮询降级：SSE 8s 无响应后 3s 轮询（逻辑从旧项目 `jobs.ts` 复制）

### P2-B：中等复杂页面（2 天）

#### 全部项目 `/projects`

参考旧文件：`apps/web/src/app/(user)/projects/`

- `getProjects()` 分页列表
- 创建项目：弹窗 → `createProject()` → 跳转 `/canvas/[id]`
- 删除项目：确认对话框 → `deleteProject()`
- 项目卡片封面：用项目快照缩略图（或占位色块）

#### 资产库 `/assets`

参考旧文件：`apps/web/src/app/(user)/assets/`（4 files）

- `getAssetLibrary()` 分页，支持分类/文件夹筛选
- 文件夹侧边栏：`getAssetFolders()` → 新增 `asset-folders.ts`
- 上传：`uploadAsset()` multipart
- 血缘 tab：`getAssetLineage(id)`
- 使用 tab：`getAssetUsageEvents(id)`
- 用户状态（收藏/不喜欢）：`updateAssetUserState()`
- 回收站：trash-preflight → bulk-trash → restore → 清空（扩充 `assets.ts`）

#### 标签库 `/tags` 及 `/tags/[tagId]`

参考旧文件：`apps/web/src/app/(user)/tags/`（2 files）

- 新增 `services/api/tags.ts`（完整 CRUD）
- `getTags()` 树形结构
- 标签 CRUD：创建、移动、删除（含确认）
- 别名管理：`createAlias()` / `deleteAlias()`
- 关联资产 / 提示词数量展示

#### 提示词库 `/prompts`

参考旧文件：`apps/web/src/app/(user)/prompts/`（1 file）

- `getPromptLibrary()` 已在 `catalog.ts` 中，接入分页 + 关键词搜索
- 用户自定义预设：从 `getPreferences().canvas.promptPresets` 读取，存入 `updatePreferences()`

### P2-C：流程型页面（2 天）

#### 关键帧生成 `/image`

参考旧文件：`apps/web/src/app/(user)/image/`（1 file）

- 新增 `services/api/image.ts`（参考旧 `apps/web/src/services/api/image.ts`）
- 文生图：`POST /api/jobs` 新协议
- 图生图：`POST /api/ai/images/edits`
- 参考图上传：压缩流程（最大 1280px）→ `uploadAsset()` → 存 asset_id
- 结果轮询 / SSE（复用 `jobs.ts` 的 `waitForJob()`）
- 结果归档到资产库：自动 / 手动 `uploadAsset()`
- 模型/参数：`getModels()` + 本地 state

#### 漫剧资产助手 `/comic-assets`

参考旧文件：`apps/web/src/app/(user)/comic-assets/`（3 files）

- 新增 `services/api/comic-assets.ts`（完整，参考旧实现）
- 三步流程严格对应真实 API：
  - Step 1 上传剧本 → `POST /api/comic-asset-analysis-sessions`
  - Step 2 审核候选 → `GET .../sessions/:id`，确认 → `POST .../confirm`
  - Step 3 批量生成 → `POST .../generation-batches` + 批次状态轮询
- 批次控制：pause / resume / stop / retry-failed

#### 3D 导演台 `/director`

参考旧文件：`apps/web/src/app/(user)/director/`（1 file）

- 旧实现是内嵌 iframe 加载 `public/director-desk/` 静态资源
- 原型的 `DirectorView` 是纯 UI Mock，保留其 JSX 骨架
- 暂不实现 3D 引擎（复杂度高、依赖独立构建）
- 对接：postMessage 接收构图结果 → 送入 `/image` 生成

#### 管理后台 `/admin`

参考旧文件：`apps/web/src/app/(user)/admin/`（若存在）

- 新增 `services/api/admin.ts`（完整，参考旧实现）
- 用户管理：列表 + 创建 + 状态切换
- 模型提供商：列表 + CRUD + 测试连接
- 系统公告：列表 + 发布 + 撤销
- 运行监控：`getAdminMonitoring()` 已有，周期轮询（10s）
- Seedance 素材：新增 `services/api/seedance-assets.ts`

### P2 新增服务文件清单

```
services/api/jobs.ts            JobRecord, getJobs, getJob, cancelJob, waitForJob (SSE+轮询)
services/api/image.ts           ImageGenerationRequest, requestImageGeneration, requestImageEdit
services/api/video.ts           requestVideoGeneration (OpenAI + Seedance 双通道)
services/api/audio.ts           requestAudioSpeech
services/api/tags.ts            SemanticTag, getTags, createTag, updateTag, deleteTag, moveTag, aliases
services/api/comic-assets.ts    ComicAssetProject, ComicAnalysisSession, ComicGenerationBatch 全套
services/api/admin.ts           AdminUser, ModelProviderConfig, getUsers, providers CRUD, announcements
services/api/announcements.ts   SystemAnnouncement, getCurrentAnnouncement, markRead, streamAnnouncements
services/api/material.ts        Seedance material 验证
services/api/seedance-assets.ts SeedanceAsset, admin 端素材管理
services/api/asset-folders.ts   文件夹 CRUD（从 assets.ts 拆出）
services/api/asset-exports.ts   导出任务 CRUD + 内容下载
```

> 迁移策略：以上文件全部从 `apps/web/src/services/api/` 对应文件复制类型定义和请求逻辑，再用原型的 `request()` 函数重写调用层（不引入旧 webui 的 axios 封装）。

---

## Phase 3：Canvas 重实现

> 这是工作量最大的单个模块。旧 webui canvas 目录共 61 个文件，功能复杂。
> 原则：功能逻辑从旧 canvas 迁移，UI 皮肤全部使用原型设计语言重写，不复制任何旧 JSX / CSS。

### 3.1 Leafer.js 集成

- 安装 `leafer-canvas`（参考旧 `apps/web` package.json）
- 初始化：`<div id="canvas-container">` → `new App({ container, fill, tree })` 
- 无限画布基础：pan（中键/空格拖拽）、zoom（滚轮/Ctrl+滚轮）、minimap
- 背景参考线/点阵：从 `UserPreferences.canvas.backgroundMode` 读取

### 3.2 节点系统

参考旧文件：`canvas-node.tsx`

- `CanvasNode` 数据结构（`id, type, x, y, width, height, data`）
- 节点类型：`prompt`（纯文字）、`image`（生成结果）、`reference`（参考图）
- 节点选中、移动、缩放（Leafer 手势）
- 节点连接线：`canvas-connections.tsx` 逻辑参考，SVG overlay 实现
- 右键菜单：`canvas-context-menu.tsx` 功能参考，UI 用原型样式重写

### 3.3 生成流水线

参考旧文件：`canvas-node-generation.ts`、`canvas-image-settings-popover.tsx`

```
用户触发生成（选中 prompt 节点 → 点击"生成关键帧"）
  → 读取节点 prompt + 参考图 asset_ids + 当前 preferences 参数
  → POST /api/jobs { type: "image_generation", ... }
  → 获取 job_id → 在节点上显示进度环
  → SSE GET /api/jobs/:id/stream（或轮询降级）
  → succeeded → 结果图写入新 image 节点，连接到 prompt 节点
  → 自动 POST /api/assets 归档，获取 asset_id
```

### 3.4 图像操作对话框

参考旧文件（逻辑参考，UI 重写）：

| 功能 | 旧文件 | 触发方式 |
|------|--------|---------|
| 裁切 | `canvas-node-crop-dialog.tsx` | 节点工具栏 |
| 外扩（outpaint） | `canvas-node-outpaint-dialog.tsx` | 节点工具栏 |
| 压缩 | `canvas-node-compress-dialog.tsx` | 节点工具栏 |
| 蒙版编辑 | `canvas-node-mask-edit-dialog.tsx` | 节点工具栏 |
| 放大（upscale） | `canvas-node-upscale-dialog.tsx` | 节点工具栏 |
| 分镜导出 | `canvas-node-split-dialog.tsx` | 节点工具栏 |
| 旋转/角度 | `canvas-node-angle-dialog.tsx` | 节点工具栏 |
| 标注 | `canvas-node-annotation-dialog.tsx` | 右键菜单 |
| 聚焦 | `canvas-node-focus-dialog.tsx` | 右键菜单 |

### 3.5 AI 助手面板

参考旧文件：`canvas-assistant-panel.tsx`、`canvas-agent-chat-ui.tsx`、`canvas-local-agent-panel.tsx`

- Inspector 右侧抽屉内嵌聊天 UI
- `POST /api/ai/text` 文本生成（系统 prompt + 当前画布上下文）
- 流式响应（SSE 或 chunked）

### 3.6 画布持久化

参考旧文件：`canvas-project-switcher.tsx`

- 加载：`getProjectSnapshot(id)` → 恢复所有节点
- 自动保存：节点变更后 debounce 500ms → `saveProjectSnapshot(id, data)`
- 手动快照：点击"已保存"按钮 → `updateProject(id, { data })`

### 3.7 音频 / 视频节点

参考旧文件：`canvas-audio-settings-popover.tsx`

- 音频节点：`POST /api/ai/audio/speech` → 播放器节点
- 视频节点：`requestVideoGeneration()` → 视频预览节点

### 3.8 Canvas 验收标准

- 创建 / 加载 / 自动保存项目
- prompt 节点 → 图像生成 → 结果节点 → 归档资产 完整闭环
- 节点拖拽、缩放、连接、右键菜单正常
- 刷新后节点恢复（快照加载正确）

### 3.9 本地 Agent 面板迁移（必须保留）

参考旧文件：
- `canvas-local-agent-panel.tsx`（约 1000 行，面板主体）
- `canvas-agent-chat-ui.tsx`（聊天消息 / 附件 / Composer 子组件）
- `use-canvas-agent-store.ts`（Zustand store）
- `canvas-agent-ops.ts`（ops 摘要工具函数）
- `packages/canvas-agent-protocol/src/index.ts`（协议包，208 行纯类型 + 常量）

#### 3.9.1 协议包处理

`canvas-agent-protocol` 只有类型定义和常量，无任何运行时依赖。两种方式均可，选其一：

**方案 A（推荐）：保留 monorepo 本地包引用**
```json
// 新 apps/web/package.json
"@ai-manju/canvas-agent-protocol": "workspace:*"
```
Dockerfile 构建时已经 `COPY packages/canvas-agent-protocol` ，无需额外改动。

**方案 B：内联到新项目**
```
services/canvas-agent/protocol.ts   ← 直接复制 index.ts 内容
```
适合将来脱离 monorepo 独立部署的场景。

#### 3.9.2 Ant Design → shadcn/ui 组件替换清单

面板逻辑**完全不动**，只换 UI 组件层：

| Ant Design 用法 | shadcn/ui 替换 |
|----------------|----------------|
| `<Button>` / `<Button type="primary">` / `<Button danger>` | `<Button>` / `<Button variant="default">` / `<Button variant="destructive">` |
| `<Input>` / `<Input.Password>` | `<Input>` / `<Input type="password">` |
| `<Segmented>` | `<Tabs>` 或自制 segmented（原型已有类似实现） |
| `<Tooltip>` | `<Tooltip>` （shadcn/ui Radix 版） |
| `App.useApp()` → `message.success/error/warning` | `toast()` from sonner（原型已安装） |
| `modal.confirm()` 删除确认弹窗 | `<AlertDialog>` （shadcn/ui） |

#### 3.9.3 功能迁移要点

- SSE 连接逻辑（`EventSource` + `hello/tool_call/agent_event/agent_log/agent_error/agent_done` 事件）：**原样复制**
- HTTP 调用（`/agent/codex/threads`、`/canvas/state`、`/canvas/result`）：**原样复制**
- 27 个工具调用分发（`canvas_apply_ops` / `canvas_search_assets` / ...）：**原样复制**
- 可拖拽面板宽度（`onPointerDown` → pointermove/pointerup）：**原样复制**
- `canvas-agent-store.ts`：从 Zustand 直接迁移，API 不变
- `canvas-agent-ops.ts`：工具函数，直接复制

#### 3.9.4 验收标准

- 本地 Agent（`canvas-agent` 进程）可正常连接，状态指示灯显示绿色
- 发送一条指令，Agent 可对画布执行 `canvas_apply_ops`，节点变化反映到画布
- 工具确认模式：关闭时自动执行，开启时显示确认卡片
- 历史 tab：展示已有 thread，可恢复/删除
- 日志 tab：事件流正常，可复制

---

## Phase 4：全量验证测试

### 4.1 功能核对矩阵

对照 `docs/API-ARCHITECTURE.md` 的页面 → API 映射，逐项验证：

| 分类 | 检查点 |
|------|--------|
| Auth | 登录/登出/token 持久化/401 跳转/角色守卫 |
| 工作台 | 真实项目数/任务数/资产数/SSE 公告 |
| 项目 | CRUD/跳转 Canvas/封面显示 |
| Canvas | 节点增删/生成闭环/持久化/10+ 操作对话框 |
| 图像生成 | 文生图/图生图/参考图/批量变体/结果归档 |
| 漫剧资产 | 三步流程/批次控制/暂停恢复/重试 |
| 资产库 | 列表/筛选/上传/标签/血缘/回收站/导出 |
| 标签库 | 树形/CRUD/别名/关联资产和提示词 |
| 提示词库 | 搜索/分类/预设保存 |
| 渲染队列 | 状态筛选/SSE/取消 |
| 设置 | 加载/保存/模型动态获取 |
| 管理后台 | 用户/提供商/公告/监控（仅 super_admin 可访问） |

### 4.2 边界测试

- API 超时（15s）→ 错误提示，不白屏
- 401 响应 → 自动登出跳转
- 网络断开 → SSE 断线重连
- 空列表 → 空态提示（不显示 loading 无限转圈）
- 大文件上传 → 进度提示 + 文件大小校验
- 并发任务（多节点同时生成）→ 队列展示正确

### 4.3 Playwright E2E（复用旧 webui 的测试框架）

关键路径：
```
登录 → 工作台加载 → 创建项目 → 进入 Canvas → 生成图像 → 查看队列 → 归档资产 → 登出
```

---

## Phase 5：切换上线

### 5.1 旧 webui 存档

```bash
# 在主项目 monorepo 中
mv apps/web apps/web-v1-archive
git add apps/web-v1-archive
git commit -m "chore: 归档旧 webui (v1) 至 apps/web-v1-archive"
```

### 5.2 新 UI 接入 monorepo

```bash
# 将 ai-manhua-studio 整体移入 apps/web
cp -r ai-manhua-studio/ apps/web
# 更新 pnpm-workspace.yaml、docker-compose.yml、turbo.json 的引用路径
# 更新 Dockerfile（Next.js 构建替换原 Next.js 构建，配置基本一致）
```

### 5.3 docker-compose 更新

```yaml
web:
  build:
    context: ./apps/web
    dockerfile: Dockerfile
  environment:
    - NEXT_PUBLIC_API_URL=http://api:3101
  depends_on: [api]
  ports:
    - "3100:3000"
```

### 5.4 环境变量映射

| 原型 env | Next.js 对应 |
|---------|-------------|
| `VITE_API_URL` | `NEXT_PUBLIC_API_URL` |
| `VITE_OAUTH_PORTAL_URL` | 暂不使用（OAuth 流程保留 bearer 方案） |

### 5.5 灰度验证

- 同时启动旧 UI（port 3100）和新 UI（port 3200）
- 对比验证关键路径
- 确认无问题后关停旧 UI，重定向 3100 → 新 UI

---

## 约束与红线

| 红线 | 说明 |
|------|------|
| 不复制旧 webui JSX / CSS | 仅参考功能实现和类型定义 |
| 不引入 Ant Design | 设计语言锁定 shadcn/ui + 影印分镜室 |
| 不修改原型 `index.css` 的设计 token | 颜色、字体、间距不变 |
| Canvas 引擎保持 Leafer.js | 不换渲染引擎 |
| 服务层统一用原型的 `request()` | 不混入 axios |
| Token Key 统一为 `ai-manju:auth_token` | 兼容已登录用户 |
| 旧 webui 存档前不删除代码 | 保留回滚能力 |

---

## 进度追踪

| Phase | 任务 | 状态 |
|-------|------|------|
| 0 | Next.js 框架迁移 | ⬜ 待开始 |
| 0 | 清除 Manus 工具链 | ⬜ 待开始 |
| 1 | Token Key 统一 | ⬜ 待开始 |
| 1 | StudioShell 接入路由 | ⬜ 待开始 |
| 1 | Auth 登录页接入真实 API | ⬜ 待开始 |
| 2A | 工作台 / | ⬜ 待开始 |
| 2A | 设置 /settings | ⬜ 待开始 |
| 2A | 渲染队列 /queue | ⬜ 待开始 |
| 2B | 全部项目 /projects | ⬜ 待开始 |
| 2B | 资产库 /assets | ⬜ 待开始 |
| 2B | 标签库 /tags | ⬜ 待开始 |
| 2B | 提示词库 /prompts | ⬜ 待开始 |
| 2C | 关键帧生成 /image | ⬜ 待开始 |
| 2C | 漫剧资产助手 /comic-assets | ⬜ 待开始 |
| 2C | 管理后台 /admin | ⬜ 待开始 |
| 3 | Leafer.js 集成 | ⬜ 待开始 |
| 3 | 节点系统 | ⬜ 待开始 |
| 3 | 生成流水线 | ⬜ 待开始 |
| 3 | 图像操作对话框 (10项) | ⬜ 待开始 |
| 3 | AI 助手面板 | ⬜ 待开始 |
| 3 | 音频 / 视频节点 | ⬜ 待开始 |
| 4 | 功能核对矩阵 | ⬜ 待开始 |
| 4 | 边界测试 | ⬜ 待开始 |
| 4 | E2E 测试 | ⬜ 待开始 |
| 5 | 旧 UI 存档 | ⬜ 待开始 |
| 5 | monorepo 接入 | ⬜ 待开始 |
| 5 | 灰度验证 | ⬜ 待开始 |
