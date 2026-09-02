# AI Manju API (Go)

> Go + Gin 后端 API 服务

## 🚀 快速开始

### 整理依赖
```bash
go mod tidy
```

### 启动开发服务器
```bash
go run ./cmd/server
```

访问: http://localhost:3101

默认使用内存存储，重启后数据会清空。

Beta 账号模式启动时建议配置超级管理员：

```powershell
$env:ADMIN_USERNAME = "admin"
$env:ADMIN_PASSWORD = "<strong-password>"
$env:ADMIN_DISPLAY_NAME = "Super Admin"
$env:APP_SECRET = "<at-least-32-random-characters>"
go run ./cmd/server
```

登录接口使用 HttpOnly Cookie `ai_manju_session` 保存服务端 Session。前端联调请求需要携带 credentials；PowerShell smoke 脚本会使用 `WebRequestSession` 保持 Cookie。

### PostgreSQL 模式

```bash
set STORAGE_DRIVER=postgres
set DATABASE_URL=postgres://postgres:postgres@localhost:55432/ai_manju?sslmode=disable
go run ./cmd/server
```

PowerShell:

```powershell
$env:STORAGE_DRIVER = "postgres"
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:55432/ai_manju?sslmode=disable"
go run ./cmd/server
```

标准联调环境：

```powershell
docker start ai-manju-postgres-test
$env:STORAGE_DRIVER = "postgres"
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:55432/ai_manju?sslmode=disable"
$env:ADMIN_USERNAME = "admin"
$env:ADMIN_PASSWORD = "<strong-password>"
$env:ADMIN_DISPLAY_NAME = "Super Admin"
$env:APP_SECRET = "<at-least-32-random-characters>"
go run ./cmd/server
```

前端联调默认地址：

```text
VITE_API_URL=http://localhost:3100
NEXT_PUBLIC_PROJECT_STORAGE=server
```

也可以使用拆分配置：

```env
STORAGE_DRIVER=postgres
DB_HOST=localhost
DB_PORT=55432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=ai_manju
DB_SSLMODE=disable
```

### 健康检查
```bash
curl http://localhost:3101/health
```

健康检查中的存储字段：

```json
{
  "success": true,
  "data": {
    "service": "AI Manju API (Go)",
    "storage": "memory",
    "db": "disabled"
  }
}
```

- `storage: memory, db: disabled`：默认内存模式。
- `storage: postgres, db: ok`：PostgreSQL 模式已连接。
- `storage: memory, db: missing_config`：请求 postgres 但未配置数据库地址，已回退 memory。
- `storage: memory, db: unavailable`：请求 postgres 但连接失败，已回退 memory。
- 响应头 `X-Request-Id` 可用于定位单次请求日志；错误响应体也会返回 `request_id`。

### 局域网 CORS

Beta 支持多前端 Origin：

```env
HOST=0.0.0.0
FRONTEND_URLS=http://localhost:3100,http://127.0.0.1:3100,http://192.168.1.50:3100
```

`FRONTEND_URLS` 优先；未配置时兼容旧的 `FRONTEND_URL`。`VITE_API_URL` 会在 Studio 构建时注入；局域网部署应使用访问者可达的宿主机地址，或使用 Studio 同源 Nginx 代理。

---

## 📁 项目结构

```
apps/api/
├── cmd/
│   └── server/
│       └── main.go              # 入口文件
├── internal/
│   ├── config/                  # 环境配置
│   ├── database/                # 数据库连接
│   ├── handler/                 # HTTP 处理器
│   │   ├── user.go
│   │   └── project.go
│   ├── repository/              # 数据访问层
│   ├── response/                # 统一响应
│   ├── router/                  # 路由注册
│   └── model/                   # 数据模型
│       └── models.go
├── _legacy-nest/                # 旧 NestJS 归档，不作为当前主线
├── go.mod
├── go.sum
└── README.md
```

---

## 🛠️ 技术栈

- **框架**: Gin (HTTP 路由)
- **ORM**: GORM (PostgreSQL，可选)
- **配置**: godotenv
- **当前存储**: 默认进程内内存仓库，可通过环境变量切换 PostgreSQL
- **后续目标**: PostgreSQL、Redis + Asynq、WebSocket

---

## 📡 API 端点

