# AI 漫剧工作室

> 基于无限画布的 AI 漫剧创作平台 - Monorepo  
> 前后端分离架构

---

## 📁 项目结构

```
ai-manju-project/
├── apps/
│   ├── web/                  # Next.js 前端
│   │   ├── src/
│   │   ├── public/
│   │   └── package.json
│   └── api/                  # NestJS 后端
│       ├── src/
│       └── package.json
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
```bash
pnpm install
```

### 启动开发环境
```bash
# 同时启动前后端
pnpm dev

# 只启动前端
pnpm dev:web

# 只启动后端
pnpm dev:api
```

---

## 🛠️ 技术栈

### 前端 (apps/web)
- Next.js 16 + React 19
- TypeScript
- Tailwind CSS 4
- Ant Design 6
- Zustand (状态管理)
- localForage (本地存储)

### 后端 (apps/api)
- NestJS (Node.js + TypeScript)
- PostgreSQL (主数据库)
- Redis (队列 + 缓存)
- TypeORM (ORM)
- BullMQ (任务队列)
- Socket.IO (实时通信)

---

## 📦 包管理

使用 **pnpm workspace** + **Turborepo** 进行 Monorepo 管理。

---

## 🔧 开发

- 前端端口：3000
- 后端端口：3001
- PostgreSQL：5432
- Redis：6379

