# SD_Video 数据架构文档

## 概述

SD_Video 采用 PostgreSQL（Supabase）作为数据存储层，使用关系模型存储用户、任务、对话和消息数据。本文档详细说明完整的数据架构。

---

## 核心表结构

### 1. **tasks**（任务表）
存储所有视频生成任务的记录。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `user_id` | UUID | 用户ID（fk: auth.users） |
| `model` | TEXT | 模型ID（如 'doubao-seedance-1-5-pro-251215'） |
| `prompt` | TEXT | 用户描述文字 |
| `input_path` | TEXT | 参考图上传路径 |
| `volcano_task_id` | TEXT | 火山引擎任务ID |
| `status` | TEXT | 任务状态：processing \| queued \| running \| succeeded \| failed \| cancelled \| expired |
| `ratio` | TEXT | 画幅比例（16:9, 9:16, 等） |
| `duration` | INTEGER | 视频时长（秒：5或10） |
| `generate_audio` | BOOLEAN | 是否生成音频 |
| `watermark` | BOOLEAN | 是否添加水印 |
| `content_inputs` | JSONB | 输入资源JSON（文本、首帧、尾帧、参考图） |
| `video_url` | TEXT | 生成视频在Storage中的路径 |
| `error_message` | TEXT | 失败错误信息 |
| `conversation_id` | UUID | 关联的对话ID（fk: conversations） |
| `created_at` | TIMESTAMPTZ | 创建时间 |
| `updated_at` | TIMESTAMPTZ | 更新时间 |

**主要索引**：
- PRIMARY KEY: `id`
- FOREIGN KEY: `user_id`, `conversation_id`
- 触发器：自动更新 `updated_at`

---

### 2. **conversations**（对话表）
存储用户与AI的对话会话。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `user_id` | UUID | 用户ID（fk: auth.users） |
| `title` | TEXT | 对话标题（由首条prompt自动生成） |
| `thumbnail_url` | TEXT | 最新视频缩略图路径 |
| `last_task_id` | UUID | 关联的最新任务ID（fk: tasks） |
| `created_at` | TIMESTAMPTZ | 创建时间 |
| `updated_at` | TIMESTAMPTZ | 更新时间 |

**主要索引**：
- PRIMARY KEY: `id`
- FOREIGN KEY: `user_id`, `last_task_id`

---

### 3. **chat_messages**（消息表）
存储某对话中的所有消息记录（用户输入/系统反馈）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `conversation_id` | UUID | 对话ID（fk: conversations） |
| `user_id` | UUID | 用户ID（fk: auth.users） |
| `role` | TEXT | 发送者角色：'user' \| 'system' |
| `text` | TEXT | 消息内容 |
| `attachments` | JSONB | 附件JSON（参考图、首帧、尾帧等） |
| `task_id` | UUID | 关联的任务ID（若消息触发生成） |
| `video_url` | TEXT | 生成的视频URL（若消息含视频结果） |
| `created_at` | TIMESTAMPTZ | 创建时间 |

**主要索引**：
- PRIMARY KEY: `id`
- FOREIGN KEY: `conversation_id`, `user_id`, `task_id`
- ON DELETE CASCADE：删除对话时级联删除消息

---

### 4. **user_statistics**（用户统计表）⭐ NEW
实时缓存用户的统计数据，通过触发器自动更新。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `user_id` | UUID | 用户ID（fk: auth.users, UNIQUE） |
| `total_video_duration` | INTEGER | 生成成功的视频总时长（秒） |
| `total_conversations` | INTEGER | 对话总数 |
| `succeeded_tasks` | INTEGER | 成功任务数 |
| `failed_tasks` | INTEGER | 失败/取消/过期的任务总数 |
| `total_tasks` | INTEGER | 总任务数 |
| `total_tasks_processing` | INTEGER | 处理中任务数 |
| `total_tasks_queued` | INTEGER | 排队中任务数 |
| `total_tasks_running` | INTEGER | 运行中任务数 |
| `created_at` | TIMESTAMPTZ | 创建时间 |
| `updated_at` | TIMESTAMPTZ | 上次更新时间 |

**更新机制**：
- 任务表INSERT/UPDATE → 触发 `trigger_update_stats_on_task_change()`
- 任务表DELETE → 触发 `trigger_update_stats_on_task_delete()`
- 对话表INSERT/UPDATE → 触发 `trigger_update_stats_on_conversation_change()`
- 对话表DELETE → 触发 `trigger_update_stats_on_conversation_delete()`

---

## 数据关系图

