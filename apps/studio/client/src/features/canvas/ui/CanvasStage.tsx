import {
  Boxes,
  ClipboardPaste,
  Film,
  GitMerge,
  Image as ImageIcon,
  Images,
  Loader2,
  Music2,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Type,
  Ungroup,
  WandSparkles,
} from "lucide-react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent,
  ReactNode,
  RefObject,
} from "react";
import { toast } from "sonner";
import { useMemo, useRef } from "react";
import { useOutsidePress } from "@/shared/lib/useOutsidePress";
import MetaBallOrb from "@/components/MetaBallOrb";
import {
  buildCanvasConnectionLayerBounds,
  canvasConnectionCurvature,
  canvasConnectionDisplayNode,
  isHiddenCanvasConnectionEndpoint,
} from "@/features/canvas/domain/connections";
import type { CanvasGroupData, CanvasGroupResizeCorner } from "@/features/canvas/domain/groups";
import type { CanvasMinimapModel } from "@/features/canvas/domain/minimap";
import type { CanvasAlignGuide } from "@/features/canvas/domain/nodeSnap";
import { imageSrcFromNode } from "@/features/canvas/domain/nodes";
import type {
  CanvasBackgroundMode,
  CanvasEdgeData,
  CanvasNodeData,
  CanvasNodeKind,
} from "@/features/canvas/domain/types";
import type { CanvasPinnedMarker } from "@/features/canvas/domain/pin";
import {
  CanvasNodeCard,
  type CanvasNodeCardActions,
  type CanvasNodeCardProps,
  type ConnectionHandleType,
} from "./CanvasNodeCard";
import {
  CanvasBottomToolbar,
  CanvasPinRail,
  CanvasTopToolbar,
  type CanvasBottomToolbarProps,
  type CanvasTopToolbarProps,
} from "./CanvasToolbar";

type CanvasContextMenuState = {
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
  nodeId?: string;
  edgeId?: string;
};

type CanvasConnectionDraft = {
  nodeId: string;
  handleType: ConnectionHandleType;
};

type PendingConnectionCreateState = {
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
  connection: CanvasConnectionDraft;
};

function groupConnectionNode(
  group: CanvasGroupData,
  nodeMap: Map<string, CanvasNodeData>,
  side: "left" | "right",
) {
  const members = group.nodeIds
    .map(nodeId => nodeMap.get(nodeId))
    .filter((node): node is CanvasNodeData => Boolean(node));
  return members.reduce<CanvasNodeData | null>((best, node) => {
    if (!best) return node;
    const nodePosition = side === "left" ? node.x : node.x + node.width;
    const bestPosition = side === "left" ? best.x : best.x + best.width;
    return side === "left"
      ? nodePosition < bestPosition ? node : best
      : nodePosition > bestPosition ? node : best;
  }, null);
}

