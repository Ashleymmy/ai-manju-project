import { useEffect, useRef } from "react";
import { ArchiveRestore, ChevronDown, Download, FolderInput, Tag, Trash2, X } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Select-all checkbox that also shows the partially selected state. */
export function PageSelectAll({ total, selected, onChange }: { total: number; selected: number; onChange: (all: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const all = total > 0 && selected >= total;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = selected > 0 && !all;
  }, [all, selected]);
  return (
    <label className="asset-page-select" title={all ? "取消选择本页全部资产" : `选中本页全部 ${total} 项`}>
      <input ref={ref} type="checkbox" checked={all} disabled={!total} onChange={() => onChange(!all)} />本页全选
    </label>
  );
}

/** Replaces the idle grid toolbar while assets are selected; `asset-bulk-bar` keeps the selection alive on click. */
export function AssetSelectionBar(props: {
  total: number;
  selectedCount: number;
  onSelectAll: (all: boolean) => void;
  onClear: () => void;
  trash: boolean;
  moveTargets: Array<{ id: string; label: string }>;
  onMove: (folderId: string) => void;
  onEditTags: () => void;
  exportBusy: boolean;
  onExport: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onPermanentDelete: () => void;
}) {
  return (
    <div className="asset-bulk-bar" role="toolbar" aria-label="批量操作">
      <PageSelectAll total={props.total} selected={props.selectedCount} onChange={props.onSelectAll} />
      <span className="asset-bulk-divider" aria-hidden="true" />
      <span className="asset-bulk-count" aria-live="polite">已选 <em>{props.selectedCount}</em> 项</span>
      {props.trash ? (
        <button type="button" onClick={props.onRestore}><ArchiveRestore size={14} />恢复</button>
      ) : (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" disabled={!props.moveTargets.length}><FolderInput size={14} />移动到<ChevronDown size={12} className="caret" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="asset-menu asset-move-menu" data-keep-asset-selection="true">
              {props.moveTargets.map((target) => (
                <DropdownMenuItem key={target.id} onSelect={() => props.onMove(target.id)}>{target.label}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" onClick={props.onEditTags}><Tag size={14} />标签</button>
          <button type="button" disabled={props.exportBusy} onClick={props.onExport}><Download size={14} />导出</button>
        </>
      )}
      <span className="asset-toolbar-spacer" />
      {props.trash
        ? <button type="button" className="danger" onClick={props.onPermanentDelete}><Trash2 size={14} />永久删除</button>
        : <button type="button" className="danger" onClick={props.onDelete}><Trash2 size={14} />删除</button>}
      <span className="asset-bulk-divider" aria-hidden="true" />
      <button type="button" className="asset-bulk-close" aria-label="取消选择" title="取消选择（Esc）" onClick={props.onClear}><X size={15} /></button>
    </div>
  );
}
