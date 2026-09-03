import { ArrowDownToLine, Check, Loader2, Pin, Plus, Search, Trash2, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PromptPreset } from "@/entities/prompt";
import { getPreferences, updatePreferences } from "@/features/settings";
import { publicApiError } from "@/shared/api/errors";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

/** 我的提示词预设管理：左列表 + 右编辑区，支持搜索/置顶/使用/删除/一键导出。 */
export default function PromptPresetManagerDialog({ open, onOpenChange }: Props) {
  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [activeId, setActiveId] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const active = presets.find((item) => item.id === activeId) || presets[0];

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const preferences = await getPreferences();
      const items = preferences.canvas?.promptPresets || [];
      setPresets(items);
      setActiveId((current) => items.some((item) => item.id === current) ? current : items[0]?.id || "");
    } catch (error) {
      toast.error(publicApiError(error, "读取提示词预设失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const visible = useMemo(() => presets
    .filter((item) => !query.trim() || item.title.includes(query.trim()) || item.prompt.includes(query.trim()) || item.tags.some((tag) => tag.includes(query.trim())))
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.sort_order - b.sort_order || a.title.localeCompare(b.title, "zh-CN")), [presets, query]);

  const persist = async (next: PromptPreset[], message: string) => {
    if (saving) return;
    setSaving(true);
    try {
      const normalized = next.map((item, index) => ({ ...item, sort_order: item.sort_order ?? index }));
      const saved = await updatePreferences({ canvas: { promptPresets: normalized } });
      const list = saved.canvas?.promptPresets || normalized;
      setPresets(list);
      setActiveId((current) => list.some((item) => item.id === current) ? current : list[0]?.id || "");
      toast.success(message);
    } catch (error) {
      toast.error(publicApiError(error, "保存预设失败"));
    } finally {
      setSaving(false);
    }
  };

  const patchActive = (patch: Partial<PromptPreset>) => {
    if (!active) return;
    setPresets((items) => items.map((item) => item.id === active.id ? { ...item, ...patch } : item));
  };

  const saveActive = () => {
    if (!active) return;
    void persist(presets.map((item) => item.id === active.id ? { ...item, updatedAt: new Date().toISOString() } : item), "预设已保存");
  };

  const createPreset = () => {
    const now = new Date().toISOString();
    const created: PromptPreset = { id: crypto.randomUUID(), title: "未命名预设", prompt: "", tags: [], priority: "normal", sort_order: presets.length, createdAt: now, updatedAt: now };
    setPresets((items) => [...items, created]);
    setActiveId(created.id);
  };

  const deletePreset = (id: string) => {
    const target = presets.find((item) => item.id === id);
    if (!target) return;
    if (!window.confirm(`删除预设“${target.title}”？`)) return;
    void persist(presets.filter((item) => item.id !== id), "预设已删除");
  };

  const togglePin = (preset: PromptPreset) => {
    const next = presets.map((item) => item.id === preset.id ? { ...item, priority: item.priority === "pinned" ? "normal" as const : "pinned" as const } : item);
    void persist(next, preset.priority === "pinned" ? "已取消置顶" : "已置顶");
  };

  const exportPresets = () => {
    const blob = new Blob([JSON.stringify({ app: "ai-manju-studio", version: 1, exportedAt: new Date().toISOString(), presets }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `提示词预设-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    toast.success("已导出全部预设");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="preset-manager-dialog">
        <DialogHeader>
          <DialogTitle>我的提示词预设</DialogTitle>
          <DialogDescription>左列表管理，右侧编辑；支持搜索、置顶与一键导出。</DialogDescription>
        </DialogHeader>
        <div className="preset-manager-layout">
          <aside className="preset-manager-list">
            <div className="tag-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、正文或标签" /></div>
            <div className="preset-manager-toolbar">
              <button className="outline-button small" onClick={createPreset}><Plus size={13} /> 新建</button>
              <button className="outline-button small" onClick={exportPresets} disabled={!presets.length}><ArrowDownToLine size={13} /> 一键导出</button>
            </div>
            <div className="preset-manager-items">
              {loading ? <div className="preset-manager-loading"><Loader2 className="spin" size={16} /> 读取中…</div> : visible.length ? visible.map((preset) => (
                <div key={preset.id} className={active?.id === preset.id ? "preset-manager-item active" : "preset-manager-item"} onClick={() => setActiveId(preset.id)}>
                  <div className="preset-manager-item-head">
                    <span className={`status-chip ${preset.priority === "pinned" ? "sand" : "blue"}`}>{priorityLabel(preset.priority)}</span>
                    <b>{preset.title}</b>
                  </div>
                  <p>{preset.prompt || "未填写提示词"}</p>
                  <div className="preset-manager-item-actions">
                    <button title={preset.priority === "pinned" ? "取消置顶" : "置顶"} onClick={(event) => { event.stopPropagation(); togglePin(preset); }}><Pin size={12} /></button>
                    <button title="复制提示词" onClick={(event) => { event.stopPropagation(); void navigator.clipboard.writeText(preset.prompt).then(() => toast.success("已复制")); }}><WandSparkles size={12} /></button>
                    <button title="删除" onClick={(event) => { event.stopPropagation(); deletePreset(preset.id); }}><Trash2 size={12} /></button>
                  </div>
                </div>
              )) : <div className="empty-output"><p>没有匹配的预设</p></div>}
            </div>
          </aside>
          <section className="preset-manager-editor">
            {active ? (
              <>
                <label>标题<input value={active.title} onChange={(event) => patchActive({ title: event.target.value })} /></label>
                <label>标签<input value={active.tags.join(", ")} onChange={(event) => patchActive({ tags: event.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) })} placeholder="标签，以逗号分隔" /></label>
                <label>优先级<select value={active.priority} onChange={(event) => patchActive({ priority: event.target.value as PromptPreset["priority"] })}>{priorityOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                <label>提示词正文<textarea value={active.prompt} onChange={(event) => patchActive({ prompt: event.target.value })} placeholder="在此填写提示词内容…" /></label>
                <button className="vermilion-button" disabled={saving} onClick={saveActive}><Check size={15} /> {saving ? "保存中…" : "保存预设"}</button>
              </>
            ) : <div className="empty-output"><p>暂无预设，点击「新建」开始。</p></div>}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
