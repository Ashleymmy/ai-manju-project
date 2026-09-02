import { describe, expect, it } from "vitest";

import {
  DEFAULT_CANVAS_SHORTCUTS,
  eventMatchesShortcut,
  findShortcutConflicts,
  normalizeShortcutCombo,
  normalizeShortcutList,
  resolveCanvasShortcuts,
  shortcutActionOrder,
  shortcutComboFromEvent,
  shortcutDisplay,
} from "./hotkeys";

describe("canvas shortcut bindings", () => {
  it("builds combos with Ctrl and Meta kept distinct", () => {
    expect(shortcutComboFromEvent({ key: "z", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBe("Ctrl+Z");
    expect(shortcutComboFromEvent({ key: "z", ctrlKey: false, metaKey: true, shiftKey: false, altKey: false })).toBe("Meta+Z");
    expect(shortcutComboFromEvent({ key: "Z", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false })).toBe("Ctrl+Shift+Z");
    expect(shortcutComboFromEvent({ key: "Enter", ctrlKey: false, metaKey: true, shiftKey: false, altKey: false })).toBe("Meta+Enter");
    expect(shortcutComboFromEvent({ key: "Control", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBe("");
  });

  it("matches an event against any combo bound to the action", () => {
    const metaZ = { key: "z", ctrlKey: false, metaKey: true, shiftKey: false, altKey: false };
    expect(eventMatchesShortcut(metaZ, DEFAULT_CANVAS_SHORTCUTS.undo)).toBe(true);
    expect(eventMatchesShortcut(metaZ, DEFAULT_CANVAS_SHORTCUTS.redo)).toBe(false);
    expect(eventMatchesShortcut(metaZ, [])).toBe(false);

    const backspace = { key: "Backspace", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
    expect(eventMatchesShortcut(backspace, DEFAULT_CANVAS_SHORTCUTS.delete)).toBe(true);
  });

  it("normalizes combo aliases, ordering and duplicates", () => {
    expect(normalizeShortcutCombo("cmd+shift+p")).toBe("Meta+Shift+P");
    expect(normalizeShortcutCombo("shift+ctrl+z")).toBe("Ctrl+Shift+Z");
    expect(normalizeShortcutCombo("alt+space")).toBe("Alt+Space");
    expect(normalizeShortcutList(["Ctrl+Z", "ctrl+z", "Meta+Z"])).toEqual(["Ctrl+Z", "Meta+Z"]);
  });

  it("covers every action the backend whitelist accepts", () => {
    expect(shortcutActionOrder).toEqual([
      "undo", "redo", "delete", "copy", "paste", "selectAll", "runSelection", "openSettings", "resetZoom",
    ]);
    expect(Object.keys(DEFAULT_CANVAS_SHORTCUTS).sort()).toEqual([...shortcutActionOrder].sort());
    shortcutActionOrder.forEach((action) => {
      expect(DEFAULT_CANVAS_SHORTCUTS[action].length).toBeGreaterThan(0);
    });
  });

  it("merges stored string arrays over defaults and ignores malformed values", () => {
    const resolved = resolveCanvasShortcuts({ undo: ["Ctrl+U"], redo: [], delete: undefined, unknown: ["Ctrl+X"] });
    expect(resolved.undo).toEqual(["Ctrl+U"]);
    expect(resolved.redo).toEqual(DEFAULT_CANVAS_SHORTCUTS.redo);
    expect(resolved.delete).toEqual(DEFAULT_CANVAS_SHORTCUTS.delete);
    expect(resolved.runSelection).toEqual(DEFAULT_CANVAS_SHORTCUTS.runSelection);
  });

  it("detects conflicts at combo level", () => {
    const conflicts = findShortcutConflicts({ ...DEFAULT_CANVAS_SHORTCUTS, undo: ["Ctrl+C"] });
    expect([...conflicts.keys()]).toEqual(["Ctrl+C"]);
    expect(conflicts.get("Ctrl+C")).toEqual(expect.arrayContaining(["undo", "copy"]));
    expect(findShortcutConflicts(DEFAULT_CANVAS_SHORTCUTS).size).toBe(0);
  });

  it("renders Meta as Cmd for display", () => {
    expect(shortcutDisplay("Meta+Shift+Z")).toBe("Cmd + Shift + Z");
  });
});
