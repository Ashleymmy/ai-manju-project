# AI 漫工坊原型核对文档

> 核对时间：2026-08-14 | 原型路径：`ai-manhua-studio/`

---

## 一、API 接口核对

### 1.1 原型已实现的服务层

| 文件 | 已覆盖端点 | 状态 |
|------|-----------|------|
| `services/api/request.ts` | 基础 fetch 封装、Token 管理（`ai-manju:token`）、超时、401 事件 | ✅ 完整 |
| `services/api/auth.ts` | `POST /api/auth/login`, `register`, `GET /api/auth/me`, `POST /api/auth/logout` | ✅ 完整 |
| `services/api/projects.ts` | `/api/projects` CRUD + snapshot, `getComicProjects`（仅列表） | ✅ 基础完整 |
| `services/api/assets.ts` | 资产库、上传、详情、metadata、lineage、user-state | ⚠️ 部分覆盖 |
| `services/api/preferences.ts` | `GET/PUT /api/user/preferences`, `GET /api/ai/models` | ✅ 完整 |
| `services/api/catalog.ts` | `getTags`（仅列表）、`getPromptLibrary`、`getAdminMonitoring`、`getHealth` | ⚠️ 极简占位 |

### 1.2 原型完全缺失的服务文件

以下是主项目有、原型完全没有的服务层：

| 缺失文件 | 对应功能 | 影响页面 |
|---------|---------|---------|
| `services/api/image.ts` | 图像生成/编辑，参考图压缩上传 | `/image`、`/canvas` |
| `services/api/video.ts` | 视频生成（OpenAI + Seedance 双通道） | `/canvas`、`/comic-assets` |
| `services/api/jobs.ts` | 任务提交、查询、取消、SSE 流 | `/queue`、全部生成页 |
| `services/api/comic-assets.ts` | 分析会话、漫剧项目完整 CRUD、批量生成 | `/comic-assets` |
| `services/api/tags.ts` | 标签完整 CRUD（目前仅 `getTags` 列表） | `/tags` |
| `services/api/admin.ts` | 用户管理、模型提供商 CRUD、公告管理 | `/admin` |
| `services/api/announcements.ts` | 系统公告、SSE 推流 | 登录页、全局 |
| `services/api/material.ts` | Seedance 素材验证 | `/canvas` 视频生成 |
| `services/api/seedance-assets.ts` | Seedance 静态素材管理 | `/admin` |

还缺失的端点（assets.ts 中未覆盖）：

- 标签操作：`GET/POST/DELETE /api/assets/:id/tags`、`POST .../resync-inherited`
- 回收站全套：trash-preflight、bulk-trash、bulk-restore、`DELETE /api/assets/trash`
- 批量操作：`bulk-move`、`bulk-tags`
- 导出全套：`/api/asset-exports/*`
- 文件夹 CRUD：`/api/asset-folders/*`
- 使用记录：`GET /api/assets/:id/usage-events`

### 1.3 Token Key 不一致

| 位置 | Key 名 |
|------|--------|
| 原型 `request.ts` | `ai-manju:token` |
| 主项目 `apps/web` | `ai-manju:auth_token` |

如果直接以原型为基础，现有已登录用户的 token 会丢失，需统一。

### 1.4 `lib/api-contract.ts` 与实际端点的差距

原型的 `apiContract` 对象只覆盖了约 15% 的后端端点，仅起文档展示作用，不影响运行，但需要扩充。

---

## 二、功能展示组件核对（Mock vs 真实）

### 2.1 路由 → 组件 → 数据来源总表

