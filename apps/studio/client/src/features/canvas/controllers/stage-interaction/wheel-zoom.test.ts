// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStageInteractionController } from "./controller";

const controllers: CanvasStageInteractionController[] = [];
function mountCanvas() {
  const stage = document.createElement("section");
  document.body.append(stage);
  const controller = new CanvasStageInteractionController();
  controllers.push(controller);
  controller.mount(stage);
  return controller;
}
function wheel(target: HTMLElement, options: WheelEventInit = {}) {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100, ...options });
  target.dispatchEvent(event);
  return event;
}
afterEach(() => { controllers.splice(0).forEach(controller => controller.dispose()); document.body.replaceChildren(); });

describe("canvas browser zoom guard", () => {
  it.each(["ctrlKey", "metaKey"])("blocks %s browser zoom over panels and body portals even if a child stops propagation", modifier => {
    mountCanvas();
    // Floating inspectors / Agent panels and portal dialogs sit outside the stage.
    const panel = document.createElement("aside");
    panel.dataset.canvasUi = "";
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const editor = document.createElement("textarea");
    dialog.append(editor);
    document.body.append(panel, dialog);
    panel.addEventListener("wheel", event => event.stopPropagation());
    editor.addEventListener("wheel", event => event.stopPropagation());
    expect(wheel(panel, { [modifier]: true }).defaultPrevented).toBe(true);
    expect(wheel(editor, { [modifier]: true }).defaultPrevented).toBe(true);
  });

  it("preserves ordinary panel scrolling and restores browser wheel zoom when leaving the canvas", () => {
    const controller = mountCanvas();
    const editor = document.createElement("textarea");
    document.body.append(editor);
    expect(wheel(editor).defaultPrevented).toBe(false);
    expect(wheel(editor, { ctrlKey: true }).defaultPrevented).toBe(true);
    controller.unmount();
    expect(wheel(editor, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(wheel(editor, { metaKey: true }).defaultPrevented).toBe(false);
  });

  it("does not intercept wheel zoom when no canvas stage is mounted", () => {
    const controller = new CanvasStageInteractionController();
    controllers.push(controller);
    controller.mount(null);
    expect(wheel(document.body, { ctrlKey: true }).defaultPrevented).toBe(false);
  });
});
