import { request } from "./request";
import type { Asset } from "./assets";
import type { WorkspaceScope } from "./projects";

export type TagInheritMode = "auto" | "manual" | "never";
export type SemanticTag = {
  id: string;
  scope_type: "system" | "public" | "workspace" | "user";
  parent_id: string;
  name: string;
  description: string;
  asset_enabled: boolean;
  prompt_enabled: boolean;
  inherit_mode: TagInheritMode;
  status: "active" | "archived";
  sort_order: number;
  aliases: Array<{ id: string; tag_id: string; alias: string }>;
  asset_count: number;
  prompt_count: number;
  editable: boolean;
  children_count: number;
};

export type TagListResult = { items: SemanticTag[]; total: number; page: number; page_size: number };

export function listTags(scope: WorkspaceScope = "personal", query: { usage?: "asset" | "prompt"; keyword?: string; includeDescendants?: boolean; page?: number; pageSize?: number } = {}) {
  return request<TagListResult>("/api/tags", {
    query: {
      scope,
      usage: query.usage,
      keyword: query.keyword,
      include_descendants: query.includeDescendants || undefined,
      page: query.page || 1,
      page_size: query.pageSize || 100,
    },
  });
}

export async function listAllTags(scope: WorkspaceScope = "personal", usage?: "asset" | "prompt") {
  const first = await listTags(scope, { usage, page: 1, pageSize: 100 });
  const items = [...first.items];
  for (let page = 2; items.length < first.total; page += 1) {
    const next = await listTags(scope, { usage, page, pageSize: 100 });
    if (!next.items.length) break;
    items.push(...next.items);
  }
  return items;
}

export function createTag(scope: WorkspaceScope, input: { parent_id?: string; name: string; description?: string; asset_enabled: boolean; prompt_enabled: boolean; inherit_mode?: TagInheritMode; scope_type?: "workspace" | "user" }) {
  return request<SemanticTag>("/api/tags", { method: "POST", query: { scope }, body: input });
}

export function createWorkspaceTag(scope: WorkspaceScope, input: Omit<Parameters<typeof createTag>[1], "scope_type">) {
  return createTag(scope, { ...input, scope_type: "workspace" });
}

export function updateTag(scope: WorkspaceScope, id: string, input: Pick<SemanticTag, "name" | "description" | "asset_enabled" | "prompt_enabled" | "inherit_mode" | "status" | "sort_order">) {
  return request<SemanticTag>(`/api/tags/${encodeURIComponent(id)}`, { method: "PUT", query: { scope }, body: input });
}

export function moveTag(scope: WorkspaceScope, id: string, input: { parent_id?: string; sort_order?: number }) {
  return request<SemanticTag>(`/api/tags/${encodeURIComponent(id)}/move`, { method: "POST", query: { scope }, body: input });
}

export function bulkMoveTags(scope: WorkspaceScope, tagIds: string[], parentId?: string) {
  return request<{ items: SemanticTag[]; count: number }>("/api/tags/bulk-move", { method: "POST", query: { scope }, body: { tag_ids: tagIds, parent_id: parentId || "" } });
}

export function deleteTag(scope: WorkspaceScope, id: string) {
  return request<{ items: SemanticTag[]; count: number }>(`/api/tags/${encodeURIComponent(id)}`, { method: "DELETE", query: { scope } });
}

export function bulkDeleteTags(scope: WorkspaceScope, tagIds: string[]) {
  return request<{ items: SemanticTag[]; count: number }>("/api/tags/bulk-delete", { method: "POST", query: { scope }, body: { tag_ids: tagIds } });
}

export function createTagAlias(scope: WorkspaceScope, id: string, alias: string) {
  return request<{ id: string; tag_id: string; alias: string }>(`/api/tags/${encodeURIComponent(id)}/aliases`, { method: "POST", query: { scope }, body: { alias } });
}

export function deleteTagAlias(scope: WorkspaceScope, id: string, aliasId: string) {
  return request<void>(`/api/tags/${encodeURIComponent(id)}/aliases/${encodeURIComponent(aliasId)}`, { method: "DELETE", query: { scope } });
}

export function listTagAssets(scope: WorkspaceScope, id: string, page = 1, pageSize = 24, signal?: AbortSignal) {
  return request<{ items: Asset[]; total: number }>(`/api/tags/${encodeURIComponent(id)}/assets`, {
    signal,
    query: { scope, include_descendants: true, page, page_size: pageSize },
  });
}
