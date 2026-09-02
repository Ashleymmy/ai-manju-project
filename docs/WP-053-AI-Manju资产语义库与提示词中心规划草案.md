# WP-053：AI-Manju 资产语义库、标签库、提示词中心与统一入库规划草案

- **项目**：AI-Manju
- **状态**：规划草案，等待用户审核
- **规划日期**：2026-08-10
- **本轮范围**：只制定计划，不修改业务源码、不迁移数据、不部署服务
- **依赖基线**：WP-044 资产文件夹/来源/分类、WP-047 回收站/导出/画布体验及当前 3100/3101 正式开发环境

## 1. 目标与已确认决策

本计划把近期资产库、标签库、公共/私人提示词和个人主页需求收敛为一套服务端真源，解决当前标签只是字符串、公共/私人提示词割裂、画布入库双轨、自动归档不透明及大资产量下检索困难的问题。

已确认：

1. 文件夹继续负责纵向归档，标签负责跨目录、多维语义检索，两者并存。
2. 标签首期为单父级树；单父级只限制标签结构，资产可绑定不同分支的任意多个标签。
3. 同一标签可用于资产和提示词，但资产绑定与提示词绑定必须分表，统计、删除和权限互不影响。
4. 衍生图片是独立 Asset；它在创建时继承输入资产允许继承的标签，同时保存输入资产血缘。
5. 继承采用创建时快照，不因上游资产后续改标签而静默变化；用户可在子资产上独立调整。
6. 私人提示词库放入个人主页，不新增独立一级导航；公共提示词库保留独立页面。
7. 所有登录用户都可把私人提示词直接发布到公共提示词库，不设置发布前人工审批。
8. 公共发布产生不可变公共版本；私人版本后续修改不自动覆盖已发布内容。
9. 资产调用次数定义为“资产作为生成输入且成功创建 Job”的次数；画布引用、下载、导出和衍生数量分别统计。
10. 收藏与踩为用户个人状态，互斥、可取消；不公开用户身份，只展示授权范围内的匿名汇总。
11. 公共说明与个人备注分开：现有 Asset note 继续作为共享元数据，新增仅本人可见的个人备注。
12. 画布成功生成的正式结果继续自动持久化，避免结果丢失，但必须明确提示归档位置。
13. 画布自动归档调整为 `系统归档/画布工坊/{项目}/{YYYY-MM-DD}`，默认业务时区为 `Asia/Shanghai`。
14. 从资产库加入画布只建立引用，不重复入库；节点已有 Asset ID 时按钮改为查看/整理资产。
15. 不调用付费 Provider，不执行真人、TokenSpace 或 Seedance 真人业务。

## 2. 当前状态与根因

| 模块 | 当前状态 | 本计划需要解决的问题 |
|---|---|---|
| 资产文件夹 | 已有系统目录、用户目录、来源、分类、分页、回收站和后台导出 | 画布项目目录下缺日期层，自动入库缺提示 |
| 资产标签 | `assets.tags` 为 JSONB 字符串数组 | 无独立标签实体、层级、别名、权限、用途和来源 |
| 资产检索 | 支持目录、类型、分类、来源、项目、日期和字符串 LIKE | 无标签后代检索、标签组合、标签计数和统一语义索引 |
| 手动上传 | 选择图片时立即上传，保存时再更新元数据并写本地 Store | 取消弹窗可能留下服务端资产，本地/服务端双轨 |
| 画布加入资产库 | 图片/视频/文本主要调用本地 `addAsset` | 跨设备不可见，可能与 Worker 已注册 Asset 重复 |
| 生成结果 | Worker 可自动注册服务端 Asset | 用户不知道为什么入库，同一项目资产长期堆积 |
| 资产血缘 | 有项目、批次、Job 等来源字段，部分引用模型已存在 | 缺通用父子 Asset 衍生边和标签继承来源 |
| 资产互动 | 有共享 `note` | 无个人备注、收藏、踩及汇总统计 |
| 资产统计 | 无统一调用事件与汇总 | 无法稳定展示调用、引用、衍生、下载和导出次数 |
| 公共提示词 | Web `/api/prompts` 运行时读取多个 GitHub 数据源并使用内存缓存 | 非服务端持久化，无作者、版本、发布、收藏和稳定检索 |
| 私人提示词 | `user_preferences.canvas.promptPresets` JSON | 无独立记录、版本、发布关系及个人主页管理 |
| 用户资料 | User 已有部分名称/头像字段，但普通用户缺完整资料编辑接口 | 无个人主页、私人内容管理和统计面板 |

