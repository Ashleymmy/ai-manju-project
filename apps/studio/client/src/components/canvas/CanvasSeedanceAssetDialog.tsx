import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, RefreshCw, Search, Trash2, UserRoundCog } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ensureSeedanceAssetsActive,
  listSeedanceAssetMentions,
  seedanceAssetRef,
  type SeedanceAsset,
  type SeedanceAssetTag,
} from "@/services/api";

export type SelectedSeedanceVolcanoAsset = {
  id: string;
  volcanoAssetId: string;
  name?: string;
  status?: string;
  assetType?: string;
};

type CanvasSeedanceAssetDialogProps = {
  open: boolean;
  selectedAssets?: SelectedSeedanceVolcanoAsset[];
  onClose: () => void;
  onSelect: (asset: SeedanceAsset) => void;
  onRemove?: (volcanoAssetId: string) => void;
};

export function CanvasSeedanceAssetDialog({ open, selectedAssets = [], onClose, onSelect, onRemove }: CanvasSeedanceAssetDialogProps) {
  const [assets, setAssets] = useState<SeedanceAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [tagId, setTagId] = useState("");
  const [selectingId, setSelectingId] = useState("");
  const selectedIds = useMemo(() => new Set(selectedAssets.map((asset) => asset.volcanoAssetId).filter(Boolean)), [selectedAssets]);
  const tags = useMemo(() => uniqueTags(assets.flatMap((asset) => asset.tags || [])), [assets]);
  const visibleAssets = useMemo(() => tagId
    ? assets.filter((asset) => (asset.tags || []).some((tag) => tag.id === tagId))
    : assets, [assets, tagId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listSeedanceAssetMentions({ search: search.trim(), limit: 100 });
      setAssets(result.items || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "拟真人素材库读取失败");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  const selectAsset = async (asset: SeedanceAsset) => {
    setSelectingId(asset.volcano_asset_id);
    try {
      await ensureSeedanceAssetsActive([asset.volcano_asset_id]);
      onSelect(asset);
      toast.success("已选入 Seedance 拟真人素材");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "素材未激活");
    } finally {
      setSelectingId("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="canvas-seedance-dialog sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>Seedance 拟真人素材库</DialogTitle>
          <DialogDescription>选择 Active 的火山素材，以 `asset://` 引用加入当前视频节点。</DialogDescription>
        </DialogHeader>
        <div className="canvas-seedance-toolbar">
          <label><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} placeholder="搜索名称 / AssetID" /></label>
          <select value={tagId} onChange={(event) => setTagId(event.target.value)}>
            <option value="">全部标签</option>
            {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
          </select>
          <button type="button" title="查询素材" onClick={() => void load()} disabled={loading}><Search size={15} /> 查询</button>
          <button type="button" title="刷新素材" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /></button>
        </div>
        {selectedAssets.length ? (
          <div className="canvas-seedance-selected">
            {selectedAssets.map((asset) => <span key={asset.volcanoAssetId}>{asset.name || asset.volcanoAssetId}{onRemove ? <button type="button" title="移除素材" onClick={() => onRemove(asset.volcanoAssetId)}><Trash2 size={12} /></button> : null}</span>)}
          </div>
        ) : null}
        <div className="canvas-seedance-list">
          {visibleAssets.length ? visibleAssets.map((asset) => {
            const selected = selectedIds.has(asset.volcano_asset_id);
            return (
              <article key={asset.id}>
                <div className="canvas-seedance-asset-main">
                  <UserRoundCog size={16} />
                  <div><b>{asset.name || asset.volcano_asset_id}</b><code>{seedanceAssetRef(asset)}</code>{asset.description ? <p>{asset.description}</p> : null}</div>
                  <span>{asset.status || "Active"}</span><span>{asset.asset_type || "Image"}</span>
                </div>
                {asset.tags?.length ? <div className="canvas-seedance-tags">{asset.tags.map((tag) => <i key={tag.id}>{tag.name}</i>)}</div> : null}
                <div className="canvas-seedance-actions">
                  <button type="button" title="复制 asset:// 引用" onClick={() => void navigator.clipboard.writeText(seedanceAssetRef(asset)).then(() => toast.success("已复制 asset:// 引用"))}><Copy size={14} /></button>
                  {selected && onRemove ? <button type="button" title="移除素材" onClick={() => onRemove(asset.volcano_asset_id)}><Trash2 size={14} /></button> : null}
                  <button type="button" onClick={() => void selectAsset(asset)} disabled={selected || selectingId === asset.volcano_asset_id}>{selected ? "已选" : selectingId === asset.volcano_asset_id ? "校验中" : "选入"}</button>
                </div>
              </article>
            );
          }) : <div className="empty-output"><p>{loading ? "正在读取素材…" : "暂无 Active 素材"}</p></div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function uniqueTags(tags: SeedanceAssetTag[]) {
  const seen = new Set<string>();
  return tags.filter((tag) => {
    if (!tag.id || seen.has(tag.id)) return false;
    seen.add(tag.id);
    return true;
  });
}
