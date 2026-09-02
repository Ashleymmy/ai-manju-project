import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Hash,
  Image as ImageIcon,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useSearch } from "wouter";

import {
  getAssetContentObjectUrl,
  type Asset,
} from "@/entities/asset";
import {
  bulkDeleteTags,
  bulkMoveTags,
  createTag,
  createTagAlias,
  deleteTag,
  deleteTagAlias,
  updateTag,
  type SemanticTag,
  type TagInheritMode,
} from "@/entities/tag";
import { publicApiError } from "@/shared/api/errors";
import type { WorkspaceScope } from "@/shared/config";

import {
  collectTagSubtreeIds,
  filterTagsWithAncestors,
  flattenTagTree,
  semanticTagPath,
} from "./model/tagTree";
import {
  useTagAssetsQuery,
  useTagLibraryQuery,
  useTagPromptBindingsQuery,
} from "./model/queries";
import "./styles.css";

type Option<T extends string> = { value: T; label: string };

const scopeOptions: Array<Option<WorkspaceScope>> = [
  { value: "personal", label: "个人空间" },
  { value: "team", label: "团队空间" },
];

function initialScopeFromSearch(): WorkspaceScope {
  return new URLSearchParams(window.location.search).get("scope") === "team" ? "team" : "personal";
}

function canvasProjectHref(projectId: string, scope: WorkspaceScope) {
  return `/canvas/${encodeURIComponent(projectId)}?scope=${encodeURIComponent(scope)}`;
}

