import { request } from "./request";

export function getTags() { return request<unknown>("/api/tags", { query: { scope: "personal", usage: "asset" } }); }
export function getPromptLibrary() { return request<unknown>("/api/prompts", { query: { page: 1, pageSize: 24 } }); }
export function getAdminMonitoring() { return request<unknown>("/api/admin/monitoring"); }
export function getHealth() { return request<{ public_signup?: boolean; status?: string }>("/health", { timeoutMs: 5_000 }); }
