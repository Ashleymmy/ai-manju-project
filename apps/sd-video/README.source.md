# SD_Video

SD_Video 是一个基于 FastAPI 的 AI 视频生成工作台。项目面向 Seedance 系列视频模型，提供登录、对话式生成、任务历史、媒体库、素材库、字幕擦除/视频增强、后台统计等能力。

本仓库是一个前后端一体项目：后端负责调用火山引擎/上游代理 API、管理 Supabase 数据与 Storage、轮询异步任务并转存结果；前端使用 Jinja2 模板 + Alpine.js + Tailwind CSS，静态资源直接由 FastAPI 提供。

## 功能概览

- 视频生成：支持文本、首帧、尾帧、参考图片、参考视频、参考音频等输入。
- 对话工作流：每个生成任务可归入对话，消息、附件和生成结果会沉淀到会话中。
- 任务轮询：服务端后台轮询火山任务，即使浏览器关闭也会继续回填生成结果。
- 媒体库：管理上传图片、上传视频、生成视频，并提供签名 URL、缩略图、标签和统计信息。
- 素材库：同步和管理火山素材资产，支持全局标签与提及引用。
- 工具箱：集成 AI MediaKit 的字幕擦除和视频增强任务。
- 管理后台：查看用户任务统计、账单消耗、余额，支持用户管理。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 后端 | Python 3.12、FastAPI、Uvicorn、Pydantic、httpx |
| 页面渲染 | Jinja2 |
| 前端交互 | Alpine.js、Tailwind CSS、Supabase JS、ffmpeg.wasm |
| 数据与认证 | Supabase Auth、PostgreSQL、Row Level Security |
| 文件存储 | Supabase Storage、阿里云 OSS |
| 上游服务 | 火山引擎 Ark / Seedance、AI MediaKit |
| 依赖管理 | uv、`pyproject.toml`、`uv.lock` |

## 项目结构

```text
.
├── main.py                         # FastAPI 应用入口，挂载静态资源并启动后台轮询
├── pyproject.toml                  # Python 项目元数据与依赖声明
├── requirements.txt                # uv 导出的 pip requirements，目前仅保留生成说明
├── uv.lock                         # uv 锁文件，推荐开发环境优先使用
├── README.md                       # 项目上手文档
├── DEPLOYMENT.md                   # 云端 Git 拉取更新与部署说明
├── DATA_ARCHITECTURE.md            # 数据架构说明
├── MEDIA_LIBRARY_GUIDE.md          # 媒体库实现说明
├── Changelog.md                    # 变更记录
├── app/
│   ├── config.py                   # 环境变量与模型配置
│   ├── schemas.py                  # 请求体模型
│   ├── supabase_client.py          # Supabase 表与 Storage 访问封装
│   ├── volcano_api.py              # 火山/Seedance 视频任务 API 客户端
│   ├── mediakit_api.py             # AI MediaKit API 客户端
│   ├── oss_client.py               # 阿里云 OSS 访问封装
│   ├── task_worker.py              # 后台任务轮询与结果转存
│   ├── admin.py                    # `/admin` 管理后台页面与 API
│   ├── routers/
│   │   ├── pages.py                # 首页路由
│   │   ├── config.py               # 模型配置与容量接口
│   │   ├── tasks.py                # 创建、查询、取消视频生成任务
│   │   ├── conversations.py        # 对话与消息 API
│   │   ├── media.py                # 媒体库 API
│   │   ├── volcano_assets.py       # 火山素材库 API
│   │   └── erase.py                # 字幕擦除/视频增强 API
│   ├── template/
│   │   ├── index.html              # 主工作台页面
│   │   ├── admin.html              # 管理后台页面
│   │   └── pages/                  # 生成器、媒体库、历史、工具箱页面片段
│   └── static/
│       ├── css/style.css
│       └── js/                     # Alpine 页面模块、前端库和 ffmpeg.wasm
├── supabase/
│   ├── config.toml                 # Supabase CLI 本地开发配置
│   └── snippets/                   # 数据库/Storage 初始化 SQL 片段
├── sd_video_public_schema_local.sql # 当前 public schema 导出
└── logs/                           # 运行日志，已在 .gitignore 中忽略
```

生产环境更新统一通过 GitHub 拉取新版本，详见 [`DEPLOYMENT.md`](DEPLOYMENT.md)；不再制作或分发本地更新补丁。

## 快速开始

### 1. 安装基础工具

请先准备：

- Python 3.12
- uv
- ffmpeg 和 ffprobe
- 一个可用的 Supabase 项目，或本地 Supabase CLI 环境
- 火山引擎/Seedance 或项目配置的上游代理 API Key

macOS 可参考：

