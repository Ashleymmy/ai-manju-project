import { ImageIcon, Loader2, Search, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getAssetContentObjectUrl, getAssetLibrary, type Asset } from "@/entities/asset";
import { publicApiError } from "@/shared/api/errors";
import type { WorkspaceScope } from "@/shared/config";

import "./ProjectCoverPickerDialog.css";

/* 封面选择弹窗一次拉取的图片资产数量上限 */
const COVER_PICKER_PAGE_SIZE = 60;
/* 封面缩略图拉取尺寸（px 长边） */
const COVER_PICKER_THUMB_SIZE = 320;

/**
 * 画布项目封面选择弹窗：从当前空间的图片资产里挑一张作为项目封面；
 * 传空字符串表示恢复默认抽象封面。
 */
export function ProjectCoverPickerDialog({
  open,
  scope,
  currentCoverAssetId,
  onClose,
  onSelect,
}: {
  open: boolean;
  scope: WorkspaceScope;
  currentCoverAssetId?: string;
  onClose: () => void;
  onSelect: (assetId: string) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});

  /* 打开时按当前空间拉取图片资产（支持关键字搜索） */
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    setLoading(true);
    getAssetLibrary(scope, { type: "image", keyword: keyword.trim() || undefined, pageSize: COVER_PICKER_PAGE_SIZE, sort: "created_at_desc" })
      .then((result) => { if (!disposed) setAssets(result.items || []); })
      .catch((error) => { if (!disposed) toast.error(publicApiError(error, "读取图片资产失败")); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [open, scope, keyword]);

  /* 为可见资产拉取缩略图 object URL，关闭/换页时统一回收 */
  useEffect(() => {
    if (!open || !assets.length) {
      setThumbUrls({});
      return;
    }
    let disposed = false;
    const urls: Record<string, string> = {};
    Promise.all(assets.map(async (asset) => {
      try {
        const url = await getAssetContentObjectUrl(asset.id, scope, COVER_PICKER_THUMB_SIZE);
        if (disposed) URL.revokeObjectURL(url);
        else urls[asset.id] = url;
      } catch {
        undefined;
      }
    })).then(() => { if (!disposed) setThumbUrls(urls); });
    return () => {
      disposed = true;
      Object.values(urls).forEach(URL.revokeObjectURL);
    };
  }, [open, assets, scope]);

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="cover-picker-dialog">
        <DialogHeader>
          <DialogTitle>设置项目封面</DialogTitle>
          <DialogDescription>从当前空间的图片资产中选一张作为封面；不设置时保持默认抽象封面。</DialogDescription>
        </DialogHeader>
        <div className="tag-search"><Search size={14} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索图片资产" /></div>
        <div className="cover-picker-grid">
          {loading ? (
            <div className="empty-output"><Loader2 className="spin" size={20} /><p>正在读取图片资产…</p></div>
          ) : assets.length ? (
            assets.map((asset) => (
              <button
                key={asset.id}
                className={asset.id === currentCoverAssetId ? "cover-picker-item selected" : "cover-picker-item"}
                title={asset.name}
                onClick={() => onSelect(asset.id)}
              >
                {thumbUrls[asset.id] ? <img src={thumbUrls[asset.id]} alt={asset.name} /> : <ImageIcon size={18} />}
                <span>{asset.name}</span>
              </button>
            ))
          ) : (
            <div className="empty-output"><ImageIcon size={20} /><p>当前空间还没有图片资产</p></div>
          )}
        </div>
        {currentCoverAssetId ? (
          <button className="cover-picker-reset" onClick={() => onSelect("")}><Undo2 size={13} /> 恢复默认封面</button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
