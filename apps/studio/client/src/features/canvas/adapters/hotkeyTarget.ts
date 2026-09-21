export function isCanvasHotkeyEditingTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  if (!element) return false;

  // Video/audio cards use data-canvas-no-zoom so their controls do not zoom the
  // canvas. That marker must not suppress node copy/paste when the media itself
  // has focus; the surrounding canvas still owns Ctrl/Cmd+C and Ctrl/Cmd+V.
  const isMediaElement = element.tagName === "VIDEO" || element.tagName === "AUDIO";
  const selector = isMediaElement
    ? "[data-canvas-ui],input,textarea,select,button,[contenteditable='true']"
    : "[data-canvas-ui],[data-canvas-no-zoom],input,textarea,select,button,[contenteditable='true']";
  return Boolean(element.closest(selector));
}
