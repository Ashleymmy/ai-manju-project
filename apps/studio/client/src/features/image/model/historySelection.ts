/** 切换生成记录的勾选状态，已选则取消，未选则加入 */
export function toggleHistorySelection(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

/** 全选：未全选则选中全部，已全选则清空 */
export function nextHistorySelectAll(current: string[], available: string[]): string[] {
  if (!available.length) return [];
  const selected = new Set(current);
  const allSelected = available.every((id) => selected.has(id));
  return allSelected ? [] : [...available];
}

/** 历史列表变化后丢掉已不存在的勾选 */
export function pruneHistorySelection(current: string[], available: string[]): string[] {
  if (!current.length) return current;
  const valid = new Set(available);
  const next = current.filter((id) => valid.has(id));
  return next.length === current.length ? current : next;
}