当前最大的逻辑冲突是：服务端已经把部分生成结果注册为 Asset，但画布“加入资产库”仍可能只创建浏览器本地记录。规划必须先统一入库真源，再建设标签和统计，否则新页面会继续展示不一致数据。

## 3. 目标信息架构

```text
/assets                 资产库：目录、筛选、统计、反馈、血缘
/tags                   标签库：树、搜索、用途、计数、管理
/tags/:tagId            单标签页：资产、提示词、子标签、别名
/prompts                公共提示词库与结构化拼接器
/profile                私有个人管理中心
  ├─ overview           概览和统计
  ├─ prompts            私人提示词
  ├─ published-prompts  我发布的公共提示词
  ├─ tags               我创建/管理的标签
  ├─ favorites          收藏资产
  ├─ feedback           踩过的资产和个人备注
  └─ preferences        跳转或嵌入现有设置
```

现有 `/settings` 保留为设置真源；个人主页只提供聚合入口，不复制两套偏好保存逻辑。

## 4. 核心领域规则

### 4.1 文件夹、分类和标签

- 每个 Asset 继续只属于一个逻辑文件夹，移动目录不改变物理文件和 URL。
- 现有 `category` 暂时保留，继续承担人物、场景、服饰、道具、UI 等固定业务主分类。
- 标签承担性别、年龄、职业、服装、风格、时代、光线、色调等多维属性。
- 选择父标签检索时包含其全部后代；多个标签默认提供 AND/OR 两种模式，默认 AND。
- 标签树首期最大深度建议 8；禁止循环和跨权限范围移动。

### 4.2 标签用途和可见范围

标签本体增加两个独立维度：

```text
usage:
  asset_enabled
  prompt_enabled

scope:
  system       平台内置，只读
  public       全局可用
  workspace    当前个人/团队 workspace 可用
  user         当前用户私人提示词可用
```

至少启用一种 usage。资产只能绑定 system/public/当前 workspace 可用标签；私人提示词可绑定 system/public/本人 user 标签。用户在资产流程中现场新建的标签默认归当前 workspace；公共标签发布治理不纳入首期。

为避免同名冲突，唯一性使用 `scope_key + parent_id + normalized_name`，并通过 alias 解决同义词，不使用显示名称作为业务主键。

### 4.3 衍生资产与标签继承

示例：

```text
人物图 A：人物、女性、古装
场景图 B：场景、宫殿、夜景

A + B 生成图片 C：
人物、女性、古装、场景、宫殿、夜景 + C 自己新增的标签
```

规则：

- C 获得新的 Asset ID、文件、归档目录、来源和统计。
- 创建 C 时从所有输入资产复制可用于资产且 `inherit_mode=auto` 的有效标签。
- 相同标签来自多个输入时前端只展示一枚，但保留全部来源。
- 继承后不与上游动态同步；可提供显式“重新同步输入标签”。
- 用户在 C 上移除继承标签只影响 C，并保存 suppressed 状态，避免重试或对账再次静默加回。
- 文件夹、备注、审核状态、回收站状态、Job 状态等不作为标签继承。

### 4.4 调用和互动口径

| 指标 | 计数时点 |
|---|---|
| `generation_use_count` | 资产作为输入且 Job 创建成功，每个 Job/Asset 只计一次 |
| `active_reference_count` | 当前仍有效的画布/项目引用数 |
| `derived_asset_count` | 当前资产作为父资产产生的独立子资产数 |
| `download_count` | 授权下载请求成功返回内容 |
| `export_count` | 资产实际进入成功或部分成功导出包 |
| `favorite_count` | 当前有效收藏用户数 |
| `dislike_count` | 当前有效踩用户数 |
| `last_used_at` | 最近一次 generation/reference/download/export 有效事件 |

