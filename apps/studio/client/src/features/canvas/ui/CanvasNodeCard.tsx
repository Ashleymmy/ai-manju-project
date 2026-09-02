import {
  Archive,
  ArrowRight,
  BadgeCheck,
  Camera,
  ChevronRight,
  Copy,
  Crop,
  Download,
  Eraser,
  Expand,
  Eye,
  Film,
  FlipHorizontal,
  FlipVertical,
  FolderOpen,
  GalleryHorizontalEnd,
  Grid2X2,
  Image as ImageIcon,
  Images,
  Maximize2,
  Minimize2,
  Minus,
  Music2,
  PenLine,
  Pin,
  Plus,
  RotateCcw,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Square,
  Star,
  Trash2,
  Type,
  Upload,
  WandSparkles,
  ZoomIn,
} from "lucide-react";
import {
  memo,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CanvasResourceMentionTextarea } from "@/components/canvas/CanvasResourceMentionTextarea";
import PixelLoadingOverlay from "@/components/canvas/PixelLoadingOverlay";
import { buildCanvasMentionReferences, type CanvasMentionReference } from "@/features/canvas/domain/mentions";
import {
  editableNodeKind,
  generationModeFromNode,
  mediaKindFromNode,
  nodeEditorTextFromNode,
  nodeInlineEditPlaceholder,
  nodeKindBadge,
} from "@/features/canvas/domain/nodeUtils";
import { imageSrcFromNode } from "@/features/canvas/domain/nodes";
import { isGeneratedCanvasText } from "@/features/canvas/domain/text";
import type { CanvasNodeData, CanvasNodeKind } from "@/features/canvas/domain/types";
import { numberValue } from "@/features/canvas/domain/value";

export type CanvasImageToolMode = "crop" | "focus" | "split" | "upscale" | "compress" | "outpaint" | "angle";
export type ConnectionHandleType = "source" | "target";

