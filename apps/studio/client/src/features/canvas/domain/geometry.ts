import type { CanvasEdgeData, CanvasNodeData } from "./types";
import type { CanvasPoint } from "./selection";
import { canvasConnectionCurvature, isHiddenCanvasConnectionEndpoint } from "./connections";

export function cubicCanvasPoint(t: number, p0: number, p1: number, p2: number, p3: number) {
  const inverse = 1 - t;
  return inverse ** 3 * p0 + 3 * inverse ** 2 * t * p1 + 3 * inverse * t ** 2 * p2 + t ** 3 * p3;
}

export function distanceToCanvasSegment(point: CanvasPoint, start: CanvasPoint, end: CanvasPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function distanceToCanvasEdge(point: CanvasPoint, from: CanvasNodeData, to: CanvasNodeData) {
  const start = { x: from.x + from.width, y: from.y + from.height / 2 };
  const end = { x: to.x, y: to.y + to.height / 2 };
  const curvature = canvasConnectionCurvature(start.x, end.x);
  const controlA = { x: start.x + curvature, y: start.y };
  const controlB = { x: end.x - curvature, y: end.y };
  let previous = start;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i <= 32; i += 1) {
    const t = i / 32;
    const current = {
      x: cubicCanvasPoint(t, start.x, controlA.x, controlB.x, end.x),
      y: cubicCanvasPoint(t, start.y, controlA.y, controlB.y, end.y),
    };
    best = Math.min(best, distanceToCanvasSegment(point, previous, current));
    previous = current;
  }
  return best;
}

export function nearestCanvasEdgeIdAtPoint(point: CanvasPoint, edges: CanvasEdgeData[], nodes: CanvasNodeData[], radius: number) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  let bestEdgeId = "";
  let bestDistance = radius;
  for (const edge of edges) {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);
    if (!from || !to || isHiddenCanvasConnectionEndpoint(from, nodes) || isHiddenCanvasConnectionEndpoint(to, nodes)) continue;
    const distance = distanceToCanvasEdge(point, from, to);
    if (distance <= bestDistance) {
      bestDistance = distance;
      bestEdgeId = edge.id;
    }
  }
  return bestEdgeId;
}