页面浏览、缩略图加载、列表刷新不计数。收藏与踩互斥；个人备注不进入公共搜索，不出现在导出清单中，除非用户明确勾选“包含我的私人备注”。

## 5. 数据模型

所有新增表均包含 `created_at/updated_at`，使用增量迁移和必要索引；Gorm 与 Memory 实现行为一致。

### 5.1 标签域

`Tag`

```text
id
scope_type                 system/public/workspace/user
scope_key                  global/workspace_id/user_id
created_by
parent_id                  单父级
name
normalized_name
description
asset_enabled
prompt_enabled
inherit_mode               auto/manual/never
status                     active/archived
sort_order
```

`TagClosure`

```text
ancestor_id
descendant_id
depth
```

使用 closure table 支持任意层级后代查询；移动标签必须在事务中重建受影响闭包。

`TagAlias`

```text
id
tag_id
alias
normalized_alias
```

### 5.2 资产/提示词标签关系

`AssetTagBinding`

```text
id
workspace_id
asset_id
tag_id
state                      active/suppressed
created_by
```

唯一约束：`asset_id + tag_id`。

`AssetTagOrigin`

```text
id
binding_id
origin_type                direct/inherited/ai_suggested/system/migrated
source_asset_id
source_job_id
source_node_id
```

同一 binding 可有多个来源，用于多输入资产继承去重与追踪。

`PromptTagBinding`

```text
id
prompt_id
tag_id
created_by
```

提示词标签和资产标签关系分表，删除某一侧关系不影响另一侧。

### 5.3 资产血缘与内容摘要

`AssetLineage`

```text
id
workspace_id
parent_asset_id
child_asset_id
relation_type              generation/edit/crop/annotation/compress/import
source_project_id
source_node_id
source_job_id
input_ordinal
```

Asset 增加可空字段：

```text
content_sha256             用于重复提示和幂等核对，不作为 Asset 身份
ingestion_mode             automatic/manual/migrated
```

同一二进制可在用户明确选择时形成不同逻辑 Asset；首期不引入物理 Blob 引用计数，不以去重为由破坏独立资产语义。

### 5.4 使用事件和汇总

`AssetUsageEvent`

```text
id
workspace_id
asset_id
user_id
event_type                 generation/reference/download/export
context_type               job/canvas/project/export
context_id
idempotency_key
occurred_at
```

`AssetUsageAggregate`

```text
asset_id
generation_use_count
active_reference_count
derived_asset_count
download_count
export_count
favorite_count
dislike_count
last_used_at
```

列表只读取汇总表，不逐卡片 COUNT。事件写入使用幂等键；提供可重复执行的 reconciliation 重算任务。

### 5.5 用户资产状态

`AssetUserState`

```text
asset_id
user_id
workspace_id
reaction                    none/favorite/dislike
private_note                text
created_at
updated_at
```

唯一约束：`asset_id + user_id`。个人备注仅本人可读；团队资产的共享说明继续使用现有 Asset note。

### 5.6 提示词域

`PromptEntry`

```text
id
owner_user_id
visibility                  private/public
status                      draft/published/withdrawn/hidden/trashed
kind                        fragment/template
part_type                   style_prefix/actual_description/color_atmosphere/extension_modifier/full_template
title
summary
cover_asset_id
current_revision_id
forked_from_prompt_id
published_from_prompt_id
source_type                 user/external_import/system
source_url
```

`PromptRevision`

```text
id
prompt_id
version
parent_revision_id
content
structured_content          JSONB，保留未来组合结构
created_by
published_at
```

`PromptUserState`

```text
prompt_id
user_id
favorite
```

公共版本不可变；作者修改公共条目时创建新 revision。其他用户只能收藏、复制或 fork 到私人库，不能直接改公共原文。

### 5.7 用户资料

User 在保持旧字段兼容的前提下补充：

```text
bio
profile_visibility          首期固定 private
```