export type CanvasNodeCardActions = {
  chooseNode: (id: string, event?: ReactMouseEvent<HTMLElement>) => boolean;
  openNodeContextMenu: (event: ReactMouseEvent<HTMLElement>, nodeId: string) => void;
  toggleCanvasBatch: (nodeId: string) => void;
  openDirectorNode: (node: CanvasNodeData) => Promise<unknown>;
  applyNodeSelection: (ids: Iterable<string>, primaryId?: string, openInspector?: boolean) => void;
  beginInlineNodeEdit: (nodeId: string) => void;
  handleNodeHoverStart: (id: string) => void;
  handleNodeHoverEnd: (id: string) => void;
  startDrag: (event: PointerEvent<HTMLElement>, node: CanvasNodeData) => void;
  moveDrag: (event: PointerEvent<HTMLElement>) => void;
  endDrag: () => void;
  registerConnectionHandle: (nodeId: string, side: "source" | "target", element: HTMLElement | null) => void;
  beginConnection: (event: PointerEvent<HTMLElement>, nodeId: string, handleType: ConnectionHandleType) => void;
  commitNodeTitle: (node: CanvasNodeData) => void;
  setTitleDraft: Dispatch<SetStateAction<string>>;
  setTitleEditingNodeId: Dispatch<SetStateAction<string>>;
  setReplaceImageNodeId: Dispatch<SetStateAction<string>>;
  setImagePreviewNodeId: Dispatch<SetStateAction<string>>;
  setEditingInlineNodeId: Dispatch<SetStateAction<string>>;
  setPinnedToolbarNodeId: Dispatch<SetStateAction<string>>;
  setMaterialNodeId: Dispatch<SetStateAction<string>>;
  setImageAnnotationNodeId: Dispatch<SetStateAction<string>>;
  setImageMaskNodeId: Dispatch<SetStateAction<string>>;
  setImageToolError: Dispatch<SetStateAction<string>>;
  setStoryboardNodeId: Dispatch<SetStateAction<string>>;
  replaceMediaNodeIdRef: MutableRefObject<string>;
  replaceMediaInputRef: RefObject<HTMLInputElement | null>;
  replaceImageInputRef: RefObject<HTMLInputElement | null>;
  toggleCanvasNodeFavorite: (node: CanvasNodeData) => Promise<unknown>;
  detachBatchChildToCanvas: (node: CanvasNodeData) => void;
  downloadNodeMedia: (node: CanvasNodeData) => Promise<unknown>;
  setBatchPrimaryNode: (node: CanvasNodeData) => void;
  captureVideoFrameNode: (node: CanvasNodeData) => Promise<unknown>;
  updateNodeTextContent: (id: string, content: string) => void;
  updateNodePrompt: (id: string, content: string) => void;
  mentionReferencesForNode: (nodeId: string) => ReturnType<typeof buildCanvasMentionReferences>;
  queueMentionAssetSearch: (query: string) => void;
  mentionThumbnailFor: (reference: CanvasMentionReference) => string;
  previewMentionReference: (reference: CanvasMentionReference) => void;
  locateMentionReference: (reference: CanvasMentionReference) => void;
  startResize: (event: PointerEvent<HTMLButtonElement>, node: CanvasNodeData) => void;
  moveResize: (event: PointerEvent<HTMLButtonElement>) => void;
  endResize: () => void;
  stopGenerationByNodeId: (nodeId: string) => void;
  duplicateSelectedNode: (targetId?: string) => Promise<unknown>;
  adjustNodeFontSize: (node: CanvasNodeData, delta: number) => void;
  openImageToolDialog: (nodeId: string, mode?: CanvasImageToolMode) => void;
  flipCanvasImageNode: (node: CanvasNodeData, direction: "horizontal" | "vertical") => Promise<void>;
  generatePanoramaCanvasImage: (node: CanvasNodeData) => Promise<unknown>;
  createImageReversePromptNodes: (node: CanvasNodeData) => Promise<unknown>;
  generateImageFromTextNode: (node: CanvasNodeData) => Promise<unknown>;
  archiveCanvasMediaNode: (node: CanvasNodeData) => Promise<unknown>;
  archiveCanvasTextNode: (node: CanvasNodeData) => Promise<unknown>;
  retryImageNode: (node: CanvasNodeData) => Promise<unknown>;
  retryTextNode: (node: CanvasNodeData) => Promise<unknown>;
  retryAudioNode: (node: CanvasNodeData) => Promise<unknown>;
  retryVideoNode: (node: CanvasNodeData) => Promise<unknown>;
  removeNode: (id: string) => void;
};

export type CanvasNodeCardProps = {
  node: CanvasNodeData;
  previews: Record<string, string>;
  isSelected: boolean;
  isSelectedSingle: boolean;
  isHovered: boolean;
  isConnectionTarget: boolean;
  isConnecting: boolean;
  connectActiveTarget: boolean;
  connectActiveSource: boolean;
  isTitleEditing: boolean;
  titleDraft: string;
  isInlineEditing: boolean;
  isRunning: boolean;
  progress: number;
  isPinned: boolean;
  captureBusy: boolean;
  isCapturingFrame: boolean;
  showImageInfo: boolean;
  imageToolBusy: boolean;
  storyboardBusy: boolean;
  actions: CanvasNodeCardActions;
};

export type CanvasImageToolGridProps = {
  node: CanvasNodeData;
  imageToolBusy: boolean;
  storyboardBusy: boolean;
  openImageToolDialog: (nodeId: string, mode?: CanvasImageToolMode) => void;
  setImageAnnotationNodeId: (id: string) => void;
  setImageMaskNodeId: (id: string) => void;
  setImageToolError: (value: string) => void;
  flipCanvasImageNode: (node: CanvasNodeData, direction: "horizontal" | "vertical") => Promise<unknown>;
  generatePanoramaCanvasImage: (node: CanvasNodeData) => Promise<unknown>;
  generateStoryboard: (node: CanvasNodeData) => void;
  createImageReversePromptNodes: (node: CanvasNodeData) => Promise<unknown>;
  setImagePreviewNodeId: (id: string) => void;
  setReplaceImageNodeId: (id: string) => void;
  replaceImageInputRef: RefObject<HTMLInputElement | null>;
  archiveCanvasMediaNode: (node: CanvasNodeData) => Promise<unknown>;
};

