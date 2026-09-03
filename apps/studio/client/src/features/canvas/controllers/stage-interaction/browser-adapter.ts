import { isCanvasHotkeyEditingTarget } from "@/features/canvas/adapters/hotkeyTarget";
import type { CanvasStageInteractionAdapter } from "./types";

function targetElement(target: EventTarget | null) {
  return typeof Element !== "undefined" && target instanceof Element ? target : null;
}

export function createBrowserCanvasStageInteractionAdapter(): CanvasStageInteractionAdapter {
  return {
    now: () => Date.now(),
    createId: () => crypto.randomUUID(),
    requestFrame: callback => window.requestAnimationFrame(callback),
    cancelFrame: frame => window.cancelAnimationFrame(frame),
    setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: timer => clearTimeout(timer),
    getRect: element => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    },
    closest: (target, selector) => targetElement(target)?.closest(selector) || null,
    getAttribute: (element, name) => element?.getAttribute(name) || "",
    elementFromPoint: (clientX, clientY) => document.elementFromPoint(clientX, clientY),
    isHotkeyEditingTarget: target => isCanvasHotkeyEditingTarget(target),
    isInlineNodeEditor: target => Boolean(targetElement(target)?.closest(".node-inline-editor")),
    blurActiveInlineEditorExcept: nodeId => {
      const active = document.activeElement;
      if (
        active instanceof HTMLElement
        && active.matches(".node-inline-editor")
        && active.dataset.nodeInlineEditorId !== nodeId
      ) {
        active.blur();
      }
    },
    focusInlineEditor: (stage, nodeId) => {
      const editors = stage?.querySelectorAll<HTMLTextAreaElement>(".node-inline-editor") ?? [];
      const editor = Array.from(editors).find(
        item => item.dataset.nodeInlineEditorId === nodeId,
      );
      editor?.focus();
      editor?.setSelectionRange(editor.value.length, editor.value.length);
    },
    capturePointer: (element, pointerId) => {
      try {
        element.setPointerCapture(pointerId);
      } catch {
        // 元素可能已从 DOM 卸载；后续全局监听仍会完成状态清理。
      }
    },
    releasePointer: (element, pointerId) => {
      try {
        if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      } catch {
        // 浏览器已自动释放 capture 时无需重复处理。
      }
    },
    setPanCursor: active => {
      document.body.style.cursor = active ? "grabbing" : "";
    },
    setConnectionHandleMagnet: (element, active, offset) => {
      element.classList.toggle("handle-magnet", active);
      element.style.transform = active && offset
        ? `translate(${(offset.x * offset.strength).toFixed(1)}px, ${(offset.y * offset.strength).toFixed(1)}px) scale(1.4)`
        : "";
    },
    addWindowListener: (type, listener, options) => {
      const eventListener = listener as EventListener;
      window.addEventListener(type, eventListener, options);
      return () => window.removeEventListener(type, eventListener, options);
    },
    addWheelListener: (element, listener) => {
      const eventListener = listener as EventListener;
      element.addEventListener("wheel", eventListener, { passive: false });
      return () => element.removeEventListener("wheel", eventListener);
    },
    observeStage: (element, listener) => {
      const update = () => {
        const rect = element.getBoundingClientRect();
        listener({ width: rect.width, height: rect.height });
      };
      update();
      const observer = typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(update);
      observer?.observe(element);
      window.addEventListener("resize", update);
      return () => {
        observer?.disconnect();
        window.removeEventListener("resize", update);
      };
    },
  };
}