头像继续复用现有 Asset/URL 能力，但必须校验当前用户有权读取；普通用户可编辑自己的显示名称、头像和简介。

## 6. 统一入库与按日归档

### 6.1 唯一服务端入库编排

手动上传、画布、本地编辑、模型 Worker、漫剧助手和工作台最终都调用同一 Asset ingestion service。旧 `POST /api/assets` 保持兼容，但内部改走统一服务。

入库输入统一包含：

```text
workspace
file/existing_asset_id
name/type/content_type
folder/category/tag_ids
source_type/project/batch/item/job/node
parent_asset_ids
ingestion_mode
idempotency_key
```

### 6.2 手动上传

```text
选择或拖入文件
→ 浏览器本地预览、类型/大小校验
→ 填写目录、分类、标签、共享说明
→ 用户确认
→ 上传并在同一服务流程创建资产
```

- 用户取消前不创建正式 Asset。
- 大文件/批量上传可建立临时会话，未确认文件按 TTL 清理。
- 每项独立进度、失败重试和结果；单项失败不回滚其它成功项。
- 检测到相同 SHA-256 时提示复用已有资产或创建独立记录，不静默覆盖。

### 6.3 画布加入资产库

```text
节点已有 Asset ID
→ 不上传、不复制
→ 建立/刷新引用
→ 打开资产详情或整理归档

节点无 Asset ID，但 storage key 可解析到服务端 Asset
→ 复用服务端资产并回写节点 Asset ID

节点只有本地 Blob/Data URL
→ 用户确认元数据后上传
→ 创建 Asset
→ Asset ID 回写节点和画布快照

节点内容经过压缩、裁剪、标注等改变
→ 创建新的衍生 Asset
→ 写 AssetLineage 和继承标签
```

同一项目/节点/内容版本使用稳定幂等键，重复点击、刷新和 API 重试不得产生重复逻辑资产。

### 6.4 画布自动归档

新增系统目录类型：

```text
system_key: canvas_project_date
source_ref_type: canvas_project_date
source_ref_id: {project_id}:{YYYY-MM-DD}
```

目标路径：

```text
系统归档/画布工坊/{项目名称}/{YYYY-MM-DD}
```

无项目 ID 时进入：

```text
系统归档/画布工坊/未归属画布/{YYYY-MM-DD}
```

日期使用配置项 `ASSET_ARCHIVE_TIMEZONE`，默认 `Asia/Shanghai`。资产首次创建后目录冻结；用户手工移动后，对账和重试不能将其移回系统目录。

画布生成成功后显示“已自动归档至 …”，提供打开目录、查看资产和移动目录。节点已有 Asset ID 时将“加入资产库”替换为“查看资产/整理归档”。

## 7. 公共接口规划

全部接口沿用登录鉴权、workspace 隔离和 `{success,data,error,request_id}` 响应信封。

### 7.1 标签

```text
GET    /api/tags
POST   /api/tags
GET    /api/tags/:tagId
PUT    /api/tags/:tagId
POST   /api/tags/:tagId/move
POST   /api/tags/:tagId/aliases
DELETE /api/tags/:tagId/aliases/:aliasId
GET    /api/tags/:tagId/assets
GET    /api/tags/:tagId/prompts

POST   /api/assets/:assetId/tags
DELETE /api/assets/:assetId/tags/:tagId
POST   /api/assets/bulk-tags
POST   /api/assets/:assetId/tags/resync-inherited
```

`GET /api/tags` 支持 scope、usage、parent、keyword、include_descendants、page/page_size 和计数摘要。

### 7.2 资产统计和个人状态

```text
GET  /api/assets/:assetId/stats
GET  /api/assets/:assetId/lineage
GET  /api/assets/:assetId/user-state
PUT  /api/assets/:assetId/user-state
GET  /api/assets/:assetId/usage-events
```

普通用户只能看到自己有权访问的资产统计和自己的状态；usage-events 默认仅返回脱敏摘要。

资产列表新增可选筛选：

```text
tag_ids
tag_match=and|or
include_tag_descendants
favorite
disliked
used_from/used_to
sort=popular|recently_used|...
```