```bash
brew install python@3.12 ffmpeg
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 2. 安装 Python 依赖

推荐使用 uv：

```bash
uv sync
```

如果你不使用 uv，可以手动创建虚拟环境并安装依赖：

```bash
python3.12 -m venv .venv
source .venv/bin/activate
uv pip install -e .
```

### 3. 配置环境变量

在项目根目录创建 `.env`。不要提交真实 `.env`，该文件已被 `.gitignore` 忽略。

```bash
RELOAD=true

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLIC_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_HOST_HEADER=
SUPABASE_DISABLE_SSL_VERIFY=true

# 火山 Ark / Seedance 1.5 / Lite
ARK_API_KEY=your-ark-api-key
VM_Seedance15=doubao-seedance-1-5-pro-251215
VM_SeedanceLite=doubao-seedance-1-0-lite-i2v-250428

# Seedance 2.0 上游代理
SEEDANCE20_URL=https://your-seedance20-proxy.example.com
SEEDANCE20_KEY=your-seedance20-key
VM_Seedance20=doubao-seedance-2-0-260128

# 阿里云 OSS，用于素材/文件外链存储
OSS_KEY_ID=your-oss-key-id
OSS_ACCESSKEY=your-oss-secret
OSS_BUCKET_NAME=your-bucket
OSS_ENDPOINT=https://oss-cn-region.aliyuncs.com
OSS_URI=your-bucket.oss-cn-region.aliyuncs.com

# AI MediaKit，字幕擦除和视频增强功能需要
AMK_API_KEY=your-mediakit-key
AMK_BASE_URL=https://mediakit.cn-beijing.volces.com

# 模型并发上限，0 表示不限制
LIMIT_SEEDANCE_20=30
LIMIT_SEEDANCE_15=30
LIMIT_SEEDANCE_LITE=30
```

关键说明：

- `SUPABASE_KEY` 必须使用 service role key，后端需要绕过 RLS 完成管理和任务回填。
- `SUPABASE_ANON_KEY` 会被前端 Supabase JS 用于登录。
- `SUPABASE_PUBLIC_URL` 用于把 Storage 签名链接转换成外部可访问地址，部署在内网或反代后尤其重要。
- `SEEDANCE20_URL` 与 `SEEDANCE20_KEY` 缺失时，Seedance 2.0 会被标记为不可用。
- `AMK_API_KEY` 缺失时，工具箱中的字幕擦除/增强接口会返回配置错误。
- `RELOAD=true` 仅建议本地开发使用。

### 4. 初始化数据库与存储

项目使用 Supabase Auth、PostgreSQL 和 Storage。至少需要以下表或视图：

- `tasks`
- `conversations`
- `chat_messages`
- `user_profiles`
- `user_statistics`
- `user_video_stats_view`
- `media_library`
- `media_library_tag_mapping`
- `global_tags`
- `volcano_assets`
- `volcano_asset_tag_mapping`
- `volcano_usage_logs`
- `amk_tasks`

可用当前 schema 导出作为初始化参考：

```bash
sd_video_public_schema_local.sql
```

如果使用 Supabase 控制台：

1. 打开 Supabase Dashboard。
2. 进入 SQL Editor。
3. 执行 `sd_video_public_schema_local.sql` 中的 schema。
4. 执行 `supabase/snippets/Untitled query 230.sql` 创建 Storage bucket。
5. 在 Authentication 中创建测试用户。
6. 如需管理员后台，将对应用户在 `user_profiles.role` 设置为 `admin`。

如果使用 Supabase CLI 本地开发：

```bash
supabase start
```

本地默认端口参考 `supabase/config.toml`：

- API: `http://127.0.0.1:54321`
- DB: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- Studio: `http://127.0.0.1:54323`
- Inbucket: `http://127.0.0.1:54324`

本仓库目前没有标准化 migrations 目录，`supabase/snippets/` 和 schema 导出文件主要用于同步/恢复。正式多人协作时建议把 schema 变更整理成可重复执行的 migration。

### 5. 启动开发服务

```bash
uv run python main.py
```

默认访问：

- 主工作台：`http://127.0.0.1:8001/`
- 管理后台：`http://127.0.0.1:8001/admin/`
- OpenAPI 文档：`http://127.0.0.1:8001/docs`

也可以直接用 Uvicorn：

```bash
uv run uvicorn main:app --host 127.0.0.1 --port 8001 --reload
```

启动后 `main.py` 会做三件事：

1. 创建 FastAPI 应用。
2. 挂载 `/static` 静态资源并注册所有路由。
3. 在 lifespan 中启动素材状态轮询和视频任务后台轮询。

## 常用开发入口

### 后端入口