### 健康检查
- `GET /health` - 健康检查

### 用户
- `POST /api/auth/login` - 登录并写入 HttpOnly Cookie
- `GET /api/auth/me` - 获取当前用户
- `POST /api/auth/logout` - 登出并撤销 Session
- `GET /api/admin/users` - 管理员获取用户列表
- `POST /api/admin/users` - 管理员创建用户
- `PUT /api/admin/users/:id` - 管理员更新用户

### 项目
- `GET /api/projects` - 获取项目列表
- `POST /api/projects` - 创建项目
- `GET /api/projects/:id` - 获取单个项目
- `PUT /api/projects/:id` - 更新项目
- `DELETE /api/projects/:id` - 删除项目
- `GET /api/projects/:id/snapshot` - 获取画布快照
- `PUT /api/projects/:id/snapshot` - 更新画布快照

字段和错误码细节见根目录 `docs/02-技术设计与契约/后端API契约-ProjectCanvas.md`。

所有 Project / Snapshot API 从 Beta 起需要登录。`owner_id` 由后端从当前用户写入，前端传入值会被忽略；跨用户访问返回 `404`。

### 管理端模型 Provider

- `GET /api/admin/model-provider`
- `PUT /api/admin/model-provider`
- `POST /api/admin/model-provider/test`

Beta 只支持一条默认 OpenAI-compatible 文本 Provider：

```json
{
  "mode": "local_openai",
  "base_url": "http://host.docker.internal:11434",
  "auth_type": "none",
  "api_key": "",
  "text_model": "llama3.1",
  "timeout_ms": 30000,
  "enabled": true
}
```

`GET` 只返回 `api_key_set`，不返回明文 API Key。`auth_type=bearer` 保存 key 时必须配置 `APP_SECRET`。

### 普通 AI API

- `GET /api/ai/models`
- `POST /api/ai/text`
- `POST /api/ai/images/generations`

普通用户只能通过后端代理访问模型服务，响应不包含 Provider `base_url`、`api_key` 或原始 headers。Provider `base_url` 可填写服务根地址，后端会自动补 `/v1`；旧的 `/v1` 地址仍兼容。文本代理转发 Provider `/responses`；主模型图片生成可走 `/responses` 的 `image_generation` 工具，专用图片模型和图片编辑仍走 `/images/generations`、`/images/edits`，用于避免浏览器直连模型服务产生 CORS 预检失败。兼容保留 `POST /api/ai/image/generations`。

### 创建项目请求
```json
{
  "title": "测试项目",
  "owner_id": "local-user",
  "data": {}
}
```

### 更新画布快照请求
```json
{
  "data": {
    "nodes": [],
    "connections": []
  }
}
```

---

## 🔧 环境变量

创建 `.env` 文件：

```env
PORT=3101
HOST=0.0.0.0
FRONTEND_URLS=http://localhost:3100,http://127.0.0.1:3100
STORAGE_DRIVER=memory
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<strong-password>
ADMIN_DISPLAY_NAME=Super Admin
APP_SECRET=<at-least-32-random-characters>

# 使用 PostgreSQL 时：
# STORAGE_DRIVER=postgres
# DATABASE_URL=postgres://postgres:postgres@localhost:55432/ai_manju?sslmode=disable
```

---

## 🧪 冒烟验证

### 内存模式

```bash
go test ./...
go build ./cmd/server
go run ./cmd/server
curl http://localhost:3101/health
curl http://localhost:3101/api/projects
```

### PostgreSQL 模式

```bash
set STORAGE_DRIVER=postgres
set DATABASE_URL=postgres://postgres:postgres@localhost:55432/ai_manju?sslmode=disable
go run ./cmd/server
curl http://localhost:3101/health
```

创建项目：

```bash
curl -X POST http://localhost:3101/api/projects ^
  -H "Content-Type: application/json" ^
  -d "{\"title\":\"Postgres Smoke\",\"owner_id\":\"tester\",\"data\":{\"id\":\"local-1\"}}"
```

保存快照：

```bash
curl -X PUT http://localhost:3101/api/projects/<projectId>/snapshot ^
  -H "Content-Type: application/json" ^
  -d "{\"data\":{\"id\":\"local-1\",\"nodes\":[],\"connections\":[]}}"
```

集成测试：

