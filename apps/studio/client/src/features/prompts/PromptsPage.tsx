import {
  ArrowUpRight,
  Check,
  FileText,
  Plus,
  Search,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import type { PromptPreset, SystemPrompt } from "@/entities/prompt";
import {
  settingsQueryKeys,
  updatePreferences,
  usePreferencesQuery,
} from "@/features/settings";
import { publicApiError } from "@/shared/api/errors";

import {
  usePromptSemanticTagsQuery,
  useSystemPromptLibraryQuery,
} from "./model/queries";
import "./styles.css";

function SurfaceTitle({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="feature-title"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{actions}</div>;
}

function priorityRank(value: PromptPreset["priority"]) {
  return { pinned: 0, high: 1, normal: 2, low: 3 }[value] ?? 2;
}

function priorityLabel(value: PromptPreset["priority"]) {
  return { pinned: "置顶", high: "高", normal: "普通", low: "低" }[value] ?? value;
}

export function PromptLibraryView() {
  const queryClient = useQueryClient();
  const preferencesInitializedRef = useRef(false);
  const [mode, setMode] = useState<"personal" | "system">("personal");
  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [activeId, setActiveId] = useState("");
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get("tag") || "");
  const [systemItems, setSystemItems] = useState<SystemPrompt[]>([]);
  const [systemTotal, setSystemTotal] = useState(0);
  const [systemTags, setSystemTags] = useState<string[]>([]);
  const [systemCategories, setSystemCategories] = useState<string[]>([]);
  const [systemKeyword, setSystemKeyword] = useState("");
  const [systemDebouncedKeyword, setSystemDebouncedKeyword] = useState("");
  const [systemCategory, setSystemCategory] = useState("");
  const [systemTagFilter, setSystemTagFilter] = useState<string[]>([]);
  const [systemPage, setSystemPage] = useState(1);
  const [systemActiveId, setSystemActiveId] = useState("");
  const preferencesQuery = usePreferencesQuery();
  const semanticTagsQuery = usePromptSemanticTagsQuery();
  const systemPromptQuery = useSystemPromptLibraryQuery(
    mode === "system",
    systemPage,
    systemDebouncedKeyword,
    systemCategory,
    systemTagFilter
  );
  const loading = preferencesQuery.isPending;
  const semanticPromptTags = semanticTagsQuery.data || [];
  const systemLoading = systemPromptQuery.isFetching;
  const active = presets.find((item) => item.id === activeId) || presets[0];
  const systemActive = systemItems.find((item) => item.id === systemActiveId) || systemItems[0];
  const visible = presets.filter((item) => !query.trim() || item.priority === query || item.title.includes(query) || item.prompt.includes(query) || item.tags.some((tag) => tag.includes(query))).sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.sort_order - b.sort_order || a.title.localeCompare(b.title, "zh-CN"));
  const commonTags = Array.from(new Set(presets.flatMap((item) => item.tags))).slice(0, 12);

  useEffect(() => {
    if (preferencesInitializedRef.current || preferencesQuery.isPending) return;
    preferencesInitializedRef.current = true;
    if (preferencesQuery.error || !preferencesQuery.data) {
      toast.error(publicApiError(preferencesQuery.error, "读取个人提示词失败"));
      return;
    }
    const items = preferencesQuery.data.canvas?.promptPresets || [];
    setPresets(items);
    setActiveId(items[0]?.id || "");
  }, [
    preferencesQuery.data,
    preferencesQuery.error,
    preferencesQuery.isPending,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSystemDebouncedKeyword(systemKeyword), 300);
    return () => window.clearTimeout(timer);
  }, [systemKeyword]);

  useEffect(() => {
    setSystemPage(1);
  }, [systemCategory, systemDebouncedKeyword, systemTagFilter]);

  useEffect(() => {
    if (mode !== "system" || systemPromptQuery.isPending) return;
    if (systemPromptQuery.error || !systemPromptQuery.data) {
      toast.error(publicApiError(systemPromptQuery.error, "读取系统提示词库失败"));
      return;
    }
    const result = systemPromptQuery.data;
    setSystemItems((current) => systemPage === 1 ? result.items || [] : [...current, ...(result.items || [])]);
    setSystemTotal(result.total || 0);
    setSystemTags(result.tags || []);
    setSystemCategories(result.categories || []);
    if (systemPage === 1) setSystemActiveId(result.items?.[0]?.id || "");
  }, [
    mode,
    systemPage,
    systemPromptQuery.data,
    systemPromptQuery.error,
    systemPromptQuery.isPending,
  ]);

  const persist = async (next: PromptPreset[], success: string) => {
    const normalized = next.map((item, index) => ({ ...item, sort_order: item.sort_order ?? index }));
    const preferences = await updatePreferences({ canvas: { promptPresets: normalized } });
    queryClient.setQueryData(settingsQueryKeys.preferences(), preferences);
    const saved = preferences.canvas?.promptPresets || normalized;
    setPresets(saved);
    setActiveId(saved[0]?.id || "");
    toast.success(success);
  };

  const createPreset = async () => {
    const now = new Date().toISOString();
    const created: PromptPreset = { id: crypto.randomUUID(), title: "未命名提示词", prompt: "请在此填写提示词内容。", tags: [], priority: "normal", sort_order: presets.length, createdAt: now, updatedAt: now };
    setActiveId(created.id);
    await persist([...presets, created], "已创建提示词预设");
  };

  const saveSystemPromptAsPreset = async (item: SystemPrompt) => {
    const now = new Date().toISOString();
    const created: PromptPreset = { id: crypto.randomUUID(), title: item.title, prompt: item.prompt, tags: item.tags.slice(0, 6), priority: "normal", sort_order: presets.length, createdAt: now, updatedAt: now };
    await persist([...presets, created], "系统提示词已存为个人预设");
  };

  const patchActive = (patch: Partial<PromptPreset>) => active && setPresets((items) => items.map((item) => item.id === active.id ? { ...item, ...patch } : item));
  const moveActive = async (direction: -1 | 1) => {
    if (!active) return;
    const samePriority = presets
      .filter((item) => item.priority === active.priority)
      .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, "zh-CN"));
    const index = samePriority.findIndex((item) => item.id === active.id);
    const target = samePriority[index + direction];
    if (!target) return;
    await persist(presets.map((item) => {
      if (item.id === active.id) return { ...item, sort_order: target.sort_order };
      if (item.id === target.id) return { ...item, sort_order: active.sort_order };
      return item;
    }), "提示词顺序已更新");
    setActiveId(active.id);
  };

  const toggleSystemTag = (tag: string) => setSystemTagFilter((tags) => tags.includes(tag) ? tags.filter((item) => item !== tag) : [...tags, tag]);

  return <div className="feature-page prompt-page">
    <SurfaceTitle eyebrow={mode === "personal" ? `PROMPTS / ${presets.length}` : `LIBRARY / ${systemTotal}`} title="提示词中心" description="个人预设与偏好共用一份数据；系统库聚合公开提示词仓库，可直接检索复用。"
      actions={<div className="scope-switch"><button className={mode === "personal" ? "active" : ""} onClick={() => setMode("personal")}>个人预设</button><button className={mode === "system" ? "active" : ""} onClick={() => setMode("system")}>系统库</button>{mode === "personal" && <button className="vermilion-button" onClick={() => void createPreset()}><Plus size={16} /> 新建预设</button>}</div>} />
    {mode === "personal" ? <div className="prompt-workspace"><aside className="prompt-filters"><div className="tag-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="关键词、标签或优先级" /></div><p className="field-label">PRIORITY</p>{[["置顶", "pinned"], ["高", "high"], ["普通", "normal"], ["低", "low"]].map(([name, key]) => <button onClick={() => setQuery(key)} key={key}><span>{name}</span><b>{presets.filter((item) => item.priority === key).length}</b></button>)}<hr /><p className="field-label">常用标签</p>{commonTags.map((tag) => <button className="tag-filter" onClick={() => setQuery(tag)} key={tag}>#{tag}</button>)}</aside><section className="template-list"><div className="template-list-head"><span>{loading ? "读取中…" : `匹配到 ${visible.length} 条视觉片段`}</span></div>{visible.map((item) => <button className={active?.id === item.id ? "template-card selected" : "template-card"} onClick={() => setActiveId(item.id)} key={item.id}><div><span>{priorityLabel(item.priority)}</span><b>{item.title}</b><p>{item.prompt || "尚未填写提示词"}</p></div><div className="template-card-tags">{item.tags.map((tag) => <i key={tag}>#{tag}</i>)}</div></button>)}</section><aside className="prompt-preview">{active ? <><div><p className="eyebrow">PRESET PREVIEW</p><input value={active.title} onChange={(e) => patchActive({ title: e.target.value })} /></div><div className="preview-tags">{active.tags.map((tag) => { const semantic = semanticPromptTags.find((item) => item.name === tag); return <span key={tag} className={semantic ? "semantic" : ""} title={semantic ? "已命中语义标签库，点击跳转标签库" : "自由标签（未关联语义标签库）"} onClick={() => semantic && window.location.assign(`/tags?tag_id=${encodeURIComponent(semantic.id)}`)}>#{tag}</span>; })}</div><textarea value={active.prompt} onChange={(e) => patchActive({ prompt: e.target.value })} /><input list="prompt-semantic-tag-options" value={active.tags.join(", ")} onChange={(e) => patchActive({ tags: e.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) })} placeholder="标签，以逗号分隔；可输入或从语义标签库选择" /><datalist id="prompt-semantic-tag-options">{semanticPromptTags.map((tag) => <option key={tag.id} value={tag.name} />)}</datalist>{semanticPromptTags.length ? <div className="prompt-semantic-hint"><span className="field-label">语义标签库</span>{semanticPromptTags.slice(0, 10).map((tag) => <button key={tag.id} type="button" disabled={active.tags.includes(tag.name)} onClick={() => patchActive({ tags: [...active.tags, tag.name] })}>#{tag.name}</button>)}</div> : null}<select value={active.priority} onChange={(e) => patchActive({ priority: e.target.value as PromptPreset["priority"] })}><option value="pinned">置顶</option><option value="high">高</option><option value="normal">普通</option><option value="low">低</option></select><div className="prompt-order-actions"><button onClick={() => void moveActive(-1)}>上移</button><button onClick={() => void moveActive(1)}>下移</button></div><button className="vermilion-button" onClick={() => void persist(presets.map((item) => item.id === active.id ? { ...item, updatedAt: new Date().toISOString() } : item), "提示词已保存")}><Check size={16} /> 保存预设</button><button className="full-outline" onClick={() => { sessionStorage.setItem("ai-manju:image-prompt", active.prompt); window.location.assign("/image"); }}><WandSparkles size={16} /> 送入关键帧</button><button className="full-outline" onClick={async () => { await navigator.clipboard.writeText(active.prompt); toast.success("提示词已复制"); }}><FileText size={15} /> 复制完整提示词</button><button className="full-outline" onClick={() => { if (window.confirm(`删除"${active.title}"？`)) void persist(presets.filter((item) => item.id !== active.id), "提示词已删除"); }}><Trash2 size={15} /> 删除预设</button></> : <div className="empty-output"><p>暂无个人提示词预设</p></div>}</aside></div>
      : <div className="prompt-workspace">
        <aside className="prompt-filters">
          <div className="tag-search"><Search size={15} /><input value={systemKeyword} onChange={(e) => setSystemKeyword(e.target.value)} placeholder="搜索标题、正文或标签" /></div>
          <p className="field-label">CATEGORY</p>
          <button className={!systemCategory ? "tag-filter selected" : "tag-filter"} onClick={() => setSystemCategory("")}>全部分类</button>
          {systemCategories.map((category) => <button className={systemCategory === category ? "tag-filter selected" : "tag-filter"} onClick={() => setSystemCategory(category)} key={category}>{category}</button>)}
          <hr />
          <p className="field-label">TAGS {systemTagFilter.length ? `· 已选 ${systemTagFilter.length}` : ""}</p>
          <div className="system-tag-cloud">{systemTags.slice(0, 40).map((tag) => <button className={systemTagFilter.includes(tag) ? "tag-filter selected" : "tag-filter"} onClick={() => toggleSystemTag(tag)} key={tag}>#{tag}</button>)}</div>
        </aside>
        <section className="template-list">
          <div className="template-list-head"><span>{systemLoading && systemPage === 1 ? "读取中…" : `共 ${systemTotal} 条系统提示词`}</span></div>
          {systemItems.map((item) => <button className={systemActive?.id === item.id ? "template-card selected" : "template-card"} onClick={() => setSystemActiveId(item.id)} key={item.id}><div><span>{item.category}</span><b>{item.title}</b><p>{item.prompt}</p></div><div className="template-card-tags">{item.tags.slice(0, 5).map((tag) => <i key={tag}>#{tag}</i>)}</div></button>)}
          {!systemItems.length && !systemLoading && <div className="empty-output"><p>没有匹配的系统提示词；提示词库需要服务端能访问 GitHub。</p></div>}
          {systemItems.length < systemTotal && <button className="full-outline" disabled={systemLoading} onClick={() => setSystemPage((page) => page + 1)}>{systemLoading ? "加载中…" : `加载更多（${systemItems.length}/${systemTotal}）`}</button>}
        </section>
        <aside className="prompt-preview">{systemActive ? <><div><p className="eyebrow">{systemActive.category}</p><h3 className="system-prompt-title">{systemActive.title}</h3></div>{systemActive.coverUrl && <img className="system-prompt-cover" src={systemActive.coverUrl} alt={systemActive.title} loading="lazy" />}<div className="preview-tags">{systemActive.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div><textarea value={systemActive.prompt} readOnly /><button className="vermilion-button" onClick={async () => { await navigator.clipboard.writeText(systemActive.prompt); toast.success("提示词已复制"); }}><FileText size={15} /> 复制完整提示词</button><button className="full-outline" onClick={() => { sessionStorage.setItem("ai-manju:image-prompt", systemActive.prompt); window.location.assign("/image"); }}><WandSparkles size={16} /> 送入关键帧</button><button className="full-outline" onClick={() => void saveSystemPromptAsPreset(systemActive)}><Plus size={15} /> 存为个人预设</button>{systemActive.githubUrl && <button className="full-outline" onClick={() => window.open(systemActive.githubUrl, "_blank", "noopener")}><ArrowUpRight size={15} /> 查看来源仓库</button>}</> : <div className="empty-output"><p>选择一条系统提示词查看详情</p></div>}</aside>
      </div>}
  </div>;
}

export default PromptLibraryView;