| 路由 | 渲染组件 | 数据来源 | 是否 Mock |
|------|---------|---------|-----------|
| `/` | `Home.tsx` → `Dashboard()` | 硬编码 `projectCards[]`、`jobs[]`、`StatStrip` 数字 | ❌ 全 Mock |
| `/projects` | `Home.tsx` → `Projects()` | 同一份 `projectCards[]` 复制 | ❌ 全 Mock |
| `/canvas` | `Home.tsx` → `Canvas()` | 硬编码 nodes 数组，无真实项目加载 | ❌ 全 Mock |
| `/director` | `FeatureViews.tsx` → `DirectorView` | 静态图片 + local state | ❌ 全 Mock |
| `/comic-assets` | `FeatureViews.tsx` → `ComicAssetsView` | 静态 `candidates[]` + local state | ❌ 全 Mock |
| `/image` | `FeatureViews.tsx` → `ImageWorkbenchView` | local state，生成只 toast | ❌ 全 Mock |
| `/queue` | `Home.tsx` → `Queue()` | 硬编码 `jobs[]` 数组 | ❌ 全 Mock |
| `/assets` | `FeatureViews.tsx` → `AssetLibraryView` | 静态 `libraryAssets[]` | ❌ 全 Mock |
| `/tags` | `FeatureViews.tsx` → `TagLibraryView` | 静态 `tagGroups[]` | ❌ 全 Mock |
| `/prompts` | `FeatureViews.tsx` → `PromptLibraryView` | 静态 `promptTemplates[]` | ❌ 全 Mock |
| `/settings` | `SystemViews.tsx` → `SettingsView` | local state，保存只 toast | ❌ 全 Mock |
| `/admin` | `SystemViews.tsx` → `AdminView` | 静态 `adminRows[]`、硬编码 providers | ❌ 全 Mock |
| `/login` `/register` `/v2-login` | `SystemViews.tsx` → `AuthView` | 提交只 navigate("/")，无真实调用 | ❌ 全 Mock |

**总结：所有 13 条路由的页面内容 100% 是 Mock 数据，没有一条路由实现了端到端的真实数据流。**

### 2.2 存在但未接入路由的真实组件

| 文件 | 状态 |
|------|------|
| `pages/Dashboard.tsx` | 接入了 `useWorkspaceDashboardData`（真实 API）✅，但路由 `/` 渲染的是 `Home.tsx` 内的同名 `Dashboard` 函数（Mock）❌，该文件是死代码 |
| `components/StudioShell.tsx` | 接入了 `getCurrentUser()` 和 `logout()` ✅，但主应用布局用的是 `Home.tsx` 内的 `SideRail`（Mock），该文件也是死代码 |

### 2.3 各页面需要替换的具体内容

**工作台 `/`**
- 替换：`projectCards[]` → `getProjects()` + `getComicProjects()`
- 替换：`jobs[]` → `getJobs({ status: 'running', status: 'queued' })`
- 替换：`StatStrip` 硬编码数字 → 合并 API 响应的 total 字段
- 替换：`Timeline` 手写条目 → 真实运行中 job 列表
- 替换：`SideRail` 用户信息（"林叙"、"61%额度"）→ `getCurrentUser()` + preferences

**全部项目 `/projects`**
- 替换：`projectCards[]` → `getProjects()` 分页列表
- 新增：创建、删除、归档操作对接真实 API

**画布 `/canvas`**
- 全量重写：需引入 Leafer.js（主项目已有完整实现）
- 加载项目：`getProject(id)` + `getProjectSnapshot(id)`
- 自动保存：`saveProjectSnapshot(id, data)`
- 提交生成：`POST /api/jobs` + SSE 订阅（需实现 `jobs.ts` 服务）
- 节点结果归档：`uploadAsset()`

**漫剧资产助手 `/comic-assets`**
- 全量重写数据层：依赖缺失的 `comic-assets.ts` 完整服务
- 剧本上传 → 分析会话 → 候选审核 → 批次生成的完整流程

**关键帧生成 `/image`**
- 提交生成：需实现 `image.ts`，对接 `POST /api/jobs` 新协议
- 结果展示：轮询 / SSE job 状态
- 参考图上传：`uploadAsset()`

**渲染队列 `/queue`**
- 替换：`jobs[]` → `getJobs()` 分页 + 筛选
- SSE 订阅：`GET /api/jobs/:id/stream`
- 取消：`POST /api/jobs/:id/cancel`

**资产库 `/assets`**
- 替换：`libraryAssets[]` → `getAssetLibrary()` 分页
- 回收站、批量操作、导出对接（需扩充 assets.ts）
- 血缘、使用记录调用真实端点

**标签库 `/tags`**
- 替换：`tagGroups[]` → `getTags()` 树形结构
- 完整 CRUD（需新增 `tags.ts`）

