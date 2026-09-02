export type CanvasGroupNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasGroupData = Record<string, unknown> & {
  id: string;
  title: string;
  nodeIds: string[];
  position: { x: number; y: number };
  width: number;
  height: number;
  color: string;
};

export type CanvasGroupResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const GROUP_HORIZONTAL_PADDING = 28;
const GROUP_HEADER_HEIGHT = 46;
const GROUP_BOTTOM_PADDING = 28;

export function createCanvasGroup(
  nodes: readonly CanvasGroupNode[],
  selectedIds: Iterable<string>,
  id: string,
  title = "新分组",
  color = "#7dd3fc",
) {
  const selected = new Set(selectedIds);
  const members = nodes.filter((node) => selected.has(node.id));
  if (members.length < 2) return null;
  return buildCanvasGroup(members, id, title, color);
}

function buildCanvasGroup(
  members: readonly CanvasGroupNode[],
  id: string,
  title = "新分组",
  color = "#7dd3fc",
) {
  const bounds = nodeBounds(members);
  return {
    id,
    title,
    nodeIds: members.map((node) => node.id),
    position: { x: bounds.left - GROUP_HORIZONTAL_PADDING, y: bounds.top - GROUP_HEADER_HEIGHT },
    width: bounds.right - bounds.left + GROUP_HORIZONTAL_PADDING * 2,
    height: bounds.bottom - bounds.top + GROUP_HEADER_HEIGHT + GROUP_BOTTOM_PADDING,
    color,
  } satisfies CanvasGroupData;
}

export function normalizeCanvasGroups(value: unknown, nodes: readonly CanvasGroupNode[]) {
  if (!Array.isArray(value)) return [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const source = item as Record<string, unknown>;
    const members = Array.isArray(source.nodeIds)
      ? source.nodeIds.filter((id): id is string => typeof id === "string" && nodeIds.has(id))
      : [];
    if (!members.length) return [];
    const memberNodes = nodes.filter((node) => members.includes(node.id));
    const fallback = buildCanvasGroup(memberNodes, stringValue(source.id) || `group-${index + 1}`);
    const position = recordValue(source.position);
    return [{
      ...source,
      id: stringValue(source.id) || fallback.id,
      title: stringValue(source.title) || fallback.title,
      nodeIds: members,
      position: {
        ...position,
        x: numberValue(position.x) ?? numberValue(source.x) ?? fallback.position.x,
        y: numberValue(position.y) ?? numberValue(source.y) ?? fallback.position.y,
      },
      width: Math.max(120, numberValue(source.width) ?? fallback.width),
      height: Math.max(90, numberValue(source.height) ?? fallback.height),
      color: stringValue(source.color) || fallback.color,
    } satisfies CanvasGroupData];
  });
}

export function removeNodesFromCanvasGroups(groups: readonly CanvasGroupData[], removedIds: Iterable<string>) {
  const removed = new Set(removedIds);
  return groups.flatMap((group) => {
    const nodeIds = group.nodeIds.filter((id) => !removed.has(id));
    return nodeIds.length ? [{ ...group, nodeIds }] : [];
  });
}

export function resizeCanvasGroup(
  group: CanvasGroupData,
  corner: CanvasGroupResizeCorner,
  deltaX: number,
  deltaY: number,
  minWidth = 260,
  minHeight = 180,
) {
  const fromLeft = corner.includes("left");
  const fromTop = corner.includes("top");
  const right = group.position.x + group.width;
  const bottom = group.position.y + group.height;
  const width = Math.max(minWidth, group.width + (fromLeft ? -deltaX : deltaX));
  const height = Math.max(minHeight, group.height + (fromTop ? -deltaY : deltaY));
  return {
    ...group,
    position: {
      x: fromLeft ? right - width : group.position.x,
      y: fromTop ? bottom - height : group.position.y,
    },
    width,
    height,
  };
}

function nodeBounds(nodes: readonly CanvasGroupNode[]) {
  return nodes.reduce((bounds, node) => ({
    left: Math.min(bounds.left, node.x),
    top: Math.min(bounds.top, node.y),
    right: Math.max(bounds.right, node.x + node.width),
    bottom: Math.max(bounds.bottom, node.y + node.height),
  }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
