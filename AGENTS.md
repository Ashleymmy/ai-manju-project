# AGENTS.md — AI-Manju 项目规范（项目层）

> **继承全局协作宪法**：`C:\Users\JT\.codex\AGENTS.md`（角色分工、工单流、验收纪律、交接中心位置）。
> 交接中心在 `D:\ITEM\任务看板\collab\`；本项目的工单也走那里。
> 本文件只补充 **AI-Manju 专属**的技术约束，冲突时以本文件为准（离 cwd 更近，优先级更高）。

---

## 1. 项目速览

- **架构**：pnpm + turbo monorepo。
- **后端 `apps/api`**（端口 3101）：Go 1.23 + Gin + GORM。入口 `cmd/server`；路由 `internal/router/router.go`；业务在 `internal/{handler,provider,repository,middleware,auth,config,response,model}`；统一响应信封见 `internal/response`。仓库层有 `Memory*`(dev/test) 与 `Gorm*`(生产，`STORAGE_DRIVER=postgres`) 两套实现。
- **前端 `apps/web`**（端口 3100）：Next.js(App Router) + React + zustand + localforage(IndexedDB)。API 客户端统一走 `src/services/api/request.ts` 的 `requestApi`。画布核心在 `src/app/(user)/canvas/[id]/canvas-client-page.tsx`（大文件，定位要精确）。
- **共享**：`packages/types`（类型）、`packages/config`（配置）。
- **文档**：`docs/`（00-项目总览 … 04-验收报告）；大型修复见根目录 `FIX_PLAN.md`。

## 2. 专属硬约束（任何工单不得违反）

1. **不破坏现有公开行为**：响应信封 `{success,data,error,request_id}`、路由路径、鉴权语义保持不变。
2. **两套仓库实现必须行为一致**：改 `Memory*` 或 `Gorm*` 任一处逻辑，必须检查另一处是否需同步。
3. 新增常量集中放置并带注释，杜绝散落的魔法数字。
4. 涉及并发/取消：先保证"不丢数据、不卡死"，其次才谈性能。

## 3. 每阶段验证命令（交付前必跑，报告贴实际输出）

- 后端：`cd apps/api && go build ./... && go vet ./... && go test ./...`
- 前端：`cd apps/web && pnpm tsc --noEmit && pnpm lint`（有 build 脚本则 `pnpm build`）

## 4. 提交信息约定（仅当被要求提交时）

Conventional Commits：`feat|fix|chore|docs|refactor(scope): 简述`，scope 常用 `web` / `api`。