type CanvasStageActions = {
  handleStagePointerDown: (event: PointerEvent<HTMLElement>) => void;
  openCanvasContextMenu: (event: ReactMouseEvent<Element>) => void;
  handleCanvasDoubleClick: (event: ReactMouseEvent<Element>) => void;
  uploadFilesAsNodes: (files: FileList | File[], position?: { x: number; y: number }) => Promise<unknown>;
  selectCanvasGroup: (group: CanvasGroupData) => void;
  startGroupDrag: (event: PointerEvent<HTMLElement>, group: CanvasGroupData) => void;
  moveGroupDrag: (event: PointerEvent<HTMLElement>) => void;
  endGroupDrag: () => void;
  startGroupResize: (event: PointerEvent<HTMLElement>, group: CanvasGroupData, corner: CanvasGroupResizeCorner) => void;
  moveGroupResize: (event: PointerEvent<HTMLElement>) => void;
  endGroupResize: (event: PointerEvent<HTMLElement>) => void;
  handleCanvasLinesPointerDown: (event: PointerEvent<SVGSVGElement>) => void;
  handleCanvasLinesPointerMove: (event: PointerEvent<SVGSVGElement>) => void;
  handleCanvasLinesPointerLeave: () => void;
  handleCanvasLinesClick: (event: ReactMouseEvent<SVGSVGElement>) => void;
  handleCanvasLinesDoubleClick: (event: ReactMouseEvent<SVGSVGElement>) => void;
  handleCanvasLinesContextMenu: (event: ReactMouseEvent<SVGSVGElement>) => void;
  handleEdgeClick: (edgeId: string) => void;
  removeEdge: (edgeId: string) => void;
  setHoveredEdgeId: (edgeId: string) => void;
  clientToStagePoint: (clientX: number, clientY: number) => { x: number; y: number };
  screenToCanvasPoint: (clientX: number, clientY: number) => { x: number; y: number };
  setContextMenu: (menu: CanvasContextMenuState | null) => void;
  toggleAgent: () => void;
  navigateFromMinimap: (event: ReactMouseEvent<SVGSVGElement>) => void;
  node: CanvasNodeCardActions;
  activateConnectionMode: (nodeId: string) => void;
  copySelectedNodes: () => void;
  openConnectSelection: () => void;
  generateFromNode: (nodeId?: string) => Promise<unknown>;
  renderCanvasSubmenu: (key: string, icon: ReactNode, label: string, items: ReactNode) => ReactNode;
  copyCanvasImagePrompt: (node: CanvasNodeData) => Promise<unknown>;
  addNode: (kind: CanvasNodeKind, position?: { x: number; y: number }) => void;
  pasteCopiedNodes: () => void;
  createNodeFromConnectionDraft: (kind: CanvasNodeKind, draft: PendingConnectionCreateState) => void;
  cancelPendingConnectionCreate: () => void;
  dismissPendingGroup: () => void;
  confirmPendingGroup: (groupId: string) => void;
  cancelPendingGroup: (groupId: string) => void;
};

export type CanvasStageProps = {
  stageRef: RefObject<HTMLElement | null>;
  gridRef: RefObject<HTMLDivElement | null>;
  backgroundMode: CanvasBackgroundMode;
  zoom: number;
  panX: number;
  panY: number;
  projectActionDisabled: boolean;
  topToolbar: CanvasTopToolbarProps;
  bottomToolbar: CanvasBottomToolbarProps;
  pinnedMarkers: CanvasPinnedMarker[];
  onFocusPinnedNode: (nodeIds: string[]) => void;
  canvasInteractionBlocked: boolean;
  switching: boolean;
  projectScopePending: boolean;
  groups: CanvasGroupData[];
  selectedGroupId: string;
  selectionBoxStyle?: CSSProperties;
  alignmentGuides?: CanvasAlignGuide[];
  connectionLayerBounds: ReturnType<typeof buildCanvasConnectionLayerBounds>;
  connectFrom: string;
  connectHandleType: ConnectionHandleType;
  edges: CanvasEdgeData[];
  nodes: CanvasNodeData[];
  nodeMap: Map<string, CanvasNodeData>;
  selectedEdgeId: string;
  hoveredEdgeId: string;
  connectionPreviewPath: string;
  renderedNodes: CanvasNodeData[];
  nodeCardProps: (node: CanvasNodeData) => CanvasNodeCardProps;
  agentOpen: boolean;
  minimapOpen: boolean;
  visibleNodeCount: number;
  minimapModel: CanvasMinimapModel;
  selectedNodeIds: ReadonlySet<string>;
  contextMenu: CanvasContextMenuState | null;
  contextMenuFlipX: boolean;
  contextMenuStyle?: CSSProperties;
  contextMenuNode?: CanvasNodeData;
  previews: Record<string, string>;
  captureFrameNodeId: string;
  pendingConnectionCreate: PendingConnectionCreateState | null;
  pendingConnectionMenuStyle?: CSSProperties;
  actions: CanvasStageActions;
};

