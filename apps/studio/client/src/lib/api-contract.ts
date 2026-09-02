/**
 * API-ARCHITECTURE.md 的前端路由与服务映射。
 * 这个目录只保存可调用的业务契约；不会再以静态样例代替服务端数据。
 */
export const apiContract = {
  auth: { login: "POST /api/auth/login", register: "POST /api/auth/register", me: "GET /api/auth/me", logout: "POST /api/auth/logout" },
  workspace: {
    projects: "GET /api/projects?scope=personal",
    comicProjects: "GET /api/comic-asset-projects?scope=personal",
    jobs: "GET /api/jobs?status=running&status=queued",
    assets: "GET /api/assets/library",
  },
  canvas: {
    project: "GET /api/projects/:id",
    saveSnapshot: "PUT /api/projects/:id/snapshot",
    createImageJob: "POST /api/jobs",
    streamJob: "GET /api/jobs/:id/stream",
  },
  assets: { library: "GET /api/assets/library", upload: "POST /api/assets", lineage: "GET /api/assets/:id/lineage" },
  tags: { list: "GET /api/tags?scope=&usage=asset&parent=", create: "POST /api/tags", move: "POST /api/tags/:tagId/move" },
  queue: {
    list: "GET /api/jobs?status=&type=&page=&pageSize=",
    cancel: "POST /api/jobs/:id/cancel",
  },
  preferences: "PUT /api/user/preferences",
} as const;

export type JobState = "queued" | "running" | "succeeded" | "failed" | "canceled";
