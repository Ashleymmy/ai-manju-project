import { useRef, useState } from "react";
import { Images, Loader2, Tag } from "lucide-react";
import { ASSET_CATEGORY_OPTIONS, type Asset, type AssetCategory } from "@/entities/asset";
import type { WorkspaceScope } from "@/shared/config";
import { publicApiError } from "@/shared/api/errors";
import type { BulkCategoryResult } from "../model/bulkCategory";
import { AssetThumbnail } from "./AssetThumbnail";

// A compact preview represents the selection without loading the entire page again.
const BULK_PREVIEW_LIMIT = 4;

export function AssetBulkDetailsPanel({ assets, scope, readOnly, onEditTags, onSaveCategory }: {
  assets: Asset[];
  scope: WorkspaceScope;
  readOnly: boolean;
  onEditTags: () => void;
  onSaveCategory: (ids: string[], category: AssetCategory) => Promise<BulkCategoryResult>;
}) {
  const commonCategory = assets.every(asset => asset.category === assets[0]?.category) ? assets[0]?.category || "" : "";
  const [category, setCategory] = useState<AssetCategory | "">(commonCategory);
  const [busy, setBusy] = useState(false);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const saving = useRef(false);

  const save = async () => {
    if (!category || readOnly || saving.current) return;
    saving.current = true;
    setBusy(true); setMessage(""); setError("");
    try {
      const result = await onSaveCategory(failedIds.length ? failedIds : assets.map(asset => asset.id), category);
      setFailedIds(result.failedIds);
      if (result.failedIds.length) setError(`已更新 ${result.updated.length} 项，${result.failedIds.length} 项失败。可重试未完成项。`);
      else setMessage(`已更新 ${result.updated.length} 项资产的分类。`);
    } catch (cause) {
      setError(publicApiError(cause, "批量修改分类失败，请重试"));
    } finally {
      saving.current = false; setBusy(false);
    }
  };

  return <section className="asset-bulk-details" aria-label="批量编辑资产" data-keep-asset-selection="true">
    <div className="detail-head"><div><p className="eyebrow">BATCH EDIT</p><h3>已选择 {assets.length} 项资产</h3></div><Images size={20} aria-hidden="true" /></div>
    <div className="asset-bulk-preview" aria-label="所选资产预览">
      {assets.slice(0, BULK_PREVIEW_LIMIT).map(asset => <div key={asset.id} title={asset.name}>
        {asset.type === "image" ? <AssetThumbnail id={asset.id} scope={scope} name={asset.name} /> : <span>{asset.type === "video" ? "视频" : "音频"}</span>}
      </div>)}
    </div>
    <p className="asset-bulk-help">对当前选中的 {assets.length} 项资产统一调整。</p>
    {readOnly ? <p role="status" className="asset-bulk-help">回收站中的资产请先恢复，再编辑分类和标签。</p> : <>
      <div className="asset-bulk-field">
        <label htmlFor="asset-bulk-category">批量分类</label>
        <select id="asset-bulk-category" value={category} disabled={busy} onChange={event => { setCategory(event.target.value as AssetCategory | ""); setFailedIds([]); setError(""); setMessage(""); }}>
          <option value="">{commonCategory ? "选择分类…" : "分类不一致或未设置"}</option>
          {ASSET_CATEGORY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button className="outline-button small" disabled={busy || !category} onClick={() => void save()}>
          {busy ? <><Loader2 className="spin" size={14} /> 保存中…</> : failedIds.length ? `重试失败的 ${failedIds.length} 项` : `应用到 ${assets.length} 项资产`}
        </button>
        {message && <p role="status" className="asset-bulk-feedback">{message}</p>}
        {error && <p role="alert" className="asset-bulk-feedback error">{error}</p>}
      </div>
      <div className="asset-bulk-field">
        <span>批量标签</span>
        <button className="outline-button small" disabled={busy} onClick={onEditTags}><Tag size={14} /> 编辑所选资产标签</button>
        <small>为所选资产添加或移除标签。</small>
      </div>
    </>}
  </section>;
}
