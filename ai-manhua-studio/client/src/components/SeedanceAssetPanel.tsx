import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Loader2, RefreshCw, Search, UserRoundCog } from "lucide-react";
import { toast } from "sonner";

import {
  listSeedanceAssetMentions,
  publicApiError,
  seedanceAssetRef,
  type SeedanceAsset,
  type WorkspaceScope,
} from "@/services/api";
import "../pages/video-workbench/workbench.css";

/* 资产库「真人素材」选项页：对应 SD-video 媒体库里的火山真人素材架。
   数据来自 /api/ai/seedance-assets/mentions（只读浏览 + 复制 asset:// 引用；
   上传/同步等管理操作仍在管理后台的 Seedance 素材页）。 */

function statusLabel(status: string) {
  const normalized = (status || "").toLowerCase();
  if (normalized === "active") return { text: "可用", tone: "ok" };
  if (normalized === "processing" || normalized === "pending") return { text: "处理中", tone: "busy" };
  if (normalized === "failed" || normalized === "error") return { text: "失败", tone: "bad" };
  return { text: status || "未知", tone: "muted" };
}

function isHttpUrl(value?: string) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

export default function SeedanceAssetPanel({ scope }: { scope: WorkspaceScope }) {
  const [items, setItems] = useState<SeedanceAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | "Image" | "Video">("");

  const load = useCallback(async (keyword: string, type: string) => {
    setLoading(true);
    try {
      const result = await listSeedanceAssetMentions({ search: keyword.trim(), type: type || undefined, limit: 100 });
      setItems(result.items || []);
    } catch (error) {
      toast.error(publicApiError(error, "读取真人素材失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(search, typeFilter), 260);
    return () => window.clearTimeout(timer);
  }, [load, search, typeFilter]);

  const stats = useMemo(() => {
    const images = items.filter((item) => item.asset_type === "Image").length;
    const videos = items.filter((item) => item.asset_type === "Video").length;
    const active = items.filter((item) => (item.status || "").toLowerCase() === "active").length;
    return { total: items.length, images, videos, active };
  }, [items]);

  return (
    <div className="wb-seedance-panel">
      <div className="wb-seedance-toolbar">
        <label className="wb-picker-search">
          <Search size={13} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索素材名称…" />
        </label>
        <div className="wb-segments">
          {([["", "全部"], ["Image", "图片"], ["Video", "视频"]] as const).map(([value, label]) => (
            <button key={value || "all"} type="button" className={typeFilter === value ? "active" : ""} onClick={() => setTypeFilter(value)}>{label}</button>
          ))}
        </div>
        <span className="wb-seedance-stats">共 {stats.total} · 图片 {stats.images} · 视频 {stats.videos} · 可用 {stats.active}</span>
        <button type="button" className="wb-icon-button" title="刷新" onClick={() => void load(search, typeFilter)} disabled={loading}>
          <RefreshCw size={13} className={loading ? "spin" : ""} />
        </button>
      </div>
      {loading && !items.length ? (
        <div className="empty-output"><Loader2 className="spin" size={24} /><p>正在读取真人素材…</p></div>
      ) : !items.length ? (
        <div className="empty-output"><UserRoundCog size={24} /><p>暂无真人素材，可在管理后台的 Seedance 素材页上传或同步。</p></div>
      ) : (
        <div className="wb-seedance-grid">
          {items.map((asset) => {
            const status = statusLabel(asset.status);
            const previewUrl = isHttpUrl(asset.source_url) ? asset.source_url : "";
            return (
              <article key={asset.id} className="wb-seedance-card">
                <button
                  type="button"
                  className="wb-seedance-thumb"
                  title="复制 asset:// 引用，可在视频提示词中引用该素材"
                  onClick={() => void navigator.clipboard.writeText(seedanceAssetRef(asset)).then(() => toast.success(`已复制 ${seedanceAssetRef(asset)}`))}
                >
                  {previewUrl && asset.asset_type === "Image" ? <img src={previewUrl} alt={asset.name} loading="lazy" /> : null}
                  {previewUrl && asset.asset_type === "Video" ? <video src={previewUrl} muted playsInline preload="metadata" /> : null}
                  {!previewUrl ? <UserRoundCog size={22} /> : null}
                  <span className={`wb-seedance-status ${status.tone}`}>{status.text}</span>
                  <i className="wb-seedance-copy"><Copy size={11} /></i>
                </button>
                <b title={asset.name || asset.volcano_asset_id}>{asset.name || asset.volcano_asset_id}</b>
                <code>{seedanceAssetRef(asset)}</code>
                {asset.tags?.length ? (
                  <div className="wb-seedance-tags">{asset.tags.map((tag) => <span key={tag.id}>#{tag.name}</span>)}</div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
      <p className="wb-seedance-hint">提示：点击卡片复制 asset:// 引用；在 /video 工作台或画布视频节点的提示词里粘贴即可引用该真人素材。当前工作区：{scope === "team" ? "团队空间" : "个人空间"}。</p>
    </div>
  );
}
