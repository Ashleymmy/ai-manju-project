export function isCanvasHotkeyEditingTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  return Boolean(element?.closest(
    "[data-canvas-ui],[data-canvas-no-zoom],input,textarea,select,button,[contenteditable='true']",
  ));
}
