import { Check, ChevronLeft, ChevronRight, Film, FolderOpen, Image as ImageIcon, Loader2, Music2, RefreshCw, Search, UserRoundCog } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getAssetContentObjectUrl,
  getAssetLibrary,
  listSeedanceAssetMentions,
  seedanceAssetRef,
  type Asset,
  type SeedanceAsset,
  type SeedanceAssetTag,
} from "@/entities/asset";
import { listTags, type SemanticTag } from "@/entities/tag";
import { publicApiError } from "@/shared/api/errors";
import type { WorkspaceScope } from "@/shared/config";

import { workbenchFormatBytes } from "../model/referenceEngine";

/* 媒体资产库选择弹窗：来源筛选（全部/上传/生成/真人(火山)）+ 类型筛选 + 标签筛选
   + 搜索 + 分页 + 多选 + 缩略图懒加载。
   「真人(火山)」页签数据来自 Seedance 素材接口（/api/ai/seedance-assets/mentions），
   选中后以 asset:// 引用直通视频生成，无需下载文件。 */

const pickerThumbCache = new Map<string, string>();

/** 每页条数（网格 4-6 列，约 4 行） */
const PICKER_PAGE_SIZE = 24;
/** 生成类来源是多个 source_type 的并集，后端只支持单值筛选，这里在已加载页内过滤 */
const GENERATED_SOURCE_TYPES = new Set(["image_workbench", "canvas", "comic_batch"]);

type SourceTab = "all" | "upload" | "generated" | "volcano";
type TypeFilter = "all" | "image" | "video" | "audio";

