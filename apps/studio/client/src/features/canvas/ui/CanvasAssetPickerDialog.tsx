import {
  BookOpen,
  Check,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Music2,
  Search,
  Star,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  CanvasAssetPickerFolderOption,
  CanvasAssetPickerItem,
  CanvasAssetPickerKind,
} from "@/features/canvas/controllers/assets-mentions/types";
import type { WorkspaceScope } from "@/shared/config/workspace";

export type { CanvasAssetPickerItem, CanvasAssetPickerKind };

const PICKER_KIND_CHIPS: Array<{ value: CanvasAssetPickerKind; label: string }> = [
  { value: "all", label: "全部" },
  { value: "favorite", label: "收藏夹" },
  { value: "text", label: "文本" },
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
];

export type CanvasAssetPickerDialogProps = {
  open: boolean;
  insertBusy: boolean;
  scopeOptions: ReadonlyArray<{ value: WorkspaceScope; label: string }>;
  scope: WorkspaceScope;
  loading: boolean;
  query: string;
  kind: CanvasAssetPickerKind;
  folderId: string;
  folders: CanvasAssetPickerFolderOption[];
  error: string;
  items: CanvasAssetPickerItem[];
  selectedIds: string[];
  thumbnails: Record<string, string>;
  onOpenChange: (open: boolean) => void;
  onScopeChange: (scope: WorkspaceScope) => void;
  onKindChange: (kind: CanvasAssetPickerKind) => void;
  onFolderChange: (folderId: string) => void;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  onToggleItem: (itemId: string) => void;
  onCancel: () => void;
  onInsert: () => void;
};

export function CanvasAssetPickerDialog({
  open,
  insertBusy,
  scopeOptions,
  scope,
  loading,
  query,
  kind,
  folderId,
  folders,
  error,
  items,
  selectedIds,
  thumbnails,
  onOpenChange,
  onScopeChange,
  onKindChange,
  onFolderChange,
  onQueryChange,
  onSearch,
  onToggleItem,
  onCancel,
  onInsert,
}: CanvasAssetPickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[820px] canvas-asset-picker-dialog" showCloseButton={!insertBusy}>
        <DialogHeader>
          <DialogTitle>从资产库插入节点</DialogTitle>
          <DialogDescription>支持本地持久化文本以及服务端图片、视频和音频。跨工作区插入文本会复制内容，媒体保留原资产引用。</DialogDescription>
        </DialogHeader>
        <div className="canvas-asset-picker-toolbar">
          <div className="scope-switch">
            {scopeOptions.map((item) => (
              <button
                key={item.value}
                type="button"
                className={scope === item.value ? "active" : ""}
                disabled={loading || insertBusy}
                onClick={() => onScopeChange(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="scope-switch canvas-asset-kind-switch">
            {PICKER_KIND_CHIPS.map((chip) => (
              <button
                key={chip.value}
                type="button"
                className={kind === chip.value ? "active" : ""}
                disabled={loading || insertBusy}
                onClick={() => onKindChange(chip.value)}
              >
                {chip.value === "favorite" ? <Star size={12} fill={kind === "favorite" ? "currentColor" : "none"} /> : null}
                {chip.label}
              </button>
            ))}
          </div>
          <label className="canvas-asset-picker-location">
            <span>位置</span>
            <select
              value={folderId}
              disabled={loading || insertBusy}
              onChange={(event) => onFolderChange(event.target.value)}
            >
              <option value="">全部目录</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.label}</option>
              ))}
            </select>
          </label>
          <label>
            <Search size={15} />
            <input
              value={query}
              placeholder="按名称、备注或标签搜索"
              disabled={insertBusy}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") onSearch(); }}
            />
          </label>
          <button className="outline-button small" type="button" onClick={onSearch} disabled={loading || insertBusy}>
            {loading ? <Loader2 className="spin" size={15} /> : <Search size={15} />} 搜索
          </button>
        </div>
        {error ? <p className="canvas-asset-picker-error">{error}</p> : null}
        <div className="canvas-asset-picker-list">
          {items.map((asset) => {
            const selected = selectedIds.includes(asset.id);
            const Icon = asset.type === "text" ? BookOpen : asset.type === "image" ? ImageIcon : asset.type === "video" ? Film : Music2;
            const thumb = thumbnails[asset.id] || "";
            return (
              <button
                type="button"
                key={asset.id}
                className={selected ? "selected" : ""}
                disabled={insertBusy}
                title={asset.name}
                onClick={() => onToggleItem(asset.id)}
              >
                {thumb ? (
                  <img className="canvas-asset-picker-thumb" src={thumb} alt="" />
                ) : (
                  <span className="canvas-asset-picker-fallback"><Icon size={22} /></span>
                )}
                {selected ? <i><Check size={13} /></i> : null}
              </button>
            );
          })}
          {!loading && !items.length && !error ? <div className="empty-output"><FolderOpen size={26} /><p>当前筛选下没有资产</p></div> : null}
        </div>
        <DialogFooter>
          <button className="outline-button small" type="button" onClick={onCancel} disabled={insertBusy}>取消</button>
          <button className="vermilion-button" type="button" onClick={onInsert} disabled={!selectedIds.length || insertBusy}>
            {insertBusy ? "插入中…" : `插入 ${selectedIds.length || ""} 个资产`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