### 7.3 提示词

保持现有公共列表字段兼容，并把服务端变为真源：

```text
GET    /api/prompts
GET    /api/prompts/:promptId
POST   /api/prompts/:promptId/fork
POST   /api/prompts/:promptId/favorite
DELETE /api/prompts/:promptId/favorite

GET    /api/user/prompts
POST   /api/user/prompts
GET    /api/user/prompts/:promptId
PUT    /api/user/prompts/:promptId
DELETE /api/user/prompts/:promptId
POST   /api/user/prompts/:promptId/publish
POST   /api/user/prompts/:promptId/withdraw

POST   /api/prompts/compose-preview
```

Web 现有 Next `/api/prompts` 在迁移期改为兼容代理或退化层，不再运行时从多个 GitHub 仓库拼接为唯一真源。

### 7.4 个人资料

```text
GET /api/user/profile
PUT /api/user/profile
GET /api/user/profile/stats
```

## 8. 页面与交互安排

### 8.1 资产库

- 左侧继续显示系统归档和我的文件夹，并展开画布项目的日期子目录。
- 顶部提供全局搜索、目录内搜索和标签条件构建器。
- 标签筛选按性别、年龄、职业、服饰、风格等父标签分组，支持收起和多选。
- 资产卡片显示调用、引用、衍生、收藏、踩和最近使用摘要。
- 卡片支持收藏、踩、快速个人备注；收藏与踩互斥。
- 详情抽屉增加共享说明、个人备注、标签来源、统计、输入资产、衍生资产和归档提示。
- 增加“我的收藏”“我踩过的”“未使用资产”“高频使用”快捷视图。
- 列表只加载摘要和缩略图，不为不可见卡片加载原始大图。

### 8.2 标签库

- 左侧树展示层级，右侧展示标签说明、用途、别名和资产/提示词计数。
- 支持搜索名称和别名、创建子标签、移动、排序和归档。
- 单标签页分为“关联资产”“关联提示词”“子标签”“管理记录”。
- 资产/提示词计数分别展示，不因一个标签同时支持两种用途而混淆。
- 系统/公共标签显示权限标识；无权限用户只能绑定和检索，不能编辑。

### 8.3 公共提示词库

- 公共列表按 `风格类型前缀/实际描述/色调氛围/延展修改/完整模板` 分类。
- 支持标签树、关键词和作者筛选。
- 拼接器允许用户分别选择各类片段，预览最终组合文本，再复制、送入画布或保存到私人库。
- 首期以人工结构化和人工标签为准，不自动调用 AI 拆分历史提示词。
- 公共条目展示作者、版本、标签、收藏量、来源和 fork 关系。

### 8.4 个人主页

- 私人提示词在个人主页中创建、编辑、排序、标签化和删除。
- 发布时选择 fragment/template 和 part_type，展示将公开的不可变快照后确认。
- 所有用户均可直接发布；作者可撤回，管理员保留隐藏违规内容能力。
- 我的标签页只管理本人有权管理的 user/workspace 标签。
- 我的资产页聚合收藏、负反馈、个人备注、高频和最近使用。
- 首期个人主页为私有管理中心，不建设公开创作者社交主页。

## 9. 大资产量性能方案

目标数据规模：单 workspace 10,000 资产、100,000 标签绑定、5,000 提示词仍可正常使用。

1. 资产列表继续服务端分页；新增标签、统计和个人状态使用批量查询，禁止逐卡 N+1。
2. 标签后代查询使用 closure table；常用组合建立 workspace/tag/asset 复合索引。
3. 标签字符串从 Asset JSONB 查询迁移到关系表；旧 JSONB 仅做兼容镜像。
4. `AssetUsageAggregate` 预聚合，列表不扫描事件表。
5. 公共提示词改为数据库持久化，外部源通过导入任务更新，不在用户请求内抓取 GitHub。
6. 增加 `AssetVariant` 或等价缩略图记录，列表优先加载 320/640px WebP 预览；缺失时回退原图并后台补齐。
7. 当前页以外图片使用 lazy load；打开详情才请求原始媒体。
8. 批量标签、迁移和汇总重算使用后台任务，关页后继续，单项失败不终止整批。

