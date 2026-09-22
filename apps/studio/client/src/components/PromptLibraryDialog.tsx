import { ArrowDownToLine, ArrowUpFromLine, BookOpen, Check, Loader2, Pin, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveAs } from "file-saver";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildPromptLibraryEntries } from "@/lib/prompt-library";
import { getPromptLibrary, type PromptPreset, type SystemPrompt } from "@/entities/prompt";
import { getPreferences, updatePreferences } from "@/features/settings";
import { publicApiError } from "@/shared/api/errors";
import { MAX_PROMPT_PRESET_FILE_BYTES, mergePromptPresetImport, parsePromptPresetFile, serializePromptPresetFile } from "@/features/prompts/model/presetTransfer";

type PromptLibraryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (prompt: string) => void;
};

const priorityOptions: Array<{ value: PromptPreset["priority"]; label: string }> = [
  { value: "pinned", label: "置顶" },
  { value: "high", label: "高" },
  { value: "normal", label: "普通" },
  { value: "low", label: "低" },
];

// Read only one page at a time; briefly reuse public results when switching tabs.
const PUBLIC_PAGE_SIZE = 20;
const PUBLIC_CACHE_MS = 60_000;
// Avoid a request for every keystroke while retaining a search over the whole catalog.
const PUBLIC_SEARCH_DELAY_MS = 300;

function priorityRank(value: PromptPreset["priority"]) {
  return { pinned: 0, high: 1, normal: 2, low: 3 }[value] ?? 2;
}

function priorityLabel(value: PromptPreset["priority"]) {
  return { pinned: "置顶", high: "高", normal: "普通", low: "低" }[value] ?? value;
}

