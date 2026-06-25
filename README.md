# AI 漫剧工作室

> 基于无限画布的 AI 漫剧创作平台 - Monorepo  
> 前后端分离架构：Next.js + Go

---

## 📁 项目结构

```
ai-manju-project/
├── apps/
│   ├── web/                  # Next.js 前端 (端口 3100)
│   │   ├── src/
│   │   ├── public/
│   │   └── package.json
│   └── api/                  # Go 后端 (端口 3101)
│       ├── cmd/server/       # 入口文件
│       ├── internal/         # 内部包
│       │   ├── handler/      # HTTP 处理器
│       │   ├── repository/   # 数据访问
│       │   ├── response/     # 统一响应
│       │   ├── router/       # 路由注册
│       │   └── model/        # 数据模型
│       └── _legacy-nest/     # 旧 NestJS 代码归档，不作为当前主线
│
├── packages/
│   ├── types/                # 共享类型定义
│   └── config/               # 共享配置
│
├── package.json              # Root package.json
├── pnpm-workspace.yaml       # pnpm workspace
└── turbo.json                # Turborepo 配置
```

---

## 🚀 快速开始

### 安装依赖

**前端**:
```bash
pnpm install
```

**后端**:
```bash
cd apps/api
go mod tidy
```

### 启动开发环境

**方式 1: 同时启动前后端**
```bash
# 终端 1: 启动前端
pnpm dev:web

# 终端 2: 启动后端
pnpm dev:api
```

**方式 2: 分目录启动后端**
```bash
cd apps/api
go run ./cmd/server
```

---

## 🛠️ 技术栈

### 前端 (apps/web) - 端口 3100
- **Next.js 16** + React 19
- TypeScript
- Tailwind CSS 4
- Ant Design 6
- Zustand (状态管理)
- localForage (本地存储)

### 后端 (apps/api) - 端口 3101
- **Go 1.23**
- Gin (HTTP 框架)
- GORM + PostgreSQL 可选持久化
- Beta 账号、Project / Snapshot 用户隔离、管理端模型 Provider 和文本代理
- Redis + Asynq、WebSocket 为后续阶段接入目标

---

## 🔧 开发

### 前端端口
- 开发服务器：http://localhost:3100

### 后端端口
- API 服务器：http://localhost:3101
- 健康检查：http://localhost:3101/health

- API 服务器：http://localhost:3101
- 健康检查：http://localhost:3101/health

### 后端 Beta 能力
- `POST /api/auth/login` 使用 HttpOnly Cookie `ai_manju_session`。
- `/api/projects/*` 需要登录，并按当前用户隔离数据。
- `/api/admin/*` 仅允许 `super_admin`。
- `/api/ai/models`、`/api/ai/text` 和 `/api/ai/images/generations` 通过后端代理使用管理员配置的 OpenAI-compatible 模型服务。
- Beta 推荐 `STORAGE_DRIVER=postgres`；memory 模式仅用于本地快速开发和测试。
- Redis 仍是后续阶段目标，不是当前已接入能力。

---

## 📦 环境变量

### 前端 (apps/web/.env.local)
```env
NEXT_PUBLIC_API_URL=http://localhost:3101
```

### 后端 (apps/api/.env)
```env
PORT=3101
HOST=0.0.0.0
FRONTEND_URLS=http://localhost:3100,http://127.0.0.1:3100
STORAGE_DRIVER=postgres
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<strong-password>
ADMIN_DISPLAY_NAME=Super Admin
APP_SECRET=<at-least-32-random-characters>

# PostgreSQL 模式：
# STORAGE_DRIVER=postgres
# DATABASE_URL=postgres://postgres:postgres@localhost:55432/ai_manju?sslmode=disable
```

后端联调 smoke：

```powershell
cd apps/api
.\scripts\smoke-project.ps1 -Username admin -Password <strong-password>
.\scripts\smoke-auth-admin.ps1 -AdminUsername admin -AdminPassword <strong-password>
```

---

## 🚢 部署

### Docker Compose
```bash
cp .env.example .env
# Edit .env and set strong secrets first.
docker compose up --build
```

当前 compose 提供 `api + postgres`，敏感配置从 `.env` 读取。局域网访问时，前端 `NEXT_PUBLIC_API_URL` 应配置为宿主机 LAN API 地址，例如 `http://192.168.1.50:3101`；后端 `FRONTEND_URLS` 需包含对应前端 Origin。

### 分别部署
- **前端**: Vercel / Netlify
- **后端**: 独立服务器 / K8s

---

## 📚 文档

- [前端开发文档](./apps/web/README.md)
- [后端 API 文档](./apps/api/README.md)
- [类型定义](./packages/types/README.md)

---

## 🎯 Phase 1 进度

- ✅ Monorepo 架构搭建
- ✅ 前端画布核心功能复刻
- ✅ Go 后端基础架构
- ✅ 最小 Project / Canvas Snapshot API
- ⏳ 数据库设计
- ⏳ 实时协作功能