本地性能验收建议：预热后 10,000 资产样本下，20 项列表和常规标签筛选的 API p95 不高于 500ms；前端首屏不得请求全部原图。若测试机基线达不到，报告实际硬件和查询计划，不用增加超时掩盖问题。

## 10. 兼容迁移

### 10.1 资产旧标签

1. 新表和索引先增量创建，不删除 `assets.tags`。
2. dry-run 统计每个 workspace 的唯一旧标签、空值和冲突。
3. 旧平面标签保守迁移到 workspace 的“历史标签”根节点，不猜测父子层级。
4. 根据现有 category 可绑定对应系统主分类标签，但原 category 字段继续保留。
5. API 返回的 `tags: string[]` 由新 binding 生成；迁移期同时维护旧 JSONB 兼容镜像。
6. 完成至少一个发布周期后才评估停止写旧字段，本工单不删除旧列。

### 10.2 私人提示词

1. 将 `user_preferences.canvas.promptPresets` 逐用户迁移到 PromptEntry/Revision。
2. 保留原 ID、标题、正文、标签、priority、sort_order 和时间。
3. 增加迁移标记，命令可重复运行，不重复创建。
4. 迁移期画布提示词选择器优先读新表，旧 JSON 仅在未迁移时兜底。
5. 本工单不静默删除用户偏好中的旧数据。

### 10.3 公共提示词

- 将当前六类 GitHub 数据源改为显式 import 命令或后台同步任务。
- 保存来源仓库、原始 ID、URL 和内容哈希，重复导入幂等。
- 某个外部源失败不清空已有公共数据；只记录同步错误和上次成功时间。

### 10.4 画布日期目录

- 为仍直接位于系统 `canvas_project` 目录的历史资产按 `created_at` 创建日期子目录并移动逻辑 folder_id。
- 已被用户移到自定义目录的资产不迁回。
- 无项目证据的历史画布资产进入 `未归属画布/{日期}`。
- 不移动物理文件，不改变 Asset ID 和 URL。

## 11. 实施阶段

### WP-053-R0：数据保护与基线

- 冻结当前工作树清单，识别大量未提交历史变更归属，不 reset、不覆盖。
- 对 3100/3101 使用的 PostgreSQL、资产卷、Compose/镜像和关键计数做停写备份。
- 记录 assets、folders、references、users、preferences、prompt preset 和物理文件数量。
- 跑 Go、Worker、Web、资产库/画布/提示词基线测试。

### WP-053-R1：标签领域基础

- 新增 Tag、TagClosure、TagAlias、AssetTagBinding/Origin、PromptTagBinding。
- 完成 Memory/Gorm Repository、Service、权限、层级移动和后代查询。
- 新增标签 API、资产批量绑定和详情统计。
- 完成旧 `assets.tags` dry-run/backfill/兼容镜像。

### WP-053-R2：统一入库、血缘和日期归档

- 抽取唯一 Asset ingestion service，旧上传接口内部复用。
- 修复手动上传“选文件即创建正式资产”。
- 画布按 existing Asset、本地媒体、衍生媒体三路处理并回写 Asset ID。
- 接通 AssetLineage、标签继承、抑制和显式重同步。
- 新增画布项目日期目录、业务时区、自动归档提示和历史目录迁移。

### WP-053-R3：统计、收藏、踩和个人备注

- 新增 AssetUsageEvent/Aggregate、AssetUserState。
- 在 Job 创建、引用、下载、导出和血缘创建处写幂等事件。
- 提供统计对账任务和 API。
- 保证个人状态隔离、收藏/踩互斥及匿名汇总。

### WP-053-R4：资产库和标签库页面

- 资产库接入标签树、组合筛选、统计、个人反馈、血缘和日期目录。
- 建设标签库和单标签管理页。
- 增加缩略图/懒加载和批量查询，完成 10,000 资产性能样本。
- 现有回收站、导出、目录、跨工作台编辑和 `@` 引用回归不得退化。