export function CanvasStage({
  stageRef,
  gridRef,
  backgroundMode,
  zoom,
  panX,
  panY,
  projectActionDisabled,
  topToolbar,
  bottomToolbar,
  pinnedMarkers,
  onFocusPinnedNode,
  canvasInteractionBlocked,
  switching,
  projectScopePending,
  groups,
  selectedGroupId,
  selectionBoxStyle,
  alignmentGuides = [],
  connectionLayerBounds,
  connectFrom,
  connectHandleType,
  edges,
  nodes,
  nodeMap,
  selectedEdgeId,
  hoveredEdgeId,
  connectionPreviewPath,
  renderedNodes,
  nodeCardProps,
  agentOpen,
  minimapOpen,
  visibleNodeCount,
  minimapModel,
  selectedNodeIds,
  contextMenu,
  contextMenuFlipX,
  contextMenuStyle,
  contextMenuNode,
  previews,
  captureFrameNodeId,
  pendingConnectionCreate,
  pendingConnectionMenuStyle,
  actions,
}: CanvasStageProps) {
  const {
    handleStagePointerDown,
    openCanvasContextMenu,
    handleCanvasDoubleClick,
    uploadFilesAsNodes,
    selectCanvasGroup,
    startGroupDrag,
    moveGroupDrag,
    endGroupDrag,
    handleCanvasLinesPointerDown,
    handleCanvasLinesPointerMove,
    handleCanvasLinesPointerLeave,
    handleCanvasLinesClick,
    handleCanvasLinesDoubleClick,
    handleCanvasLinesContextMenu,
    handleEdgeClick,
    removeEdge,
    setHoveredEdgeId,
    clientToStagePoint,
    screenToCanvasPoint,
    setContextMenu,
    toggleAgent,
    navigateFromMinimap,
    node: {
      duplicateSelectedNode,
      openDirectorNode,
      openImageToolDialog,
      setImageAnnotationNodeId,
      setImageMaskNodeId,
      setImageToolError,
      flipCanvasImageNode,
      generatePanoramaCanvasImage,
      createImageReversePromptNodes,
      setStoryboardNodeId,
      setImagePreviewNodeId,
      setReplaceImageNodeId,
      replaceImageInputRef,
      archiveCanvasMediaNode,
      captureVideoFrameNode,
      archiveCanvasTextNode,
      removeNode,
    },
    copySelectedNodes,
    openConnectSelection,
    renderCanvasSubmenu,
    copyCanvasImagePrompt,
    addNode,
    pasteCopiedNodes,
    createNodeFromConnectionDraft,
    cancelPendingConnectionCreate,
    dismissPendingGroup,
    confirmPendingGroup,
    cancelPendingGroup,
  } = actions;
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const connectionMenuRef = useRef<HTMLDivElement>(null);
  const displayEdges = useMemo(() => {
    const groupByNode = new Map<string, CanvasGroupData>();
    groups.forEach((group) => group.nodeIds.forEach((nodeId) => {
      if (!groupByNode.has(nodeId) || group.pending) groupByNode.set(nodeId, group);
    }));
    const seen = new Set<string>();
    return edges.flatMap((edge) => {
      const fromGroup = groupByNode.get(edge.from);
      const toGroup = groupByNode.get(edge.to);
      if (fromGroup && toGroup && fromGroup.id === toGroup.id) return [];
      const key = `${fromGroup?.id || edge.from}->${toGroup?.id || edge.to}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ edge, fromGroup, toGroup }];
    });
  }, [edges, groups]);
  useOutsidePress(Boolean(contextMenu), event => event.composedPath().includes(contextMenuRef.current!), () => setContextMenu(null));
  // This menu opens on pointerup; the same gesture's trailing click must not dismiss it.
  useOutsidePress(Boolean(pendingConnectionCreate), event => event.composedPath().includes(connectionMenuRef.current!), cancelPendingConnectionCreate, false);
  return (
        <section
          ref={stageRef}
          tabIndex={-1}
          aria-label="画布"
          className={`canvas-stage real-canvas-stage canvas-background-${backgroundMode}`}
          style={{ "--canvas-grid-size": `${40 * zoom / 100}px`, "--canvas-grid-x": `${panX}px`, "--canvas-grid-y": `${panY}px`, "--canvas-zoom": String(zoom) } as CSSProperties}
          onPointerDown={handleStagePointerDown}
          onPointerDownCapture={(event) => {
            if (connectFrom || !groups.some((group) => group.pending)) return;
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest(".canvas-group-frame.pending, .canvas-group-pending-actions, .canvas-node-handle, .canvas-context-menu, .canvas-connection-create-menu")) return;
            dismissPendingGroup();
          }}
          onContextMenu={(event) => { if (projectActionDisabled) { event.preventDefault(); return; } openCanvasContextMenu(event); }}
          onDoubleClick={(event) => { if (!projectActionDisabled) handleCanvasDoubleClick(event); }}
          onDragOver={(event) => { if (!projectActionDisabled) event.preventDefault(); }}
          onDrop={(event) => { event.preventDefault(); if (!projectActionDisabled) void uploadFilesAsNodes(event.dataTransfer.files, screenToCanvasPoint(event.clientX, event.clientY)); }}
        >
          <div className="canvas-left-dock" data-canvas-ui data-canvas-no-zoom>
            <CanvasTopToolbar {...topToolbar} />
            <CanvasPinRail markers={pinnedMarkers} onFocus={onFocusPinnedNode} />
          </div>

          {canvasInteractionBlocked ? (
            <div className="empty-output"><Loader2 className="spin" size={28} /><p>{switching ? "正在保存当前画布，切换完成前请勿操作…" : projectScopePending ? "正在确认项目工作区，暂不可操作画布…" : "正在读取画布快照…"}</p></div>
          ) : (
            <div className="real-canvas-grid" ref={gridRef}
              style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom / 100})` }}
            >
              {groups.map((group) => (
                <section
                  key={group.id}
                  className={`canvas-group-frame${group.pending ? " pending" : ""} ${selectedGroupId === group.id ? "selected" : ""}`}
                  data-group-id={group.id}
                  style={{
                    left: group.position.x,
                    top: group.position.y,
                    width: group.width,
                    height: group.height,
                    "--canvas-group-color": group.color,
                  } as CSSProperties}
                  onClick={(event) => { event.stopPropagation(); selectCanvasGroup(group); }}
                  onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); selectCanvasGroup(group); }}
                  onPointerDown={(event) => startGroupDrag(event, group)}
                  onPointerMove={moveGroupDrag}
                  onPointerUp={endGroupDrag}
                  onPointerCancel={endGroupDrag}
                >
                  {!group.pending ? (
                    <div className="canvas-group-header">
                      <Boxes size={14} />
                      <b>{group.title}</b>
                      <span>{group.nodeIds.length} 节点</span>
                      <div className="canvas-group-header-actions" onPointerDown={(event) => event.stopPropagation()}>
                        <button type="button" title="批量执行分组" onClick={() => topToolbar.onRunGroup(group.id)} disabled={topToolbar.groupRunning}>
                          {topToolbar.selectedGroupRunning ? <Loader2 className="spin" size={12} /> : <WandSparkles size={12} />}
                        </button>
                        <button type="button" title="将分组节点连接到配置" onClick={() => actions.openConnectSelection()}>
                          <GitMerge size={12} />
                        </button>
                        <button type="button" title="解绑组" onClick={() => topToolbar.onUngroup(group.id)}>
                          <Ungroup size={12} />
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {group.pending ? (
                    <div className="canvas-group-pending-actions" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                      <span>已框选 {group.nodeIds.length} 个节点</span>
                      <button type="button" onClick={() => confirmPendingGroup(group.id)}>组成分组</button>
                      <button type="button" onClick={() => cancelPendingGroup(group.id)}>取消</button>
                    </div>
                  ) : null}
                  {!group.pending && (["top-left", "top-right", "bottom-left", "bottom-right"] as CanvasGroupResizeCorner[]).map((corner) => (
                    <span
                      key={corner}
                      className={`canvas-group-corner ${corner}`}
                      aria-hidden="true"
                    />
                  ))}
                  {!groups.some(other => other.pending && other.id !== group.id && other.nodeIds.some(id => group.nodeIds.includes(id))) ? (() => {
                    const leftNode = groupConnectionNode(group, nodeMap, "left");
                    const rightNode = groupConnectionNode(group, nodeMap, "right");
                    return <>
                      <button
                        ref={(element) => {
                          if (leftNode) actions.node.registerConnectionHandle(leftNode.id, "target", element);
                        }}
                        type="button"
                        className={`canvas-group-connection-handle target canvas-node-handle ${leftNode && connectFrom === leftNode.id && connectHandleType === "target" ? "active" : ""}`}
                        data-connection-node-id={leftNode?.id || ""}
                        aria-label={group.pending ? "连接到选区" : "连接到分组"}
                        title={group.pending ? "连接到选区" : "连接到分组"}
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          if (leftNode) actions.node.beginConnection(event, leftNode.id, "target");
                        }}
                      />
                      <button
                        ref={(element) => {
                          if (rightNode) actions.node.registerConnectionHandle(rightNode.id, "source", element);
                        }}
                        type="button"
                        className={`canvas-group-connection-handle source canvas-node-handle ${rightNode && connectFrom === rightNode.id && connectHandleType === "source" ? "active" : ""}`}
                        data-connection-node-id={rightNode?.id || ""}
                        aria-label={group.pending ? "从选区连接" : "从分组连接"}
                        title={group.pending ? "从选区连接" : "从分组连接"}
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          if (rightNode) actions.node.beginConnection(event, rightNode.id, "source");
                        }}
                      />
                    </>;
                  })() : null}
                </section>
              ))}
              {selectionBoxStyle ? <div className="canvas-selection-box" style={selectionBoxStyle} /> : null}
              {alignmentGuides.length ? (
                <svg className="canvas-align-guides" aria-hidden="true" fill="none">
                  {alignmentGuides.map((guide, index) => {
                    const x1 = guide.axis === "x" ? guide.position : guide.start;
                    const y1 = guide.axis === "y" ? guide.position : guide.start;
                    const x2 = guide.axis === "x" ? guide.position : guide.end;
                    const y2 = guide.axis === "y" ? guide.position : guide.end;
                    return (
                      <g key={`${guide.axis}-${guide.position}-${index}`}>
                        <line className="canvas-align-guide-shadow" x1={x1} y1={y1} x2={x2} y2={y2} />
                        <line className="canvas-align-guide" x1={x1} y1={y1} x2={x2} y2={y2} />
                      </g>
                    );
                  })}
                </svg>
              ) : null}
              <svg
                className="real-canvas-lines"
                aria-hidden="true"
                style={{
                  left: connectionLayerBounds.left,
                  top: connectionLayerBounds.top,
                  width: connectionLayerBounds.width,
                  height: connectionLayerBounds.height,
                }}
                viewBox={connectionLayerBounds.viewBox}
                onPointerDown={handleCanvasLinesPointerDown}
                onPointerMove={handleCanvasLinesPointerMove}
                onPointerLeave={handleCanvasLinesPointerLeave}
                onClick={handleCanvasLinesClick}
                onDoubleClick={handleCanvasLinesDoubleClick}
                onContextMenu={handleCanvasLinesContextMenu}
              >
                {displayEdges.map(({ edge, fromGroup, toGroup }) => {
                  const from = nodeMap.get(edge.from);
                  const to = nodeMap.get(edge.to);
                  if (!from || !to || isHiddenCanvasConnectionEndpoint(from, nodes) || isHiddenCanvasConnectionEndpoint(to, nodes)) return null;
                  const displayFrom = canvasConnectionDisplayNode(from, fromGroup ? [fromGroup] : []);
                  const displayTo = canvasConnectionDisplayNode(to, toGroup ? [toGroup] : []);
                  const x1 = displayFrom.x + displayFrom.width;
                  const y1 = displayFrom.y + displayFrom.height / 2;
                  const x2 = displayTo.x;
                  const y2 = displayTo.y + displayTo.height / 2;
                  const curvature = canvasConnectionCurvature(x1, x2);
                  const path = `M ${x1} ${y1} C ${x1 + curvature} ${y1}, ${x2 - curvature} ${y2}, ${x2} ${y2}`;
                  const active = selectedEdgeId === edge.id || hoveredEdgeId === edge.id;
                  return (
                <g key={edge.id} className={selectedEdgeId === edge.id ? "selected-canvas-edge" : ""}>
                      <path
                        className="real-canvas-edge-hit"
                        data-edge-id={edge.id}
                        d={path}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={16}
                        style={{ cursor: "pointer", pointerEvents: "stroke" }}
                        onClick={(event) => { event.stopPropagation(); handleEdgeClick(edge.id); }}
                        onDoubleClick={(event) => { event.stopPropagation(); removeEdge(edge.id); }}
                        onMouseEnter={() => setHoveredEdgeId(edge.id)}
                        onMouseLeave={() => setHoveredEdgeId("")}
                        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); const point = clientToStagePoint(event.clientX, event.clientY); const canvasPoint = screenToCanvasPoint(event.clientX, event.clientY); handleEdgeClick(edge.id); setContextMenu({ x: point.x, y: point.y, canvasX: canvasPoint.x, canvasY: canvasPoint.y, edgeId: edge.id }); }}
                      />
                      <path
                        className="real-canvas-edge-visible"
                        d={path}
                        fill="none"
                        pointerEvents="none"
                        style={active ? { stroke: "#7dd3fc", strokeWidth: 2.4, filter: "drop-shadow(0 0 8px rgba(125, 211, 252, .45))" } : undefined}
                      />
                    </g>
                  );
                })}
                {connectionPreviewPath ? <path className="real-canvas-edge-preview" d={connectionPreviewPath} fill="none" pointerEvents="none" /> : null}
              </svg>
              {renderedNodes.map((node) => <CanvasNodeCard key={node.id} {...nodeCardProps(node)} />)}
            </div>
          )}

          <CanvasBottomToolbar {...bottomToolbar} />
          <button
            className={`canvas-agent-fab ${agentOpen ? "is-active" : ""}`}
            onClick={toggleAgent}
            disabled={projectActionDisabled}
            title={agentOpen ? "关闭 Agent" : "打开 Agent"}
            data-canvas-ui
            data-canvas-no-zoom
          >
            <MetaBallOrb className="canvas-agent-fab-orb" />
            <Sparkles size={20} />
          </button>
          {minimapOpen && !projectActionDisabled ? (
            <div className="canvas-minimap" data-canvas-ui data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()}>
              <div><span>MINIMAP</span><b>{visibleNodeCount} NODES</b></div>
              <svg
                viewBox={`0 0 ${minimapModel.width} ${minimapModel.height}`}
                role="img"
                aria-label="画布缩略导航，点击可移动当前视口"
                onClick={navigateFromMinimap}
              >
                {minimapModel.nodes.map((node) => (
                  <rect
                    key={node.id}
                    className={selectedNodeIds.has(node.id) ? "selected" : ""}
                    x={node.x}
                    y={node.y}
                    width={node.width}
                    height={node.height}
                    rx={1.5}
                  />
                ))}
                <rect
                  className="viewport"
                  x={minimapModel.viewport.x}
                  y={minimapModel.viewport.y}
                  width={minimapModel.viewport.width}
                  height={minimapModel.viewport.height}
                />
              </svg>
            </div>
          ) : null}
          {contextMenu && !projectActionDisabled ? (
            <div ref={contextMenuRef} className={`canvas-context-menu${contextMenuFlipX ? " flip-x" : ""}`} data-canvas-ui data-canvas-no-zoom style={contextMenuStyle} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
              {contextMenu.nodeId || contextMenu.edgeId ? (
                <div className="inspector-head">
                  <div><p className="eyebrow">MENU</p><h3>{contextMenu.edgeId ? "连线操作" : "节点操作"}</h3></div>
                </div>
              ) : null}
              <div className={`canvas-context-menu-list${contextMenuNode?.kind === "image" && imageSrcFromNode(contextMenuNode, previews) ? " has-submenus" : ""}`}>
                {contextMenu.nodeId ? (
                  <>
                    {contextMenuNode?.kind === "image" && imageSrcFromNode(contextMenuNode, previews) ? renderCanvasSubmenu("image-asset", <Images size={14} />, "素材与文件", (
                      <>
                        <button className="full-outline" onClick={() => { setImagePreviewNodeId(contextMenuNode.id); setContextMenu(null); }}>查看图片</button>
                        <button className="full-outline" onClick={() => { void copyCanvasImagePrompt(contextMenuNode); setContextMenu(null); }}>复制提示词</button>
                        <button className="full-outline" onClick={() => { setReplaceImageNodeId(contextMenuNode.id); replaceImageInputRef.current?.click(); setContextMenu(null); }}>替换图片</button>
                        <button className="full-outline" onClick={() => { void archiveCanvasMediaNode(contextMenuNode); setContextMenu(null); }}>加入素材库</button>
                      </>
                    )) : null}
                    <button className="full-outline" onClick={() => { copySelectedNodes(); setContextMenu(null); }}>复制所选节点</button>
                    {selectedNodeIds.size >= 2 ? <button className="full-outline" onClick={() => { openConnectSelection(); setContextMenu(null); }}>连接所选节点到配置</button> : null}
                    <button className="full-outline" onClick={() => { void duplicateSelectedNode(contextMenu.nodeId!); setContextMenu(null); }}>复制节点</button>
                    {contextMenuNode?.kind === "director" ? <button className="full-outline" onClick={() => { void openDirectorNode(contextMenuNode); setContextMenu(null); }}>打开导演台</button> : null}
                    {contextMenuNode?.kind === "image" && imageSrcFromNode(contextMenuNode, previews) ? (
                      <>
                        {renderCanvasSubmenu("image-edit", <Scissors size={14} />, "图片处理", (
                          <>
                            <button className="full-outline" onClick={() => { openImageToolDialog(contextMenuNode.id, "crop"); setContextMenu(null); }}>裁剪图片</button>
                            <button className="full-outline" onClick={() => { openImageToolDialog(contextMenuNode.id, "focus"); setContextMenu(null); }}>聚焦提取</button>
                            <button className="full-outline" onClick={() => { setImageAnnotationNodeId(contextMenuNode.id); setContextMenu(null); }}>图片标注</button>
                            <button className="full-outline" onClick={() => { setImageMaskNodeId(contextMenuNode.id); setImageToolError(""); setContextMenu(null); }}>蒙版修改</button>
                            <button className="full-outline" onClick={() => { openImageToolDialog(contextMenuNode.id, "outpaint"); setContextMenu(null); }}>扩图</button>
                            <button className="full-outline" onClick={() => { openImageToolDialog(contextMenuNode.id, "split"); setContextMenu(null); }}>切分图片</button>
                            <button className="full-outline" onClick={() => { void flipCanvasImageNode(contextMenuNode, "horizontal"); setContextMenu(null); }}>水平翻转</button>
                            <button className="full-outline" onClick={() => { void flipCanvasImageNode(contextMenuNode, "vertical"); setContextMenu(null); }}>垂直翻转</button>
                            <button className="full-outline" onClick={() => { openImageToolDialog(contextMenuNode.id, "upscale"); setContextMenu(null); }}>放大图片</button>
                            <button className="full-outline" onClick={() => { openImageToolDialog(contextMenuNode.id, "compress"); setContextMenu(null); }}>压缩图片</button>
                          </>
                        ))}
                        {renderCanvasSubmenu("image-ai", <Sparkles size={14} />, "AI 生成", (
                          <>
                            <button className="full-outline" onClick={() => { void generatePanoramaCanvasImage(contextMenuNode); setContextMenu(null); }}>生成全景图</button>
                            <button className="full-outline" onClick={() => { openImageToolDialog(contextMenuNode.id, "angle"); setContextMenu(null); }}>AI 多角度</button>
                            <button className="full-outline" onClick={() => { toast.info("AI 超分依赖管理员配置的模型服务，本地暂未实现"); setContextMenu(null); }}>AI 超分</button>
                            <button className="full-outline" onClick={() => { void createImageReversePromptNodes(contextMenuNode); setContextMenu(null); }}>反推提示词</button>
                            <button className="full-outline" onClick={() => { setStoryboardNodeId(contextMenuNode.id); setContextMenu(null); }}>故事板导出</button>
                          </>
                        ))}
                      </>
                    ) : null}
                    {contextMenuNode?.kind === "video" ? <button className="full-outline" disabled={Boolean(captureFrameNodeId)} onClick={() => { void captureVideoFrameNode(contextMenuNode); setContextMenu(null); }}>当前帧创建图片</button> : null}
                    {contextMenuNode?.kind === "video" || contextMenuNode?.kind === "audio" ? <button className="full-outline" onClick={() => { void archiveCanvasMediaNode(contextMenuNode); setContextMenu(null); }}>加入素材库</button> : null}
                    {contextMenuNode?.kind === "text" ? <button className="full-outline" onClick={() => { void archiveCanvasTextNode(contextMenuNode); setContextMenu(null); }}>加入素材库</button> : null}
                    <hr className="canvas-menu-divider" />
                    <button className="full-outline danger" onClick={() => { removeNode(contextMenu.nodeId!); }}>删除节点</button>
                  </>
                ) : contextMenu.edgeId ? (
                  <>
                    <button className="full-outline" onClick={() => { handleEdgeClick(contextMenu.edgeId!); setContextMenu(null); }}>选中连线</button>
                    <button className="full-outline danger" onClick={() => { removeEdge(contextMenu.edgeId!); }}>删除连线</button>
                  </>
                ) : (
                  <>
                    <button className="full-outline" onClick={() => { addNode("image", { x: contextMenu.canvasX, y: contextMenu.canvasY }); setContextMenu(null); }}><ImageIcon size={14} /> 新建图片</button>
                    <button className="full-outline" onClick={() => { addNode("video", { x: contextMenu.canvasX, y: contextMenu.canvasY }); setContextMenu(null); }}><Film size={14} /> 新建视频</button>
                    <button className="full-outline" onClick={() => { addNode("text", { x: contextMenu.canvasX, y: contextMenu.canvasY }); setContextMenu(null); }}><Type size={14} /> 新建文本</button>
                    <button className="full-outline" onClick={() => { addNode("audio", { x: contextMenu.canvasX, y: contextMenu.canvasY }); setContextMenu(null); }}><Music2 size={14} /> 新建音频</button>
                    <button className="full-outline" onClick={() => { addNode("config", { x: contextMenu.canvasX, y: contextMenu.canvasY }); setContextMenu(null); }}><SlidersHorizontal size={14} /> 新建配置</button>
                    <hr className="canvas-menu-divider" />
                    <button className="full-outline" onClick={() => { pasteCopiedNodes(); setContextMenu(null); }}><ClipboardPaste size={14} /> 粘贴</button>
                  </>
                )}
              </div>
            </div>
          ) : null}
          {pendingConnectionCreate && !projectActionDisabled ? (
            <div ref={connectionMenuRef} className="canvas-context-menu canvas-connection-create-menu" data-canvas-ui data-canvas-no-zoom style={pendingConnectionMenuStyle} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
              <div className="inspector-head">
                <div><p className="eyebrow">CONNECT</p><h3>新建节点并连接</h3></div>
              </div>
              <div className="canvas-context-menu-list">
                <button className="full-outline" onClick={() => createNodeFromConnectionDraft("image", pendingConnectionCreate)}>新建图片</button>
                <button className="full-outline" onClick={() => createNodeFromConnectionDraft("video", pendingConnectionCreate)}>新建视频</button>
                <button className="full-outline" onClick={() => createNodeFromConnectionDraft("text", pendingConnectionCreate)}>新建文本</button>
                <button className="full-outline" onClick={() => createNodeFromConnectionDraft("audio", pendingConnectionCreate)}>新建音频</button>
                <button className="full-outline danger" onClick={() => cancelPendingConnectionCreate()}>取消连接</button>
              </div>
            </div>
          ) : null}
        </section>
  );
}
