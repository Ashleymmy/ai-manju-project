import { request } from "./request";

export function getTags() { return request<unknown>("/api/tags", { query: { scope: "personal", usage: "asset" } }); }
export type SystemPrompt = {
  id: string;
  title: string;
  prompt: string;
  tags: string[];
  category: string;
  preview?: string;
  coverUrl?: string;
  githubUrl?: string;
};
export type SystemPromptListResult = { items: SystemPrompt[]; total: number; tags?: string[]; categories?: string[] };
export type SystemPromptQuery = { keyword?: string; category?: string; tags?: string[] };

// 系统提示词库由 studio 自身的同源服务聚合（vite dev 中间件 / 生产 node server），不走 Go 后端。
export async function getPromptLibrary(page = 1, pageSize = 100, query: SystemPromptQuery = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (query.keyword?.trim()) params.set("keyword", query.keyword.trim());
  if (query.category) params.set("category", query.category);
  (query.tags || []).forEach((tag) => params.append("tag", tag));
  const response = await fetch(`/api/prompts?${params.toString()}`);
  if (!response.ok) throw new Error(`读取系统提示词失败（HTTP ${response.status}）`);
  return await response.json() as SystemPromptListResult;
}

export async function listAllSystemPrompts() {
  const first = await getPromptLibrary(1, 100);
  const items = [...(first.items || [])];
  for (let page = 2; items.length < (first.total || items.length); page += 1) {
    const next = await getPromptLibrary(page, 100);
    if (!next.items?.length) break;
    items.push(...next.items);
  }
  return items;
}
export function getAdminMonitoring() { return request<unknown>("/api/admin/monitoring"); }
export function getHealth() { return request<{ public_signup?: boolean; status?: string }>("/health", { timeoutMs: 5_000 }); }