```bash
set TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/ai_manju?sslmode=disable
go test ./internal/repository -run Integration -count=1
```

联调 smoke 脚本：

```powershell
.\scripts\smoke-project.ps1 -Username admin -Password <strong-password>
```

如果本机 PowerShell 执行策略禁止脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-project.ps1
```

保留项目用于重启后读取：

```powershell
.\scripts\smoke-project.ps1 -ExpectStorage postgres -Username admin -Password <strong-password> -SkipDelete
```

脚本覆盖健康检查、创建 Project、保存 Snapshot、读取 Snapshot 和删除 Project。`-ExpectStorage postgres` 可防止把 memory fallback 误判为 PostgreSQL 联调通过。

账号与管理端 smoke：

```powershell
.\scripts\smoke-auth-admin.ps1 -AdminUsername admin -AdminPassword <strong-password>
```

本地模型 Provider smoke：

```powershell
.\scripts\smoke-ai-provider.ps1 `
  -AdminUsername admin `
  -AdminPassword <strong-password> `
  -ProviderBaseUrl http://localhost:11434/v1 `
  -Mode local_openai `
  -AuthType none `
  -TextModel llama3.1
```

保留项目后，重启 API，再按脚本输出的 project id 读取：

```powershell
Invoke-RestMethod http://localhost:3101/api/projects/<projectId>/snapshot
```

### PostgreSQL 测试容器

启动或复用专用测试库：

```powershell
docker start ai-manju-postgres-test
```

如果容器不存在：

```powershell
docker run --name ai-manju-postgres-test `
  -e POSTGRES_PASSWORD=postgres `
  -e POSTGRES_USER=postgres `
  -e POSTGRES_DB=ai_manju `
  -p 55432:5432 `
  -d postgres:15
```

停止容器：

```powershell
docker stop ai-manju-postgres-test
```

清理容器和数据：

```powershell
docker rm -f ai-manju-postgres-test
```

释放后端端口 3101：

```powershell
Get-NetTCPConnection -LocalPort 3101 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

不要把 `storage: memory` 的结果误判为 PostgreSQL 持久化通过。

### 常见失败原因

- 端口不可达：确认 PostgreSQL 容器或本机服务已监听配置端口。
- 数据库不存在：先创建 `ai_manju` 数据库，或调整 `DATABASE_URL`。
- 密码不匹配：检查 `DATABASE_URL`、`DB_USER`、`DB_PASSWORD`。
- 已回退 memory：查看 `/health` 的 `storage` 和 `db` 字段，不要只看服务是否启动。
- 排查单次失败：复制响应头或错误体里的 `request_id`，在后端日志中搜索同一 ID。

---

## 📦 部署

### Docker 构建
```bash
docker build -f apps/api/Dockerfile -t ai-manju-api .
docker run -p 3101:3101 ai-manju-api
```

### Docker Compose

仓库根目录提供 `docker-compose.yml`，包含 `api + postgres`：

```bash
cp .env.example .env
# Edit .env and set strong APP_SECRET / ADMIN_PASSWORD / database password first.
docker compose up --build
```

Compose 下 API 容器连接 PostgreSQL 使用 `DB_HOST=postgres`。`docker-compose.yml` 会从 `.env` 读取敏感配置，不再内置 `admin/admin` 或 `beta-change-me`。如果 API 容器访问宿主机模型服务，应把 Provider `base_url` 配成 `http://host.docker.internal:<port>`，后端会自动补 `/v1`；Linux Docker 已在 compose 中预留 `host-gateway`。

---

## 📝 开发说明

- 所有 API 响应格式统一：
  ```json
  {
    "success": true,
    "data": {},
    "message": "optional message"
  }
  ```

- 错误响应：
  ```json
  {
    "success": false,
    "error": "error message"
  }
  ```

- 当前 Project / Canvas Snapshot 默认使用内存存储，服务重启后会清空。
- 如需 PostgreSQL 持久化，设置 `STORAGE_DRIVER=postgres` 并配置 `DATABASE_URL` 或 `DB_HOST` 等环境变量。
- Beta 模式下 Project / Canvas Snapshot、AI API 都要求登录；admin API 只允许 `super_admin`。
- API 契约见根目录 `docs/02-技术设计与契约/后端API契约-ProjectCanvas.md`。