- 新增页面路由：修改 `app/routers/pages.py` 或新增 `app/routers/*.py` 后在 `app/routers/__init__.py` 注册。
- 新增 API 请求体：优先放在 `app/schemas.py`。
- 调整模型参数：修改 `app/config.py` 中 `MODELS`。
- 调整视频生成请求：查看 `app/routers/tasks.py` 和 `app/volcano_api.py`。
- 调整任务完成后的回填逻辑：查看 `app/task_worker.py`。
- 调整 Supabase 表或 Storage 访问：查看 `app/supabase_client.py`。
- 调整管理员能力：查看 `app/admin.py` 与 `app/template/admin.html`。

### 前端入口

主页面由 `app/template/index.html` 组合，各业务页片段在 `app/template/pages/`。

前端状态由 Alpine 组装：

- `app/static/js/app.js`：全局状态装配入口。
- `app/static/js/pages/auth.js`：登录和用户资料。
- `app/static/js/pages/conversation.js`：对话列表、消息保存、切换会话。
- `app/static/js/pages/generator.js`：生成器主逻辑。
- `app/static/js/pages/generator/`：任务、提及、文件、媒体处理和 UI 拆分模块。
- `app/static/js/pages/media.js`：媒体库。
- `app/static/js/pages/history.js`：任务历史。
- `app/static/js/pages/toolkit.js`：字幕擦除和视频增强。
- `app/static/js/pages/admin.js`：管理后台逻辑。

项目没有 npm 构建步骤。修改 HTML、CSS 或 JS 后，刷新浏览器即可看到变化；如果启用 `RELOAD=true`，Python 代码变更会自动重载。

## 核心流程

### 视频生成流程

```text
前端提交 POST /api/create_task
  -> 后端校验模型能力与并发
  -> 上传/读取输入素材并生成可访问 URL
  -> 调用火山/Seedance 创建异步任务
  -> 写入 tasks、chat_messages、media_library
  -> 前端或后台 worker 轮询任务状态
  -> 任务成功后下载视频
  -> 上传到 Supabase Storage 或 OSS
  -> 回填 tasks、conversations、chat_messages、media_library
```

### 媒体库流程

```text
上传或生成媒体
  -> 写入 Supabase Storage / OSS
  -> 生成图片缩略图或视频信息
  -> 写入 media_library
  -> 前端请求 /api/media/library
  -> 后端批量生成签名 URL
  -> 页面展示、筛选、标签、删除或重命名
```

### 工具箱流程

```text
前端上传/选择视频
  -> POST /api/erase/pro、/api/erase/standard 或 /api/erase/enhance
  -> 后端调用 AI MediaKit 创建任务
  -> 写入 amk_tasks
  -> 前端或后台 worker 查询任务
  -> 完成后下载结果并转存
  -> 回填媒体库
```

## 常用 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/` | 主工作台页面 |
| `GET` | `/admin/` | 管理后台页面 |
| `GET` | `/api/models` | 获取模型配置 |
| `GET` | `/api/system/capacity` | 获取模型并发占用 |
| `POST` | `/api/create_task` | 创建视频生成任务 |
| `GET` | `/api/check_status/{task_id}` | 查询并推进任务状态 |
| `GET` | `/api/tasks` | 查询用户任务历史 |
| `DELETE` | `/api/tasks/{task_id}` | 取消或标记删除任务 |
| `GET` | `/api/video/{task_id}` | 获取生成视频签名 URL |
| `GET` | `/api/user/statistics` | 用户统计 |
| `GET` | `/api/user/profile` | 用户资料 |
| `PATCH` | `/api/user/profile` | 更新用户资料 |
| `POST` | `/api/conversations` | 创建对话 |
| `GET` | `/api/conversations` | 获取对话列表 |
| `GET` | `/api/conversations/{conversation_id}/messages` | 获取对话消息 |
| `POST` | `/api/messages` | 保存消息 |
| `GET` | `/api/media/library` | 获取媒体库 |
| `GET` | `/api/media/library/mentions` | 获取可被提及的媒体资源 |
| `GET` | `/api/media/library/stats` | 获取媒体库统计 |
| `PATCH` | `/api/media/{item_id}` | 更新媒体信息 |
| `DELETE` | `/api/media/{item_id}` | 删除媒体 |
| `POST` | `/api/upload` | 上传媒体文件 |
| `GET` | `/api/media/download-proxy` | 代理下载远程媒体 |
| `GET` | `/api/volcano/tags` | 获取素材标签 |
| `POST` | `/api/volcano/tags` | 创建素材标签 |
| `GET` | `/api/volcano/assets` | 获取火山素材库 |
| `POST` | `/api/volcano/assets/upload` | 上传并注册火山素材 |
| `POST` | `/api/volcano/assets/register` | 注册已有外链为火山素材 |
| `PUT` | `/api/volcano/assets/{asset_id}` | 更新火山素材信息 |
| `POST` | `/api/volcano/sync` | 从火山侧同步素材 |
| `POST` | `/api/erase/upload` | 上传工具箱处理视频 |
| `POST` | `/api/erase/pro` | 提交高级字幕擦除 |
| `POST` | `/api/erase/standard` | 提交标准字幕擦除 |
| `POST` | `/api/erase/enhance` | 提交视频增强 |
| `GET` | `/api/erase/task/{task_id}` | 查询工具箱任务 |
| `GET` | `/api/erase/tasks` | 查询工具箱任务列表 |
| `GET` | `/admin/api/stats` | 管理后台统计 |
| `GET` | `/admin/api/stats/export` | 导出管理后台统计 CSV |
| `POST` | `/admin/api/add_user` | 管理后台添加用户 |
| `POST` | `/admin/api/ban_user` | 管理后台封禁用户 |
| `POST` | `/admin/api/billing/sync` | 同步上游账单 |