```
┌─────────────────────────────────────┐
│        auth.users (Supabase)        │
│  身份认证、邮箱、密码等             │
└────────────────┬────────────────────┘
                 │ user_id
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
   ┌─────────┐       ┌──────────┐
   │  tasks  │       │ conversations│
   │ (任务表) │       │ (对话表)  │
   └────┬────┘       └────┬─────┘
        │                 │ conversation_id
        │            ┌────▼─────┐
        │            │           │
        │            ▼           ▼
        │      ┌──────────────┐
        │      │ chat_messages│
        │      │ (消息表)     │
        │      └──────────────┘
        │
        └──────────────────────┐
                             │
                             ▼
                   ┌─────────────────────┐
                   │ user_statistics     │
                   │ (统计表)            │
                   │ ⭐ 自动更新缓存    │
                   └─────────────────────┘
```

---

## 数据流程

### 1. **创建任务流程**
```
前端 → POST /api/create_task
    → 上传首尾帧/参考图 到 Supabase Storage
    → 调用 create_task_record()
    → 在 tasks 表插入记录
    → ✅ trigger_update_stats_on_task_change() 自动触发
    → user_statistics 表自动刷新
```

### 2. **任务状态更新流程**
```
后端轮询 → 向火山引擎查询状态
    → 状态变为 succeeded/failed/cancelled
    → 调用 update_task_status() 更新 tasks 表
    → ✅ trigger_update_stats_on_task_change() 自动触发
    → user_statistics 表自动刷新
```

### 3. **查询统计数据流程**
```
前端 → GET /api/user/statistics?user_id=xxx
    → 从 user_statistics 表直接查询
    → ⚡ O(1) 查询时间（已缓存）
    → 返回统计JSON
```

---

## 行级安全策略（RLS）

所有表都启用了 Row Level Security，确保用户只能访问自己的数据：

| 表 | 策略 |
|----|------|
| `tasks` | 用户只能查看/创建/更新/删除自己的任务 |
| `conversations` | 用户只能查看/创建/更新/删除自己的对话 |
| `chat_messages` | 用户只能查看自己所在对话的消息 |
| `user_statistics` | 用户只能查看自己的统计数据 |

---

## 性能考虑

### 查询优化技巧

**不推荐**（每次聚合计算）：
```sql
SELECT COUNT(*) FROM tasks WHERE user_id = ? AND status = 'succeeded';
-- 当任务数百万时，每次查询都需要全表扫描
```

**推荐**（从缓存表查询）：
```sql
SELECT succeeded_tasks FROM user_statistics WHERE user_id = ?;
-- O(1) 查询时间，毫秒级响应
```

---

## 数据初始化

### 1. 创建表结构
运行 `migration_statistics.sql` 中的所有 SQL 语句：

```bash
# 通过 Supabase SQL Editor 或 psql 执行
psql -h <DB_HOST> -U <DB_USER> -d <DB_NAME> -f migration_statistics.sql
```

### 2. 初始化现有用户统计
迁移脚本中的 `DO` 语句会自动计算所有已存在用户的统计数据。

---

## 后端集成示例

### Python 代码（已实现）

**查询统计数据**（使用缓存表）：
```python
async def get_user_statistics(user_id: str) -> dict:
    client = get_supabase_client()
    result = (
        client.table("user_statistics")
        .select("*")
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    return result.data or {}
```

**任务插入时自动刷新**（触发器自动处理）：
```python
# 无需手动调用 update_user_statistics，触发器会自动执行
await create_task_record(user_id, ...)  # ✅ 自动触发统计更新
```

---

## API 端点

### 获取用户统计
```
GET /api/user/statistics?user_id={user_id}

响应示例：
{
    "total_video_duration": 150,      // 生成视频总时长（秒）
    "total_conversations": 12,        // 对话数
    "succeeded_tasks": 18,            // 成功任务
    "failed_tasks": 3,                // 失败任务
    "total_tasks": 21,                // 总任务
    "total_tasks_processing": 0,      // 处理中
    "total_tasks_queued": 0,          // 排队中
    "total_tasks_running": 0,         // 运行中
    "created_at": "2026-01-01T...",
    "updated_at": "2026-03-25T..."
}
```

---

## 总结

| 方案 | 适用场景 | 优点 | 缺点 |
|------|---------|------|------|
| **动态查询**（旧方式） | 小型应用、数据量<10k | 实时准确、无冗余 | 查询慢、不可扩展 |
| **缓存表**（推荐） | 生产环境、大数据量 | 查询快、自动更新、可扩展 | 存储冗余、需维护触发器 |

**当前推荐**：使用缓存表方式（user_statistics），通过PG触发器自动维护，保证数据一致性且查询性能最优。