export default function PromptLibraryDialog({ open, onOpenChange, onSelect }: PromptLibraryDialogProps) {
  const [mode, setMode] = useState<"personal" | "public">("personal");
  const [personalPrompts, setPersonalPrompts] = useState<PromptPreset[]>([]);
  const [query, setQuery] = useState("");
  const [publicSearch, setPublicSearch] = useState("");
  const [publicRequest, setPublicRequest] = useState({ page: 1, keyword: "" });
  const [personalLoading, setPersonalLoading] = useState(true);
  const [personalLoaded, setPersonalLoaded] = useState(false);
  const [publicItems, setPublicItems] = useState<SystemPrompt[]>([]);
  const [publicTotal, setPublicTotal] = useState(0);
  const [publicLoadingState, setPublicLoadingState] = useState(false);
  const [publicLoaded, setPublicLoaded] = useState(false);
  const [publicError, setPublicError] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [personalError, setPersonalError] = useState("");
  const [activeId, setActiveId] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const importingRef = useRef(false);
  const personalLoadIdRef = useRef(0);
  const publicLoadIdRef = useRef(0);
  const publicAbortRef = useRef<AbortController | null>(null);
  const publicCacheRef = useRef(new Map<string, { items: SystemPrompt[]; total: number; expiresAt: number }>());
  const busy = personalLoading || !personalLoaded || saving || importing;
  const active = personalPrompts.find((item) => item.id === activeId) || personalPrompts[0];

  const publicLoading = publicLoadingState || publicSearch.trim() !== publicRequest.keyword || (mode === "public" && !publicLoaded && !publicError);
  const publicEntries = buildPromptLibraryEntries(publicItems, []);

  useEffect(() => {
    const keyword = publicSearch.trim();
    if (keyword === publicRequest.keyword) return;
    const timer = window.setTimeout(() => setPublicRequest({ page: 1, keyword }), PUBLIC_SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [publicSearch, publicRequest.keyword]);

  const loadPublic = useCallback((force = false) => {
    const key = `${publicRequest.page}:${publicRequest.keyword}`;
    const cached = publicCacheRef.current.get(key);
    if (!force && cached && cached.expiresAt > Date.now()) {
      publicLoadIdRef.current++;
      publicAbortRef.current?.abort();
      setPublicLoadingState(false);
      setPublicItems(cached.items);
      setPublicTotal(cached.total);
      setPublicLoaded(true);
      setPublicError("");
      return;
    }
    const loadId = ++publicLoadIdRef.current;
    publicAbortRef.current?.abort();
    const controller = new AbortController();
    publicAbortRef.current = controller;
    setPublicLoadingState(true);
    setPublicLoaded(false);
    setPublicError("");
    getPromptLibrary(publicRequest.page, PUBLIC_PAGE_SIZE, { keyword: publicRequest.keyword }, controller.signal).then((result) => {
      if (loadId !== publicLoadIdRef.current) return;
      const items = result.items || [];
      const total = result.total || 0;
      publicCacheRef.current.set(key, { items, total, expiresAt: Date.now() + PUBLIC_CACHE_MS });
      setPublicItems(items);
      setPublicTotal(total);
      setPublicLoaded(true);
    }).catch((reason) => {
      if (loadId !== publicLoadIdRef.current || controller.signal.aborted) return;
      setPublicItems([]);
      setPublicTotal(0);
      setPublicError(publicApiError(reason, "读取公共提示词库失败"));
    }).finally(() => {
      if (loadId === publicLoadIdRef.current) setPublicLoadingState(false);
    });
  }, [publicRequest]);

  const visiblePersonal = useMemo(() => personalPrompts
    .filter((item) => !query.trim() || item.title.includes(query.trim()) || item.prompt.includes(query.trim()) || item.tags.some((tag) => tag.includes(query.trim())))
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.sort_order - b.sort_order || a.title.localeCompare(b.title, "zh-CN")), [personalPrompts, query]);

  const reloadPersonal = useCallback(() => {
    const loadId = ++personalLoadIdRef.current;
    setPersonalLoading(true);
    setPersonalLoaded(false);
    setPersonalError("");
    getPreferences().then((preferences) => {
      if (loadId !== personalLoadIdRef.current) return;
      const list = preferences.canvas?.promptPresets || [];
      setPersonalPrompts(list);
      setPersonalLoaded(true);
      setActiveId((current) => list.some((item) => item.id === current) ? current : list[0]?.id || "");
    }).catch((reason) => {
      if (loadId !== personalLoadIdRef.current) return;
      setPersonalPrompts([]);
      setPersonalError(publicApiError(reason, "读取个人预设失败"));
    }).finally(() => {
      if (loadId === personalLoadIdRef.current) setPersonalLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    void reloadPersonal();
    return () => {
      personalLoadIdRef.current++;
    };
  }, [open, reloadPersonal]);

  useEffect(() => {
    if (!open || mode !== "public") return;
    loadPublic();
    return () => {
      publicLoadIdRef.current++;
      publicAbortRef.current?.abort();
    };
  }, [open, mode, loadPublic]);

  const persist = async (next: PromptPreset[], message: string) => {
    if (!personalLoaded || personalLoading || savingRef.current) return null;
    savingRef.current = true;
    setSaving(true);
    try {
      const normalized = next.map((item, index) => ({ ...item, sort_order: item.sort_order ?? index }));
      const saved = await updatePreferences({ canvas: { promptPresets: normalized } });
      const list = saved.canvas?.promptPresets || normalized;
      setPersonalPrompts(list);
      setActiveId((current) => list.some((item) => item.id === current) ? current : list[0]?.id || "");
      toast.success(message);
      return list;
    } catch (err) {
      toast.error(publicApiError(err, "保存预设失败"));
      return null;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const patchActive = (patch: Partial<PromptPreset>) => {
    if (!active) return;
    setPersonalPrompts((items) => items.map((item) => item.id === active.id ? { ...item, ...patch } : item));
  };

  const saveActive = () => {
    if (!active) return;
    void persist(personalPrompts.map((item) => item.id === active.id ? { ...item, updatedAt: new Date().toISOString() } : item), "预设已保存");
  };

  const createPreset = () => {
    const now = new Date().toISOString();
    const created: PromptPreset = { id: crypto.randomUUID(), title: "未命名预设", prompt: "", tags: [], priority: "normal", sort_order: personalPrompts.length, createdAt: now, updatedAt: now };
    setPersonalPrompts((items) => [...items, created]);
    setActiveId(created.id);
  };

  const deletePreset = (id: string) => {
    const target = personalPrompts.find((item) => item.id === id);
    if (!target) return;
    if (!window.confirm(`删除预设"${target.title}"？`)) return;
    void persist(personalPrompts.filter((item) => item.id !== id), "预设已删除");
  };

  const togglePin = (preset: PromptPreset) => {
    const next = personalPrompts.map((item) => item.id === preset.id ? { ...item, priority: item.priority === "pinned" ? "normal" as const : "pinned" as const } : item);
    void persist(next, preset.priority === "pinned" ? "已取消置顶" : "已置顶");
  };

  const usePreset = (preset: PromptPreset) => {
    onSelect(preset.prompt);
    onOpenChange(false);
  };

  const exportPresets = () => {
    if (busy || !personalPrompts.length) return;
    try {
      const text = serializePromptPresetFile(personalPrompts);
      // Ensure an exported draft can also pass import validation.
      parsePromptPresetFile(text);
      saveAs(new Blob([text], { type: "application/json;charset=utf-8" }), `提示词预设-${new Date().toISOString().slice(0, 10)}.json`);
      toast.success(`已导出 ${personalPrompts.length} 条预设`);
    } catch (err) {
      toast.error(publicApiError(err, "导出预设失败"));
    }
  };

  const importPresets = async (file: File) => {
    if (!personalLoaded || personalLoading || savingRef.current || importingRef.current) return;
    importingRef.current = true;
    setImporting(true);
    try {
      if (file.size > MAX_PROMPT_PRESET_FILE_BYTES) throw new Error("预设文件过大，请选择不超过 2 MB 的 JSON 文件");
      const imported = parsePromptPresetFile(await file.text());
      const result = mergePromptPresetImport(personalPrompts, imported);
      if (!result.added) {
        toast.info("文件中的预设已存在，无需重复导入");
        return;
      }
      const saved = await persist(result.presets, `已导入 ${result.added} 条预设${result.skipped ? `，跳过 ${result.skipped} 条重复预设` : ""}`);
      if (saved) {
        setQuery("");
        setActiveId(result.firstImportedId);
      }
    } catch (err) {
      toast.error(publicApiError(err, "导入预设失败"));
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!savingRef.current && !importingRef.current) onOpenChange(next); }}>
      <DialogContent className="prompt-library-dialog">
        <DialogHeader>
          <DialogTitle>提示词库</DialogTitle>
          <DialogDescription>{mode === "personal" ? "管理个人提示词预设，左列表右编辑" : "搜索公共提示词库，点击使用"}</DialogDescription>
        </DialogHeader>
        <div className="prompt-library-mode-tabs">
          <button type="button" className={mode === "personal" ? "active" : ""} onClick={() => setMode("personal")}>个人预设</button>
          <button type="button" className={mode === "public" ? "active" : ""} onClick={() => setMode("public")}>公共库</button>
        </div>
        {mode === "public" ? (
          <>
            <div className="tag-search">
              <Search size={15} />
              <input value={publicSearch} onChange={(event) => setPublicSearch(event.target.value)} placeholder="搜索标题、正文、分类或标签" autoFocus />
            </div>
            <div className="prompt-library-list">
              {publicLoading ? <div className="empty-output"><Loader2 className="spin" size={24} /><p>正在读取提示词库…</p></div> : null}
              {!publicLoading && publicError ? <div className="empty-output"><p role="alert">{publicError}</p><button className="outline-button small" onClick={() => loadPublic(true)}>重新加载</button></div> : null}
              {!publicLoading && !publicError && publicEntries.map((item) => (
                <button key={item.id} type="button" onClick={() => { onSelect(item.prompt); onOpenChange(false); }}>
                  <BookOpen size={16} />
                  <span>
                    <b>{item.title}</b>
                    <small>{item.prompt}</small>
                  </span>
                  <i>{item.category || "系统"}</i>
                </button>
              ))}
              {!publicLoading && !publicError && !publicEntries.length ? <div className="empty-output"><p>没有匹配的提示词</p></div> : null}
            </div>
            <div className="prompt-library-personal-actions" aria-label="公共提示词分页">
              <button className="outline-button small" disabled={publicLoading || publicRequest.page === 1} onClick={() => setPublicRequest((current) => ({ ...current, page: current.page - 1 }))}>上一页</button>
              <span>第 {publicRequest.page} 页{!publicLoading && !publicError ? ` · 共 ${publicTotal} 条` : ""}</span>
              <button className="outline-button small" disabled={publicLoading || !!publicError || publicRequest.page * PUBLIC_PAGE_SIZE >= publicTotal} onClick={() => setPublicRequest((current) => ({ ...current, page: current.page + 1 }))}>下一页</button>
            </div>
          </>
        ) : (
          <div className="prompt-library-personal-layout">
            <aside className="prompt-library-personal-list">
              <div className="tag-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、正文或标签" /></div>
              <button className="outline-button small" disabled={busy} onClick={createPreset}><Plus size={13} /> 新建预设</button>
              <div className="prompt-library-transfer-actions">
                <button type="button" className="outline-button small" disabled={busy} onClick={() => importInputRef.current?.click()}>
                  {importing ? <Loader2 className="spin" size={13} /> : <ArrowUpFromLine size={13} />}{importing ? "导入中…" : "一键导入"}
                </button>
                <button type="button" className="outline-button small" disabled={busy || !personalPrompts.length} onClick={exportPresets}><ArrowDownToLine size={13} />一键导出</button>
                <input ref={importInputRef} type="file" accept=".json,application/json" aria-label="导入提示词预设文件" hidden disabled={busy} onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void importPresets(file);
                }} />
              </div>
              <div className="prompt-library-personal-items">
                {personalLoading ? <div className="prompt-library-loading"><Loader2 className="spin" size={16} /> 读取中…</div> : personalError ? <div className="empty-output"><p role="alert">{personalError}</p><button className="outline-button small" onClick={reloadPersonal}>重新加载</button></div> : visiblePersonal.length ? visiblePersonal.map((preset) => (
                  <div key={preset.id} className={active?.id === preset.id ? "preset-item active" : "preset-item"} onClick={() => setActiveId(preset.id)}>
                    <div className="preset-item-head">
                      <span className={`status-chip ${preset.priority === "pinned" ? "sand" : "blue"}`}>{priorityLabel(preset.priority)}</span>
                      <b>{preset.title}</b>
                    </div>
                    <p>{preset.prompt || "未填写提示词"}</p>
                    <div className="preset-item-actions">
                      <button title={preset.priority === "pinned" ? "取消置顶" : "置顶"} disabled={busy} onClick={(event) => { event.stopPropagation(); togglePin(preset); }}><Pin size={12} /></button>
                      <button title="使用此预设" disabled={busy} onClick={(event) => { event.stopPropagation(); usePreset(preset); }}>使用</button>
                      <button title="删除" disabled={busy} onClick={(event) => { event.stopPropagation(); deletePreset(preset.id); }}><Trash2 size={12} /></button>
                    </div>
                  </div>
                )) : <div className="empty-output"><p>没有匹配的预设</p></div>}
              </div>
            </aside>
            <section className="prompt-library-personal-editor">
              {active ? (
                <>
                  <label>标题<input disabled={busy} value={active.title} onChange={(event) => patchActive({ title: event.target.value })} /></label>
                  <label>标签<input disabled={busy} value={active.tags.join(", ")} onChange={(event) => patchActive({ tags: event.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) })} placeholder="标签，以逗号分隔" /></label>
                  <label>优先级<select disabled={busy} value={active.priority} onChange={(event) => patchActive({ priority: event.target.value as PromptPreset["priority"] })}>{priorityOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                  <label>提示词正文<textarea disabled={busy} value={active.prompt} onChange={(event) => patchActive({ prompt: event.target.value })} placeholder="在此填写提示词内容…" /></label>
                  <div className="prompt-library-personal-actions">
                    <button className="outline-button" disabled={busy} onClick={() => usePreset(active)}>使用预设</button>
                    <button className="vermilion-button" disabled={busy} onClick={saveActive}><Check size={15} /> {saving ? "保存中…" : "保存预设"}</button>
                  </div>
                </>
              ) : <div className="empty-output"><p>{personalLoading ? "正在读取个人预设…" : personalError ? "读取失败，请点击「重新加载」重试。" : "暂无预设，点击「新建预设」开始。"}</p></div>}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