### WP-053-R5：服务端提示词中心

- 新增 PromptEntry/Revision/UserState 和兼容公共列表 API。
- 迁移私人 promptPresets；导入现有外部公共提示词。
- 建设公共版本、直接发布、撤回、fork、收藏和结构化片段类型。
- 画布和工作台提示词选择器统一读取新服务。

### WP-053-R6：公共提示词 UI 与拼接器

- 公共提示词页接入服务端分页、标签树和片段分类。
- 实现风格前缀、实际描述、色调氛围、延展修改和完整模板拼接预览。
- 支持复制、保存私人预设和送入画布。
- 首期不实现 AI 自动拆分；保留后续扩展接口。

### WP-053-R7：个人主页

- 建设私有个人管理中心。
- 接入私人提示词、已发布提示词、标签、收藏/踩/备注和使用统计。
- 增加普通用户资料编辑接口，设置仍复用 `/settings`。

### WP-053-R8：全量迁移、回归与部署

- schema deploy → dry-run → backfill → reconciliation → 幂等复跑。
- 使用 Mock Provider 完成上传、画布自动归档、多输入继承、提示词发布/拼接闭环。
- 正式验收只使用 3100/3101；部署后对账数据库和资产文件计数。
- 回滚代码和服务时保留新增表、旧字段和迁移数据，不执行破坏性 down migration。

依赖关系：

```text
R0
├─ R1 ─┬─ R2 ─ R3 ─ R4
│      └─ R5 ─ R6 ─ R7
└────────────────── R8
```

R1 是资产标签和提示词标签的共同前置；R2 完成后才能验证真正的衍生继承；R5 完成后才能迁移私人提示词和建设个人主页。

## 12. 测试与验收

### 标签和检索

- [ ] 单父级树禁止循环、跨 scope 移动和越权编辑。
- [ ] 父标签检索正确包含任意深度后代。
- [ ] 同一个标签可同时 asset_enabled/prompt_enabled，两套绑定和计数互不影响。
- [ ] 标签别名可搜索但不产生重复 Tag。
- [ ] 个人、团队、user、public 和 system 范围正确隔离。
- [ ] 旧 JSONB 标签迁移幂等，API 兼容返回字符串数组。

### 统一入库和血缘

- [ ] 取消手动上传不留下正式 Asset。
- [ ] 同一画布节点重复保存、刷新、API 重试不产生重复 Asset。
- [ ] 已有 Asset ID 的节点只建立引用，不重新上传。
- [ ] 压缩/裁剪/标注结果创建新 Asset 并保存父子血缘。
- [ ] 人物图与场景图生成新图后同时继承两侧允许继承的标签。
- [ ] 相同标签来自多个父资产时展示一枚并保留多个 origin。
- [ ] 修改父资产标签不改变已生成子资产；移除子资产继承标签不影响父资产。
- [ ] 自动归档路径为项目/日期，时区跨日边界正确。
- [ ] 用户手动移动后的资产不会被对账任务移回。

### 统计和反馈

- [ ] 同一 Job/Asset 的生成调用只计一次，失败重投不重复计数。
- [ ] 浏览、刷新和缩略图请求不计入调用次数。
- [ ] 收藏与踩互斥、重复点击取消、跨用户状态隔离。
- [ ] 个人备注仅本人可见，共享 note 语义不变。
- [ ] 汇总重算与事件增量结果一致。

### 提示词和个人主页

- [ ] 旧 promptPresets 无损迁移，priority/sort_order 保留。
- [ ] 所有登录用户可发布公共提示词，发布内容是不可变快照。
- [ ] 私人提示词修改不覆盖已发布版本；公共撤回不删除私人原稿。
- [ ] 公共提示词支持 fragment/template 和五类 part_type。
- [ ] 拼接器可组合、复制、保存私人库和送入画布。
- [ ] 标签用于提示词时不会修改资产标签关系。
- [ ] 个人主页只展示当前用户的私人内容和个人反馈。

### 性能和回归

