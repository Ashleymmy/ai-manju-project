import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Loader2, RefreshCw, Search, UserRoundCog } from "lucide-react";
import { toast } from "sonner";

import { listUserSeedanceAssets, seedanceAssetRef, type SeedanceAsset } from "@/entities/asset";
import { SeedanceAssetUpload, SeedanceAssetThumbnail } from "./SeedanceAssetMedia";
import type { WorkspaceScope } from "@/shared/config";
import { publicApiError } from "@/shared/api/errors";
import "../pages/video-workbench/workbench.css";

/* 用户自己的拟真人素材注册与状态；Active 后才能用于视频参考。 */

function statusLabel(status: string) {
  const normalized = (status || "").toLowerCase();
  if (normalized === "active") return { text: "可用", tone: "ok" };
  if (normalized === "processing" || normalized === "pending") return { text: "处理中", tone: "busy" };
  if (normalized === "failed" || normalized === "error") return { text: "失败", tone: "bad" };
  return { text: status || "未知", tone: "muted" };
}

export default function SeedanceAssetPanel({ scope }: { scope: WorkspaceScope }) {
  const [items, setItems] = useState<SeedanceAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | "Image" | "Video">("");

  const load = useCallback(async (keyword: string, type: string) => {
    setLoading(true);
    try {
      const result = await listUserSeedanceAssets({ scope, search: keyword.trim(), type: type || undefined, limit: 100 });
      setItems(result.items || []);
    } catch (error) {
      toast.error(publicApiError(error, "读取真人素材失败"));
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(search, typeFilter), 260);
    return () => window.clearTimeout(timer);
  }, [load, search, typeFilter]);

  const hasPending = items.some((item) => item.status === "Processing");
  useEffect(() => {
    if (!hasPending) return;
    const timer = window.setInterval(() => void load(search, typeFilter), 5_000);
    return () => window.clearInterval(timer);
  }, [hasPending, load, search, typeFilter]);

  const stats = useMemo(() => {
    const images = items.filter((item) => item.asset_type === "Image").length;
    const videos = items.filter((item) => item.asset_type === "Video").length;
    const active = items.filter((item) => (item.status || "").toLowerCase() === "active").length;
    return { total: items.length, images, videos, active };
  }, [items]);

  return (
    <div className="wb-seedance-panel">
      <div className="wb-seedance-toolbar">
        <SeedanceAssetUpload scope={scope} onRegistered={() => void load(search, typeFilter)} />
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
        <div className="empty-output"><UserRoundCog size={24} /><p>暂无拟真人素材，上传 AI 角色图片后等待注册完成。</p></div>
      ) : (
        <div className="wb-seedance-grid">
          {items.map((asset) => <SeedanceCard key={asset.id} asset={asset} />)}
        </div>
      )}
        {/* 暂时隐藏"当前工作区：团队空间/个人空间"提示（全局隐藏团队空间显示），恢复时取消下行注释
        <p className="wb-seedance-hint">上传 AI 生成的拟真人角色图，状态变为“可用”后，在视频工作台的“媒体资产库 → 真人(火山)”中选入参考。当前工作区：{scope === "team" ? "团队空间" : "个人空间"}。</p>
        */}
        <p className="wb-seedance-hint">上传 AI 生成的拟真人角色图，状态变为“可用”后，在视频工作台的“媒体资产库 → 真人(火山)”中选入参考。</p>
    </div>
  );
}

function SeedanceCard({ asset }: { asset: SeedanceAsset }) {
  const status = statusLabel(asset.status);
  const active = asset.status === "Active" && Boolean(asset.volcano_asset_id);
  return (
              <article key={asset.id} className="wb-seedance-card">
                <button
                  type="button"
                  className="wb-seedance-thumb"
                  disabled={!active}
                  title="复制 asset:// 引用，可在视频提示词中引用该素材"
                  onClick={() => void navigator.clipboard.writeText(seedanceAssetRef(asset)).then(() => toast.success(`已复制 ${seedanceAssetRef(asset)}`))}
                >
                  <SeedanceAssetThumbnail source={asset.source_url} assetType={asset.asset_type} name={asset.name} />
                  <span className={`wb-seedance-status ${status.tone}`}>{status.text}</span>
                  <i className="wb-seedance-copy"><Copy size={11} /></i>
                </button>
                <b title={asset.name || asset.volcano_asset_id}>{asset.name || asset.volcano_asset_id}</b>
                {active ? <code>{seedanceAssetRef(asset)}</code> : <small>{asset.error_message || status.text}</small>}
                {asset.tags?.length ? (
                  <div className="wb-seedance-tags">{asset.tags.map((tag) => <span key={tag.id}>#{tag.name}</span>)}</div>
                ) : null}
              </article>
  );
}
