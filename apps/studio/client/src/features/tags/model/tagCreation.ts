import type { SemanticTag } from "@/entities/tag";
import { ApiError } from "@/shared/api/errors";

/** The deployed HTTP origin does not expose crypto.randomUUID in every browser. */
export function createTagAttemptKey() {
  return globalThis.crypto?.randomUUID?.() || `tag_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/** Match the API's case-insensitive, whitespace-collapsed sibling names. */
export function normalizeTagName(name: string) {
  return name.replace(/\p{White_Space}+/gu, " ").trim();
}

export function findTagNameConflict(tags: SemanticTag[], name: string, parentId: string, scopeType: "workspace" | "user") {
  const normalized = normalizeTagName(name).toLowerCase();
  return tags.find(tag => tag.editable && tag.scope_type === scopeType && (tag.parent_id || "") === parentId
    && normalizeTagName(tag.name).toLowerCase() === normalized);
}

export function isTagNameConflict(error: unknown) {
  return error instanceof ApiError && error.status === 409 && error.message === "tag already exists";
}

export function tagCreationError(error: unknown) {
  if (isTagNameConflict(error)) return "创建标签时发生冲突，已保留输入，请联系管理员查看运行监控。";
  if (error instanceof ApiError) {
    if (error.status === 0) return "暂未确认创建结果，请重试；相同内容不会重复创建。";
    if (error.message === "tag parent is invalid") return "所选父级不可用，请重新选择父级。";
    if (error.message === "tag scope is invalid") return "标签归属与用途不匹配；仅自己可见的标签只能用于提示词。";
    if (error.message === "tag name is too long") return "标签名称最多 64 个字符，请缩短后重试。";
  }
  return "创建标签失败，请稍后重试。";
}
