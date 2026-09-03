import { useEffect, useSyncExternalStore, type RefObject } from "react";
import type { CanvasStageViewport } from "./types";
import type { CanvasStageInteractionController } from "./controller";

export function useCanvasStageInteraction(
  controller: CanvasStageInteractionController,
  stageRef: RefObject<HTMLElement | null>,
  viewport: CanvasStageViewport,
) {
  const view = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    controller.syncViewport(viewport);
  }, [controller, viewport.panX, viewport.panY, viewport.zoom]);

  useEffect(() => controller.mount(stageRef.current), [controller, stageRef]);

  return view;
}