完整参数以 `http://127.0.0.1:8001/docs` 中的 OpenAPI 文档和各 router 源码为准。

## 部署建议

### 运行方式

生产环境建议使用 Uvicorn 或 Gunicorn 管理进程：

```bash
uv run uvicorn main:app --host 0.0.0.0 --port 8001
```

如需 systemd，可参考：

```ini
[Unit]
Description=SD_Video FastAPI Service
After=network.target

[Service]
WorkingDirectory=/path/to/SD_Video
EnvironmentFile=/path/to/SD_Video/.env
ExecStart=/path/to/SD_Video/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8001
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 反向代理

如果通过 Nginx 或其他网关暴露服务，请确保：

- `/static/` 可以正常访问。
- 上传体大小满足图片/视频上传需求。
- 反代超时足够长，避免创建任务或上传大文件时中断。
- `SUPABASE_PUBLIC_URL` 指向浏览器和上游服务都能访问的地址。

### 外部依赖

生产环境至少要确认：

- Supabase Auth、DB、Storage 可访问。
- Storage 中存在项目使用的 bucket，代码默认使用 `private` 和 `thumbnails`。
- ffmpeg/ffprobe 在 PATH 中，否则视频缩略图和视频信息读取会失败。
- 火山/Seedance API Key 有余额和对应模型权限。
- OSS 配置可用，否则素材库中走 OSS 的路径会失败。
- AI MediaKit Key 可用，否则工具箱接口不可用。

## 调试与排错

### 登录后页面一直无数据

检查：

- `.env` 中 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY` 是否正确。
- Supabase Auth 是否已有用户。
- 相关表是否开启了正确 RLS 策略。
- 浏览器控制台是否有 Supabase JS 请求错误。

### 创建任务时报 Supabase 配置缺失

后端需要 `SUPABASE_URL` 和 `SUPABASE_KEY`。注意 `SUPABASE_KEY` 要使用 service role key，不是 anon key。

### Seedance 2.0 不可用

检查：

- `SEEDANCE20_URL`
- `SEEDANCE20_KEY`
- `VM_Seedance20` 或 `VM_SEEDANCE_20`

`app/config.py` 中会根据这些值决定 `seedance-2.0` 是否可用。

### 视频任务一直 processing

检查：

- 后端服务是否仍在运行。
- `app/task_worker.py` 是否在启动日志中正常开始轮询。
- `tasks.volcano_task_id` 是否存在。
- 火山/上游 API 是否能查询任务。
- 生成成功后 Supabase Storage 或 OSS 是否能写入。

### 缩略图或视频信息失败

检查服务器是否安装：

```bash
ffmpeg -version
ffprobe -version
```

图片缩略图依赖 Pillow，已在 `pyproject.toml` 中声明。

### 管理后台提示无权限

管理后台会检查 `user_profiles.role`。将当前登录用户设置为管理员：

```sql
update public.user_profiles
set role = 'admin'
where user_id = '<你的用户 UUID>';
```

## 开发规范建议

- 环境变量统一从 `app/config.py` 读取，不要在业务代码中分散读取 `.env`。
- 新增 API 时优先放到 `app/routers/`，再在 `app/routers/__init__.py` 注册。
- 对外部 API 请求要记录安全摘要，不要把完整密钥或超长 URL 打进日志。
- 任务状态只在后端落库后再让前端展示成功，避免浏览器关闭导致状态丢失。
- 数据库结构变更建议沉淀到 Supabase migration，避免只依赖手工 SQL。
- 不要提交 `.env`、日志、生成视频或本地测试素材。

## 相关文档

- `DATA_ARCHITECTURE.md`：更详细的数据表、关系和 RLS 说明。
- `MEDIA_LIBRARY_GUIDE.md`：媒体库表结构、缩略图、接口和部署说明。
- `Changelog.md`：历史变更记录。
