export type CanvasMinimapNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasMinimapViewport = {
  zoom: number;
  panX: number;
  panY: number;
};

export type CanvasMinimapRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasMinimapModel = {
  width: number;
  height: number;
  world: CanvasMinimapRect;
  nodes: Array<CanvasMinimapRect & { id: string }>;
  viewport: CanvasMinimapRect;
};

const MINIMAP_WORLD_PADDING = 80;
// Keep navigation space around a compact scene without misrepresenting its viewport.
const MINIMAP_VIEWPORT_CONTEXT = 2;

export function buildCanvasMinimapModel(
  nodes: readonly CanvasMinimapNode[],
  viewport: CanvasMinimapViewport,
  stage: { width: number; height: number },
  panel: { width: number; height: number },
): CanvasMinimapModel {
  const zoomScale = Math.max(0.05, viewport.zoom / 100);
  const viewportWorld = {
    x: -viewport.panX / zoomScale,
    y: -viewport.panY / zoomScale,
    width: Math.max(1, stage.width / zoomScale),
    height: Math.max(1, stage.height / zoomScale),
  };
  const content = nodes.length ? nodes : [viewportWorld];
  const contentLeft = Math.min(...content.map(node => node.x));
  const contentTop = Math.min(...content.map(node => node.y));
  const contentRight = Math.max(...content.map(node => node.x + Math.max(1, node.width)));
  const contentBottom = Math.max(...content.map(node => node.y + Math.max(1, node.height)));
  const contextWidth = Math.max(contentRight - contentLeft + MINIMAP_WORLD_PADDING * 2, viewportWorld.width * MINIMAP_VIEWPORT_CONTEXT);
  const contextHeight = Math.max(contentBottom - contentTop + MINIMAP_WORLD_PADDING * 2, viewportWorld.height * MINIMAP_VIEWPORT_CONTEXT);
  const left = Math.min((contentLeft + contentRight - contextWidth) / 2, viewportWorld.x - MINIMAP_WORLD_PADDING);
  const top = Math.min((contentTop + contentBottom - contextHeight) / 2, viewportWorld.y - MINIMAP_WORLD_PADDING);
  const right = Math.max((contentLeft + contentRight + contextWidth) / 2, viewportWorld.x + viewportWorld.width + MINIMAP_WORLD_PADDING);
  const bottom = Math.max((contentTop + contentBottom + contextHeight) / 2, viewportWorld.y + viewportWorld.height + MINIMAP_WORLD_PADDING);
  const world = { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
  const panelWidth = Math.max(1, panel.width);
  const panelHeight = Math.max(1, panel.height);
  const scale = Math.min(panelWidth / world.width, panelHeight / world.height);
  const offsetX = (panelWidth - world.width * scale) / 2;
  const offsetY = (panelHeight - world.height * scale) / 2;
  const project = (rect: CanvasMinimapRect): CanvasMinimapRect => ({
    x: offsetX + (rect.x - world.x) * scale,
    y: offsetY + (rect.y - world.y) * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  });

  return {
    width: panelWidth,
    height: panelHeight,
    world,
    nodes: nodes.map((node) => {
      const rect = project(node);
      return { id: node.id, ...rect, width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
    }),
    viewport: project(viewportWorld),
  };
}

export function canvasMinimapWorldPoint(
  model: CanvasMinimapModel,
  point: { x: number; y: number },
) {
  const scale = Math.min(model.width / model.world.width, model.height / model.world.height);
  const offsetX = (model.width - model.world.width * scale) / 2;
  const offsetY = (model.height - model.world.height * scale) / 2;
  return {
    x: model.world.x + (point.x - offsetX) / scale,
    y: model.world.y + (point.y - offsetY) / scale,
  };
}

// Reproject just the live viewport while a gesture keeps its original map frame.
export function canvasMinimapViewportInFrame(model: CanvasMinimapModel, frame: CanvasMinimapModel): CanvasMinimapRect {
  const world = canvasMinimapWorldPoint(model, model.viewport);
  const modelScale = Math.min(model.width / model.world.width, model.height / model.world.height);
  const frameScale = Math.min(frame.width / frame.world.width, frame.height / frame.world.height);
  return {
    x: (frame.width - frame.world.width * frameScale) / 2 + (world.x - frame.world.x) * frameScale,
    y: (frame.height - frame.world.height * frameScale) / 2 + (world.y - frame.world.y) * frameScale,
    width: model.viewport.width / modelScale * frameScale,
    height: model.viewport.height / modelScale * frameScale,
  };
}
