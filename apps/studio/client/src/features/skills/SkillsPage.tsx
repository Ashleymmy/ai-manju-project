import {
  ArrowDownToLine,
  Bot,
  Check,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  createSkillEntry,
  exportSkillsFile,
  importSkillsFile,
  loadSkills,
  persistSkills,
  type CanvasSkill,
} from "./model/skillLibrary";
import "./styles.css";

function SurfaceTitle({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="feature-title"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{actions}</div>;
}

export function SkillLibraryView() {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [skills, setSkills] = useState<CanvasSkill[]>([]);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [sortBy, setSortBy] = useState<"updated" | "name">("updated");
  const [selectedId, setSelectedId] = useState("");
  const [managing, setManaging] = useState(false);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [createMode, setCreateMode] = useState(false);
  // 右栏编辑草稿：选中技能变化时重置
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const loaded = loadSkills();
    setSkills(loaded);
    setSelectedId(loaded[0]?.id || "");
  }, []);

  // 联动：画布或其他标签页改动技能库后，回到本页（focus）或收到 storage 事件时同步
  useEffect(() => {
    const sync = () => {
      const loaded = loadSkills();
      setSkills(loaded);
      setSelectedId((current) => current && loaded.some((skill) => skill.id === current) ? current : loaded[0]?.id || "");
    };
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const save = (next: CanvasSkill[], success?: string) => {
    persistSkills(next);
    setSkills(next);
    if (success) toast.success(success);
  };

  const selected = skills.find((skill) => skill.id === selectedId) || null;

  // 选中项变化时把内容载入右栏草稿
  useEffect(() => {
    setDraftTitle(selected?.title || "");
    setDraftDescription(selected?.description || "");
    setDraftPrompt(selected?.prompt || "");
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleEnabled = (id: string) => {
    save(skills.map((skill) => skill.id === id ? { ...skill, enabled: !skill.enabled, updatedAt: new Date().toISOString() } : skill));
  };

  const createSkill = () => {
    if (!draftTitle.trim() || !draftPrompt.trim()) return toast.error("请填写技能名称与提示词");
    const created = createSkillEntry({ title: draftTitle, description: draftDescription, prompt: draftPrompt });
    save([...skills, created], "技能已创建，画布中即刻可用");
    setSelectedId(created.id);
    setCreateMode(false);
  };

  const saveEdit = () => {
    if (!selected) return;
    if (!draftTitle.trim() || !draftPrompt.trim()) return toast.error("请填写技能名称与提示词");
    save(skills.map((skill) => skill.id === selected.id ? { ...skill, title: draftTitle.trim(), description: draftDescription.trim(), prompt: draftPrompt.trim(), updatedAt: new Date().toISOString() } : skill), "技能已更新，画布中同步生效");
  };

  const removeSkill = (skill: CanvasSkill) => {
    if (!window.confirm(`删除技能「${skill.title}」？画布中将不再提供该技能。`)) return;
    const next = skills.filter((item) => item.id !== skill.id);
    save(next, "技能已删除");
    if (selectedId === skill.id) setSelectedId(next[0]?.id || "");
  };

  const doImport = async (file: File) => {
    setBusy(true);
    try {
      const merged = await importSkillsFile(file, skills);
      setSkills(merged);
      setSelectedId((current) => current || merged[0]?.id || "");
      toast.success(`导入完成，共 ${merged.length} 个技能`);
    } catch {
      toast.error("导入失败：请确认是 skill 库 JSON 文件");
    } finally {
      setBusy(false);
    }
  };

  const toggleChecked = (id: string) => setCheckedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);

  const bulkSetEnabled = (enabled: boolean) => {
    if (!checkedIds.length) return;
    save(skills.map((skill) => checkedIds.includes(skill.id) ? { ...skill, enabled, updatedAt: new Date().toISOString() } : skill), `已${enabled ? "启用" : "禁用"} ${checkedIds.length} 个技能`);
    setCheckedIds([]);
  };

  const bulkDelete = () => {
    if (!checkedIds.length) return;
    if (!window.confirm(`删除选中的 ${checkedIds.length} 个技能？`)) return;
    const next = skills.filter((skill) => !checkedIds.includes(skill.id));
    save(next, `已删除 ${checkedIds.length} 个技能`);
    setCheckedIds([]);
    if (checkedIds.includes(selectedId)) setSelectedId(next[0]?.id || "");
  };

  const term = keyword.trim().toLowerCase();
  const visible = skills
    .filter((skill) => statusFilter === "all" || (statusFilter === "enabled" ? skill.enabled : !skill.enabled))
    .filter((skill) => !term || skill.title.toLowerCase().includes(term) || skill.description.toLowerCase().includes(term) || skill.prompt.toLowerCase().includes(term))
    .sort((a, b) => sortBy === "name" ? a.title.localeCompare(b.title, "zh-CN") : b.updatedAt.localeCompare(a.updatedAt));
  const enabledCount = skills.filter((skill) => skill.enabled).length;

  return <div className="feature-page skill-page">
    <input ref={importInputRef} type="file" accept=".json,application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void doImport(file); }} />
    <SurfaceTitle eyebrow={`SKILLS / ${skills.length}`} title="技能库" description={`提示词优化技能的统一仓库，与画布节点「提示词优化」菜单实时联动：当前启用 ${enabledCount} 个，画布中选择技能时会读取这份列表。`}
      actions={<div className="scope-switch">
        <button className="vermilion-button" onClick={() => { setCreateMode(true); setDraftTitle(""); setDraftDescription(""); setDraftPrompt(""); }}><Plus size={16} /> 新建技能</button>
        <button className="outline-button small" onClick={() => importInputRef.current?.click()} disabled={busy}><Upload size={14} /> 导入</button>
        <button className="outline-button small" onClick={() => exportSkillsFile(skills)} disabled={!skills.length}><ArrowDownToLine size={14} /> 导出</button>
      </div>} />
    <div className="prompt-workspace skill-workspace">
      <aside className="prompt-filters">
        <div className="tag-search"><Search size={15} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="名称、描述或指令" /></div>
        <p className="field-label">状态</p>
        {([["全部", "all", skills.length], ["启用中", "enabled", enabledCount], ["已禁用", "disabled", skills.length - enabledCount]] as const).map(([label, key, count]) => (
          <button key={key} className={statusFilter === key ? "selected" : ""} onClick={() => setStatusFilter(key)}><span>{label}</span><b>{count}</b></button>
        ))}
        <hr />
        <p className="field-label">排序</p>
        {([["最近更新", "updated"], ["名称 A-Z", "name"]] as const).map(([label, key]) => (
          <button key={key} className={sortBy === key ? "selected" : ""} onClick={() => setSortBy(key)}><span>{label}</span></button>
        ))}
        <hr />
        <p className="skill-side-hint">启用的技能会出现在画布节点的「提示词优化」菜单中；禁用后画布立即隐藏，但配置保留。</p>
      </aside>
      <section className="template-list">
        <div className="template-list-head">
          <span>{busy ? "导入中…" : `匹配到 ${visible.length} 个技能`}</span>
          <button onClick={() => { setManaging((value) => !value); setCheckedIds([]); }}>{managing ? "完成" : "管理"}</button>
        </div>
        {managing ? (
          <div className="skill-manage-bar">
            <label><input type="checkbox" checked={visible.length > 0 && checkedIds.length === visible.length} onChange={(event) => setCheckedIds(event.target.checked ? visible.map((skill) => skill.id) : [])} /> 全选</label>
            <span>已选 {checkedIds.length} 项</span>
            <button className="outline-button small" disabled={!checkedIds.length} onClick={() => bulkSetEnabled(true)}>启用</button>
            <button className="outline-button small" disabled={!checkedIds.length} onClick={() => bulkSetEnabled(false)}>禁用</button>
            <button className="outline-button small" disabled={!checkedIds.length} onClick={bulkDelete}><Trash2 size={12} /> 删除</button>
          </div>
        ) : null}
        {visible.map((skill) => (
          <div
            key={skill.id}
            className={`template-card skill-card ${!managing && selected?.id === skill.id ? "selected" : ""} ${skill.enabled ? "" : "disabled"}`}
            role="button"
            tabIndex={0}
            onClick={() => managing ? toggleChecked(skill.id) : (setSelectedId(skill.id), setCreateMode(false))}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); managing ? toggleChecked(skill.id) : (setSelectedId(skill.id), setCreateMode(false)); } }}
          >
            <div>
              <span className={skill.enabled ? "skill-status" : "skill-status off"}>{skill.enabled ? "启用" : "禁用"}</span>
              <b>{skill.title}</b>
              <p>{skill.description || skill.prompt}</p>
            </div>
            <div className="template-card-tags"><i>{new Date(skill.updatedAt).toLocaleDateString("zh-CN")} 更新</i>{skill.enabled ? <i>画布可用</i> : null}</div>
            {managing ? <input className="skill-card-check" type="checkbox" readOnly checked={checkedIds.includes(skill.id)} /> : null}
          </div>
        ))}
        {!visible.length ? <div className="empty-output"><Bot size={26} /><p>{skills.length ? "当前筛选下没有技能" : "暂无技能，点击右上角「新建技能」或「导入」。"}</p></div> : null}
      </section>
      <aside className="prompt-preview">
        {createMode ? (
          <>
            <div><p className="eyebrow">NEW SKILL</p><input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="技能名称，例如：电影级提示词优化" /></div>
            <input value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} placeholder="一句话描述（可选）" />
            <textarea value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} placeholder="技能指令（作为提示词优化的系统指令）" />
            <button className="vermilion-button" onClick={createSkill}><Check size={15} /> 保存技能</button>
            <button className="full-outline" onClick={() => setCreateMode(false)}>取消</button>
          </>
        ) : selected ? (
          <>
            <div><p className="eyebrow">SKILL / {selected.enabled ? "启用中" : "已禁用"}</p><input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="技能名称" /></div>
            <input value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} placeholder="一句话描述（可选）" />
            <textarea value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} placeholder="技能指令（作为提示词优化的系统指令）" />
            <button className="vermilion-button" onClick={saveEdit}><Check size={15} /> 保存修改</button>
            <button className="full-outline" onClick={() => toggleEnabled(selected.id)}>{selected.enabled ? "禁用（画布中隐藏）" : "启用（画布中可用）"}</button>
            <button className="full-outline" onClick={() => removeSkill(selected)}><Trash2 size={14} /> 删除技能</button>
            <p className="skill-side-hint">更新于 {new Date(selected.updatedAt).toLocaleString("zh-CN")} · 保存后画布节点菜单实时生效</p>
          </>
        ) : (
          <div className="empty-output"><Bot size={26} /><p>选择左侧技能查看与编辑</p></div>
        )}
      </aside>
    </div>
  </div>;
}

export default SkillLibraryView;