**设置 `/settings`**
- 替换：local state → `getPreferences()` 加载 + `updatePreferences()` 保存
- 模型选项：`getModels()` 动态获取

**管理后台 `/admin`**
- 全量替换：需新增 `admin.ts` 完整服务
- 用户、提供商、公告、监控均需真实 API

**登录页**
- 替换：`navigate("/")` → `login()` 真实调用 + 错误处理
- 公告区域：接入 `GET /api/announcements/current`

---

## 三、技术栈核对

### 3.1 原型 vs 主项目对比

| 维度 | 原型 (`ai-manhua-studio`) | 主项目 (`apps/web`) |
|------|--------------------------|---------------------|
| **框架** | Vite + React 19 SPA | Next.js 16.2.3 (App Router) |
| **路由** | Wouter 3.x（客户端） | Next.js App Router（文件系统） |
| **UI 组件库** | Radix UI + shadcn/ui | Ant Design 6.x |
| **样式** | Tailwind CSS v4 | Tailwind CSS v4 |
| **状态管理** | useState + Context | Zustand |
| **Canvas 引擎** | 无（纯 UI Mock） | Leafer.js（完整接入） |
| **图标** | Lucide React 0.453 | Lucide React |
| **表单** | React Hook Form + Zod | 未统一（Ant Design Form） |
| **动效** | Framer Motion | 未使用 |
| **SSR/RSC** | 无 | 有（Next.js） |
| **Auth 中间件** | 无（客户端守护） | Next.js middleware |
| **Token Key** | `ai-manju:token` | `ai-manju:auth_token` |
| **构建工具** | Vite 7 | Next.js (Turbopack) |
| **服务端** | Express 静态托管 | Next.js 内置 |

### 3.2 需要决策的技术栈分歧

**① 框架（最关键）**

原型是纯 SPA，不涉及 SSR。如果以原型为基地重构，有两条路：

- **方案 A：保留 Vite SPA** — 放弃 Next.js 的 SSR、Middleware、Image Optimization，对当前项目影响有限（后台工具类产品 SEO 不是诉求），维护简单，与原型代价最小。
- **方案 B：迁移到 Next.js App Router** — 需要把 Wouter 路由改为文件系统路由，把 `vite.config.ts` 换成 `next.config.ts`，成本约 1-2 天，但长期更灵活。

**② UI 组件库**

原型用的是 Radix UI + shadcn/ui，主项目用的是 Ant Design 6.x。两者不兼容。由于原型的设计语言（影印分镜室）已完整基于 shadcn/ui 实现，**迁移方向应是从 Ant Design 切换到 shadcn/ui**，而不是反向。

**③ Leafer.js Canvas**

原型完全没有 Canvas 实现，`/canvas` 只是一个静态 UI。需要从主项目移植 Leafer.js 的完整集成层（节点序列化、手势处理、生成挂载点等）。这是重构中工作量最大的单个模块。

**④ Zustand**

原型目前用 `useState` + Context 管理局部状态，没有全局状态。主项目有 Zustand store（canvas 状态、auth 状态等）。重构时需引入 Zustand 管理全局 auth + canvas 状态。

**⑤ Manus 特有工具链（需清除）**

原型的 `vite.config.ts` 包含大量 Manus 平台专有插件和 storage proxy：
- `vite-plugin-manus-runtime`
- `vitePluginManusDebugCollector`（`/__manus__/logs` 端点）
- `vitePluginStorageProxy`（`/manus-storage/` 代理，依赖 `BUILT_IN_FORGE_API_URL`）
- 静态资源引用：`/manus-storage/ai-manhua-logo_32ef177b.png` 等

所有 `/manus-storage/xxx` 图片引用在本地环境无法加载，需替换为本地资产或 CDN 地址。这些 Manus 工具链配置全部需要移除。

---

## 四、以原型为基础直接重构的可行性

### 4.1 可以直接复用的部分

