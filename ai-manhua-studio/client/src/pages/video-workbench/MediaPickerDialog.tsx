import { Check, Film, FolderOpen, Image as ImageIcon, Loader2, Music2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getAssetContentObjectUrl, getAssetLibrary, publicApiError, type Asset, type WorkspaceScope } from "@/services/api";
import { workbenchFormatBytes } from "./referenceEngine";

/* 媒体库选择弹窗：网格 + 类型筛选 + 搜索 + 多选 + 缩略图懒加载。 */

const pickerThumbCache = new Map<string, string>();

export function MediaPickerDialog({
  open,
  scope,
  onScopeChange,
  onClose,
  onConfirm,
  busy,
}: {
  open: boolean;
  scope: WorkspaceScope;
  onScopeChange: (scope: WorkspaceScope) => void;
  onClose: () => void;
  onConfirm: (assets: Asset[]) => void;
  busy: boolean;
}) {
  const [items, setItems] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "image" | "video" | "audio">("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedIds([]);
    void load("");
    return () => requestRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope]);

  async function load(keyword: string, type: "all" | "image" | "video" | "audio" = typeFilter) {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await getAssetLibrary(scope, {
        keyword: keyword.trim() || undefined,
        type: type === "all" ? undefined : type,
        page: 1,
        pageSize: 60,
        sort: "created_at_desc",
      }, controller.signal);
      if (!controller.signal.aborted) setItems(result.items || []);
    } catch (loadError) {
      if (!controller.signal.aborted) {
        setItems([]);
        setError(publicApiError(loadError, "读取资产库失败"));
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  const selected = items.filter((item) => selectedIds.includes(item.id));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) onClose();
      }}
    >
      <DialogContent className="wb-picker-dialog" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>从资产库选择参考素材</DialogTitle>
          <DialogDescription>图片、视频、音频都可以作为生成参考；确认引用时才读取内容。</DialogDescription>
        </DialogHeader>
        <div className="wb-picker-toolbar">
          <div className="wb-segments">
            {(["all", "image", "video", "audio"] as const).map((type) => (
              <button
                key={type}
                type="button"
                className={typeFilter === type ? "active" : ""}
                disabled={busy}
                onClick={() => {
                  setTypeFilter(type);
                  void load(query, type);
                }}
              >{type === "all" ? "全部" : type === "image" ? "图片" : type === "video" ? "视频" : "音频"}</button>
            ))}
          </div>
          <div className="wb-segments">
            {(["personal", "team"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={scope === item ? "active" : ""}
                disabled={busy}
                onClick={() => onScopeChange(item)}
              >{item === "personal" ? "个人" : "团队"}</button>
            ))}
          </div>
          <label className="wb-picker-search">
            <Search size={13} />
            <input
              value={query}
              disabled={busy}
              placeholder="搜索名称…"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void load(query);
              }}
            />
          </label>
          <button type="button" className="outline-button small" disabled={loading || busy} onClick={() => void load(query)}>
            {loading ? <Loader2 className="spin" size={13} /> : <Search size={13} />} 搜索
          </button>
        </div>
        {error ? <p className="wb-picker-error">{error}</p> : null}
        <div className="wb-picker-grid">
          {loading ? (
            <div className="wb-picker-empty"><Loader2 className="spin" size={22} /><p>正在读取资产库…</p></div>
          ) : items.length ? (
            items.map((asset) => (
              <PickerCard
                key={asset.id}
                asset={asset}
                scope={scope}
                selected={selectedIds.includes(asset.id)}
                disabled={busy}
                onToggle={() => setSelectedIds((ids) => ids.includes(asset.id) ? ids.filter((id) => id !== asset.id) : [...ids, asset.id])}
              />
            ))
          ) : (
            <div className="wb-picker-empty"><FolderOpen size={22} /><p>当前筛选下没有素材</p></div>
          )}
        </div>
        <DialogFooter>
          <button type="button" className="outline-button small" disabled={busy} onClick={onClose}>取消</button>
          <button
            type="button"
            className="vermilion-button"
            disabled={!selected.length || busy}
            onClick={() => onConfirm(selected)}
          >
            {busy ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
            引用所选 {selected.length || ""} 项
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PickerCard({
  asset,
  scope,
  selected,
  disabled,
  onToggle,
}: {
  asset: Asset;
  scope: WorkspaceScope;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const thumb = usePickerThumb(asset, scope);
  const Icon = asset.type === "image" ? ImageIcon : asset.type === "video" ? Film : Music2;
  return (
    <button
      type="button"
      className={`wb-picker-card ${selected ? "selected" : ""}`}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="wb-picker-thumb">
        {thumb && asset.type === "image" ? <img src={thumb} alt={asset.name} loading="lazy" /> : null}
        {thumb && asset.type === "video" ? <video src={thumb} muted preload="metadata" /> : null}
        {!thumb ? <Icon size={20} /> : null}
        <i className="wb-picker-check">{selected ? <Check size={12} /> : null}</i>
      </span>
      <span className="wb-picker-name">{asset.name || asset.id.slice(-8)}</span>
      <span className="wb-picker-meta">{asset.type} · {asset.size ? workbenchFormatBytes(asset.size) : "—"}</span>
    </button>
  );
}

function usePickerThumb(asset: Asset, scope: WorkspaceScope) {
  const cacheKey = `${scope}:${asset.id}`;
  const [url, setUrl] = useState(() => pickerThumbCache.get(cacheKey) || "");
  useEffect(() => {
    if (url || asset.type === "audio") return;
    let alive = true;
    getAssetContentObjectUrl(asset.id, scope, 320)
      .then((value) => {
        pickerThumbCache.set(cacheKey, value);
        if (alive) setUrl(value);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [asset.id, asset.type, cacheKey, scope, url]);
  return url;
}
