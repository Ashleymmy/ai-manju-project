import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Film,
  Hash,
  Image as ImageIcon,
  Music,
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
  listTags,
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
  TAG_ASSET_PAGE_SIZE,
  useTagAssetsQuery,
  useTagLibraryQuery,
  useTagPromptBindingsQuery,
} from "./model/queries";
import "./styles.css";
import { createTagAttemptKey, findTagNameConflict, isTagNameConflict, normalizeTagName, tagCreationError } from "./model/tagCreation";
import { setTagSelection, toggleTagRange } from "./model/tagSelection";

type Option<T extends string> = { value: T; label: string };

const scopeOptions: Array<Option<WorkspaceScope>> = [
  { value: "personal", label: "个人空间" },
  // 暂时隐藏"团队空间"入口（全局隐藏），恢复时取消下行注释
  // { value: "team", label: "团队空间" },
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
  const selectionAnchorRef = useRef("");
  const selectAllRef = useRef<HTMLInputElement>(null);
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
  const createBusyRef = useRef(false);
  const createAttemptRef = useRef<{ payload: string; key: string } | null>(null);
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
  const tagAssetsQuery = useTagAssetsQuery(scope, selectedId, tagAssetPage, Boolean(current?.asset_enabled));
  const tagPromptIds = tagPromptQuery.data?.items || [];
  const tagPromptTotal = tagPromptQuery.data?.total || 0;
  const tagAssets = useMemo<Asset[]>(
    () => tagAssetsQuery.data?.items || [],
    [tagAssetsQuery.data?.items]
  );
  const tagAssetTotal = tagAssetsQuery.data?.total || 0;
  const tagAssetPageCount = Math.max(1, Math.ceil(tagAssetTotal / TAG_ASSET_PAGE_SIZE));
  const loading = tagLibraryQuery.isPending;
  const visibleTags = useMemo(() => filterTagsWithAncestors(tags, query), [query, tags]);
  const tagRows = useMemo(() => flattenTagTree(visibleTags), [visibleTags]);
  const selectableIds = useMemo(() => tagRows.filter(row => row.tag.editable).map(row => row.tag.id), [tagRows]);
  const visibleSelectedCount = selectableIds.filter(id => selectedIds.includes(id)).length;
  const allVisibleSelected = selectableIds.length > 0 && visibleSelectedCount === selectableIds.length;
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = visibleSelectedCount > 0 && !allVisibleSelected;
  }, [visibleSelectedCount, allVisibleSelected]);
  useEffect(() => { selectionAnchorRef.current = ""; }, [query, scope]);
  const draftDirty = Boolean(current) && (
    draftName.trim() !== current?.name ||
    draftDescription.trim() !== (current?.description || "") ||
    draftAssetEnabled !== current?.asset_enabled ||
    draftPromptEnabled !== current?.prompt_enabled ||
    draftInheritMode !== (current?.inherit_mode || "auto") ||
    draftStatus !== (current?.status || "active") ||
    draftSortOrder !== (current?.sort_order || 0)
  );
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

  const toggle = (id: string, range = false) => {
    const anchor = selectionAnchorRef.current;
    setSelectedIds(ids => toggleTagRange(ids, selectableIds, id, anchor, range));
    if (!range || !anchor) selectionAnchorRef.current = id;
  };
  const openCreate = (parentId = "") => {
    if (createBusyRef.current) return;
    setCreateParentId(parentId);
    setCreateName("");
    setCreateScopeType("workspace");
    setCreateAssetEnabled(true);
    setCreatePromptEnabled(true);
    setCreateInheritMode("auto");
    setCreateOpen(true);
  };
  const showCreateConflict = (tag: SemanticTag) => {
    if (tag.status === "archived") {
      toast.warning(`标签「${tag.name}」之前已删除，可以恢复或使用其他名称。`, {
        action: { label: "恢复标签", onClick: () => void restoreCreatedTag(tag) },
      });
      return;
    }
    toast.warning(`同一位置已有标签「${tag.name}」，无需重复创建。`, {
      action: { label: "查看标签", onClick: () => {
        setQuery("");
        setCreateOpen(false);
        void reload(tag.id);
      } },
    });
  };
  const restoreCreatedTag = async (tag: SemanticTag) => {
    if (createBusyRef.current) return;
    createBusyRef.current = true;
    setCreateBusy(true);
    try {
      // Restore explicitly; keep prior settings, bindings and archived children untouched.
      await updateTag(scope, tag.id, { name: tag.name, description: tag.description,
        asset_enabled: tag.asset_enabled, prompt_enabled: tag.prompt_enabled, inherit_mode: tag.inherit_mode,
        status: "active", sort_order: tag.sort_order });
      setCreateOpen(false);
      setQuery("");
      toast.success(`标签「${tag.name}」已恢复`);
      await reload(tag.id);
    } catch {
      toast.error("恢复标签失败，请刷新后重试。");
    } finally {
      createBusyRef.current = false;
      setCreateBusy(false);
    }
  };
  const submitCreate = async () => {
    const name = normalizeTagName(createName);
    if (!name || createBusyRef.current) return;
    if (!createAssetEnabled && !createPromptEnabled) {
      toast.warning("标签至少需要启用一种用途（资产或提示词）");
      return;
    }
    const conflict = findTagNameConflict(tags, name, createParentId, createScopeType);
    if (conflict) {
      showCreateConflict(conflict);
      return;
    }
    const input = {
      parent_id: createParentId || undefined,
      name,
      asset_enabled: createAssetEnabled,
      prompt_enabled: createPromptEnabled,
      inherit_mode: createInheritMode,
      scope_type: createScopeType,
    };
    const payload = JSON.stringify({ scope, ...input });
    // A lost response must retry the same operation, not create a second tag.
    if (createAttemptRef.current?.payload !== payload) {
      createAttemptRef.current = { payload, key: createTagAttemptKey() };
    }
    createBusyRef.current = true;
    setCreateBusy(true);
    try {
      const created = await createTag(scope, { ...input, idempotency_key: createAttemptRef.current.key });
      createAttemptRef.current = null;
      setCreateOpen(false);
      setQuery("");
      toast.success(`标签「${created.name}」已创建`);
      await reload(created.id);
    } catch (error) {
      if (isTagNameConflict(error)) {
        try {
          // A stale list or hidden archived tag can still collide on the server.
          const result = await listTags(scope, { keyword: name, parentId: createParentId,
            scopeType: createScopeType, includeArchived: true });
          const existing = findTagNameConflict(result.items, name, createParentId, createScopeType);
          if (existing) {
            showCreateConflict(existing);
            return;
          }
        } catch { /* Keep the draft when conflict lookup is unavailable. */ }
      }
      toast.error(tagCreationError(error));
    } finally {
      createBusyRef.current = false;
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
  const renderTag = ({ tag, depth }: ReturnType<typeof flattenTagTree>[number]) => (
    <div key={tag.id} className={`tag-row ${selectedId === tag.id ? "selected" : ""}`} style={{ paddingLeft: 9 + depth * 14 }}>
      <input type="checkbox" aria-label={`选择标签 ${tag.name}`} title="Shift 连续选择" disabled={!tag.editable}
        checked={selectedIds.includes(tag.id)} onClick={event => toggle(tag.id, event.shiftKey)} onChange={() => undefined} />
      <button type="button" title={tag.name} onClick={event => {
        if ((event.shiftKey || event.ctrlKey || event.metaKey) && tag.editable) toggle(tag.id, event.shiftKey);
        else setSelectedId(tag.id);
      }}>{depth ? <Hash size={13} /> : <ChevronRight size={13} />}<span className="tag-row-name">{tag.name}</span><span className="tag-row-count">{tag.asset_count || tag.prompt_count || 0}</span></button>
    </div>
  );

  return <div className="feature-page tag-page">
    <SurfaceTitle eyebrow={`TAXONOMY / ${tags.length}`} title="标签库" description="标签可同时服务资产与提示词，并支持删除、批量删除、移动和批量移动。"
      actions={<div className="scope-switch">{scopeOptions.map((item) => <button key={item.value} className={scope === item.value ? "active" : ""} onClick={() => setScope(item.value)}>{item.label}</button>)}<button className="vermilion-button" onClick={() => openCreate()}><Plus size={16} /> 新建标签</button></div>} />
    <div className="tag-bulk-toolbar"><span>已选 {selectedIds.length} 个标签</span><select value={moveParentId} onChange={(e) => setMoveParentId(e.target.value)}><option value="">移动到根级</option>{bulkParentOptions.map((tag) => <option key={tag.id} value={tag.id}>{semanticTagPath(tag.id, tags)}</option>)}</select><button onClick={() => void bulkMoveSelected()} disabled={!selectedIds.length}>批量移动</button><button onClick={() => void bulkDeleteSelected()} disabled={!selectedIds.length}>批量删除</button></div>
<div className="tag-workspace"><aside className="tag-tree"><div className="tag-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="检索标签" /></div><div className="tag-selection-tools"><label><input ref={selectAllRef} type="checkbox" checked={allVisibleSelected} disabled={!selectableIds.length || loading} onChange={event => { const checked = event.target.checked; setSelectedIds(ids => setTagSelection(ids, selectableIds, checked)); }} />{query.trim() ? "全选当前结果" : "全选"}</label><button type="button" disabled={!selectedIds.length} onClick={() => { setSelectedIds([]); selectionAnchorRef.current = ""; }}>清空选择</button></div>{loading ? <small>读取中…</small> : <div className="tag-group">{tagRows.map(renderTag)}</div>}</aside><section className="tag-editor">{createOpen ? <div className="tag-create-panel"><div className="tag-editor-head"><div><p className="eyebrow">NEW TAG</p><h2>新建标签</h2></div><button className="icon-button subtle" onClick={() => setCreateOpen(false)}><X size={15} /></button></div><div className="tag-settings tag-create-grid"><label>名称<input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="标签名称" autoFocus /></label><label>父级<select value={createParentId} onChange={(e) => setCreateParentId(e.target.value)}><option value="">根级</option>{tags.filter((tag) => tag.editable).map((tag) => <option key={tag.id} value={tag.id}>{semanticTagPath(tag.id, tags)}</option>)}</select></label><label>归属<select value={createScopeType} onChange={(e) => setCreateScopeType(e.target.value as "workspace" | "user")}><option value="workspace">工作区共享</option><option value="user">仅自己可见</option></select></label><label>继承模式<select value={createInheritMode} onChange={(e) => setCreateInheritMode(e.target.value as TagInheritMode)}><option value="auto">自动继承</option><option value="manual">手动确认</option><option value="never">不继承</option></select></label><label className="tag-check"><input type="checkbox" checked={createAssetEnabled} onChange={(e) => setCreateAssetEnabled(e.target.checked)} /> 资产用途</label><label className="tag-check"><input type="checkbox" checked={createPromptEnabled} onChange={(e) => setCreatePromptEnabled(e.target.checked)} /> 提示词用途</label></div><div className="tag-editor-actions"><button type="button" className="outline-button" onClick={() => setCreateOpen(false)}>取消</button><button type="button" className="outline-button" disabled={createBusy || !createName.trim()} onClick={() => void submitCreate()}>{createBusy ? "创建中…" : "创建标签"}</button></div></div> : null}{current ? <><div className="tag-editor-head"><div><p className="eyebrow">{current.scope_type} / SEMANTIC TAG</p><h2>#{current.name}</h2></div><div><button className="icon-button subtle" onClick={() => openCreate(current.id)} disabled={!current.editable}><Plus size={16} /></button><button className="icon-button subtle" onClick={() => void archiveCurrent()} disabled={!current.editable}><Trash2 size={16} /></button></div></div><div className="tag-description"><span className="field-label">名称</span><input value={draftName} onChange={(e) => setDraftName(e.target.value)} disabled={!current.editable} /><span className="field-label">描述</span><textarea value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} disabled={!current.editable} /></div><div className="tag-settings tag-edit-settings"><div className="tag-usage"><span className="field-label">用途</span><div><label className="tag-check"><input type="checkbox" checked={draftAssetEnabled} onChange={(e) => setDraftAssetEnabled(e.target.checked)} disabled={!current.editable} /> 资产用途</label><label className="tag-check"><input type="checkbox" checked={draftPromptEnabled} onChange={(e) => setDraftPromptEnabled(e.target.checked)} disabled={!current.editable} /> 提示词用途</label></div></div><div className="tag-edit-grid"><label><span className="field-label">继承模式</span><select value={draftInheritMode} onChange={(e) => setDraftInheritMode(e.target.value as TagInheritMode)} disabled={!current.editable}><option value="auto">自动继承</option><option value="manual">手动确认</option><option value="never">不继承</option></select></label><label><span className="field-label">状态</span><select value={draftStatus} onChange={(e) => setDraftStatus(e.target.value as "active" | "archived")} disabled={!current.editable}><option value="active">启用</option><option value="archived">归档</option></select></label><label><span className="field-label">排序值</span><input type="number" value={draftSortOrder} onChange={(e) => setDraftSortOrder(Number(e.target.value) || 0)} disabled={!current.editable} /></label></div><div className="tag-move"><label><span className="field-label">移动到</span><select value={moveParentId} onChange={(e) => setMoveParentId(e.target.value)} disabled={!current.editable}><option value="">根级</option>{currentParentOptions.map((tag) => <option key={tag.id} value={tag.id}>{semanticTagPath(tag.id, tags)}</option>)}</select></label><button type="button" className="outline-button" disabled={!current.editable} onClick={() => void moveCurrent()}>移动标签</button></div></div><section className="aliases"><div><span className="field-label">别名</span><small>搜索时一并匹配</small></div>{current.aliases?.length ? <div className="alias-list">{current.aliases.map((item) => <span key={item.id}>{item.alias}<button type="button" aria-label={`删除别名 ${item.alias}`} disabled={!current.editable} onClick={async () => { await deleteTagAlias(scope, current.id, item.id); await reload(current.id); }}><X size={12} /></button></span>)}</div> : null}<div className="alias-create"><input value={alias} onChange={(e) => setAlias(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void addAlias(); }} placeholder="输入别名，回车添加" disabled={!current.editable} /><button type="button" className="outline-button" disabled={!current.editable || !alias.trim()} onClick={() => void addAlias()}><Plus size={15} /> 添加别名</button></div></section><div className="tag-editor-footer"><span className={draftDirty ? "dirty" : ""}>{!current.editable ? "该标签为只读" : draftDirty ? "有未保存的修改" : "当前设置已保存"}</span><button type="button" className="tag-save-button" disabled={!current.editable || !draftDirty || !draftName.trim()} onClick={() => void saveCurrent()}><Check size={16} /> 保存标签</button></div></> : <div className="empty-output"><p>当前没有可编辑标签</p></div>}</section><aside className="tag-relations"><p className="eyebrow">CONNECTIONS</p><div><b>{tagAssetTotal || current?.asset_count || 0}</b><span>关联资产（含后代）</span><button onClick={() => current && window.location.assign(`/assets?scope=${encodeURIComponent(scope)}&tag=${encodeURIComponent(current.id)}`)}>查看资产 <ArrowUpRight size={14} /></button></div><div><b>{current?.prompt_enabled ? tagPromptTotal : (current?.prompt_count || 0)}</b><span>提示词绑定</span><button onClick={() => current && window.location.assign(`/prompts?tag=${encodeURIComponent(current.name)}`)}>按名称跳转提示词库 <ArrowUpRight size={14} /></button></div>{current?.prompt_enabled ? <section className="tag-prompt-bindings"><p className="field-label">关联提示词（绑定数据）</p>{tagPromptIds.slice(0, 12).map((promptId) => <code key={promptId} title={promptId}>{promptId}</code>)}{tagPromptIds.length > 12 ? <small>… 共 {tagPromptIds.length} 条绑定</small> : null}{!tagPromptIds.length ? <small>暂无提示词绑定记录（提示词绑定入口待后端开放，此处已接通查询接口）</small> : null}</section> : null}{current && <section className="tag-asset-preview"><div className="tag-asset-preview-head"><p className="field-label">关联资产预览</p>{current.asset_enabled && tagAssetPageCount > 1 ? <div className="tag-asset-pager"><button type="button" aria-label="上一页" disabled={tagAssetPage <= 1} onClick={() => setTagAssetPage((page) => Math.max(1, page - 1))}><ChevronLeft size={13} /></button><span>{tagAssetPage} / {tagAssetPageCount}</span><button type="button" aria-label="下一页" disabled={tagAssetPage >= tagAssetPageCount} onClick={() => setTagAssetPage((page) => page + 1)}><ChevronRight size={13} /></button></div> : null}</div>{!current.asset_enabled ? <small>该标签未启用资产用途</small> : tagAssets.length ? <div className="tag-asset-grid">{tagAssets.map((asset) => <button key={asset.id} type="button" className="tag-asset-tile" title={asset.name} onClick={() => window.location.assign(`/assets?scope=${encodeURIComponent(scope)}&tag=${encodeURIComponent(current.id)}&asset=${encodeURIComponent(asset.id)}`)}><span className="tag-asset-thumb">{tagAssetPreviewUrls[asset.id] ? <img src={tagAssetPreviewUrls[asset.id]} alt="" /> : asset.type === "video" ? <Film size={16} /> : asset.type === "audio" ? <Music size={16} /> : <ImageIcon size={16} />}</span><span className="tag-asset-name">{asset.name}</span></button>)}</div> : <small>{tagAssetsQuery.isPending ? "读取中…" : "暂无关联资产"}</small>}</section>}</aside></div>
  </div>;
}

export default TagLibraryView;