export function CanvasImageToolGrid({
  node,
  imageToolBusy,
  storyboardBusy,
  openImageToolDialog,
  setImageAnnotationNodeId,
  setImageMaskNodeId,
  setImageToolError,
  flipCanvasImageNode,
  generatePanoramaCanvasImage,
  generateStoryboard,
  createImageReversePromptNodes,
  setImagePreviewNodeId,
  setReplaceImageNodeId,
  replaceImageInputRef,
  archiveCanvasMediaNode,
}: CanvasImageToolGridProps) {
  return (
    <div className="canvas-image-tool-list">
      <button title="扩展图片画布并使用 AI 补全" onClick={() => openImageToolDialog(node.id, "outpaint")} disabled={imageToolBusy}><Expand size={14} /> 扩图</button>
      <button title="擦除图片上的指定区域" disabled><Eraser size={14} /> 擦除 <span className="tool-soon">即将上线</span></button>
      <button title="在图片上绘制形状、箭头、画笔和文字" onClick={() => setImageAnnotationNodeId(node.id)} disabled={imageToolBusy}><PenLine size={14} /> 标注</button>
      <button title="AI 增强画质" disabled><Sparkles size={14} /> 增强 <span className="tool-soon">即将上线</span></button>
      <button title="调整图片像素尺寸" disabled><Grid2X2 size={14} /> 调整像素 <span className="tool-soon">即将上线</span></button>
      <button title="涂抹区域并使用 AI 局部修改（抠图）" onClick={() => { setImageMaskNodeId(node.id); setImageToolError(""); }} disabled={imageToolBusy}><Scissors size={14} /> 抠图</button>
      <div className="tool-split-row">
        <span className="tool-split-label"><Grid2X2 size={13} /> 快速切分</span>
        <div className="tool-split-options">
          {[2, 3, 4].map((grid) => (
            <button key={grid} title={`按 ${grid}×${grid} 切分`} onClick={() => openImageToolDialog(node.id, "split")} disabled={imageToolBusy}>{grid}×{grid}</button>
          ))}
        </div>
      </div>
      <button title="Seedance 2.0 合规验证" disabled><BadgeCheck size={14} /> Seedance 2.0 合规验证 <span className="tool-soon">即将上线</span></button>
      <div className="tool-list-divider" />
      <button title="裁剪图片" onClick={() => openImageToolDialog(node.id, "crop")} disabled={imageToolBusy}><Crop size={14} /> 裁剪</button>
      <button title="提取图片局部区域" onClick={() => openImageToolDialog(node.id, "focus")} disabled={imageToolBusy}><Eye size={14} /> 聚焦</button>
      <button title="水平翻转当前图片" onClick={() => void flipCanvasImageNode(node, "horizontal")} disabled={imageToolBusy}><FlipHorizontal size={14} /> 水平翻转</button>
      <button title="垂直翻转当前图片" onClick={() => void flipCanvasImageNode(node, "vertical")} disabled={imageToolBusy}><FlipVertical size={14} /> 垂直翻转</button>
      <button title="放大图片分辨率" onClick={() => openImageToolDialog(node.id, "upscale")} disabled={imageToolBusy}><ZoomIn size={14} /> 放大</button>
      <button title="压缩图片体积" onClick={() => openImageToolDialog(node.id, "compress")} disabled={imageToolBusy}><Minimize2 size={14} /> 压缩</button>
      <button title="基于原图生成 2:1 全景图" onClick={() => void generatePanoramaCanvasImage(node)} disabled={imageToolBusy}><Images size={14} /> 全景图</button>
      <button title="基于原图重新生成其他机位" onClick={() => openImageToolDialog(node.id, "angle")} disabled={imageToolBusy}><Camera size={14} /> 多角度</button>
      <button title="AI 超分依赖管理员配置的模型服务" onClick={() => toast.info("AI 超分依赖管理员配置的模型服务，本地暂未实现")}><Sparkles size={14} /> AI 超分</button>
      <button title="把所选图片排成故事板 PNG" onClick={() => generateStoryboard(node)} disabled={storyboardBusy}><GalleryHorizontalEnd size={14} /> 故事板</button>
      <button title="创建反推提示词的文本配置节点" onClick={() => void createImageReversePromptNodes(node)}><WandSparkles size={14} /> 反推提示词</button>
      <button title="查看原图" onClick={() => setImagePreviewNodeId(node.id)}><Maximize2 size={14} /> 查看原图</button>
      <button title="替换当前图片" onClick={() => { setReplaceImageNodeId(node.id); replaceImageInputRef.current?.click(); }}><Upload size={14} /> 替换图片</button>
      <button title="确认图片已归档到素材库" onClick={() => void archiveCanvasMediaNode(node)}><Archive size={14} /> 存入素材库</button>
    </div>
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function nodeKindCenterIcon(kind: CanvasNodeKind) {
  const props = { size: 30, strokeWidth: 1.2 };
  if (kind === "video") return <Film {...props} />;
  if (kind === "audio") return <Music2 {...props} />;
  if (kind === "config") return <SlidersHorizontal {...props} />;
  if (kind === "text" || kind === "note" || kind === "prompt") return <Type {...props} />;
  return <ImageIcon {...props} />;
}

function CanvasNodeCardView({ node, previews, isSelected, isSelectedSingle, isHovered, isConnectionTarget, isConnecting, connectActiveTarget, connectActiveSource, isTitleEditing, titleDraft, isInlineEditing, isRunning, progress, isPinned, captureBusy, isCapturingFrame, showImageInfo, imageToolBusy, storyboardBusy, actions }: CanvasNodeCardProps) {
  const preview = imageSrcFromNode(node, previews);
  const previewKind = mediaKindFromNode(node);
  const nodeText = nodeEditorTextFromNode(node);
  const generatedTextNode = isGeneratedCanvasText(node);
  const isBatchRootNode = Boolean(node.metadata?.isBatchRoot && (node.metadata?.batchChildIds?.length || 0) > 0);
  const batchExpanded = Boolean(node.metadata?.imageBatchExpanded);
  const isBatchChildNode = Boolean(node.metadata?.batchRootId);
  const isEmptyMediaNode = (node.kind === "image" || node.kind === "video" || node.kind === "audio") && !preview;
  const {
    chooseNode, openNodeContextMenu, toggleCanvasBatch, openDirectorNode, applyNodeSelection, beginInlineNodeEdit,
    handleNodeHoverStart, handleNodeHoverEnd, startDrag, moveDrag, endDrag, registerConnectionHandle, beginConnection,
    commitNodeTitle, setTitleDraft, setTitleEditingNodeId, setReplaceImageNodeId, setImagePreviewNodeId,
    setEditingInlineNodeId, setPinnedToolbarNodeId, setMaterialNodeId, setImageAnnotationNodeId, setImageMaskNodeId,
    setImageToolError, setStoryboardNodeId, replaceMediaNodeIdRef, replaceMediaInputRef, replaceImageInputRef,
    toggleCanvasNodeFavorite, detachBatchChildToCanvas, downloadNodeMedia, setBatchPrimaryNode, captureVideoFrameNode,
    updateNodeTextContent, updateNodePrompt, mentionReferencesForNode, queueMentionAssetSearch,
    mentionThumbnailFor, previewMentionReference, locateMentionReference,
    startResize, moveResize, endResize, stopGenerationByNodeId, duplicateSelectedNode, adjustNodeFontSize,
    openImageToolDialog, flipCanvasImageNode, generatePanoramaCanvasImage, createImageReversePromptNodes,
    generateImageFromTextNode, archiveCanvasMediaNode, archiveCanvasTextNode,
    retryImageNode, retryTextNode, retryAudioNode, retryVideoNode, removeNode,
  } = actions;
  return (
    <article
      className={`real-canvas-node ${node.kind} ${isBatchRootNode ? "batch-root" : ""} ${isSelected ? "selected" : ""} ${isConnectionTarget ? "connection-target" : ""} ${isRunning ? "running" : ""} ${isConnecting ? "connecting-mode" : ""}`}
      data-node-id={node.id}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      onClick={(event) => {
        if (isConnecting) return;
        const selected = chooseNode(node.id, event);
        if (selected && isBatchRootNode) toggleCanvasBatch(node.id);
      }}
      onContextMenu={(event) => openNodeContextMenu(event, node.id)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (isConnecting) return;
        if ((event.target as HTMLElement).closest("[data-node-title-editor]")) return;
        if (node.kind === "director") {
          void openDirectorNode(node);
          return;
        }
        if (node.kind === "image" && preview) {
          setImagePreviewNodeId(node.id);
          return;
        }
        if ((event.target as HTMLElement).closest(".node-inline-editor")) return;
        if (editableNodeKind(node.kind)) {
          applyNodeSelection([node.id], node.id, true);
          beginInlineNodeEdit(node.id);
          return;
        }
        applyNodeSelection([node.id], node.id, true);
      }}
      onMouseEnter={() => handleNodeHoverStart(node.id)}
      onMouseLeave={() => handleNodeHoverEnd(node.id)}
      onPointerDown={(event) => startDrag(event, node)}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <button
        ref={(element) => registerConnectionHandle(node.id, "target", element)}
        type="button"
        className={`canvas-connection-handle target canvas-node-handle ${connectActiveTarget ? "active" : ""}`}
        aria-label="连接到此节点"
        title="拖到另一节点，或单击后再点目标节点"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          event.stopPropagation();
          beginConnection(event, node.id, "target");
        }}
      />
      <button
        ref={(element) => registerConnectionHandle(node.id, "source", element)}
        type="button"
        className={`canvas-connection-handle source canvas-node-handle ${connectActiveSource ? "active" : ""}`}
        aria-label="从此节点连接"
        title="拖到另一节点，或单击后再点目标节点"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          event.stopPropagation();
          beginConnection(event, node.id, "source");
        }}
      />
      <div className="node-float-label" data-node-title-editor onPointerDown={(event) => event.stopPropagation()}>
        <span className="node-float-kind">{nodeKindBadge(node.kind)}</span>
        {isTitleEditing ? (
          <input
            className="node-title-input node-float-title-input"
            value={titleDraft}
            autoFocus
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => commitNodeTitle(node)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitNodeTitle(node);
              if (event.key === "Escape") setTitleEditingNodeId("");
            }}
            onPointerDown={(event) => event.stopPropagation()}
          />
        ) : (
          <b
            title="双击重命名节点"
            onDoubleClick={(event) => {
              event.stopPropagation();
              setTitleDraft(node.title);
              setTitleEditingNodeId(node.id);
            }}
          >{node.title}</b>
        )}
      </div>
      {isEmptyMediaNode && (node.kind === "image" || node.kind === "video") && isHovered && !isRunning ? (
        <button
          type="button"
          className="node-upload-pill"
          onClick={(event) => {
            event.stopPropagation();
            if (node.kind === "video") {
              replaceMediaNodeIdRef.current = node.id;
              replaceMediaInputRef.current?.click();
            } else {
              setReplaceImageNodeId(node.id);
              replaceImageInputRef.current?.click();
            }
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Upload size={13} /> {node.kind === "video" ? "上传视频" : "上传"}
        </button>
      ) : null}
      {isBatchRootNode ? (
        <button
          type="button"
          className={`canvas-batch-badge ${batchExpanded ? "open" : ""}`}
          title={batchExpanded ? "收起图片组" : "展开图片组"}
          onClick={(event) => { event.stopPropagation(); toggleCanvasBatch(node.id); }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {(node.metadata?.batchChildIds?.length || 0) + 1} <ChevronRight size={12} />
        </button>
      ) : null}
      {node.kind === "image" && preview && isSelectedSingle ? (
        <button
          type="button"
          className={`canvas-node-favorite ${node.metadata?.assetFavorited ? "active" : ""}`}
          title={node.metadata?.assetFavorited ? "取消收藏" : "收藏到素材库"}
          onClick={(event) => { event.stopPropagation(); void toggleCanvasNodeFavorite(node); }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Star size={13} fill={node.metadata?.assetFavorited ? "currentColor" : "none"} />
        </button>
      ) : null}
      {isBatchChildNode && node.imageAssetId ? (
        <>
          <div className="canvas-batch-child-tools">
            <button
              type="button"
              className={node.metadata?.assetFavorited ? "active" : ""}
              title={node.metadata?.assetFavorited ? "取消收藏" : "收藏到素材库"}
              onClick={(event) => { event.stopPropagation(); void toggleCanvasNodeFavorite(node); }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Star size={13} fill={node.metadata?.assetFavorited ? "currentColor" : "none"} />
            </button>
            <button
              type="button"
              title="应用到画布（拆出为独立节点）"
              onClick={(event) => { event.stopPropagation(); detachBatchChildToCanvas(node); }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <ImageIcon size={13} />
            </button>
            <button
              type="button"
              title="下载"
              onClick={(event) => { event.stopPropagation(); void downloadNodeMedia(node); }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Download size={13} />
            </button>
          </div>
          <button
            type="button"
            className="canvas-batch-primary"
            title="设为图片组主图"
            onClick={(event) => { event.stopPropagation(); setBatchPrimaryNode(node); }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Star size={13} /> 设为主图
          </button>
        </>
      ) : null}
      {preview && previewKind === "video" ? (
        <>
          <video
            src={preview}
            controls
            preload="metadata"
            data-testid="canvas-node-video"
            data-canvas-no-zoom
            onPointerDown={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              if (event.clientY > rect.bottom - 36) event.stopPropagation();
            }}
          />
          <button
            type="button"
            className="node-video-capture"
            title="截取当前帧为图片节点"
            disabled={captureBusy}
            onClick={(event) => { event.stopPropagation(); void captureVideoFrameNode(node); }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Camera size={12} /> {isCapturingFrame ? "截取中…" : "截取当前帧"}
          </button>
        </>
      ) : preview && previewKind === "audio" ? (
        <audio
          src={preview}
          controls
          preload="metadata"
          data-testid="canvas-node-audio"
          data-canvas-no-zoom
          onPointerDown={(event) => event.stopPropagation()}
        />
      ) : preview ? (
        <img src={preview} alt={node.title} draggable={false} />
      ) : editableNodeKind(node.kind) ? (
        isInlineEditing ? (
          generatedTextNode ? (
            <textarea
              className="node-inline-editor"
              data-node-inline-editor-id={node.id}
              value={nodeText}
              placeholder="在节点内直接编辑文本…"
              onPointerDown={(event) => event.stopPropagation()}
              onBlur={() => setEditingInlineNodeId((current) => current === node.id ? "" : current)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setEditingInlineNodeId("");
                  event.currentTarget.blur();
                }
              }}
              onChange={(event) => updateNodeTextContent(node.id, event.target.value)}
            />
          ) : (
            <CanvasResourceMentionTextarea
              className="node-inline-editor"
              data-node-inline-editor-id={node.id}
              value={nodeText}
              references={mentionReferencesForNode(node.id)}
              placeholder="输入 @ 可引用已连接节点或资产…"
              onPointerDown={(event) => event.stopPropagation()}
              thumbnailForReference={mentionThumbnailFor}
              onPreviewReference={previewMentionReference}
              onLocateReference={locateMentionReference}
              onBlur={() => setEditingInlineNodeId((current) => current === node.id ? "" : current)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setEditingInlineNodeId("");
                  event.currentTarget.blur();
                }
              }}
              onMentionQueryChange={queueMentionAssetSearch}
              onChange={(value) => updateNodePrompt(node.id, value)}
            />
          )
        ) : (
          <div className={nodeText.trim() ? "prompt-body" : "prompt-body prompt-body-empty"} title="双击编辑节点内容">
            {nodeText.trim() ? null : <span className="prompt-body-type-icon">{nodeKindCenterIcon(node.kind)}</span>}
            <p style={node.metadata?.fontSize ? { fontSize: `${node.metadata.fontSize}px`, lineHeight: 1.65 } : undefined}>{nodeText || nodeInlineEditPlaceholder(node.kind)}</p>
          </div>
        )
      ) : isEmptyMediaNode ? (
        <div className="prompt-body node-empty-body">
          {!isRunning && <ImageIcon size={30} strokeWidth={1.2} />}
        </div>
      ) : (
        <div className="prompt-body">{node.kind === "image" ? <ImageIcon size={22} /> : <Sparkles size={18} />}<p>{node.content || "空节点"}</p></div>
      )}
      {showImageInfo && node.kind === "image" && preview ? (
        <div className="canvas-node-image-info">
          {Math.round(numberValue(node.metadata?.naturalWidth) || node.width)} × {Math.round(numberValue(node.metadata?.naturalHeight) || node.height)}
          {numberValue(node.metadata?.bytes) ? ` · ${formatBytes(numberValue(node.metadata?.bytes) || 0)}` : ""}
        </div>
      ) : null}
      {node.metadata?.status === "error" && node.metadata.errorDetails ? (
        <div className="node-error-box">
          <p title={node.metadata.errorDetails}>{node.metadata.errorDetails}</p>
          <button
            type="button"
            className="node-error-retry"
            onClick={(event) => {
              event.stopPropagation();
              const mode = generationModeFromNode(node);
              if (mode === "image") void retryImageNode(node);
              else if (mode === "video") void retryVideoNode(node);
              else if (mode === "audio") void retryAudioNode(node);
              else void retryTextNode(node);
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <RotateCcw size={12} /> 重试
          </button>
        </div>
      ) : null}
      {(isSelected || isHovered) && <button className="node-resize-handle" title="调整尺寸" onPointerDown={(event) => startResize(event, node)} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} />}
      {isRunning && <div className="node-running"><i style={{ width: `${progress}%` }} /></div>}
      {isRunning ? <div className="node-loading-overlay is-pixel"><PixelLoadingOverlay /></div> : null}
      {isRunning ? <span className="node-progress-badge">{progress > 0 ? `${progress}%` : "…"}</span> : null}
      {(isSelectedSingle || isPinned) && !isEmptyMediaNode && (
        <div className="node-toolbar-wrap" data-canvas-ui data-canvas-no-zoom>
          <button
            type="button"
            className={`node-toolbar-pin ${isPinned ? "active" : ""}`}
            title={isPinned ? "取消固定" : "固定工具条"}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); setPinnedToolbarNodeId((current) => current === node.id ? "" : node.id); }}
          >
            <Pin size={10} fill={isPinned ? "currentColor" : "none"} /> Pin
          </button>
          <div className="node-hover-toolbar">
            {isRunning ? (
              <button title="停止生成" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); stopGenerationByNodeId(node.id); }}><Square size={12} /></button>
            ) : (
              <>
                <button title="复制" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void duplicateSelectedNode(node.id); }}><Copy size={13} /></button>
                {node.kind === "director" ? <button title="打开导演台" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void openDirectorNode(node); }}><ArrowRight size={13} /></button> : null}
                {node.kind === "text" ? <button title="用文本生图" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void generateImageFromTextNode(node); }}><ImageIcon size={13} /></button> : null}
                {node.kind === "text" ? (
                  <>
                    <button title="减小字号" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); adjustNodeFontSize(node, -2); }}><Minus size={13} /></button>
                    <button title="增大字号" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); adjustNodeFontSize(node, 2); }}><Plus size={13} /></button>
                  </>
                ) : null}
                {node.kind === "image" && preview ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button title="图片工具（更多）" onPointerDown={(event) => event.stopPropagation()}><SlidersHorizontal size={13} /></button>
                    </PopoverTrigger>
                    <PopoverContent className="node-pop-card node-pop-wide" align="center" side="top" sideOffset={10}>
                      <p className="eyebrow">图片工具</p>
                      <CanvasImageToolGrid node={node} imageToolBusy={imageToolBusy} storyboardBusy={storyboardBusy} openImageToolDialog={openImageToolDialog} setImageAnnotationNodeId={setImageAnnotationNodeId} setImageMaskNodeId={setImageMaskNodeId} setImageToolError={setImageToolError} flipCanvasImageNode={flipCanvasImageNode} generatePanoramaCanvasImage={generatePanoramaCanvasImage} generateStoryboard={(target) => setStoryboardNodeId(target.id)} createImageReversePromptNodes={createImageReversePromptNodes} setImagePreviewNodeId={setImagePreviewNodeId} setReplaceImageNodeId={setReplaceImageNodeId} replaceImageInputRef={replaceImageInputRef} archiveCanvasMediaNode={archiveCanvasMediaNode} />
                    </PopoverContent>
                  </Popover>
                ) : null}
                {node.kind === "image" && !preview ? <button title="上传图片" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setReplaceImageNodeId(node.id); replaceImageInputRef.current?.click(); }}><Upload size={13} /></button> : null}
                {node.kind === "video" && preview ? <button title="从当前播放帧创建图片节点" disabled={captureBusy} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void captureVideoFrameNode(node); }}><Camera size={13} /></button> : null}
                {node.kind === "video" && preview ? <button title="AI 超分（依赖管理员配置的模型服务）" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); toast.info("视频超分依赖管理员配置的模型服务，本地暂未实现"); }}><Sparkles size={13} /></button> : null}
                {node.kind === "video" && preview ? <button title="素材校验" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setMaterialNodeId(node.id); }}><BadgeCheck size={13} /></button> : null}
                {node.kind === "video" && preview ? <button title="全屏播放" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); document.querySelector<HTMLVideoElement>(`.real-canvas-node[data-node-id="${node.id}"] video`)?.requestFullscreen?.(); }}><Maximize2 size={13} /></button> : null}
                {preview || node.kind === "text" ? <button title="加入素材库" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void (node.kind === "text" ? archiveCanvasTextNode(node) : archiveCanvasMediaNode(node)); }}><FolderOpen size={13} /></button> : null}
                {preview ? <button title="下载" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void downloadNodeMedia(node); }}><Download size={13} /></button> : null}
                {node.metadata?.status === "error" && generationModeFromNode(node) === "image" ? (
                  <button title="重试生成" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void retryImageNode(node); }}><RotateCcw size={13} /></button>
                ) : node.metadata?.status === "error" && generationModeFromNode(node) === "text" ? (
                  <button title="重试文本" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void retryTextNode(node); }}><RotateCcw size={13} /></button>
                ) : node.metadata?.status === "error" && generationModeFromNode(node) === "video" ? (
                  <button title="重试视频" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void retryVideoNode(node); }}><RotateCcw size={13} /></button>
                ) : node.metadata?.status === "error" && generationModeFromNode(node) === "audio" ? (
                  <button title="重试音频" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void retryAudioNode(node); }}><RotateCcw size={13} /></button>
                ) : null}
                <button className="danger" title="删除" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); removeNode(node.id); }}><Trash2 size={13} /></button>
              </>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

export function canvasNodeCardPropsEqual(prev: CanvasNodeCardProps, next: CanvasNodeCardProps) {
  return (
    prev.node === next.node
    && prev.previews === next.previews
    && prev.isSelected === next.isSelected
    && prev.isSelectedSingle === next.isSelectedSingle
    && prev.isHovered === next.isHovered
    && prev.isConnectionTarget === next.isConnectionTarget
    && prev.isConnecting === next.isConnecting
    && prev.connectActiveTarget === next.connectActiveTarget
    && prev.connectActiveSource === next.connectActiveSource
    && prev.isTitleEditing === next.isTitleEditing
    && prev.titleDraft === next.titleDraft
    && prev.isInlineEditing === next.isInlineEditing
    && prev.isRunning === next.isRunning
    && prev.progress === next.progress
    && prev.isPinned === next.isPinned
    && prev.captureBusy === next.captureBusy
    && prev.isCapturingFrame === next.isCapturingFrame
    && prev.showImageInfo === next.showImageInfo
    && prev.imageToolBusy === next.imageToolBusy
    && prev.storyboardBusy === next.storyboardBusy
  );
}

export const CanvasNodeCard = memo(CanvasNodeCardView, canvasNodeCardPropsEqual);
