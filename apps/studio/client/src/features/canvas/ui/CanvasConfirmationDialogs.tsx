import { Link2, Plus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isHiddenCanvasBatchChild } from "@/features/canvas/domain/connections";
import type { CanvasNodeData } from "@/features/canvas/domain/types";

export type CanvasConnectSelectionDialogProps = {
  open: boolean;
  selectedNodeCount: number;
  disabled: boolean;
  nodes: CanvasNodeData[];
  onOpenChange: (open: boolean) => void;
  onConnect: (targetNodeId?: string) => void;
};

export function CanvasConnectSelectionDialog({
  open,
  selectedNodeCount,
  disabled,
  nodes,
  onOpenChange,
  onConnect,
}: CanvasConnectSelectionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>连接所选节点到配置</DialogTitle>
          <DialogDescription>将当前选中的 {selectedNodeCount} 个节点连接到一个配置节点。隐藏的批量子节点、配置到配置和重复连线会自动跳过。</DialogDescription>
        </DialogHeader>
        <div className="canvas-config-target-list">
          <button type="button" className="full-outline" onClick={() => onConnect()} disabled={selectedNodeCount < 2 || disabled}>
            <Plus size={16} /> 新建配置节点并连接
          </button>
          {nodes.filter((node) => node.kind === "config" && !isHiddenCanvasBatchChild(node, nodes)).map((node) => (
            <button key={node.id} type="button" className="full-outline" onClick={() => onConnect(node.id)} disabled={selectedNodeCount < 2 || disabled}>
              <Link2 size={16} /> {node.title || `配置 ${node.id.slice(-6)}`}
            </button>
          ))}
          {!nodes.some((node) => node.kind === "config" && !isHiddenCanvasBatchChild(node, nodes)) ? <p className="prompt-copy">当前画布还没有已有配置，可直接新建。</p> : null}
        </div>
        <DialogFooter>
          <button className="outline-button small" type="button" onClick={() => onOpenChange(false)}>取消</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type CanvasDestructiveDialogsProps = {
  clearOpen: boolean;
  clearBusy: boolean;
  clearError: string;
  deleteOpen: boolean;
  deleteBusy: boolean;
  deleteError: string;
  projectTitle: string;
  onClearOpenChange: (open: boolean) => void;
  onClear: () => void;
  onDeleteOpenChange: (open: boolean) => void;
  onDelete: () => void;
};

export function CanvasDestructiveDialogs({
  clearOpen,
  clearBusy,
  clearError,
  deleteOpen,
  deleteBusy,
  deleteError,
  projectTitle,
  onClearOpenChange,
  onClear,
  onDeleteOpenChange,
  onDelete,
}: CanvasDestructiveDialogsProps) {
  return (
    <>
      <AlertDialog open={clearOpen} onOpenChange={onClearOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清空当前画布？</AlertDialogTitle>
            <AlertDialogDescription>将清除当前项目的全部节点、连线和分组。项目本身、画布背景设置以及独立资产库内容都会保留，完成后仍可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          {clearError ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{clearError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearBusy}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={clearBusy} onClick={(event) => { event.preventDefault(); onClear(); }}>
              {clearBusy ? "正在清空" : "确认清空"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deleteOpen} onOpenChange={onDeleteOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除当前画布</AlertDialogTitle>
            <AlertDialogDescription>将永久删除“{projectTitle || "未命名画布"}”及其服务端快照。资产库中的独立素材不会被删除。</AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{deleteError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={deleteBusy} onClick={(event) => { event.preventDefault(); onDelete(); }}>
              {deleteBusy ? "正在删除" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
