import {
  BookOpen,
  Check,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Music2,
  Search,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WorkspaceScope } from "@/shared/config/workspace";

export type CanvasAssetPickerKind = "all" | "text" | "image" | "video" | "audio";

export type CanvasAssetPickerItem = {
  id: string;
  type: Exclude<CanvasAssetPickerKind, "all">;
  name: string;
  scope: WorkspaceScope;
  source: "server" | "local-text";
  serverAsset?: unknown;
  textAsset?: unknown;
  category?: string;
  size?: number;
  contentType?: string;
};

export type CanvasAssetPickerDialogProps = {
  open: boolean;
  insertBusy: boolean;
  scopeOptions: ReadonlyArray<{ value: WorkspaceScope; label: string }>;
  scope: WorkspaceScope;
  loading: boolean;
  query: string;
  kind: CanvasAssetPickerKind;
  error: string;
  items: CanvasAssetPickerItem[];
  selectedIds: string[];
  onOpenChange: (open: boolean) => void;
  onScopeChange: (scope: WorkspaceScope) => void;
  onKindChange: (kind: CanvasAssetPickerKind) => void;
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
  error,
  items,
  selectedIds,
  onOpenChange,
  onScopeChange,
  onKindChange,
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
            {(["all", "text", "image", "video", "audio"] as CanvasAssetPickerKind[]).map((itemKind) => (
              <button
                key={itemKind}
                type="button"
                className={kind === itemKind ? "active" : ""}
                disabled={loading || insertBusy}
                onClick={() => onKindChange(itemKind)}
              >
                {itemKind === "all" ? "全部" : itemKind === "text" ? "文本" : itemKind === "image" ? "图片" : itemKind === "video" ? "视频" : "音频"}
              </button>
            ))}
          </div>
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
            return (
              <button
                type="button"
                key={asset.id}
                className={selected ? "selected" : ""}
                disabled={insertBusy}
                onClick={() => onToggleItem(asset.id)}
              >
                <span><Icon size={19} /></span>
                <b>{asset.name}</b>
                <small>{asset.type === "text" ? `文本 · ${asset.source === "local-text" ? "本地持久化" : "资产库"}` : `${asset.type} · ${asset.category || "未分类"} · ${asset.size ? formatBytes(asset.size) : "未知体积"}`}</small>
                <i>{selected ? <Check size={14} /> : null}</i>
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

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
