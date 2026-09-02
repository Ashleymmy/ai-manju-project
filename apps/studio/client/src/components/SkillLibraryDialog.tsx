import { Check, Download, Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createSkillEntry,
  exportSkillsFile,
  importSkillsFile,
  loadSkills,
  persistSkills,
  type CanvasSkill,
} from "@/lib/skill-library";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** 画布 skill 库管理弹窗：列表、启用/禁用、管理（复选删除）、导入/导出、新建。 */
export default function SkillLibraryDialog({ open, onOpenChange }: Props) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [skills, setSkills] = useState<CanvasSkill[]>([]);
  const [managing, setManaging] = useState(false);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => setSkills(loadSkills()), []);

  useEffect(() => {
    if (open) reload();
    if (!open) {
      setManaging(false);
      setCheckedIds([]);
      setShowCreate(false);
    }
  }, [open, reload]);

  const save = (next: CanvasSkill[]) => {
    persistSkills(next);
    setSkills(next);
  };

  const toggleEnabled = (id: string) => {
    save(skills.map((skill) => skill.id === id ? { ...skill, enabled: !skill.enabled, updatedAt: new Date().toISOString() } : skill));
  };

  const deleteChecked = () => {
    if (!checkedIds.length) return;
    save(skills.filter((skill) => !checkedIds.includes(skill.id)));
    setCheckedIds([]);
    toast.success(`已删除 ${checkedIds.length} 个技能`);
  };

  const createSkill = () => {
    if (!draftTitle.trim() || !draftPrompt.trim()) return toast.error("请填写技能名称与提示词");
    save([...skills, createSkillEntry({ title: draftTitle, description: draftDescription, prompt: draftPrompt })]);
    setDraftTitle("");
    setDraftPrompt("");
    setDraftDescription("");
    setShowCreate(false);
    toast.success("技能已创建");
  };

  const doImport = async (file: File) => {
    setBusy(true);
    try {
      const merged = await importSkillsFile(file, skills);
      setSkills(merged);
      toast.success(`导入完成，共 ${merged.length} 个技能`);
    } catch {
      toast.error("导入失败：请确认是 skill 库 JSON 文件");
    } finally {
      setBusy(false);
    }
  };

  const enabledCount = skills.filter((skill) => skill.enabled).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="skill-library-dialog">
        <DialogHeader>
          <DialogTitle>我的技能</DialogTitle>
          <DialogDescription>提示词优化时可选用这些技能作为指令模板。共 {skills.length} 个，启用 {enabledCount} 个。</DialogDescription>
        </DialogHeader>
        <input ref={importInputRef} type="file" accept=".json,application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void doImport(file); }} />
        <div className="skill-library-toolbar">
          <button className="outline-button small" onClick={() => setShowCreate((value) => !value)}><Plus size={14} /> 新建技能</button>
          <button className="outline-button small" onClick={() => importInputRef.current?.click()} disabled={busy}><Upload size={14} /> 导入</button>
          <button className="outline-button small" onClick={() => exportSkillsFile(skills)} disabled={!skills.length}><Download size={14} /> 导出</button>
          <button className={`outline-button small ${managing ? "active" : ""}`} onClick={() => { setManaging((value) => !value); setCheckedIds([]); }}>{managing ? "完成" : "管理"}</button>
          {managing && checkedIds.length ? <button className="outline-button small" onClick={deleteChecked}><Trash2 size={14} /> 删除 {checkedIds.length} 项</button> : null}
        </div>
        {showCreate ? (
          <div className="skill-create-form">
            <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="技能名称，例如：电影级提示词优化" />
            <input value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} placeholder="一句话描述（可选）" />
            <textarea value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} placeholder="技能指令（作为提示词优化的系统指令）" />
            <div className="skill-create-actions">
              <button className="vermilion-button" onClick={createSkill}><Check size={14} /> 保存技能</button>
              <button className="outline-button small" onClick={() => setShowCreate(false)}>取消</button>
            </div>
          </div>
        ) : null}
        <div className="skill-list">
          {skills.map((skill) => (
            <div key={skill.id} className={`skill-item ${skill.enabled ? "" : "disabled"}`}>
              {managing ? (
                <input type="checkbox" checked={checkedIds.includes(skill.id)} onChange={() => setCheckedIds((ids) => ids.includes(skill.id) ? ids.filter((id) => id !== skill.id) : [...ids, skill.id])} />
              ) : null}
              <div className="skill-item-body">
                <b>{skill.title}</b>
                {skill.description ? <small>{skill.description}</small> : null}
                <p>{skill.prompt}</p>
              </div>
              <div className="skill-item-actions">
                {managing ? null : (
                  <button className={`outline-button small ${skill.enabled ? "" : "active"}`} onClick={() => toggleEnabled(skill.id)}>
                    {skill.enabled ? "禁用" : "启用"}
                  </button>
                )}
              </div>
            </div>
          ))}
          {!skills.length ? <div className="empty-output"><p>暂无技能，点击「新建技能」或「导入」。</p></div> : null}
        </div>
        {busy ? <div className="skill-busy"><Loader2 className="spin" size={16} /> 导入中…</div> : null}
      </DialogContent>
    </Dialog>
  );
}
