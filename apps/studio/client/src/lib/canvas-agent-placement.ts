import type { CanvasAgentNode as ProtocolNode } from "@ai-manju/canvas-agent-protocol";
import { MAX_IMAGE_GENERATION_COUNT } from "@/shared/config/generation";

type CanvasAgentNode = ProtocolNode<string>;

/** Canvas units. Reserve space for the output before its asynchronous creation. */
const FLOW_LAYOUT = {
  rowGap: 80,
  outputGap: 96,
  outputOffsetY: 24,
  outputWidth: 420,
  outputHeight: 260,
  imageWidth: 320,
  imageHeight: 238,
  batchGap: 36,
  textHeight: 170,
  textRowStep: 206,
} as const;

type Box = { left: number; top: number; right: number; bottom: number };

function flowId(node: CanvasAgentNode) {
  const value = node.metadata?.agentGenerationFlowId;
  return typeof value === "string" ? value : "";
}

function box(node: CanvasAgentNode): Box {
  return { left: node.position.x, top: node.position.y,
    right: node.position.x + node.width, bottom: node.position.y + node.height };
}

function bounds(boxes: Box[]): Box {
  return {
    left: Math.min(...boxes.map(item => item.left)),
    top: Math.min(...boxes.map(item => item.top)),
    right: Math.max(...boxes.map(item => item.right)),
    bottom: Math.max(...boxes.map(item => item.bottom)),
  };
}

function reservedBox(node: CanvasAgentNode): Box {
  if (node.type !== "config" || !flowId(node)) return box(node);
  const countValue = Number(node.metadata?.count);
  const count = Number.isFinite(countValue) ? Math.min(MAX_IMAGE_GENERATION_COUNT, Math.max(1, Math.floor(countValue))) : 1;
  const mode = node.metadata?.generationMode;
  const left = node.position.x + node.width + FLOW_LAYOUT.outputGap;
  let top = node.position.y + FLOW_LAYOUT.outputOffsetY;
  let bottom = top + FLOW_LAYOUT.outputHeight;
  let right = left + FLOW_LAYOUT.outputWidth;
  // Image batches extend above the primary result, then into columns on its right.
  if (mode === "image" && count > 1) {
    top -= FLOW_LAYOUT.imageHeight + FLOW_LAYOUT.batchGap;
    right = left + FLOW_LAYOUT.imageWidth
      + Math.ceil((count - 2) / 2) * (FLOW_LAYOUT.imageWidth + FLOW_LAYOUT.batchGap);
  } else if (mode === "text") {
    top = node.position.y - (count - 1) / 2 * FLOW_LAYOUT.textRowStep;
    bottom = node.position.y + (count - 1) / 2 * FLOW_LAYOUT.textRowStep + FLOW_LAYOUT.textHeight;
  } else if (mode === "audio") {
    bottom = Math.max(bottom, node.position.y + node.height);
  }
  return bounds([box(node), { left, top, right, bottom }]);
}

/** Include future outputs when bringing a newly created flow into the visible canvas. */
export function canvasAgentGenerationFootprint(nodes: readonly CanvasAgentNode[]) {
  return nodes.map(reservedBox).map(item => ({ x: item.left, y: item.top,
    width: item.right - item.left, height: item.bottom - item.top }));
}

/** Only new Agent generation flows are placed. Existing nodes and explicit moves stay intact.
 * Run against the live snapshot when applying ops, including ops received from the local Agent.
 */
export function placeCanvasAgentGenerationFlows<TNode extends CanvasAgentNode>(before: readonly TNode[], after: TNode[]): TNode[] {
  const existingIds = new Set(before.map(node => node.id));
  const incoming = after.filter(node => !existingIds.has(node.id) && flowId(node));
  if (!incoming.length) return after;
  const incomingIds = new Set(incoming.map(node => node.id));
  const placed = after.filter(node => !incomingIds.has(node.id));
  const replacements = new Map<string, TNode>();
  for (const id of new Set(incoming.map(flowId))) {
    const group = incoming.filter(node => flowId(node) === id);
    const groupBox = bounds(group.map(reservedBox));
    const lastFlowId = [...placed].reverse().map(flowId).find(Boolean);
    const previous = lastFlowId ? placed.filter(node => flowId(node) === lastFlowId) : placed;
    // Include outputs and batch children even though they are created by the generation controller.
    const previousIds = new Set(previous.map(node => node.id));
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const node of placed) {
        if (!previousIds.has(node.id) && [node.metadata?.sourceNodeId, node.metadata?.batchRootId]
          .some(source => typeof source === "string" && previousIds.has(source))) {
          previous.push(node);
          previousIds.add(node.id);
          expanded = true;
        }
      }
    }
    const previousBox = previous.length ? bounds(previous.map(reservedBox)) : null;
    const left = previousBox?.left ?? 0;
    let top = previousBox ? previousBox.bottom + FLOW_LAYOUT.rowGap : 0;
    const width = groupBox.right - groupBox.left;
    const height = groupBox.bottom - groupBox.top;
    // Move downward only: never bounce left/right when another node occupies the next row.
    const obstacles = placed.map(reservedBox);
    while (true) {
      const collisions = obstacles.filter(item =>
        left < item.right + FLOW_LAYOUT.rowGap && left + width + FLOW_LAYOUT.rowGap > item.left
        && top < item.bottom + FLOW_LAYOUT.rowGap && top + height + FLOW_LAYOUT.rowGap > item.top);
      if (!collisions.length) break;
      top = Math.max(...collisions.map(item => item.bottom)) + FLOW_LAYOUT.rowGap;
    }
    for (const node of group) {
      const next = { ...node, position: {
        x: node.position.x + left - groupBox.left,
        y: node.position.y + top - groupBox.top,
      } };
      replacements.set(node.id, next);
      placed.push(next);
    }
  }
  return after.map(node => replacements.get(node.id) || node);
}
