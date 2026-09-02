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
  const left = Math.min(viewportWorld.x, ...nodes.map((node) => node.x)) - MINIMAP_WORLD_PADDING;
  const top = Math.min(viewportWorld.y, ...nodes.map((node) => node.y)) - MINIMAP_WORLD_PADDING;
  const right = Math.max(
    viewportWorld.x + viewportWorld.width,
    ...nodes.map((node) => node.x + Math.max(1, node.width)),
  ) + MINIMAP_WORLD_PADDING;
  const bottom = Math.max(
    viewportWorld.y + viewportWorld.height,
    ...nodes.map((node) => node.y + Math.max(1, node.height)),
  ) + MINIMAP_WORLD_PADDING;
  const world = { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
  const panelWidth = Math.max(1, panel.width);
  const panelHeight = Math.max(1, panel.height);
  const scale = Math.min(panelWidth / world.width, panelHeight / world.height);
  const offsetX = (panelWidth - world.width * scale) / 2;
  const offsetY = (panelHeight - world.height * scale) / 2;
  const project = (rect: CanvasMinimapRect): CanvasMinimapRect => ({
    x: offsetX + (rect.x - world.x) * scale,
    y: offsetY + (rect.y - world.y) * scale,
    width: Math.max(1, rect.width * scale),
    height: Math.max(1, rect.height * scale),
  });

  return {
    width: panelWidth,
    height: panelHeight,
    world,
    nodes: nodes.map((node) => ({ id: node.id, ...project(node) })),
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
