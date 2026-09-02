export type CanvasShortcutAction =
  | "undo"
  | "redo"
  | "delete"
  | "copy"
  | "paste"
  | "selectAll"
  | "runSelection"
  | "openSettings"
  | "resetZoom";

/** 每个动作可绑定多个候选组合键，形如 { undo: ["Ctrl+Z", "Meta+Z"] }，与后端 shortcuts bucket 契约一致。 */
export type CanvasShortcutBindings = Record<CanvasShortcutAction, string[]>;

export const shortcutActionOrder: CanvasShortcutAction[] = [
  "undo",
  "redo",
  "delete",
  "copy",
  "paste",
  "selectAll",
  "runSelection",
  "openSettings",
  "resetZoom",
];

export const CANVAS_SHORTCUT_LABELS: Record<CanvasShortcutAction, string> = {
  undo: "撤销",
  redo: "重做",
  delete: "删除选中",
  copy: "复制选中",
  paste: "粘贴",
  selectAll: "全选节点",
  runSelection: "运行选中生成",
  openSettings: "打开属性面板",
  resetZoom: "重置缩放",
};

export const DEFAULT_CANVAS_SHORTCUTS: CanvasShortcutBindings = {
  undo: ["Ctrl+Z", "Meta+Z"],
  redo: ["Ctrl+Shift+Z", "Meta+Shift+Z", "Ctrl+Y"],
  delete: ["Delete", "Backspace"],
  copy: ["Ctrl+C", "Meta+C"],
  paste: ["Ctrl+V", "Meta+V"],
  selectAll: ["Ctrl+A", "Meta+A"],
  runSelection: ["Ctrl+Enter", "Meta+Enter"],
  openSettings: ["Ctrl+,"],
  resetZoom: ["Ctrl+0", "Meta+0"],
};

const MODIFIER_KEYS = new Set(["Control", "Meta", "Shift", "Alt"]);

type ShortcutEventLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">;

/**
 * 从按键事件生成规范化组合键。修饰键顺序固定为 Ctrl, Meta, Alt, Shift；
 * Ctrl 与 Meta 分开保留，便于同一动作同时绑定 Windows 与 macOS 习惯键位。
 */
export function shortcutComboFromEvent(event: ShortcutEventLike) {
  if (MODIFIER_KEYS.has(event.key)) return "";
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.metaKey) modifiers.push("Meta");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  return [...modifiers, normalizeShortcutKey(event.key)].join("+");
}

export function eventMatchesShortcut(event: ShortcutEventLike, combos: string[]) {
  const combo = shortcutComboFromEvent(event);
  return Boolean(combo && normalizeShortcutList(combos).includes(combo));
}

export function normalizeShortcutCombo(value: string) {
  const parts = String(value || "").split("+").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return "";
  const key = parts.at(-1) as string;
  const modifiers = new Set(parts.slice(0, -1).map((part) => {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control") return "Ctrl";
    if (lower === "meta" || lower === "cmd" || lower === "command") return "Meta";
    if (lower === "alt" || lower === "option") return "Alt";
    if (lower === "shift") return "Shift";
    return part;
  }));
  return [
    ...(modifiers.has("Ctrl") ? ["Ctrl"] : []),
    ...(modifiers.has("Meta") ? ["Meta"] : []),
    ...(modifiers.has("Alt") ? ["Alt"] : []),
    ...(modifiers.has("Shift") ? ["Shift"] : []),
    normalizeShortcutKey(key),
  ].join("+");
}

export function normalizeShortcutList(combos: string[]) {
  const seen = new Set<string>();
  return (combos || [])
    .map((combo) => normalizeShortcutCombo(combo))
    .filter((combo) => {
      if (!combo || seen.has(combo)) return false;
      seen.add(combo);
      return true;
    });
}

export function shortcutDisplay(combo: string) {
  return combo.replaceAll("Meta", "Cmd").replaceAll("+", " + ");
}

export function resolveCanvasShortcuts(stored?: Partial<Record<string, string[]>> | null): CanvasShortcutBindings {
  const bindings = { ...DEFAULT_CANVAS_SHORTCUTS };
  if (!stored) return bindings;
  shortcutActionOrder.forEach((action) => {
    const value = stored[action];
    if (!Array.isArray(value)) return;
    const normalized = normalizeShortcutList(value);
    if (normalized.length) bindings[action] = normalized;
  });
  return bindings;
}

/** 返回冲突组：组合键 -> 共用它的动作列表（仅含冲突项）。 */
export function findShortcutConflicts(bindings: CanvasShortcutBindings) {
  const byCombo = new Map<string, CanvasShortcutAction[]>();
  shortcutActionOrder.forEach((action) => {
    normalizeShortcutList(bindings[action] || []).forEach((combo) => {
      byCombo.set(combo, [...(byCombo.get(combo) || []), action]);
    });
  });
  return new Map([...byCombo].filter(([, actions]) => actions.length > 1));
}

function normalizeShortcutKey(key: string) {
  if (key === " " || key.toLowerCase() === "space" || key === "Spacebar") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return key;
}
