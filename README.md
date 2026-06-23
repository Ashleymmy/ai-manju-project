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
│       │   ├── service/      # 业务逻辑
│       │   ├── repository/   # 数据访问
│       │   └── model/        # 数据模型
│       └── pkg/              # 公共包
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
go mod download
```

### 启动开发环境

**方式 1: 同时启动前后端**
```bash
# 终端 1: 启动前端
pnpm dev:web

# 终端 2: 启动后端
cd apps/api && go run cmd/server/main.go
```

**方式 2: 使用 Turborepo (推荐)**
```bash
# TODO: 配置 turbo 支持 Go
pnpm dev
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
- GORM (ORM)
- PostgreSQL (主数据库)
- Redis + Asynq (任务队列)
- gorilla/websocket (实时通信)

---

## 🔧 开发

### 前端端口
- 开发服务器：http://localhost:3100

### 后端端口
- API 服务器：http://localhost:3101
- 健康检查：http://localhost:3101/health

### 数据库
- PostgreSQL：5432
- Redis：6379

---

## 📦 环境变量

### 前端 (apps/web/.env.local)
```env
NEXT_PUBLIC_API_URL=http://localhost:3101
```

### 后端 (apps/api/.env)
```env
PORT=3101
FRONTEND_URL=http://localhost:3100
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=ai_manju
```

---

## 🚢 部署

### Docker Compose
```bash
docker-compose up
```

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

✅ Monorepo 架构搭建  
✅ 前端画布核心功能复刻  
✅ Go 后端基础架构  
⏳ API 接口开发  
⏳ 数据库设计  
⏳ 实时协作功能


