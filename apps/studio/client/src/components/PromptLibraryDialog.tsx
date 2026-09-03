import { BookOpen, Check, Loader2, Pin, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildPromptLibraryEntries, filterPromptLibraryEntries } from "@/lib/prompt-library";
import { createSkillEntry } from "@/lib/skill-library";
import { listAllSystemPrompts, type PromptPreset, type SystemPrompt } from "@/entities/prompt";
import { getPreferences, updatePreferences } from "@/features/settings";
import { publicApiError } from "@/shared/api/errors";

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

function priorityRank(value: PromptPreset["priority"]) {
  return { pinned: 0, high: 1, normal: 2, low: 3 }[value] ?? 2;
}

function priorityLabel(value: PromptPreset["priority"]) {
  return { pinned: "置顶", high: "高", normal: "普通", low: "低" }[value] ?? value;
}

export default function PromptLibraryDialog({ open, onOpenChange, onSelect }: PromptLibraryDialogProps) {
  const [mode, setMode] = useState<"personal" | "public">("personal");
  const [systemPrompts, setSystemPrompts] = useState<SystemPrompt[]>([]);
  const [personalPrompts, setPersonalPrompts] = useState<PromptPreset[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeId, setActiveId] = useState("");
  const active = personalPrompts.find((item) => item.id === activeId) || personalPrompts[0];

  const publicEntries = useMemo(
    () => filterPromptLibraryEntries(buildPromptLibraryEntries(systemPrompts, []), query),
    [query, systemPrompts],
  );

  const visiblePersonal = useMemo(() => personalPrompts
    .filter((item) => !query.trim() || item.title.includes(query.trim()) || item.prompt.includes(query.trim()) || item.tags.some((tag) => tag.includes(query.trim())))
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.sort_order - b.sort_order || a.title.localeCompare(b.title, "zh-CN")), [personalPrompts, query]);

  const reload = useCallback(() => {
    setLoading(true);
    setError("");
    Promise.allSettled([listAllSystemPrompts(), getPreferences()]).then(([systemResult, personalResult]) => {
      if (systemResult.status === "fulfilled") setSystemPrompts(systemResult.value);
      else setSystemPrompts([]);
      if (personalResult.status === "fulfilled") {
        const list = personalResult.value.canvas?.promptPresets || [];
        setPersonalPrompts(list);
        setActiveId((current) => list.some((item) => item.id === current) ? current : list[0]?.id || "");
      } else setPersonalPrompts([]);
      if (systemResult.status === "rejected" && personalResult.status === "rejected") {
        setError(publicApiError(systemResult.reason, "读取提示词库失败"));
      }
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const persist = async (next: PromptPreset[], message: string) => {
    if (saving) return;
    setSaving(true);
    try {
      const normalized = next.map((item, index) => ({ ...item, sort_order: item.sort_order ?? index }));
      const saved = await updatePreferences({ canvas: { promptPresets: normalized } });
      const list = saved.canvas?.promptPresets || normalized;
      setPersonalPrompts(list);
      setActiveId((current) => list.some((item) => item.id === current) ? current : list[0]?.id || "");
      toast.success(message);
    } catch (err) {
      toast.error(publicApiError(err, "保存预设失败"));
    } finally {
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、正文、分类或标签" autoFocus />
            </div>
            <div className="prompt-library-list">
              {loading ? <div className="empty-output"><Loader2 className="spin" size={24} /><p>正在读取提示词库…</p></div> : null}
              {!loading && error ? <div className="empty-output"><p>{error}</p></div> : null}
              {!loading && !error && publicEntries.map((item) => (
                <button key={item.id} type="button" onClick={() => { onSelect(item.prompt); onOpenChange(false); }}>
                  <BookOpen size={16} />
                  <span>
                    <b>{item.title}</b>
                    <small>{item.prompt}</small>
                  </span>
                  <i>{item.category || "系统"}</i>
                </button>
              ))}
              {!loading && !error && !publicEntries.length ? <div className="empty-output"><p>没有匹配的提示词</p></div> : null}
            </div>
          </>
        ) : (
          <div className="prompt-library-personal-layout">
            <aside className="prompt-library-personal-list">
              <div className="tag-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、正文或标签" /></div>
              <button className="outline-button small" onClick={createPreset}><Plus size={13} /> 新建预设</button>
              <div className="prompt-library-personal-items">
                {loading ? <div className="prompt-library-loading"><Loader2 className="spin" size={16} /> 读取中…</div> : visiblePersonal.length ? visiblePersonal.map((preset) => (
                  <div key={preset.id} className={active?.id === preset.id ? "preset-item active" : "preset-item"} onClick={() => setActiveId(preset.id)}>
                    <div className="preset-item-head">
                      <span className={`status-chip ${preset.priority === "pinned" ? "sand" : "blue"}`}>{priorityLabel(preset.priority)}</span>
                      <b>{preset.title}</b>
                    </div>
                    <p>{preset.prompt || "未填写提示词"}</p>
                    <div className="preset-item-actions">
                      <button title={preset.priority === "pinned" ? "取消置顶" : "置顶"} onClick={(event) => { event.stopPropagation(); togglePin(preset); }}><Pin size={12} /></button>
                      <button title="使用此预设" onClick={(event) => { event.stopPropagation(); usePreset(preset); }}>使用</button>
                      <button title="删除" onClick={(event) => { event.stopPropagation(); deletePreset(preset.id); }}><Trash2 size={12} /></button>
                    </div>
                  </div>
                )) : <div className="empty-output"><p>没有匹配的预设</p></div>}
              </div>
            </aside>
            <section className="prompt-library-personal-editor">
              {active ? (
                <>
                  <label>标题<input value={active.title} onChange={(event) => patchActive({ title: event.target.value })} /></label>
                  <label>标签<input value={active.tags.join(", ")} onChange={(event) => patchActive({ tags: event.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) })} placeholder="标签，以逗号分隔" /></label>
                  <label>优先级<select value={active.priority} onChange={(event) => patchActive({ priority: event.target.value as PromptPreset["priority"] })}>{priorityOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                  <label>提示词正文<textarea value={active.prompt} onChange={(event) => patchActive({ prompt: event.target.value })} placeholder="在此填写提示词内容…" /></label>
                  <div className="prompt-library-personal-actions">
                    <button className="outline-button" onClick={() => usePreset(active)}>使用预设</button>
                    <button className="vermilion-button" disabled={saving} onClick={saveActive}><Check size={15} /> {saving ? "保存中…" : "保存预设"}</button>
                  </div>
                </>
              ) : <div className="empty-output"><p>暂无预设，点击「新建预设」开始。</p></div>}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
