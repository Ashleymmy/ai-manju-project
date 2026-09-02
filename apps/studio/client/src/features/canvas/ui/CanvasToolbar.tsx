import {
  Bot,
  Boxes,
  Camera,
  CloudUpload,
  Download,
  Eye,
  Film,
  FolderOpen,
  GitMerge,
  Grid2X2,
  Grid3x3,
  Image as ImageIcon,
  Link2,
  Loader2,
  Map as MapIcon,
  Maximize2,
  MousePointer2,
  Music2,
  Redo2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Type,
  Undo2,
  Ungroup,
  Upload,
  UserRoundCog,
  WandSparkles,
} from "lucide-react";
import type { CanvasBackgroundMode, CanvasNodeKind } from "@/features/canvas/domain/types";

export type CanvasTopToolbarProps = {
  disabled: boolean;
  connecting: boolean;
  selectedNodeId?: string;
  canUndo: boolean;
  canRedo: boolean;
  uploading: boolean;
  selectedNodeCount: number;
  selectedGroupId: string;
  selectedGroupRunning: boolean;
  groupRunning: boolean;
  fragmentBusy: boolean;
  agentOpen: boolean;
  onActivateConnection: (nodeId: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddNode: (kind: CanvasNodeKind) => void;
  onUpload: () => void;
  onOpenAssets: () => void;
  onCreateGroup: () => void;
  onConnectSelection: () => void;
  onRunGroup: (groupId: string) => void;
  onUngroup: (groupId: string) => void;
  onExportSelection: () => void;
  onRemoveSelection: () => void;
  onOpenSeedanceAssets: (nodeId: string) => void;
  onToggleAgent: () => void;
};

export function CanvasTopToolbar({
  disabled,
  connecting,
  selectedNodeId,
  canUndo,
  canRedo,
  uploading,
  selectedNodeCount,
  selectedGroupId,
  selectedGroupRunning,
  groupRunning,
  fragmentBusy,
  agentOpen,
  onActivateConnection,
  onUndo,
  onRedo,
  onAddNode,
  onUpload,
  onOpenAssets,
  onCreateGroup,
  onConnectSelection,
  onRunGroup,
  onUngroup,
  onExportSelection,
  onRemoveSelection,
  onOpenSeedanceAssets,
  onToggleAgent,
}: CanvasTopToolbarProps) {
  return (
    <div className="canvas-top-tools" data-canvas-ui data-canvas-no-zoom>
      <div className="tool-cluster">
        <button title="选择" disabled={disabled}><MousePointer2 size={16} /></button>
        <button title={connecting ? "选择目标节点完成连接" : "从当前节点开始连接"} className={connecting ? "active" : ""} onClick={() => selectedNodeId && onActivateConnection(selectedNodeId)} disabled={disabled}><Link2 size={16} /></button>
        <button title="撤销" onClick={onUndo} disabled={!canUndo || disabled}><Undo2 size={16} /></button>
        <button title="重做" onClick={onRedo} disabled={!canRedo || disabled}><Redo2 size={16} /></button>
        <i className="tool-divider" />
        <button title="添加文本" onClick={() => onAddNode("text")} disabled={disabled}><Type size={16} /></button>
        <button title="添加图片" onClick={() => onAddNode("image")} disabled={disabled}><ImageIcon size={16} /></button>
        <button title="添加视频" onClick={() => onAddNode("video")} disabled={disabled}><Film size={16} /></button>
        <button title="添加音频" onClick={() => onAddNode("audio")} disabled={disabled}><Music2 size={16} /></button>
        <button title="添加配置" onClick={() => onAddNode("config")} disabled={disabled}><SlidersHorizontal size={16} /></button>
        <button title="添加导演台" onClick={() => onAddNode("director")} disabled={disabled}><Camera size={16} /></button>
        <i className="tool-divider" />
        <button title="上传素材" onClick={onUpload} disabled={uploading || disabled}><Upload size={16} /></button>
        <button title="从资产库插入" onClick={onOpenAssets} disabled={disabled}><FolderOpen size={16} /></button>
        <i className="tool-divider" />
        <button title="将所选节点创建为分组" onClick={onCreateGroup} disabled={disabled || selectedNodeCount < 2}><Boxes size={16} /></button>
        <button title="将所选节点连接到新配置或已有配置" onClick={onConnectSelection} disabled={disabled || selectedNodeCount < 2}><GitMerge size={16} /></button>
        <button title="按顺序执行当前分组中的可生成节点" onClick={() => selectedGroupId && onRunGroup(selectedGroupId)} disabled={disabled || !selectedGroupId || groupRunning}>{selectedGroupRunning ? <Loader2 className="spin" size={16} /> : <WandSparkles size={16} />}</button>
        <button title="解散当前分组（保留节点）" onClick={() => selectedGroupId && onUngroup(selectedGroupId)} disabled={disabled || !selectedGroupId}><Ungroup size={16} /></button>
        {selectedNodeCount ? (
          <>
            <i className="tool-divider" />
            <button title="导出选中节点" onClick={onExportSelection} disabled={fragmentBusy || disabled}><Download size={16} /></button>
            <button title="删除选中节点" onClick={onRemoveSelection} disabled={disabled}><Trash2 size={16} /></button>
          </>
        ) : null}
      </div>
      <div className="canvas-agent-pills" data-canvas-ui data-canvas-no-zoom>
        <button title="数字人（Seedance 素材）" onClick={() => selectedNodeId && onOpenSeedanceAssets(selectedNodeId)} disabled={!selectedNodeId || disabled}><UserRoundCog size={14} /></button>
        <button title="数字资产（资产库）" onClick={onOpenAssets} disabled={disabled}><FolderOpen size={14} /></button>
        <button title="原型对话 Agent（服务侧）" onClick={onToggleAgent} className={agentOpen ? "active" : ""} disabled={disabled}><Sparkles size={14} /></button>
        <button title="画布对话 Agent（本机桥接）" onClick={onToggleAgent} className={agentOpen ? "active" : ""} disabled={disabled}><Bot size={14} /></button>
      </div>
    </div>
  );
}

export type CanvasBottomToolbarProps = {
  disabled: boolean;
  saving: boolean;
  syncSaving: boolean;
  snapshotWriteReady: boolean;
  zoom: number;
  minimapOpen: boolean;
  showImageInfo: boolean;
  backgroundMode: CanvasBackgroundMode;
  onPersist: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onToggleMinimap: () => void;
  onFit: () => void;
  onToggleImageInfo: () => void;
  onSetBackground: (mode: CanvasBackgroundMode) => void;
};

export function CanvasBottomToolbar({
  disabled,
  saving,
  syncSaving,
  snapshotWriteReady,
  zoom,
  minimapOpen,
  showImageInfo,
  backgroundMode,
  onPersist,
  onZoomOut,
  onZoomIn,
  onToggleMinimap,
  onFit,
  onToggleImageInfo,
  onSetBackground,
}: CanvasBottomToolbarProps) {
  return (
    <div className="canvas-bottom-tools" data-canvas-ui data-canvas-no-zoom>
      <button title="手动同步到服务端快照（占位，自动同步已开启）" onClick={onPersist} disabled={saving || syncSaving || disabled || !snapshotWriteReady}><CloudUpload size={15} /></button>
      <span />
      <button onClick={onZoomOut} disabled={disabled}>−</button>
      <b>{zoom}%</b>
      <button onClick={onZoomIn} disabled={disabled}>+</button>
      <span />
      <button className={minimapOpen ? "active" : ""} title={minimapOpen ? "关闭缩略导航" : "打开缩略导航"} onClick={onToggleMinimap} disabled={disabled}><MapIcon size={15} /></button>
      <button onClick={onFit} disabled={disabled} title="适配"><Maximize2 size={15} /></button>
      <span />
      <button title="显示或隐藏图片信息" className={showImageInfo ? "active" : ""} onClick={onToggleImageInfo} disabled={disabled}><Eye size={15} /></button>
      <button title="点阵背景" className={backgroundMode === "dots" ? "active" : ""} onClick={() => onSetBackground("dots")} disabled={disabled}><Grid3x3 size={15} /></button>
      <button title="网格背景" className={backgroundMode === "lines" ? "active" : ""} onClick={() => onSetBackground("lines")} disabled={disabled}><Grid2X2 size={15} /></button>
      <button title="空白背景" className={backgroundMode === "blank" ? "active" : ""} onClick={() => onSetBackground("blank")} disabled={disabled}><Square size={14} /></button>
    </div>
  );
}
