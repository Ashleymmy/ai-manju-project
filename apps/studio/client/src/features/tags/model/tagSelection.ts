/** Limit range and select-all operations to the visible, editable rows. */
export function setTagSelection(selected: readonly string[], ids: readonly string[], checked: boolean) {
  const next = new Set(selected);
  ids.forEach(id => checked ? next.add(id) : next.delete(id));
  return [...next];
}

export function toggleTagRange(selected: readonly string[], visibleIds: readonly string[], id: string, anchor: string, range: boolean) {
  const index = visibleIds.indexOf(id);
  if (index < 0) return [...selected];
  const from = visibleIds.indexOf(anchor);
  const targets = range && from >= 0
    ? visibleIds.slice(Math.min(from, index), Math.max(from, index) + 1) : [id];
  return setTagSelection(selected, targets, !selected.includes(id));
}