| 内容 | 可复用程度 |
|------|-----------|
| 设计语言定义（`ideas.md`） | ✅ 完整，是最有价值的输出 |
| 全套 shadcn/ui 组件库（`components/ui/`） | ✅ 完整可复用 |
| CSS 样式体系（`index.css`、`final-refinement.css`） | ✅ 可直接沿用 |
| 路由结构（App.tsx 中的路由表） | ✅ 与主项目一致 |
| 基础请求封装（`request.ts`） | ✅ 仅需改 Token Key |
| 认证服务（`auth.ts`） | ✅ 完整 |
| 项目服务（`projects.ts`） | ✅ 完整 |
| 偏好服务（`preferences.ts`） | ✅ 完整 |
| 页面结构骨架（`SideRail`、`TopBar`、`PageIntro` 等布局组件） | ✅ 可复用，只需替换数据 |
| 导航定义（`creationNav`、`libraryNav`、`systemNav`） | ✅ 完整 |
| 页面标题/副标题文案（`pageTitles`） | ✅ 完整 |

### 4.2 必须新增 / 重写的部分

| 内容 | 工作量估算 |
|------|-----------|
| 补全 9 个缺失的 service 文件 | 中（逻辑简单，大量 copy from 主项目） |
| 补全 assets.ts 中缺失的 ~20 个端点 | 小 |
| 统一 Token Key | 极小（1 行） |
| 替换所有 Mock 数据为真实 API 调用 | 大（13 个路由，每个页面都要改） |
| 引入 Zustand（auth + canvas 状态） | 小-中 |
| 移植 Leafer.js 画布实现 | 大（Canvas 最复杂） |
| 实现 SSE 订阅（Queue、Job 状态流） | 中 |
| 删除 Manus 工具链，替换 `/manus-storage/` 图片 | 小 |
| 页面实现：`pages/Dashboard.tsx` 已有，接入路由 | 极小 |
| `StudioShell.tsx` 已有真实 auth，接入路由 | 小 |

### 4.3 可行性结论

**可行，但不等于"低成本"。**

- 原型的价值在于**设计系统已完全落地**（色彩、排版、组件、布局范式），不需要从头定义视觉语言。
- 以原型为基础重构的核心工作是**数据层全量替换**，即用真实 API 调用替换所有 Mock 数据。这部分工作是刚性的，无论从原型出发还是从主项目出发都要做。
- **推荐方案：以原型为基础 + 从主项目迁移核心逻辑**

  具体来说：
  1. 以 `ai-manhua-studio` 为新 codebase 基础（保留设计系统）
  2. 从主项目 `apps/web/src/services/api/` 迁移完整服务层（9 个文件 copy + 适配）
  3. 从主项目移植 Leafer.js canvas 引擎（1 个复杂模块）
  4. 页面组件按路由逐个接入真实数据，Mock 层随用随换
  5. 框架选 Vite SPA 还是 Next.js 是唯一需要提前决定的架构决策

- **不推荐**在主项目（Next.js）上直接用 shadcn/ui 替换 Ant Design，代价远高于从原型出发。

---

## 五、迁移优先级建议

如果以原型为基础开始，按以下顺序推进风险最低：

```
第一阶段（1-2 天）：基础接通
  1. 清除 Manus 工具链，替换 /manus-storage/ 图片为本地资产
  2. 统一 Token Key → ai-manju:auth_token
  3. 将 StudioShell.tsx 接入主路由（替换 Home.tsx 的 SideRail）
  4. 将 pages/Dashboard.tsx 接入 / 路由（替换 Home.tsx 的 Dashboard）
  5. 登录页对接真实 login() 调用

第二阶段（2-3 天）：服务层补全
  6. 从主项目迁移 jobs.ts、image.ts、tags.ts、admin.ts 等 9 个文件
  7. 补全 assets.ts 中的回收站、批量、导出端点

第三阶段（3-5 天）：页面数据层逐路由替换
  8. /projects → getProjects() 真实列表
  9. /queue → getJobs() + SSE
  10. /assets → getAssetLibrary() + 完整操作
  11. /tags → getTags() 树 + CRUD
  12. /settings → getPreferences() / updatePreferences()
  13. /image → image.ts 生成流程
  14. /admin → admin.ts 全套
  15. /comic-assets → comic-assets.ts 全套

第四阶段（5-7 天）：Canvas 重实现
  16. 引入 Leafer.js，移植主项目 canvas 引擎
  17. /canvas/:id 加载项目快照、节点系统、自动保存
  18. Canvas 节点挂接图像生成（jobs.ts SSE）
```

---

*仅为核对文档，未修改任何代码。*
