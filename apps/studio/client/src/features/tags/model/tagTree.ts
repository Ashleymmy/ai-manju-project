import type { SemanticTag } from "@/entities/tag";

export type TagTreeRow = {
  tag: SemanticTag;
  depth: number;
};

function compareTags(left: SemanticTag, right: SemanticTag) {
  return left.sort_order - right.sort_order || left.name.localeCompare(right.name, "zh-CN");
}

export function filterTagsWithAncestors(tags: readonly SemanticTag[], keyword: string) {
  const query = keyword.trim().toLocaleLowerCase();
  if (!query) return [...tags];
  const byId = new Map(tags.map((tag) => [tag.id, tag] as const));
  const included = new Set<string>();

  tags.forEach((tag) => {
    const matched = tag.name.toLocaleLowerCase().includes(query)
      || tag.aliases?.some((item) => item.alias.toLocaleLowerCase().includes(query));
    if (!matched) return;
    const seen = new Set<string>();
    let current: SemanticTag | undefined = tag;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      included.add(current.id);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
  });

  return tags.filter((tag) => included.has(tag.id));
}

export function flattenTagTree(tags: readonly SemanticTag[]): TagTreeRow[] {
  const byId = new Map(tags.map((tag) => [tag.id, tag] as const));
  const byParent = new Map<string, SemanticTag[]>();
  tags.forEach((tag) => {
    const parentId = tag.parent_id && byId.has(tag.parent_id) ? tag.parent_id : "";
    byParent.set(parentId, [...(byParent.get(parentId) || []), tag]);
  });
  byParent.forEach((items) => items.sort(compareTags));

  const rows: TagTreeRow[] = [];
  const visited = new Set<string>();
  const visit = (tag: SemanticTag, depth: number) => {
    if (visited.has(tag.id)) return;
    visited.add(tag.id);
    rows.push({ tag, depth });
    (byParent.get(tag.id) || []).forEach((child) => visit(child, depth + 1));
  };
  (byParent.get("") || []).forEach((tag) => visit(tag, 0));
  [...tags].sort(compareTags).forEach((tag) => visit(tag, 0));
  return rows;
}

export function collectTagSubtreeIds(tags: readonly SemanticTag[], rootIds: readonly string[]) {
  const children = new Map<string, string[]>();
  tags.forEach((tag) => children.set(tag.parent_id, [...(children.get(tag.parent_id) || []), tag.id]));
  const result = new Set<string>();
  const visit = (id: string) => {
    if (result.has(id)) return;
    result.add(id);
    (children.get(id) || []).forEach(visit);
  };
  rootIds.forEach(visit);
  return result;
}

export function semanticTagPath(tagId: string, tags: readonly SemanticTag[]) {
  const byId = new Map(tags.map((tag) => [tag.id, tag] as const));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(tagId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return names.join(" / ");
}
