# AI 漫剧工作室

基于无限画布的 AI 漫剧创作平台。仓库采用 pnpm + Turbo 管理 TypeScript 应用，真实业务 API 使用 Go，异步生成任务由 Python Worker 执行。

## 当前目录

```text
studio/
├── apps/
│   ├── studio/                     # 唯一 Web 前端，Vite + React，端口 3100
│   ├── api/                        # Go API，端口 3101
│   ├── worker/                     # Python/Celery 异步任务 Worker
│   ├── canvas-agent/               # 本地 Canvas Agent
│   └── director-desk/              # 3D 导演台
├── packages/
│   └── canvas-agent-protocol/      # Agent 共享协议
├── deploy/                         # 当前部署配置
├── docs/                           # 架构、验收和能力说明
├── scripts/                        # E2E 与真实 Provider 冒烟脚本
├── docker-compose.yml              # 完整本地运行栈
└── pnpm-workspace.yaml             # 当前 TypeScript workspace 边界
```

旧 Next 前端、历史发布副本、UI 参考、构建缓存和临时验证产物位于项目外归档目录，不参与检索、workspace 或 Docker build context。

## 运行方式

### 完整 Docker 环境

```bash
cp .env.example .env
# 修改 .env 中的密码、密钥和 Origin 配置
docker compose up --build -d
```

服务地址：

- Studio：<http://localhost:3100>
- API 健康检查：<http://localhost:3101/health>
- Worker 健康检查：<http://localhost:8101/health>

默认管理员用户名是 `admin`，密码读取项目根目录 `.env` 中的 `ADMIN_PASSWORD`。

### 本地开发

先安装 workspace 依赖并启动基础设施：

```bash
pnpm install --frozen-lockfile
docker compose up -d postgres redis worker asset-export-worker
```

分别启动开发服务：

```bash
pnpm dev:api
pnpm dev:web
pnpm dev:agent
```

Windows 也可以运行 `start-dev.bat`；Git Bash/Linux/macOS 可运行 `./start-dev.sh`。这两个脚本启动 Go API、Studio 和 Canvas Agent，PostgreSQL、Redis 与 Worker 仍由 Docker Compose 管理。

Vite 开发服务器会把 `/api`、`/health` 和 `/webdav-proxy` 代理到 `VITE_API_PROXY_TARGET`，默认目标是 `http://127.0.0.1:3101`。

## 构建与验证

```bash
# Studio、共享协议和 Director Desk
pnpm --filter ai-manhua-studio check
pnpm --filter ai-manhua-studio test
pnpm --filter ai-manhua-studio build

# Canvas Agent 与 Director Desk
pnpm --filter @basketikun/canvas-agent test
pnpm --filter @ai-manju/director-desk test

# Go API
cd apps/api
go build ./...
go vet ./...
go test ./...

# Python Worker
cd apps/worker
python -m compileall worker
python -m unittest discover -s tests
```

完整浏览器验收使用根目录 Playwright 配置：

```bash
pnpm e2e
```

## 部署边界

`docker-compose.yml` 提供 `postgres`、`redis`、`api`、`worker`、`asset-export-worker` 和 `web`。生产构建通过 `VITE_API_URL` 注入浏览器 API 地址；默认同源访问由 Studio Nginx 转发到 Go API。

持久数据只保存在以下 named volumes：

- `ai-manju-postgres-data`
- `ai-manju-assets`

历史源码和本地归档不属于部署输入。详细发布与回滚约束见 [DEPLOYMENT_STRATEGY.md](./DEPLOYMENT_STRATEGY.md)。

## 相关文档

- [API 架构](./docs/API-ARCHITECTURE.md)
- [画布 UI 能力差距清单](./docs/CANVAS-UI-GAP-INVENTORY.md)
- [Go API 说明](./apps/api/README.md)
- [Canvas Agent 说明](./apps/canvas-agent/README.md)
- [3D Director Desk](./apps/director-desk/README.md)
