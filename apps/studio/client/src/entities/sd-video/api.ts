import { getAuthToken, request, type ApiRequestOptions } from "@/shared/api/http";
import type { WorkspaceScope } from "@/shared/config";

export type VideoConversationRecord = {
  id: string; title: string; version: number; created_at: number | string; updated_at?: number | string;
};
export type VideoMessageRecord = {
  id: string; conversation_id: string; role: string; text: string; version: number;
  created_at: number | string; attachments: unknown[]; metadata: Record<string, unknown>;
};

/** 身份在 repository 实例生命周期内固定，旧账号的排队请求不能携带新账号 Token。 */
export function createSDVideoClient(scope: WorkspaceScope, signal: AbortSignal) {
  const token = getAuthToken();
  async function call<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    if (signal.aborted || !token || getAuthToken() !== token) throw new DOMException("Session changed", "AbortError");
    return request<T>(`/api/sd-video${path}`, { ...options, signal, query: { ...options.query, scope } });
  }
  async function all<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; ; page += 1) {
      const result = await call<{ items: T[]; total?: number }>(path, { query: { page, pageSize: 100 } });
      items.push(...result.items);
      if (result.total === undefined || items.length >= result.total || result.items.length === 0) return items;
    }
  }
  return {
    eraseVideo: (assetId: string, mode: "standard" | "pro" = "standard") => call<{ id: string }>("/toolkit/erase", { method: "POST", body: { asset_id: assetId, mode }, headers: { "Idempotency-Key": crypto.randomUUID() } }),
    conversations: () => all<VideoConversationRecord>("/conversations"),
    messages: (id: string) => all<VideoMessageRecord>(`/conversations/${encodeURIComponent(id)}/messages`),
    createConversation: (id: string, title: string) => call<VideoConversationRecord>("/conversations", { method: "POST", body: { id, title } }),
    renameConversation: (id: string, title: string, version: number) => call<VideoConversationRecord>(`/conversations/${encodeURIComponent(id)}`, { method: "PATCH", body: { title, version } }),
    deleteConversation: (id: string) => call(`/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }),
    createMessage: (body: Record<string, unknown>) => call<VideoMessageRecord>("/messages", { method: "POST", body }),
    updateMessage: (id: string, body: Record<string, unknown>, version: number) => call<VideoMessageRecord>(`/messages/${encodeURIComponent(id)}`, { method: "PATCH", body: { ...body, version } }),
  };
}
