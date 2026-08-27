# AI 漫工坊 — 功能 API 与架构文档

> 版本：v0.3-post3 | 更新：2026-08-13

---

## 目录

1. [系统架构总览](#1-系统架构总览)
2. [认证与会话](#2-认证与会话)
3. [用户与偏好](#3-用户与偏好)
4. [页面 → API 映射](#4-页面--api-映射)
   - [工作台 `/`](#41-工作台-)
   - [全部项目 `/projects`](#42-全部项目-projects)
   - [画布工坊 `/canvas`](#43-画布工坊-canvas)
   - [3D 导演台 `/director`](#44-3d-导演台-director)
   - [漫剧资产助手 `/comic-assets`](#45-漫剧资产助手-comic-assets)
   - [关键帧生成 `/image`](#46-关键帧生成-image)
   - [资产库 `/assets`](#47-资产库-assets)
   - [标签库 `/tags`](#48-标签库-tags)
   - [提示词库 `/prompts`](#49-提示词库-prompts)
   - [渲染队列 `/queue`](#410-渲染队列-queue)
   - [设置 `/settings`](#411-设置-settings)
   - [登录 / 注册](#412-登录--注册)
   - [管理后台 `/admin`](#413-管理后台-admin)
5. [后端 API 端点完整清单](#5-后端-api-端点完整清单)
6. [数据模型](#6-数据模型)
7. [前端服务层](#7-前端服务层)
8. [任务队列架构](#8-任务队列架构)
9. [存储架构](#9-存储架构)
10. [部署架构](#10-部署架构)

---

## 1. 系统架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                         浏览器客户端                                  │
│  Next.js 16 App Router (TypeScript · Ant Design 6 · Tailwind CSS v4) │
│  Zustand 状态管理  ·  Lucide React 图标  ·  Leafer.js Canvas 引擎     │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │ HTTP/SSE  (fetch + axios)
                                  │ Bearer Token 认证
                       ┌──────────▼───────────┐
                       │   Go API Server       │
                       │   Gin · port 3101     │
                       │   CORS 白名单控制      │
                       └──┬───────────────┬───┘
                          │               │
              ┌───────────▼───┐   ┌───────▼──────────┐
              │  PostgreSQL    │   │  Redis            │
              │  port 55432    │   │  port 6379        │
              │  业务数据       │   │  任务队列 Broker   │
              └───────────────┘   └───────┬───────────┘
                                          │ Celery 协议
                                  ┌───────▼──────────┐
                                  │  Python Worker    │
                                  │  (AI 任务执行)     │
                                  │  port 8101 /health│
                                  └──────────────────┘

  旁路服务:
  ┌──────────────────────┐   ┌────────────────────────┐
  │  Canvas Agent         │   │  Director Desk          │
  │  TypeScript MCP 服务  │   │  Vite SPA (3D 导演台)   │
  │  为 Canvas 提供 AI 工具│   │  内嵌于 /director 页面  │
  └──────────────────────┘   └────────────────────────┘
```

### 关键约定

| 约定 | 说明 |
|------|------|
| API Base URL | `NEXT_PUBLIC_API_URL`（默认 `http://localhost:3101`） |
| 认证方式 | `Authorization: Bearer <token>`，token 存 localStorage / sessionStorage |
| 响应格式 | `{ "success": true, "data": {...} }` / `{ "success": false, "error": "..." }` |
| 请求追踪 | 每个请求携带 `X-Request-Id` header，便于日志关联 |
| Workspace 作用域 | `personal`（默认）或 `team`，通过 query param `scope=` 传递 |

---

## 2. 认证与会话

### 前端服务：`src/services/api/auth.ts`

| 功能 | 方法 | 端点 |
|------|------|------|
| 登录 | `POST` | `/api/auth/login` |
| 注册 | `POST` | `/api/auth/register` |
| 获取当前用户 | `GET` | `/api/auth/me` |
| 登出 | `POST` | `/api/auth/logout` |

**登录请求体：**
```json
{ "username": "admin", "password": "xxx", "remember": true }
```

**登录响应：**
```json
{
  "success": true,
  "data": {
    "token": "<bearer-token>",
    "user": { "id": "...", "username": "admin", "role": "super_admin", "status": "active" }
  }
}
```

**Token 存储策略：**
- `remember=true` → `localStorage`（持久登录）
- `remember=false` → `sessionStorage`（tab 关闭即失效）
- 未授权响应 → 触发 `ai-manju:auth-unauthorized` 事件 → 全局跳转登录页

**角色体系：**

| Role | 权限范围 |
|------|---------|
| `super_admin` | 全部功能 + 后台管理 |
| `member` | 普通用户功能，不能访问 `/admin` |

---

## 3. 用户与偏好

### 前端服务：`src/services/api/user-preferences.ts`

| 功能 | 方法 | 端点 |
|------|------|------|
| 获取用户偏好 | `GET` | `/api/user/preferences` |
| 更新用户偏好 | `PUT` | `/api/user/preferences` |

**偏好数据结构（`UserPreferences`）：**

```typescript
{
  generation: {
    imageModel, videoModel, textModel, audioModel,
    quality, size, count, canvasImageCount,
    videoSeconds, vquality, videoGenerateAudio, videoWatermark,
    audioVoice, audioFormat, audioSpeed, audioInstructions, systemPrompt
  },
  canvas: {
    middleButtonLockHint: boolean,
    backgroundMode: "lines" | "dots" | "blank",
    wheelZoomRequiresCtrl: boolean,
    promptPresets: UserPromptPreset[]
  }
}
```

---

## 4. 页面 → API 映射

### 4.1 工作台 `/`

**用途：** 全局数据仪表盘，展示项目进度、队列任务、资产统计。

**调用的 API：**

| 功能 | 端点 |
|------|------|
| 获取项目列表 | `GET /api/projects?scope=personal` |
| 获取漫剧项目列表 | `GET /api/comic-asset-projects?scope=personal` |
| 获取任务列表（进行中） | `GET /api/jobs?status=running&status=queued` |
| 获取资产数量统计 | `GET /api/assets/library`（取 total 字段） |

**前端数据源：** `src/app/(user)/workspace-data.ts`（`useWorkspaceDashboardData` hook）

---

### 4.2 全部项目 `/projects`

**用途：** 画布项目管理，CRUD 操作。

**前端服务：** `src/services/api/project-canvas.ts`

| 功能 | 方法 | 端点 |
|------|------|------|
| 获取项目列表 | `GET` | `/api/projects?scope=<scope>` |
| 创建项目 | `POST` | `/api/projects` |
| 获取项目详情 | `GET` | `/api/projects/:id` |
| 更新项目 | `PUT` | `/api/projects/:id` |
| 删除项目 | `DELETE` | `/api/projects/:id` |
| 获取画布快照 | `GET` | `/api/projects/:id/snapshot` |
| 保存画布快照 | `PUT` | `/api/projects/:id/snapshot` |

**项目数据模型：**
```typescript
ServerProject {
  id: string
  title: string
  owner_id: string
  workspace_id?: string
  scope?: "personal" | "team"
  data?: Partial<CanvasProject>   // 画布序列化数据
  created_at: string
  updated_at: string
}
```

---

### 4.3 画布工坊 `/canvas` 及 `/canvas/[id]`

**用途：** 核心无限画布，支持 AI 图像生成、视频生成、音频生成、多模态节点编辑。

**前端服务：** `src/services/api/image.ts`、`src/services/api/video.ts`、`src/services/api/ai.ts`、`src/services/api/jobs.ts`、`src/services/api/project-canvas.ts`、`src/services/api/assets.ts`

#### 图像生成

| 功能 | 方法 | 端点 |
|------|------|------|
| 文生图（新协议） | `POST` | `/api/jobs` body: `{type:"image_generation", ...}` |
| 文生图（旧协议） | `POST` | `/api/ai/images/generations` |
| 图生图（编辑） | `POST` | `/api/ai/images/edits` |
| 获取可用模型 | `GET` | `/api/ai/models` |

#### 视频生成

| 功能 | 方法 | 端点 |
|------|------|------|
| 创建视频任务 | `POST` | `/api/ai/videos` 或 `/api/ai/contents/generations/tasks` |
| 轮询视频任务 | `GET` | `/api/ai/videos/:id` 或 `/api/ai/contents/generations/tasks/:id` |
| 获取视频内容 | `GET` | `/api/ai/videos/:id/content` 或 `/api/ai/contents/generations/tasks/:id/content` |

#### AI 文本（Canvas Agent 使用）

| 功能 | 方法 | 端点 |
|------|------|------|
| 文本生成 | `POST` | `/api/ai/text` |

#### 任务流

```
Canvas 节点触发生成
  → 提交 POST /api/jobs 或 /api/ai/images/generations
  → 获取 job_id
  → SSE 订阅 GET /api/jobs/:id/stream
  → 或轮询 GET /api/jobs/:id
  → 任务 succeeded → 结果写入 Canvas 节点
  → 自动 Upload 结果到资产库 POST /api/assets
```

#### 项目持久化流

```
Canvas 编辑
  → debounce 500ms
  → PUT /api/projects/:id/snapshot（增量快照）
  → 定期 PUT /api/projects/:id（完整项目数据）
```

**Canvas 引擎：** Leafer.js（`leafer-canvas-engine.tsx`），支持节点拖拽、缩放、画布平移。

---

### 4.4 3D 导演台 `/director`

**用途：** 嵌入式 3D 场景编辑器（Vite SPA），通过 iframe 或直接嵌入 `public/director-desk/` 的静态资源。

**数据交互：** Director Desk 通过 `postMessage` 与主应用通信，不直接调用 Go API，而是通过主应用代理。

**相关 API（间接）：**

| 功能 | 端点 |
|------|------|
| 资产提取（场景图片） | `GET /api/assets/:id/content` |
| 图像生成（背景渲染） | `POST /api/ai/images/generations` |

---

### 4.5 漫剧资产助手 `/comic-assets`

**用途：** AI 辅助的漫画角色/场景资产管理，支持剧本解析 → 资产候选生成 → 批量图像生成 → 资产归档。

**前端服务：** `src/services/api/comic-assets.ts`

#### 分析会话（从剧本提取资产候选）

| 功能 | 方法 | 端点 |
|------|------|------|
| 创建分析会话（上传剧本）| `POST` | `/api/comic-asset-analysis-sessions` |
| 获取分析会话 | `GET` | `/api/comic-asset-analysis-sessions/:sessionId` |
| 创建修订版本 | `POST` | `/api/comic-asset-analysis-sessions/:sessionId/revisions` |
| 设置活跃修订版本 | `PUT` | `/api/comic-asset-analysis-sessions/:sessionId/active-revision` |
| 确认分析结果 | `POST` | `/api/comic-asset-analysis-sessions/:sessionId/confirm` |

#### 漫剧项目

| 功能 | 方法 | 端点 |
|------|------|------|
| 获取项目列表 | `GET` | `/api/comic-asset-projects` |
| 创建项目 | `POST` | `/api/comic-asset-projects` |
| 从分析会话导入 | `POST` | `/api/comic-asset-projects/import` |
| 获取项目详情 | `GET` | `/api/comic-asset-projects/:projectId` |
| 更新项目 | `PUT` | `/api/comic-asset-projects/:projectId` |
| 删除项目 | `DELETE` | `/api/comic-asset-projects/:projectId` |

#### 项目内资产操作

| 功能 | 方法 | 端点 |
|------|------|------|
| 创建资产 | `POST` | `/api/comic-asset-projects/:projectId/assets` |
| 更新资产 | `PUT` | `/api/comic-asset-projects/:projectId/assets/:assetId` |
| 删除资产 | `DELETE` | `/api/comic-asset-projects/:projectId/assets/:assetId` |
| 预览提示词 | `POST` | `/api/comic-asset-projects/:projectId/assets/:assetId/prompt-preview` |
| 保存提示词 | `PUT` | `/api/comic-asset-projects/:projectId/assets/:assetId/prompt` |
| AI 优化提示词 | `POST` | `/api/comic-asset-projects/:projectId/assets/:assetId/prompt-optimize` |
| 批量审批提示词 | `POST` | `/api/comic-asset-projects/:projectId/prompts/bulk-approve` |

#### 批量生成

| 功能 | 方法 | 端点 |
|------|------|------|
| 获取批次列表 | `GET` | `/api/comic-asset-projects/:projectId/generation-batches` |
| 创建批次 | `POST` | `/api/comic-asset-projects/:projectId/generation-batches` |
| 获取批次详情 | `GET` | `/api/comic-asset-generation-batches/:batchId` |
| 暂停批次 | `POST` | `/api/comic-asset-generation-batches/:batchId/pause` |
| 恢复批次 | `POST` | `/api/comic-asset-generation-batches/:batchId/resume` |
| 停止批次 | `POST` | `/api/comic-asset-generation-batches/:batchId/stop` |
| 重试单条失败 | `POST` | `/api/comic-asset-generation-batches/:batchId/items/:itemId/retry` |
| 批量重试失败 | `POST` | `/api/comic-asset-generation-batches/:batchId/retry-failed` |

**流程：**
```
上传剧本 PDF/文本
  → 创建分析会话 → AI 解析角色/场景
  → 用户审核候选 → 确认分析
  → 导入为漫剧项目
  → 为每个资产编辑/优化提示词
  → 创建批次 → Celery Worker 批量图像生成
  → 结果归档到资产库
```

---

### 4.6 关键帧生成 `/image`

**用途：** 独立的图像生成工作台，支持参考图、多模型选择、批量生成。

**前端服务：** `src/services/api/image.ts`

| 功能 | 方法 | 端点 |
|------|------|------|
| 文生图 | `POST` | `/api/jobs`（新）或 `/api/ai/images/generations`（旧） |
| 图生图 | `POST` | `/api/ai/images/edits` |
| 获取任务状态 | `GET` | `/api/jobs/:id` |
| SSE 流式进度 | `GET` | `/api/jobs/:id/stream` |
| 上传参考图 | `POST` | `/api/assets`（multipart） |
| 获取可用模型 | `GET` | `/api/ai/models` |

**图像生成请求体（新协议）：**
```json
{
  "type": "image_generation",
  "model": "gpt-image-1",
  "prompt": "...",
  "size": "1024x1024",
  "quality": "high",
  "n": 1,
  "reference_images": [{ "asset_id": "...", "role": "reference" }]
}
```

**参考图处理管线：**
```
用户上传原图
  → 压缩（最大 1280px，多阶梯质量）
  → POST /api/assets 上传
  → 存储 asset_id
  → 生成时随请求体一起发送
```

---

### 4.7 资产库 `/assets`

**用途：** 统一媒体资产管理，支持文件夹、标签、血缘追踪、回收站、批量导出。

**前端服务：** `src/services/api/assets.ts`

#### 资产查询与浏览

| 功能 | 方法 | 端点 |
|------|------|------|
| 资产库列表（分页+筛选） | `GET` | `/api/assets/library` |
| 简单列表 | `GET` | `/api/assets` |
| 资产详情 | `GET` | `/api/assets/:id` |
| 资产文件内容 | `GET` | `/api/assets/:id/content` |
| 资产血缘关系 | `GET` | `/api/assets/:id/lineage` |
| 资产使用统计 | `GET` | `/api/assets/:id/stats` |
| 资产使用记录 | `GET` | `/api/assets/:id/usage-events` |

#### 资产操作

| 功能 | 方法 | 端点 |
|------|------|------|
| 上传资产 | `POST` | `/api/assets`（multipart/form-data） |
| 更新元数据 | `PUT` | `/api/assets/:id/metadata` |
| 批量移动 | `POST` | `/api/assets/bulk-move` |
| 获取用户状态 | `GET` | `/api/assets/:id/user-state` |
| 更新用户状态（收藏/不喜欢）| `PUT` | `/api/assets/:id/user-state` |

#### 标签操作

| 功能 | 方法 | 端点 |
|------|------|------|
| 获取资产标签 | `GET` | `/api/assets/:id/tags` |
| 绑定标签 | `POST` | `/api/assets/:id/tags` |
| 移除标签 | `DELETE` | `/api/assets/:id/tags/:tagId` |
| 重新同步继承标签 | `POST` | `/api/assets/:id/tags/resync-inherited` |
| 批量更新标签 | `POST` | `/api/assets/bulk-tags` |

#### 回收站

| 功能 | 方法 | 端点 |
|------|------|------|
| 删除前预检 | `POST` | `/api/assets/trash-preflight` |
| 批量移入回收站 | `POST` | `/api/assets/bulk-trash` |
| 回收站列表 | `GET` | `/api/assets/trash` |
| 回收站资产库 | `GET` | `/api/assets/trash/library` |
| 批量恢复 | `POST` | `/api/assets/bulk-restore` |
| 清空回收站 | `DELETE` | `/api/assets/trash` |
| 永久删除 | `DELETE` | `/api/assets/:id/permanent` |

#### 文件夹

| 功能 | 方法 | 端点 |
|------|------|------|
| 文件夹列表 | `GET` | `/api/asset-folders` |
| 创建文件夹 | `POST` | `/api/asset-folders` |
| 更新文件夹 | `PUT` | `/api/asset-folders/:folderId` |
| 删除文件夹 | `DELETE` | `/api/asset-folders/:folderId` |

#### 导出

| 功能 | 方法 | 端点 |
|------|------|------|
| 创建导出任务 | `POST` | `/api/asset-exports` |
| 导出任务列表 | `GET` | `/api/asset-exports` |
| 导出任务详情 | `GET` | `/api/asset-exports/:exportId` |
| 取消导出 | `POST` | `/api/asset-exports/:exportId/cancel` |
| 下载导出内容 | `GET` | `/api/asset-exports/:exportId/content` |

**资产分类（`AssetCategory`）：** `character` · `environment` · `costume` · `prop` · `ui` · `reference` · `other`

**资产来源（`AssetSourceType`）：** `manual_upload` · `image_workbench` · `canvas` · `comic_batch` · `legacy` · `unknown`

**智能视图（`smartView`）：** `favorite`（收藏） · `dislike`（不喜欢） · `unused`（未使用） · `frequent`（常用）

---

### 4.8 标签库 `/tags`

**用途：** 语义标签管理，树形结构，支持资产和提示词的分类与筛选。

**前端服务：** `src/services/api/tags.ts`

| 功能 | 方法 | 端点 |
|------|------|------|
| 获取标签列表 | `GET` | `/api/tags?scope=&usage=asset&parent=` |
| 创建标签 | `POST` | `/api/tags` |
| 获取标签详情 | `GET` | `/api/tags/:tagId` |
| 更新标签 | `PUT` | `/api/tags/:tagId` |
| 删除标签 | `DELETE` | `/api/tags/:tagId` |
| 移动标签 | `POST` | `/api/tags/:tagId/move` |
| 批量移动 | `POST` | `/api/tags/bulk-move` |
| 批量删除 | `POST` | `/api/tags/bulk-delete` |
| 创建别名 | `POST` | `/api/tags/:tagId/aliases` |
| 删除别名 | `DELETE` | `/api/tags/:tagId/aliases/:aliasId` |
| 标签下的资产 | `GET` | `/api/tags/:tagId/assets` |
| 标签下的提示词 | `GET` | `/api/tags/:tagId/prompts` |

**标签数据模型：**
```typescript
SemanticTag {
  id, name, description,
  scope_type: "system" | "public" | "workspace" | "user",
  parent_id,           // 树形结构
  asset_enabled,       // 是否可绑定资产
  prompt_enabled,      // 是否可绑定提示词
  inherit_mode: "auto" | "manual" | "never",
  aliases: [],         // 别名列表（搜索时匹配）
  asset_count, prompt_count, children_count
}
```

---

### 4.9 提示词库 `/prompts`

**用途：** 内置提示词模板库（本地 JSON），支持分类、标签、关键词搜索。

**数据来源：** `/api/prompts`（Next.js API Route，读取本地 JSON 文件）

**前端服务：** `src/services/api/prompts.ts`

| 功能 | 方法 | 端点 |
|------|------|------|
| 获取提示词列表 | `GET` | `/api/prompts?keyword=&tag=&category=&page=&pageSize=` |

> 注意：提示词库是前端本地 API Route，不经过 Go 后端。

**用户自定义提示词预设** 存储在 `UserPreferences.canvas.promptPresets` 中，通过 `/api/user/preferences` 持久化。

---

### 4.10 渲染队列 `/queue`

**用途：** 统一任务管理中心，监控所有 AI 生成任务（图像/视频/漫画批次）的状态。

**前端服务：** `src/services/api/jobs.ts`

| 功能 | 方法 | 端点 |
|------|------|------|
| 任务列表 | `GET` | `/api/jobs?status=&type=&page=&pageSize=` |
| 任务详情 | `GET` | `/api/jobs/:id` |
| 取消任务 | `POST` | `/api/jobs/:id/cancel` |
| 任务 SSE 流 | `GET` | `/api/jobs/:id/stream` |

**任务状态机：**
```
queued → running → succeeded
                 → failed
                 → canceled
```

**轮询策略（`waitForJob`）：**
- 首先尝试 SSE（`GET /api/jobs/:id/stream`）
- SSE 超时 8s 后降级为轮询（每 3s 一次 `GET /api/jobs/:id`）

---

### 4.11 设置 `/settings`

**用途：** 个人设置，包括生成参数偏好、界面偏好。

**调用 API：**

| 功能 | 端点 |
|------|------|
| 获取偏好 | `GET /api/user/preferences` |
| 保存偏好 | `PUT /api/user/preferences` |
| 获取可用模型 | `GET /api/ai/models` |

---

### 4.12 登录 / 注册

**页面：** `/login`（v1）、`/v2-login`（v2 Glacier）、`/register`

| 功能 | 方法 | 端点 |
|------|------|------|
| 登录 | `POST` | `/api/auth/login` |
| 注册（公开注册时） | `POST` | `/api/auth/register` |
| 检查公开注册状态 | `GET` | `/health`（`public_signup` 字段） |
| SSE 系统公告 | `GET` | `/api/announcements/stream` |
| 当前公告 | `GET` | `/api/announcements/current` |

---

### 4.13 管理后台 `/admin`

仅 `super_admin` 角色可访问。

**前端服务：** `src/services/api/admin.ts`、`src/services/api/seedance-assets.ts`

#### 用户管理

| 功能 | 方法 | 端点 |
|------|------|------|
| 用户列表 | `GET` | `/api/admin/users` |
| 创建用户 | `POST` | `/api/admin/users` |
| 更新用户 | `PUT` | `/api/admin/users/:id` |

#### 模型提供商（单实例模式）

| 功能 | 方法 | 端点 |
|------|------|------|
| 获取预设列表 | `GET` | `/api/admin/model-provider-presets` |
| 获取配置 | `GET` | `/api/admin/model-provider` |
| 更新配置 | `PUT` | `/api/admin/model-provider` |
| 测试连接 | `POST` | `/api/admin/model-provider/test` |
| 获取可用模型 | `POST` | `/api/admin/model-provider/models` |

#### 模型提供商（多实例模式）

| 功能 | 方法 | 端点 |
|------|------|------|
| 提供商列表 | `GET` | `/api/admin/model-providers` |
| 创建提供商 | `POST` | `/api/admin/model-providers` |
| 获取提供商 | `GET` | `/api/admin/model-providers/:id` |
| 更新提供商 | `PUT` | `/api/admin/model-providers/:id` |
| 删除提供商 | `DELETE` | `/api/admin/model-providers/:id` |
| 测试连接 | `POST` | `/api/admin/model-providers/:id/test` |
| 获取可用模型 | `POST` | `/api/admin/model-providers/:id/models` |

#### 系统公告

| 功能 | 方法 | 端点 |
|------|------|------|
| 公告列表 | `GET` | `/api/admin/announcements` |
| 创建公告 | `POST` | `/api/admin/announcements` |
| 重新发布 | `POST` | `/api/admin/announcements/:id/republish` |
| 撤销公告 | `POST` | `/api/admin/announcements/:id/revoke` |

#### 系统监控

| 功能 | 方法 | 端点 |
|------|------|------|
| 系统状态 | `GET` | `/api/admin/monitoring` |

#### Seedance 视频素材管理

| 功能 | 方法 | 端点 |
|------|------|------|
| 素材列表 | `GET` | `/api/admin/seedance-assets` |
| 就绪状态 | `GET` | `/api/admin/seedance-assets/readiness` |
| 上传素材 | `POST` | `/api/admin/seedance-assets/upload` |
| 注册 URL 素材 | `POST` | `/api/admin/seedance-assets/register-url` |
| 同步素材 | `POST` | `/api/admin/seedance-assets/sync` |
| 轮询素材状态 | `POST` | `/api/admin/seedance-assets/poll` |
| 素材标签管理 | `GET/POST/PUT/DELETE` | `/api/admin/seedance-asset-tags` |
| 关联素材与标签 | `POST/DELETE` | `/api/admin/seedance-assets/:id/tags/:tag_id` |

---

## 5. 后端 API 端点完整清单

```
GET    /health

POST   /api/auth/register
POST   /api/auth/login
GET    /api/auth/me                          [Auth]
POST   /api/auth/logout                      [Auth]

GET    /api/user/preferences                 [Auth]
PUT    /api/user/preferences                 [Auth]

GET    /api/admin/users                      [SuperAdmin]
POST   /api/admin/users                      [SuperAdmin]
PUT    /api/admin/users/:id                  [SuperAdmin]
GET    /api/admin/model-provider-presets     [SuperAdmin]
GET    /api/admin/model-provider             [SuperAdmin]
PUT    /api/admin/model-provider             [SuperAdmin]
POST   /api/admin/model-provider/test        [SuperAdmin]
POST   /api/admin/model-provider/models      [SuperAdmin]
GET    /api/admin/model-providers            [SuperAdmin]
POST   /api/admin/model-providers            [SuperAdmin]
GET    /api/admin/model-providers/:id        [SuperAdmin]
PUT    /api/admin/model-providers/:id        [SuperAdmin]
DELETE /api/admin/model-providers/:id        [SuperAdmin]
POST   /api/admin/model-providers/:id/test   [SuperAdmin]
POST   /api/admin/model-providers/:id/models [SuperAdmin]
GET    /api/admin/monitoring                 [SuperAdmin]
GET    /api/admin/announcements              [SuperAdmin]
POST   /api/admin/announcements              [SuperAdmin]
POST   /api/admin/announcements/:id/republish[SuperAdmin]
POST   /api/admin/announcements/:id/revoke   [SuperAdmin]
GET    /api/admin/seedance-assets            [SuperAdmin]
GET    /api/admin/seedance-assets/readiness  [SuperAdmin]
POST   /api/admin/seedance-assets/upload     [SuperAdmin]
POST   /api/admin/seedance-assets/register-url[SuperAdmin]
GET    /api/admin/seedance-assets/:id        [SuperAdmin]
PUT    /api/admin/seedance-assets/:id        [SuperAdmin]
DELETE /api/admin/seedance-assets/:id        [SuperAdmin]
POST   /api/admin/seedance-assets/sync       [SuperAdmin]
POST   /api/admin/seedance-assets/poll       [SuperAdmin]
GET    /api/admin/seedance-asset-tags        [SuperAdmin]
POST   /api/admin/seedance-asset-tags        [SuperAdmin]
PUT    /api/admin/seedance-asset-tags/:id    [SuperAdmin]
DELETE /api/admin/seedance-asset-tags/:id    [SuperAdmin]
POST   /api/admin/seedance-assets/:id/tags/:tag_id  [SuperAdmin]
DELETE /api/admin/seedance-assets/:id/tags/:tag_id  [SuperAdmin]

GET    /api/ai/models                        [Auth]
POST   /api/ai/text                          [Auth]
POST   /api/ai/images/generations            [Auth]
POST   /api/ai/image/generations             [Auth]
POST   /api/ai/images/edits                  [Auth]
POST   /api/ai/image/edits                   [Auth]
POST   /api/ai/videos                        [Auth]
GET    /api/ai/videos/:id                    [Auth]
GET    /api/ai/videos/:id/content            [Auth]
POST   /api/ai/contents/generations/tasks    [Auth]
GET    /api/ai/contents/generations/tasks/:id[Auth]
GET    /api/ai/contents/generations/tasks/:id/content [Auth]
POST   /api/ai/audio/speech                  [Auth]
POST   /api/ai/materials/visual-validate-sessions [Auth]
POST   /api/ai/materials/real-validate-h5    [Auth]
GET    /api/ai/materials/visual-validate-result   [Auth]
POST   /api/ai/materials/groups              [Auth]
GET    /api/ai/materials/groups/:id          [Auth]
DELETE /api/ai/materials/groups/:id          [Auth]
POST   /api/ai/materials                     [Auth]
POST   /api/ai/materials/ensure-active       [Auth]
GET    /api/ai/materials/:id                 [Auth]
DELETE /api/ai/materials/:id                 [Auth]
GET    /api/ai/seedance-assets/mentions      [Auth]
POST   /api/ai/seedance-assets/ensure-active [Auth]

GET    /api/projects                         [Auth]
POST   /api/projects                         [Auth]
GET    /api/projects/:id                     [Auth]
PUT    /api/projects/:id                     [Auth]
DELETE /api/projects/:id                     [Auth]
GET    /api/projects/:id/snapshot            [Auth]
PUT    /api/projects/:id/snapshot            [Auth]

GET    /api/comic-asset-projects             [Auth]
POST   /api/comic-asset-projects             [Auth]
POST   /api/comic-asset-projects/import      [Auth]
GET    /api/comic-asset-projects/:projectId  [Auth]
PUT    /api/comic-asset-projects/:projectId  [Auth]
DELETE /api/comic-asset-projects/:projectId  [Auth]
GET    /api/comic-asset-projects/:projectId/source          [Auth]
POST   /api/comic-asset-projects/:projectId/assets          [Auth]
PUT    /api/comic-asset-projects/:projectId/assets/:assetId [Auth]
DELETE /api/comic-asset-projects/:projectId/assets/:assetId [Auth]
POST   /api/comic-asset-projects/:projectId/assets/:assetId/prompt-preview   [Auth]
PUT    /api/comic-asset-projects/:projectId/assets/:assetId/prompt            [Auth]
POST   /api/comic-asset-projects/:projectId/assets/:assetId/prompt-optimize  [Auth]
POST   /api/comic-asset-projects/:projectId/prompts/bulk-approve              [Auth]
GET    /api/comic-asset-projects/:projectId/generation-batches                [Auth]
POST   /api/comic-asset-projects/:projectId/generation-batches                [Auth]

POST   /api/comic-asset-analysis-sessions                                [Auth]
GET    /api/comic-asset-analysis-sessions/:sessionId                     [Auth]
POST   /api/comic-asset-analysis-sessions/:sessionId/revisions           [Auth]
PUT    /api/comic-asset-analysis-sessions/:sessionId/active-revision     [Auth]
POST   /api/comic-asset-analysis-sessions/:sessionId/confirm             [Auth]

GET    /api/comic-asset-generation-batches/:batchId                      [Auth]
POST   /api/comic-asset-generation-batches/:batchId/pause                [Auth]
POST   /api/comic-asset-generation-batches/:batchId/resume               [Auth]
POST   /api/comic-asset-generation-batches/:batchId/stop                 [Auth]
POST   /api/comic-asset-generation-batches/:batchId/items/:itemId/retry  [Auth]
POST   /api/comic-asset-generation-batches/:batchId/retry-failed         [Auth]

POST   /api/jobs                             [Auth]
GET    /api/jobs                             [Auth]
GET    /api/jobs/:id                         [Auth]
POST   /api/jobs/:id/cancel                  [Auth]
GET    /api/jobs/:id/stream                  [Auth] (SSE)

GET    /api/assets                           [Auth]
POST   /api/assets                           [Auth]
GET    /api/assets/library                   [Auth]
POST   /api/assets/bulk-move                 [Auth]
POST   /api/assets/bulk-tags                 [Auth]
POST   /api/assets/trash-preflight           [Auth]
POST   /api/assets/bulk-trash                [Auth]
GET    /api/assets/trash/library             [Auth]
GET    /api/assets/trash                     [Auth]
POST   /api/assets/bulk-restore              [Auth]
DELETE /api/assets/trash                     [Auth]
GET    /api/assets/:id                       [Auth]
PUT    /api/assets/:id/metadata              [Auth]
GET    /api/assets/:id/content               [Auth]
GET    /api/assets/:id/lineage               [Auth]
GET    /api/assets/:id/stats                 [Auth]
GET    /api/assets/:id/user-state            [Auth]
PUT    /api/assets/:id/user-state            [Auth]
GET    /api/assets/:id/usage-events          [Auth]
GET    /api/assets/:id/tags                  [Auth]
POST   /api/assets/:id/tags                  [Auth]
DELETE /api/assets/:id/tags/:tagId           [Auth]
POST   /api/assets/:id/tags/resync-inherited [Auth]
DELETE /api/assets/:id/permanent             [Auth]
DELETE /api/assets/:id                       [Auth]

GET    /api/tags                             [Auth]
POST   /api/tags                             [Auth]
POST   /api/tags/bulk-move                   [Auth]
POST   /api/tags/bulk-delete                 [Auth]
GET    /api/tags/:tagId                      [Auth]
PUT    /api/tags/:tagId                      [Auth]
DELETE /api/tags/:tagId                      [Auth]
POST   /api/tags/:tagId/move                 [Auth]
POST   /api/tags/:tagId/aliases              [Auth]
DELETE /api/tags/:tagId/aliases/:aliasId     [Auth]
GET    /api/tags/:tagId/assets               [Auth]
GET    /api/tags/:tagId/prompts              [Auth]

GET    /api/asset-folders                    [Auth]
POST   /api/asset-folders                    [Auth]
PUT    /api/asset-folders/:folderId          [Auth]
DELETE /api/asset-folders/:folderId          [Auth]

POST   /api/asset-exports                    [Auth]
GET    /api/asset-exports                    [Auth]
GET    /api/asset-exports/:exportId          [Auth]
POST   /api/asset-exports/:exportId/cancel   [Auth]
GET    /api/asset-exports/:exportId/content  [Auth]

GET    /api/announcements/current            [Auth]
POST   /api/announcements/:id/read           [Auth]
GET    /api/announcements/stream             [Auth] (SSE)
```

---

## 6. 数据模型

### 核心实体关系

```
User
 ├── Projects (canvas_projects)
 ├── Assets (user_assets)
 │    ├── AssetFolders
 │    ├── AssetTags → SemanticTag
 │    ├── AssetLineage (parent/child 关系)
 │    └── AssetUsage (使用记录)
 ├── Jobs (ai_jobs)
 ├── ComicAssetProjects
 │    ├── ComicAssets
 │    └── ComicGenerationBatches
 └── UserPreferences
```

### 关键模型字段

**User**
```go
{ ID, Username, PasswordHash, DisplayName, Role, Status, CreatedAt, UpdatedAt }
```

**Asset**
```typescript
{
  id, user_id, workspace_id, scope,
  type: "image" | "video" | "audio",
  name, url, size, content_type,
  folder_id, category, tags, note,
  source_type, source_project_id, source_job_id,
  content_sha256,
  trashed_at, trash_expires_at,
  usage_stats, user_state
}
```

**Job**
```typescript
{
  id, type, status: "queued"|"running"|"succeeded"|"failed"|"canceled",
  scope, progress, queue_phase,
  result, error, payload,
  created_at, started_at, finished_at
}
```

**SemanticTag**
```typescript
{
  id, name, description, scope_type, scope_key,
  parent_id,           // 树形层级
  asset_enabled, prompt_enabled,
  inherit_mode: "auto" | "manual" | "never",
  aliases, asset_count, prompt_count
}
```

**ModelProviderConfig**
```typescript
{
  id, name, preset_id,
  provider_type: "openai_compatible"|"volcengine_ark"|"gemini_media"|
                 "kling_video"|"minimax_hailuo"|"fal_happyhorse"|"xai_imagine",
  mode, base_url, auth_type,
  text_model, image_model, video_model, audio_model,
  capabilities, models_by_capability, model_protocols,
  timeout_ms, max_concurrency, enabled
}
```

---

## 7. 前端服务层

```
src/services/api/
├── request.ts          # 基础 fetch 封装，Token 管理，超时，错误处理
├── auth.ts             # 认证：login / register / me / logout
├── ai.ts               # AI 文本生成，聚合模型列表
├── image.ts            # 图像生成/编辑（新旧协议），参考图处理
├── video.ts            # 视频生成（OpenAI + Seedance 双通道）
├── audio.ts            # 语音合成
├── jobs.ts             # 通用任务：提交/查询/取消/SSE 流
├── project-canvas.ts   # 画布项目 CRUD，快照
├── assets.ts           # 资产库完整操作
├── tags.ts             # 语义标签树操作
├── comic-assets.ts     # 漫剧资产项目，分析会话，批量生成
├── material.ts         # Seedance Material 素材（用于视频生成）
├── seedance-assets.ts  # Seedance 静态素材管理（管理员）
├── prompts.ts          # 提示词库（本地 Next.js API Route）
├── announcements.ts    # 系统公告，SSE 推送
├── admin.ts            # 管理员：用户/模型提供商/监控
├── user-preferences.ts # 用户偏好（生成参数 + 画布配置）
└── health.ts           # 健康检查
```

**基础请求封装特性（`request.ts`）：**
- 自动附加 Bearer Token
- 请求超时（默认可配置）
- 统一错误转化为 `ApiError`（含 `status`、`requestId`）
- 401 响应自动触发全局登出事件
- 支持 `AbortController` 取消请求

---

## 8. 任务队列架构

```
前端 Canvas / 工作台
    │
    ▼
POST /api/jobs  (Go API)
    │  生成 Job record，写入 PostgreSQL
    │
    ▼
Celery Redis Producer
    │  发布消息到 Redis Queue
    │
    ▼
Python Celery Worker
    │  消费任务，调用外部 AI API
    │  更新 Job 状态到 PostgreSQL
    │
    ▼
SSE / 轮询
GET /api/jobs/:id/stream  (SSE，首选)
GET /api/jobs/:id         (轮询降级，每 3s)
    │
    ▼
前端接收结果 → 更新 Canvas 节点 → 自动归档到资产库
```

**任务类型：**

| type | 说明 |
|------|------|
| `image_generation` | 文生图 |
| `image_edit` | 图生图 |
| `video_generation` | 文生视频 |
| `comic_asset_batch` | 漫剧资产批量生成 |
| `asset_export` | 资产批量导出打包 |

---

## 9. 存储架构

```
存储驱动（STORAGE_DRIVER 环境变量）
├── postgres  生产模式，所有数据持久化
└── memory    开发/测试模式，重启后数据丢失

资产文件存储（本地文件系统）
  ASSET_STORAGE_DIR（默认 /app/data/assets）
  ├── personal/<user_id>/        用户私有资产
  └── jobs/<job_id>/             任务输出文件

公开资产访问
  PUBLIC_ASSET_BASE_URL → 直接 URL 访问资产文件
  GET /api/assets/:id/content   → 受认证保护的内容下载

导出
  asset-export-worker 进程处理导出任务
  生产环境独立进程（docker-compose asset-export-worker 服务）
  开发/memory 模式由 API 进程内联调度
```

---

## 10. 部署架构

### Docker Compose 服务拓扑

```
docker-compose.yml
├── postgres          PostgreSQL 15  (port 55432 外部)
├── redis             Redis 7        (port 6379 外部)
├── api               Go API         (port 3101 外部)
│                     depends: postgres + redis
├── worker            Python Celery  (port 8101 health)
│                     depends: postgres + redis
├── asset-export-worker  Go 进程     (无外部端口)
│                     depends: api
└── web               Next.js        (port 3100 外部，生产)
                      depends: api + asset-export-worker
```

### 开发模式

```
Docker Compose 管理: postgres + redis + api + worker + asset-export-worker
本地运行: Next.js dev server  (port 3200, pnpm dev)
NEXT_PUBLIC_API_URL=http://localhost:3101
FRONTEND_URLS=...,http://localhost:3200  (CORS 白名单)
```

### 环境变量（关键）

| 变量 | 说明 |
|------|------|
| `NEXT_PUBLIC_API_URL` | 前端访问后端的 URL |
| `FRONTEND_URLS` | 后端 CORS 白名单（逗号分隔） |
| `APP_SECRET` | JWT 签发密钥 |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `CELERY_BROKER_URL` | Redis 连接串 |
| `ASSET_STORAGE_DIR` | 资产文件存储目录 |
| `PUBLIC_ASSET_BASE_URL` | 资产公开访问基础 URL |
| `ALLOW_PUBLIC_SIGNUP` | 是否开放公开注册 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 超管初始账号（首次启动引导） |

---

*文档由代码自动整理生成，如有变更请同步更新本文件。*