- [ ] 10,000 资产/100,000 bindings 样本下列表和常规标签筛选满足约定 p95。
- [ ] 首屏只请求当前可见缩略图，不全量读取原图。
- [ ] 批量绑定、迁移和汇总任务关页继续并可恢复。
- [ ] 回收站、后台导出、目录移动、画布 `@`、生图工作台、漫剧助手不退化。
- [ ] 个人与团队 workspace 互不可见，Memory/Gorm 行为一致。

全量验证：

```text
cd apps/api && go build ./... && go vet ./... && go test ./...
cd apps/worker && python -m unittest discover -s tests
pnpm --filter ai-manhua-studio check
pnpm --filter ai-manhua-studio test
pnpm --filter ai-manhua-studio build
```

新增标签、入库、统计、提示词迁移和个人主页专项回归；浏览器使用 Mock Provider 完成真实交互，不调用付费服务。

## 13. 部署与回滚顺序

推荐滚动顺序：

```text
1. 停写备份数据库、资产卷、镜像和配置摘要
2. 应用仅新增表/列/索引的 schema migration
3. 部署支持新旧双读的 API
4. 运行标签、私人提示词和日期目录 dry-run
5. 执行 backfill，并立即进行 reconciliation/幂等复跑
6. 部署 Worker，使新结果写血缘、统计和日期目录
7. 部署 Web，切换标签库、提示词和个人主页入口
8. 浏览器闭环与部署后数据计数复核
```

回滚只回滚 Web/API/Worker 代码和服务版本；不删除新增表、列、标签、提示词版本、血缘和用户状态。旧 `assets.tags` 与 `promptPresets` 在本工单内保留，因此旧版本仍可读取基本数据。

## 14. 风险和控制

| 风险 | 控制 |
|---|---|
| 新标签表与旧 JSONB 双写漂移 | 明确新表为真源、旧字段为兼容镜像，提供 reconciliation |
| 自动继承造成标签污染 | 只有 asset_enabled 且 inherit_mode=auto 的标签自动继承 |
| 多来源同标签删除错误 | Binding 与 Origin 分层，删除某个 origin 不直接删除其它来源 |
| 用户误以为画布偷偷入库 | 节点状态、完成提示和归档路径全部可见 |
| 画布重复保存 | Asset ID 回写 + 稳定 idempotency key |
| 公共提示词无审核产生滥用 | 作者可撤回、管理员可隐藏、软删除和审计记录；不阻塞普通发布 |
| 千张大图加载卡顿 | 服务端分页、缩略图、lazy load、批量查询和预聚合 |
| 大迁移破坏历史数据 | dry-run、保守分类、兼容字段保留、物理文件不移动 |
| 大量未提交历史改动被覆盖 | R0 固化清单，只修改点名文件，不 reset/格式化无关区域 |

## 15. 首期明确排除

- 不做多父级标签图；使用单父级 + 多标签绑定 + alias。
- 不做 AI 自动拆分、自动改写或自动发布提示词。
- 不做公开创作者社交主页、关注、评论或私信。
- 不让普通用户直接修改平台 system 标签。
- 不做跨 workspace 资产共享搜索；用户仍只能搜索有权访问的资产。
- 不移动现有物理文件，不改变历史 Asset URL。
- 不立即删除旧 `assets.tags`、旧 promptPresets 或旧接口。
- 不调用真实付费 Provider，不处理任何真人业务。

## 16. 审核关注点

用户审核时重点确认：

1. 用户现场创建的标签首期默认归 workspace，而不是直接成为全局公共标签。
2. 公共提示词允许所有登录用户直接发布，但平台保留隐藏违规内容能力。
3. 画布生成结果继续自动持久化，改为明确提示并按“项目/日期”归档，而不是关闭自动保存。
4. 旧平面标签统一进入“历史标签”根节点，由用户后续人工整理，不使用 AI 猜层级。
5. 首期提示词拼接依赖人工结构化片段，不做自动拆分模型调用。
6. 性能验收使用 10,000 资产/100,000 标签绑定的本地合成数据，不读取或调用真实 Provider。

以上确认后，再将本草案转成正式执行工单并从 R0 开始；任何阶段未通过对应验证，不进入下一阶段。