const sourceTabs: Array<{ value: SourceTab; label: string }> = [
  { value: "all", label: "全部来源" },
  { value: "upload", label: "上传" },
  { value: "generated", label: "生成" },
  { value: "volcano", label: "真人(火山)" },
];

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
  onConfirm: (assets: Asset[], volcanoAssets: SeedanceAsset[]) => void;
  busy: boolean;
}) {
  const [sourceTab, setSourceTab] = useState<SourceTab>("all");
  const [items, setItems] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [tagId, setTagId] = useState("");
  const [tags, setTags] = useState<SemanticTag[]>([]);
  /* 跨页选择：id → 资产（翻页/切筛选后已选项不丢） */
  const [selectedMap, setSelectedMap] = useState<Record<string, Asset>>({});
  const [volcanoItems, setVolcanoItems] = useState<SeedanceAsset[]>([]);
  const [volcanoLoading, setVolcanoLoading] = useState(false);
  const [volcanoError, setVolcanoError] = useState("");
  const [volcanoTagId, setVolcanoTagId] = useState("");
  const [selectedVolcano, setSelectedVolcano] = useState<Record<string, SeedanceAsset>>({});
  const requestRef = useRef<AbortController | null>(null);

  const isVolcano = sourceTab === "volcano";

  const loadLibrary = useCallback(async (keyword: string, pageNo: number, type: TypeFilter, tag: string, source: SourceTab) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await getAssetLibrary(scope, {
        keyword: keyword.trim() || undefined,
        type: type === "all" ? undefined : type,
        sourceType: source === "upload" ? "manual_upload" : undefined,
        tagIds: tag ? [tag] : undefined,
        includeTagDescendants: tag ? true : undefined,
        page: pageNo,
        pageSize: PICKER_PAGE_SIZE,
        sort: "created_at_desc",
      }, controller.signal);
      if (controller.signal.aborted) return;
      let list = result.items || [];
      if (source === "generated") list = list.filter((asset) => GENERATED_SOURCE_TYPES.has(asset.source_type || ""));
      setItems(list);
      setTotal(result.total || 0);
    } catch (loadError) {
      if (!controller.signal.aborted) {
        setItems([]);
        setTotal(0);
        setError(publicApiError(loadError, "读取资产库失败"));
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [scope]);

  const loadVolcano = useCallback(async (keyword: string, type: TypeFilter) => {
    setVolcanoLoading(true);
    setVolcanoError("");
    try {
      const result = await listSeedanceAssetMentions({
        search: keyword.trim(),
        type: type === "image" ? "Image" : type === "video" ? "Video" : undefined,
        limit: 100,
      });
      setVolcanoItems(result.items || []);
    } catch (loadError) {
      setVolcanoItems([]);
      setVolcanoError(publicApiError(loadError, "读取真人素材失败"));
    } finally {
      setVolcanoLoading(false);
    }
  }, []);

  /* 打开/切空间：重置筛选与选择，加载标签库 */
  useEffect(() => {
    if (!open) return;
    setSelectedMap({});
    setSelectedVolcano({});
    setPage(1);
    setTagId("");
    setVolcanoTagId("");
    setTags([]);
    listTags(scope, { usage: "asset", pageSize: 100 })
      .then((result) => setTags((result.items || []).filter((tag) => tag.asset_enabled && tag.status === "active")))
      .catch(() => setTags([]));
    return () => requestRef.current?.abort();
  }, [open, scope]);

  /* 资产库页签：筛选变化即重新加载 */
  useEffect(() => {
    if (!open || isVolcano) return;
    void loadLibrary(query, page, typeFilter, tagId, sourceTab);
    // query 走手动搜索（Enter/按钮），不作为自动触发依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isVolcano, page, typeFilter, tagId, sourceTab, scope, loadLibrary]);

  /* 切到真人(火山)页签时加载一次 */
  useEffect(() => {
    if (!open || !isVolcano) return;
    void loadVolcano(query, typeFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isVolcano, typeFilter, loadVolcano]);

  const volcanoTags = useMemo(() => uniqueSeedanceTags(volcanoItems.flatMap((asset) => asset.tags || [])), [volcanoItems]);
  const visibleVolcano = useMemo(() => volcanoTagId
    ? volcanoItems.filter((asset) => (asset.tags || []).some((tag) => tag.id === volcanoTagId))
    : volcanoItems, [volcanoItems, volcanoTagId]);

  const selectedAssets = Object.values(selectedMap);
  const selectedVolcanoAssets = Object.values(selectedVolcano);
  const selectedCount = selectedAssets.length + selectedVolcanoAssets.length;
  const pageCount = Math.max(1, Math.ceil(total / PICKER_PAGE_SIZE));

  const handleRefresh = () => {
    if (isVolcano) void loadVolcano(query, typeFilter);
    else void loadLibrary(query, page, typeFilter, tagId, sourceTab);
  };

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
          <DialogTitle>媒体资产库</DialogTitle>
          <DialogDescription>已选择 {selectedCount} 个项目 · 图片、视频、音频都可以作为生成参考；确认引用时才读取内容。</DialogDescription>
        </DialogHeader>
        <div className="wb-picker-toolbar">
          <div className="wb-segments">
            {sourceTabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                className={sourceTab === tab.value ? "active" : ""}
                disabled={busy}
                onClick={() => {
                  setSourceTab(tab.value);
                  setPage(1);
                  setQuery("");
                }}
              >{tab.label}</button>
            ))}
          </div>
          <div className="wb-segments">
            {(isVolcano
              ? [["all", "全部"], ["image", "图片"], ["video", "视频"]] as const
              : [["all", "全部类型"], ["image", "图片"], ["video", "视频"], ["audio", "音频"]] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={typeFilter === value ? "active" : ""}
                disabled={busy}
                onClick={() => {
                  setTypeFilter(value);
                  setPage(1);
                }}
              >{label}</button>
            ))}
          </div>
          {!isVolcano ? (
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
          ) : null}
          <label className="wb-picker-search">
            <Search size={13} />
            <input
              value={query}
              disabled={busy}
              placeholder={isVolcano ? "搜索火山素材…" : "搜索名称…"}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setPage(1);
                  if (isVolcano) void loadVolcano(query, typeFilter);
                  else void loadLibrary(query, 1, typeFilter, tagId, sourceTab);
                }
              }}
            />
          </label>
          <button type="button" className="outline-button small" disabled={loading || volcanoLoading || busy} onClick={handleRefresh}>
            {(loading || volcanoLoading) ? <Loader2 className="spin" size={13} /> : <RefreshCw size={13} />} 刷新
          </button>
        </div>
        {!isVolcano && tags.length ? (
          <div className="wb-picker-tags">
            <button
              type="button"
              className={`wb-picker-tag ${tagId ? "" : "active"}`}
              disabled={busy}
              onClick={() => { setTagId(""); setPage(1); }}
            >全部</button>
            {tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className={`wb-picker-tag ${tagId === tag.id ? "active" : ""}`}
                disabled={busy}
                onClick={() => { setTagId(tagId === tag.id ? "" : tag.id); setPage(1); }}
              >{tag.name}{tag.asset_count ? <i>{tag.asset_count}</i> : null}</button>
            ))}
          </div>
        ) : null}
        {isVolcano && volcanoTags.length ? (
          <div className="wb-picker-tags">
            <button
              type="button"
              className={`wb-picker-tag ${volcanoTagId ? "" : "active"}`}
              disabled={busy}
              onClick={() => setVolcanoTagId("")}
            >全部</button>
            {volcanoTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className={`wb-picker-tag ${volcanoTagId === tag.id ? "active" : ""}`}
                disabled={busy}
                onClick={() => setVolcanoTagId(volcanoTagId === tag.id ? "" : tag.id)}
              >{tag.name}</button>
            ))}
          </div>
        ) : null}
        {error && !isVolcano ? <p className="wb-picker-error">{error}</p> : null}
        {volcanoError && isVolcano ? <p className="wb-picker-error">{volcanoError}</p> : null}
        {isVolcano ? (
          <div className="wb-picker-grid">
            {volcanoLoading && !volcanoItems.length ? (
              <div className="wb-picker-empty"><Loader2 className="spin" size={22} /><p>正在读取真人素材…</p></div>
            ) : visibleVolcano.length ? (
              visibleVolcano.map((asset) => (
                <VolcanoCard
                  key={asset.id}
                  asset={asset}
                  selected={Boolean(selectedVolcano[asset.volcano_asset_id])}
                  disabled={busy}
                  onToggle={() => setSelectedVolcano((current) => {
                    const next = { ...current };
                    if (next[asset.volcano_asset_id]) delete next[asset.volcano_asset_id];
                    else next[asset.volcano_asset_id] = asset;
                    return next;
                  })}
                />
              ))
            ) : (
              <div className="wb-picker-empty"><UserRoundCog size={22} /><p>暂无真人素材，可在管理后台的 Seedance 素材页上传或同步</p></div>
            )}
          </div>
        ) : (
          <div className="wb-picker-grid">
            {loading ? (
              <div className="wb-picker-empty"><Loader2 className="spin" size={22} /><p>正在读取资产库…</p></div>
            ) : items.length ? (
              items.map((asset) => (
                <PickerCard
                  key={asset.id}
                  asset={asset}
                  scope={scope}
                  selected={Boolean(selectedMap[asset.id])}
                  disabled={busy}
                  onToggle={() => setSelectedMap((current) => {
                    const next = { ...current };
                    if (next[asset.id]) delete next[asset.id];
                    else next[asset.id] = asset;
                    return next;
                  })}
                />
              ))
            ) : (
              <div className="wb-picker-empty"><FolderOpen size={22} /><p>当前筛选下没有素材</p></div>
            )}
          </div>
        )}
        {!isVolcano && total > 0 ? (
          <div className="wb-picker-pager">
            <button type="button" className="outline-button small" disabled={busy || loading || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
              <ChevronLeft size={13} /> 上一页
            </button>
            <span>PAGE {page} / {pageCount} · 共 {total} 项</span>
            <button type="button" className="outline-button small" disabled={busy || loading || page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>
              下一页 <ChevronRight size={13} />
            </button>
          </div>
        ) : null}
        <DialogFooter>
          <button type="button" className="outline-button small" disabled={busy} onClick={onClose}>取消</button>
          <button
            type="button"
            className="vermilion-button"
            disabled={!selectedCount || busy}
            onClick={() => onConfirm(selectedAssets, selectedVolcanoAssets)}
          >
            {busy ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
            确认添加 {selectedCount || ""} 项
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

/** 火山真人素材卡片：source_url 直接预览，选中后以 asset:// 引用。 */
function VolcanoCard({
  asset,
  selected,
  disabled,
  onToggle,
}: {
  asset: SeedanceAsset;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const status = volcanoStatusLabel(asset.status);
  const previewUrl = /^https?:\/\//i.test(asset.source_url || "") ? String(asset.source_url) : "";
  return (
    <button
      type="button"
      className={`wb-picker-card ${selected ? "selected" : ""}`}
      disabled={disabled}
      title={seedanceAssetRef(asset)}
      onClick={onToggle}
    >
      <span className="wb-picker-thumb">
        {previewUrl && asset.asset_type === "Video" ? <video src={previewUrl} muted playsInline preload="metadata" /> : null}
        {previewUrl && asset.asset_type !== "Video" ? <img src={previewUrl} alt={asset.name} loading="lazy" /> : null}
        {!previewUrl ? <UserRoundCog size={20} /> : null}
        <i className={`wb-picker-status ${status.tone}`}>{status.text}</i>
        <i className="wb-picker-check">{selected ? <Check size={12} /> : null}</i>
      </span>
      <span className="wb-picker-name">{asset.name || asset.volcano_asset_id}</span>
      <span className="wb-picker-meta">{asset.asset_type === "Video" ? "视频" : "图片"} · 火山真人素材</span>
      {asset.tags?.length ? (
        <span className="wb-picker-card-tags">{asset.tags.slice(0, 3).map((tag) => <i key={tag.id}>#{tag.name}</i>)}</span>
      ) : null}
    </button>
  );
}

function volcanoStatusLabel(status: string) {
  const normalized = (status || "").toLowerCase();
  if (normalized === "active") return { text: "可用", tone: "ok" };
  if (normalized === "processing" || normalized === "pending") return { text: "处理中", tone: "busy" };
  if (normalized === "failed" || normalized === "error") return { text: "失败", tone: "bad" };
  return { text: status || "未知", tone: "" };
}

function uniqueSeedanceTags(tags: SeedanceAssetTag[]) {
  const seen = new Set<string>();
  return tags.filter((tag) => {
    if (!tag.id || seen.has(tag.id)) return false;
    seen.add(tag.id);
    return true;
  });
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
