import {
  Boxes,
  ClipboardPaste,
  Film,
  Image as ImageIcon,
  Images,
  Loader2,
  Music2,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Type,
} from "lucide-react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent,
  ReactNode,
  RefObject,
} from "react";
import { toast } from "sonner";
import MetaBallOrb from "@/components/MetaBallOrb";
import {
  buildCanvasConnectionLayerBounds,
  canvasConnectionCurvature,
  isHiddenCanvasConnectionEndpoint,
} from "@/features/canvas/domain/connections";
import type { CanvasGroupData, CanvasGroupResizeCorner } from "@/features/canvas/domain/groups";
import type { CanvasMinimapModel } from "@/features/canvas/domain/minimap";
import { imageSrcFromNode } from "@/features/canvas/domain/nodes";
import type {
  CanvasBackgroundMode,
  CanvasEdgeData,
  CanvasNodeData,
  CanvasNodeKind,
} from "@/features/canvas/domain/types";
import {
  CanvasNodeCard,
  type CanvasNodeCardActions,
  type CanvasNodeCardProps,
  type ConnectionHandleType,
} from "./CanvasNodeCard";
import {
  CanvasBottomToolbar,
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

type CanvasStageActions = {
  handleStagePointerDown: (event: PointerEvent<HTMLElement>) => void;
  openCanvasContextMenu: (event: ReactMouseEvent<Element>) => void;
  handleCanvasDoubleClick: (event: ReactMouseEvent<Element>) => void;
  uploadFilesAsNodes: (files: FileList | File[]) => Promise<unknown>;
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
  canvasInteractionBlocked: boolean;
  switching: boolean;
  projectScopePending: boolean;
  groups: CanvasGroupData[];
  selectedGroupId: string;
  selectionBoxStyle?: CSSProperties;
  connectionLayerBounds: ReturnType<typeof buildCanvasConnectionLayerBounds>;
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
  canvasInteractionBlocked,
  switching,
  projectScopePending,
  groups,
  selectedGroupId,
  selectionBoxStyle,
  connectionLayerBounds,
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
    startGroupResize,
    moveGroupResize,
    endGroupResize,
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
      chooseNode,
      applyNodeSelection,
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
    activateConnectionMode,
    copySelectedNodes,
    openConnectSelection,
    generateFromNode,
    renderCanvasSubmenu,
    copyCanvasImagePrompt,
    addNode,
    pasteCopiedNodes,
    createNodeFromConnectionDraft,
    cancelPendingConnectionCreate,
  } = actions;
  return (
        <section
          ref={stageRef}
          className={`canvas-stage real-canvas-stage canvas-background-${backgroundMode}`}
          style={{ "--canvas-grid-size": `${40 * zoom / 100}px`, "--canvas-grid-x": `${panX}px`, "--canvas-grid-y": `${panY}px` } as CSSProperties}
          onPointerDown={handleStagePointerDown}
          onContextMenu={(event) => { if (projectActionDisabled) { event.preventDefault(); return; } openCanvasContextMenu(event); }}
          onDoubleClick={(event) => { if (!projectActionDisabled) handleCanvasDoubleClick(event); }}
          onDragOver={(event) => { if (!projectActionDisabled) event.preventDefault(); }}
          onDrop={(event) => { event.preventDefault(); if (!projectActionDisabled) void uploadFilesAsNodes(event.dataTransfer.files); }}
        >
          <CanvasTopToolbar {...topToolbar} />

          {canvasInteractionBlocked ? (
            <div className="empty-output"><Loader2 className="spin" size={28} /><p>{switching ? "正在保存当前画布，切换完成前请勿操作…" : projectScopePending ? "正在确认项目工作区，暂不可操作画布…" : "正在读取画布快照…"}</p></div>
          ) : (
            <div className="real-canvas-grid" ref={gridRef}
              style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom / 100})` }}
            >
              {groups.map((group) => (
                <section
                  key={group.id}
                  className={`canvas-group-frame ${selectedGroupId === group.id ? "selected" : ""}`}
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
                  <div className="canvas-group-header">
                    <Boxes size={14} />
                    <b>{group.title}</b>
                    <span>{group.nodeIds.length} 节点</span>
                  </div>
                  {(["top-left", "top-right", "bottom-left", "bottom-right"] as CanvasGroupResizeCorner[]).map((corner) => (
                    <button
                      type="button"
                      key={corner}
                      className={`canvas-group-resize-handle ${corner}`}
                      title="调整分组尺寸"
                      aria-label={`调整分组尺寸：${corner}`}
                      onPointerDown={(event) => startGroupResize(event, group, corner)}
                      onPointerMove={moveGroupResize}
                      onPointerUp={endGroupResize}
                      onPointerCancel={endGroupResize}
                    />
                  ))}
                </section>
              ))}
              {selectionBoxStyle ? <div className="canvas-selection-box" style={selectionBoxStyle} /> : null}
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
                {edges.map((edge) => {
                  const from = nodeMap.get(edge.from);
                  const to = nodeMap.get(edge.to);
                  if (!from || !to || isHiddenCanvasConnectionEndpoint(from, nodes) || isHiddenCanvasConnectionEndpoint(to, nodes)) return null;
                  const x1 = from.x + from.width;
                  const y1 = from.y + from.height / 2;
                  const x2 = to.x;
                  const y2 = to.y + to.height / 2;
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
            <div className={`canvas-context-menu${contextMenuFlipX ? " flip-x" : ""}`} data-canvas-ui data-canvas-no-zoom style={contextMenuStyle} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
              {contextMenu.nodeId || contextMenu.edgeId ? (
                <div className="inspector-head">
                  <div><p className="eyebrow">MENU</p><h3>{contextMenu.edgeId ? "连线操作" : "节点操作"}</h3></div>
                </div>
              ) : null}
              <div className={`canvas-context-menu-list${contextMenuNode?.kind === "image" && imageSrcFromNode(contextMenuNode, previews) ? " has-submenus" : ""}`}>
                {contextMenu.nodeId ? (
                  <>
                    <button className="full-outline" onClick={() => { chooseNode(contextMenu.nodeId!); setContextMenu(null); }}>选中节点</button>
                    <button className="full-outline" onClick={() => { applyNodeSelection([contextMenu.nodeId!], contextMenu.nodeId!, true); activateConnectionMode(contextMenu.nodeId!); }}>从此节点连接</button>
                    <button className="full-outline" onClick={() => { copySelectedNodes(); setContextMenu(null); }}>复制所选节点</button>
                    {selectedNodeIds.size >= 2 ? <button className="full-outline" onClick={() => { openConnectSelection(); setContextMenu(null); }}>连接所选节点到配置</button> : null}
                    <button className="full-outline" onClick={() => { void duplicateSelectedNode(contextMenu.nodeId!); setContextMenu(null); }}>复制节点</button>
                    {contextMenuNode?.kind === "director" ? <button className="full-outline" onClick={() => { void openDirectorNode(contextMenuNode); setContextMenu(null); }}>打开导演台</button> : null}
                    {contextMenuNode?.kind !== "director" ? <button className="full-outline" onClick={() => { void generateFromNode(contextMenu.nodeId!); setContextMenu(null); }}>生成当前模式</button> : null}
                    {contextMenuNode?.kind === "image" && imageSrcFromNode(contextMenuNode, previews) ? (
                      <>
                        {renderCanvasSubmenu("image-edit", <Scissors size={14} />, "图片处理", (
                          <>
                            <button className="full-outline" onClick={() => { openImageToolDialog(contextMenuNode.id, "crop"); setContextMenu(null); }}>裁剪图片</button>
                            <button className="full-outline" onClick={() => { openImageToolDialog(contextMenuNode.id, "focus"); setContextMenu(null); }}>聚焦提取</button>
                            <button className="full-outline" onClick={() => { setImageAnnotationNodeId(contextMenuNode.id); setContextMenu(null); }}>图片标注</button>
                            <button className="full-outline" onClick={() => { setImageMaskNodeId(contextMenuNode.id); setImageToolError(""); setContextMenu(null); }}>蒙版编辑</button>
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
                        {renderCanvasSubmenu("image-asset", <Images size={14} />, "素材与文件", (
                          <>
                            <button className="full-outline" onClick={() => { setImagePreviewNodeId(contextMenuNode.id); setContextMenu(null); }}>查看图片</button>
                            <button className="full-outline" onClick={() => { void copyCanvasImagePrompt(contextMenuNode); setContextMenu(null); }}>复制提示词</button>
                            <button className="full-outline" onClick={() => { setReplaceImageNodeId(contextMenuNode.id); replaceImageInputRef.current?.click(); setContextMenu(null); }}>替换图片</button>
                            <button className="full-outline" onClick={() => { void archiveCanvasMediaNode(contextMenuNode); setContextMenu(null); }}>加入素材库</button>
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
                    <button className="full-outline" onClick={() => { pasteCopiedNodes(); setContextMenu(null); }}><ClipboardPaste size={14} /> 粘贴节点</button>
                  </>
                )}
              </div>
            </div>
          ) : null}
          {pendingConnectionCreate && !projectActionDisabled ? (
            <div className="canvas-context-menu canvas-connection-create-menu" data-canvas-ui data-canvas-no-zoom style={pendingConnectionMenuStyle} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
              <div className="inspector-head">
                <div><p className="eyebrow">CONNECT</p><h3>新建节点并连接</h3></div>
              </div>
              <div className="canvas-context-menu-list">
                <button className="full-outline" onClick={() => createNodeFromConnectionDraft("text", pendingConnectionCreate)}>新建文本</button>
                <button className="full-outline" onClick={() => createNodeFromConnectionDraft("image", pendingConnectionCreate)}>新建图片</button>
                <button className="full-outline" onClick={() => createNodeFromConnectionDraft("config", pendingConnectionCreate)}>新建配置</button>
                <button className="full-outline" onClick={() => createNodeFromConnectionDraft("video", pendingConnectionCreate)}>新建视频</button>
                <button className="full-outline" onClick={() => createNodeFromConnectionDraft("audio", pendingConnectionCreate)}>新建音频</button>
                <button className="full-outline danger" onClick={() => cancelPendingConnectionCreate()}>取消连接</button>
              </div>
            </div>
          ) : null}
        </section>
  );
}