function SurfaceTitle({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="feature-title"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{actions}</div>;
}

export function TagLibraryView() {
  const locationSearch = useSearch();
  const appliedDeepLinkRef = useRef("");
  const [scope, setScope] = useState<WorkspaceScope>(() => initialScopeFromSearch());
  const [tags, setTags] = useState<SemanticTag[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get("tag") || "");
  const [alias, setAlias] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftAssetEnabled, setDraftAssetEnabled] = useState(true);
  const [draftPromptEnabled, setDraftPromptEnabled] = useState(true);
  const [draftInheritMode, setDraftInheritMode] = useState<TagInheritMode>("auto");
  const [draftStatus, setDraftStatus] = useState<"active" | "archived">("active");
  const [draftSortOrder, setDraftSortOrder] = useState(0);
  const [moveParentId, setMoveParentId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createParentId, setCreateParentId] = useState("");
  const [createScopeType, setCreateScopeType] = useState<"workspace" | "user">("workspace");
  const [createAssetEnabled, setCreateAssetEnabled] = useState(true);
  const [createPromptEnabled, setCreatePromptEnabled] = useState(true);
  const [createInheritMode, setCreateInheritMode] = useState<TagInheritMode>("auto");
  const [createBusy, setCreateBusy] = useState(false);
  const [tagAssetPage, setTagAssetPage] = useState(1);
  const [tagAssetPreviewUrls, setTagAssetPreviewUrls] = useState<Record<string, string>>({});
  const tagLibraryQuery = useTagLibraryQuery(scope);

  const applyTagItems = useCallback((items: SemanticTag[], preferredId?: string) => {
    setTags(items);
    setSelectedId((current) => {
      if (preferredId && items.some((item) => item.id === preferredId)) return preferredId;
      return items.some((item) => item.id === current) ? current : items[0]?.id || "";
    });
    setSelectedIds((ids) => ids.filter((id) => items.some((item) => item.id === id)));
  }, []);

  const reload = useCallback(async (preferredId?: string) => {
    const result = await tagLibraryQuery.refetch();
    if (result.error || !result.data) {
      toast.error(publicApiError(result.error, "读取标签库失败"));
      return;
    }
    applyTagItems(result.data, preferredId);
  }, [applyTagItems, tagLibraryQuery.refetch]);

  const searchTag = new URLSearchParams(locationSearch).get("tag") || "";
  const deepLinkTagId = new URLSearchParams(locationSearch).get("tag_id") || "";

  useEffect(() => {
    setQuery(searchTag);
  }, [searchTag]);

  useEffect(() => {
    if (tagLibraryQuery.data) {
      const preferredId =
        deepLinkTagId && appliedDeepLinkRef.current !== deepLinkTagId
          ? deepLinkTagId
          : undefined;
      if (preferredId) appliedDeepLinkRef.current = preferredId;
      applyTagItems(tagLibraryQuery.data, preferredId);
    }
  }, [applyTagItems, deepLinkTagId, tagLibraryQuery.data]);
  useEffect(() => {
    if (tagLibraryQuery.error) {
      toast.error(publicApiError(tagLibraryQuery.error, "读取标签库失败"));
    }
  }, [tagLibraryQuery.error, tagLibraryQuery.errorUpdatedAt]);
  const current = tags.find((tag) => tag.id === selectedId);
  const tagPromptQuery = useTagPromptBindingsQuery(
    scope,
    current?.id || "",
    Boolean(current?.prompt_enabled)
  );
  const tagAssetsQuery = useTagAssetsQuery(scope, selectedId, tagAssetPage);
  const tagPromptIds = tagPromptQuery.data?.items || [];
  const tagPromptTotal = tagPromptQuery.data?.total || 0;
  const tagAssets = useMemo<Asset[]>(
    () => tagAssetsQuery.data?.items || [],
    [tagAssetsQuery.data?.items]
  );
  const tagAssetTotal = tagAssetsQuery.data?.total || 0;
  const loading = tagLibraryQuery.isPending;
  const visibleTags = useMemo(() => filterTagsWithAncestors(tags, query), [query, tags]);
  const tagRows = useMemo(() => flattenTagTree(visibleTags), [visibleTags]);
  const currentBlockedIds = useMemo(() => collectTagSubtreeIds(tags, current ? [current.id] : []), [current, tags]);
  const bulkBlockedIds = useMemo(() => collectTagSubtreeIds(tags, selectedIds), [selectedIds, tags]);
  const currentParentOptions = tags.filter((tag) => tag.editable && !currentBlockedIds.has(tag.id));
  const bulkParentOptions = tags.filter((tag) => tag.editable && !bulkBlockedIds.has(tag.id));
  useEffect(() => {
    setDraftName(current?.name || "");
    setDraftDescription(current?.description || "");
    setDraftAssetEnabled(current?.asset_enabled ?? true);
    setDraftPromptEnabled(current?.prompt_enabled ?? true);
    setDraftInheritMode(current?.inherit_mode || "auto");
    setDraftStatus(current?.status || "active");
    setDraftSortOrder(current?.sort_order || 0);
    setMoveParentId(current?.parent_id || "");
  }, [current?.asset_enabled, current?.description, current?.id, current?.inherit_mode, current?.name, current?.parent_id, current?.prompt_enabled, current?.sort_order, current?.status]);

  useEffect(() => { setTagAssetPage(1); }, [scope, selectedId]);
  useEffect(() => {
    if (tagAssetsQuery.error) {
      toast.error(publicApiError(tagAssetsQuery.error, "读取标签关联资产失败"));
    }
  }, [tagAssetsQuery.error, tagAssetsQuery.errorUpdatedAt]);

  useEffect(() => {
    let disposed = false;
    const urls: Record<string, string> = {};
    Promise.all(tagAssets.filter((asset) => asset.type === "image").map(async (asset) => {
      try {
        const url = await getAssetContentObjectUrl(asset.id, scope, 320);
        if (disposed) URL.revokeObjectURL(url);
        else urls[asset.id] = url;
      } catch {
        undefined;
      }
    })).then(() => { if (!disposed) setTagAssetPreviewUrls(urls); });
    return () => {
      disposed = true;
      Object.values(urls).forEach(URL.revokeObjectURL);
    };
  }, [scope, tagAssets]);

  const toggle = (id: string) => setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  const openCreate = (parentId = "") => {
    setCreateParentId(parentId);
    setCreateName("");
    setCreateScopeType("workspace");
    setCreateAssetEnabled(true);
    setCreatePromptEnabled(true);
    setCreateInheritMode("auto");
    setCreateOpen(true);
  };
  const submitCreate = async () => {
    const name = createName.trim();
    if (!name || createBusy) return;
    if (!createAssetEnabled && !createPromptEnabled) {
      toast.warning("标签至少需要启用一种用途（资产或提示词）");
      return;
    }
    setCreateBusy(true);
    try {
      const created = await createTag(scope, {
        parent_id: createParentId || undefined,
        name,
        asset_enabled: createAssetEnabled,
        prompt_enabled: createPromptEnabled,
        inherit_mode: createInheritMode,
        scope_type: createScopeType,
      });
      setCreateOpen(false);
      toast.success(`标签「${created.name}」已创建`);
      await reload(created.id);
    } catch (error) {
      toast.error(publicApiError(error, "创建标签失败"));
    } finally {
      setCreateBusy(false);
    }
  };
  const saveCurrent = async () => {
    if (!current || !draftName.trim()) return;
    try {
      const saved = await updateTag(scope, current.id, { name: draftName.trim(), description: draftDescription.trim(), asset_enabled: draftAssetEnabled, prompt_enabled: draftPromptEnabled, inherit_mode: draftInheritMode, status: draftStatus, sort_order: draftSortOrder });
      setTags((items) => items.map((item) => item.id === saved.id ? saved : item));
      toast.success("标签已保存");
    } catch (error) {
      toast.error(publicApiError(error, "保存标签失败"));
    }
  };
  const moveCurrent = async () => { if (!current || !current.editable) return; if (moveParentId && currentBlockedIds.has(moveParentId)) { toast.error("不能移动到自身或自身后代"); return; } await bulkMoveTags(scope, [current.id], moveParentId || undefined); await reload(current.id); };
  const archiveCurrent = async () => { if (!current || !window.confirm(`删除"${current.name}"及其可归档子标签？`)) return; await deleteTag(scope, current.id); await reload(); };
  const bulkMoveSelected = async () => { if (!selectedIds.length) return; if (moveParentId && bulkBlockedIds.has(moveParentId)) { toast.error("不能移动到选中标签或其后代"); return; } await bulkMoveTags(scope, selectedIds, moveParentId || undefined); setSelectedIds([]); await reload(); };
  const bulkDeleteSelected = async () => { if (!selectedIds.length || !window.confirm(`删除 ${selectedIds.length} 个标签及其可归档子标签？`)) return; await bulkDeleteTags(scope, selectedIds); setSelectedIds([]); await reload(); };
  const addAlias = async () => { if (!current || !alias.trim()) return; await createTagAlias(scope, current.id, alias.trim()); setAlias(""); await reload(current.id); };
  const renderTag = ({ tag, depth }: ReturnType<typeof flattenTagTree>[number]) => <button key={tag.id} className={`${selectedId === tag.id ? "selected" : ""} ${depth ? "child" : ""}`} style={{ paddingLeft: 9 + depth * 14 }} onClick={() => setSelectedId(tag.id)}><input type="checkbox" checked={selectedIds.includes(tag.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(tag.id)} />{depth ? <Hash size={13} /> : <ChevronRight size={13} />}{tag.name}<span>{tag.asset_count || tag.prompt_count || 0}</span></button>;

  return <div className="feature-page tag-page">
    <SurfaceTitle eyebrow={`TAXONOMY / ${tags.length}`} title="标签库" description="标签可同时服务资产与提示词，并支持删除、批量删除、移动和批量移动。"
      actions={<div className="scope-switch">{scopeOptions.map((item) => <button key={item.value} className={scope === item.value ? "active" : ""} onClick={() => setScope(item.value)}>{item.label}</button>)}<button className="vermilion-button" onClick={() => openCreate()}><Plus size={16} /> 新建标签</button></div>} />
    <div className="tag-bulk-toolbar"><span>已选 {selectedIds.length} 个标签</span><select value={moveParentId} onChange={(e) => setMoveParentId(e.target.value)}><option value="">移动到根级</option>{bulkParentOptions.map((tag) => <option key={tag.id} value={tag.id}>{semanticTagPath(tag.id, tags)}</option>)}</select><button onClick={() => void bulkMoveSelected()} disabled={!selectedIds.length}>批量移动</button><button onClick={() => void bulkDeleteSelected()} disabled={!selectedIds.length}>批量删除</button></div>
    <div className="tag-workspace"><aside className="tag-tree"><div className="tag-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="检索标签" /></div>{loading ? <small>读取中…</small> : <div className="tag-group">{tagRows.map(renderTag)}</div>}</aside><section className="tag-editor">{createOpen ? <div className="tag-create-panel"><div className="tag-editor-head"><div><p className="eyebrow">NEW TAG</p><h2>新建标签</h2></div><button className="icon-button subtle" onClick={() => setCreateOpen(false)}><X size={15} /></button></div><div className="tag-settings tag-create-grid"><label>名称<input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="标签名称" autoFocus /></label><label>父级<select value={createParentId} onChange={(e) => setCreateParentId(e.target.value)}><option value="">根级</option>{tags.filter((tag) => tag.editable).map((tag) => <option key={tag.id} value={tag.id}>{semanticTagPath(tag.id, tags)}</option>)}</select></label><label>归属<select value={createScopeType} onChange={(e) => setCreateScopeType(e.target.value as "workspace" | "user")}><option value="workspace">工作区共享</option><option value="user">仅自己可见</option></select></label><label>继承模式<select value={createInheritMode} onChange={(e) => setCreateInheritMode(e.target.value as TagInheritMode)}><option value="auto">自动继承</option><option value="manual">手动确认</option><option value="never">不继承</option></select></label><label className="tag-check"><input type="checkbox" checked={createAssetEnabled} onChange={(e) => setCreateAssetEnabled(e.target.checked)} /> 资产用途</label><label className="tag-check"><input type="checkbox" checked={createPromptEnabled} onChange={(e) => setCreatePromptEnabled(e.target.checked)} /> 提示词用途</label></div><div className="tag-editor-actions"><button className="outline-button" onClick={() => setCreateOpen(false)}>取消</button><button className="vermilion-button" disabled={createBusy || !createName.trim()} onClick={() => void submitCreate()}>{createBusy ? <Loader2 className="spin" size={15} /> : <Check size={15} />} 创建标签</button></div></div> : null}{current ? <><div className="tag-editor-head"><div><p className="eyebrow">{current.scope_type} / SEMANTIC TAG</p><h2>#{current.name}</h2></div><div><button className="icon-button subtle" onClick={() => openCreate(current.id)} disabled={!current.editable}><Plus size={16} /></button><button className="icon-button subtle" onClick={() => void archiveCurrent()} disabled={!current.editable}><Trash2 size={16} /></button></div></div><div className="tag-description"><span className="field-label">名称</span><input value={draftName} onChange={(e) => setDraftName(e.target.value)} disabled={!current.editable} /><span className="field-label">描述</span><textarea value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} disabled={!current.editable} /></div><div className="tag-settings"><label>移动到<select value={moveParentId} onChange={(e) => setMoveParentId(e.target.value)} disabled={!current.editable}><option value="">根级</option>{currentParentOptions.map((tag) => <option key={tag.id} value={tag.id}>{semanticTagPath(tag.id, tags)}</option>)}</select></label><label className="tag-check"><input type="checkbox" checked={draftAssetEnabled} onChange={(e) => setDraftAssetEnabled(e.target.checked)} disabled={!current.editable} /> 资产用途</label><label className="tag-check"><input type="checkbox" checked={draftPromptEnabled} onChange={(e) => setDraftPromptEnabled(e.target.checked)} disabled={!current.editable} /> 提示词用途</label><label>继承模式<select value={draftInheritMode} onChange={(e) => setDraftInheritMode(e.target.value as TagInheritMode)} disabled={!current.editable}><option value="auto">自动继承</option><option value="manual">手动确认</option><option value="never">不继承</option></select></label><label>状态<select value={draftStatus} onChange={(e) => setDraftStatus(e.target.value as "active" | "archived")} disabled={!current.editable}><option value="active">启用</option><option value="archived">归档</option></select></label><label>排序值<input type="number" value={draftSortOrder} onChange={(e) => setDraftSortOrder(Number(e.target.value) || 0)} disabled={!current.editable} /></label></div><section className="aliases"><div><span className="field-label">别名</span><small>搜索时一并匹配</small></div><div className="alias-list">{current.aliases?.map((item) => <span key={item.id}>{item.alias}<button onClick={async () => { await deleteTagAlias(scope, current.id, item.id); await reload(current.id); }}>×</button></span>)}</div><div className="alias-create"><input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="添加别名" /><button onClick={() => void addAlias()}>添加</button></div></section><div className="tag-editor-actions"><button className="outline-button" disabled={!current.editable} onClick={() => void moveCurrent()}>移动标签</button><button className="vermilion-button" disabled={!current.editable} onClick={() => void saveCurrent()}><Check size={16} /> 保存标签</button></div></> : <div className="empty-output"><p>当前没有可编辑标签</p></div>}</section><aside className="tag-relations"><p className="eyebrow">CONNECTIONS</p><div><b>{tagAssetTotal || current?.asset_count || 0}</b><span>关联资产（含后代）</span><button onClick={() => current && window.location.assign(`/assets?scope=${encodeURIComponent(scope)}&tag=${encodeURIComponent(current.id)}`)}>查看资产 <ArrowUpRight size={14} /></button></div><div><b>{current?.prompt_enabled ? tagPromptTotal : (current?.prompt_count || 0)}</b><span>提示词绑定</span><button onClick={() => current && window.location.assign(`/prompts?tag=${encodeURIComponent(current.name)}`)}>按名称跳转提示词库 <ArrowUpRight size={14} /></button></div>{current?.prompt_enabled ? <section className="tag-prompt-bindings"><p className="field-label">关联提示词（绑定数据）</p>{tagPromptIds.slice(0, 12).map((promptId) => <code key={promptId} title={promptId}>{promptId}</code>)}{tagPromptIds.length > 12 ? <small>… 共 {tagPromptIds.length} 条绑定</small> : null}{!tagPromptIds.length ? <small>暂无提示词绑定记录（提示词绑定入口待后端开放，此处已接通查询接口）</small> : null}</section> : null}{current && <section><p className="field-label">关联资产预览</p>{tagAssets.map((asset) => <button key={asset.id} onClick={() => window.location.assign(`/assets?scope=${encodeURIComponent(scope)}&tag=${encodeURIComponent(current.id)}`)}>{tagAssetPreviewUrls[asset.id] ? <img src={tagAssetPreviewUrls[asset.id]} alt="" style={{ width: 34, height: 34, objectFit: "cover", flex: "0 0 34px" }} /> : <ImageIcon size={18} />}<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{asset.name}</span></button>)}{!tagAssets.length && <small>暂无关联资产</small>}<div className="batch-actions"><button disabled={tagAssetPage <= 1} onClick={() => setTagAssetPage((page) => Math.max(1, page - 1))}>上一页</button><span>{tagAssetPage} / {Math.max(1, Math.ceil(tagAssetTotal / 24))}</span><button disabled={tagAssetPage * 24 >= tagAssetTotal} onClick={() => setTagAssetPage((page) => page + 1)}>下一页</button></div></section>}</aside></div>
  </div>;
}

export default TagLibraryView;
