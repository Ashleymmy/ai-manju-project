import {
  Check,
  ChevronRight,
  FileText,
  Plus,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import type { PromptPreset } from "@/entities/prompt";
import { useWorkspaceDashboardData } from "@/features/dashboard";
import {
  settingsQueryKeys,
  updatePreferences,
  usePreferencesQuery,
} from "@/features/settings";
import { publicApiError } from "@/shared/api/errors";

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

export function ProfileView() {
  const queryClient = useQueryClient();
  const preferencesInitializedRef = useRef(false);
  const preferencesQuery = usePreferencesQuery();
  const { user } = useAuth();
  const { data } = useWorkspaceDashboardData();
  const [preferences, setPreferences] = useState<PromptPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (preferencesInitializedRef.current || preferencesQuery.isPending) return;
    preferencesInitializedRef.current = true;
    const presets = preferencesQuery.data?.canvas?.promptPresets || [];
    setPreferences(presets);
    setActivePresetId(presets[0]?.id || "");
  }, [preferencesQuery.data, preferencesQuery.isPending]);
  const promptCount = preferences.length;
  const activePreset = preferences.find((item) => item.id === activePresetId) || preferences[0];
  const persistProfilePresets = async (next: PromptPreset[], message: string) => {
    setSaving(true);
    try {
      const normalized = next.map((item, index) => ({ ...item, sort_order: item.sort_order ?? index, updatedAt: item.updatedAt || new Date().toISOString() }));
      const saved = await updatePreferences({ canvas: { promptPresets: normalized } });
      queryClient.setQueryData(settingsQueryKeys.preferences(), saved);
      const presets = saved.canvas?.promptPresets || normalized;
      setPreferences(presets);
      setActivePresetId((current) => presets.some((item) => item.id === current) ? current : presets[0]?.id || "");
      toast.success(message);
    } catch (error) {
      toast.error(publicApiError(error, "保存个人提示词失败"));
    } finally {
      setSaving(false);
    }
  };
  const createProfilePreset = async () => {
    const now = new Date().toISOString();
    const preset: PromptPreset = { id: crypto.randomUUID(), title: "未命名提示词", prompt: "", tags: [], priority: "normal", sort_order: preferences.length, createdAt: now, updatedAt: now };
    setActivePresetId(preset.id);
    await persistProfilePresets([...preferences, preset], "个人提示词已创建");
  };
  const patchProfilePreset = (patch: Partial<PromptPreset>) => activePreset && setPreferences((items) => items.map((item) => item.id === activePreset.id ? { ...item, ...patch } : item));
  return <div className="feature-page profile-page">
    <SurfaceTitle eyebrow="PROFILE / YOU" title="个人主页" description="把常用模型、提示词预设和工作区状态集中放在一个页面里。"
      actions={<button className="outline-button small" onClick={() => window.location.assign("/prompts")}>打开提示词库</button>} />
    <div className="profile-workspace">
      <section className="profile-account-section">
        <div className="profile-account-card">
          <div className="profile-avatar">{(user?.display_name || user?.username || "?").slice(0, 1).toUpperCase()}</div>
          <div className="profile-account-info">
            <p className="eyebrow">ACCOUNT</p>
            <h2>{user?.display_name || user?.username || "—"}</h2>
            <p className="profile-role-text"><span className="profile-role-badge">{user?.role === "super_admin" ? "超级管理员" : user?.role || "成员"}</span></p>
          </div>
        </div>
      </section>
      <div className="profile-stats-row">
        <div className="profile-metric-card">
          <span className="metric-label">项目</span>
          <b className="metric-value">{data.projects.total ?? "—"}</b>
          <small className="metric-unit">当前工作区项目总数</small>
        </div>
        <div className="profile-metric-card">
          <span className="metric-label">资产</span>
          <b className="metric-value">{data.assets.total ?? "—"}</b>
          <small className="metric-unit">素材库资产总数</small>
        </div>
        <div className="profile-metric-card">
          <span className="metric-label">任务</span>
          <b className="metric-value">{data.jobs.total ?? "—"}</b>
          <small className="metric-unit">排队与运行中的生成任务</small>
        </div>
        <div className="profile-metric-card">
          <span className="metric-label">预设</span>
          <b className="metric-value">{promptCount < 10 ? `0${promptCount}` : promptCount}</b>
          <small className="metric-unit">个人提示词预设数</small>
        </div>
      </div>
      <section className="profile-shortcuts-section">
        <p className="eyebrow">SHORTCUTS</p>
        <div className="profile-nav-grid">
          <button className="profile-nav-item" onClick={() => window.location.assign("/prompts")}>
            <span>进入完整提示词库</span>
            <ChevronRight size={16} />
          </button>
          <button className="profile-nav-item" onClick={() => window.location.assign("/assets")}>
            <span>进入资产库</span>
            <ChevronRight size={16} />
          </button>
          <button className="profile-nav-item" onClick={() => window.location.assign("/canvas")}>
            <span>打开画布</span>
            <ChevronRight size={16} />
          </button>
          <button className="profile-nav-item" onClick={() => window.location.assign("/image")}>
            <span>打开关键帧生成</span>
            <ChevronRight size={16} />
          </button>
        </div>
      </section>
      <section className="profile-prompt-section">
        <div className="profile-section-header">
          <div>
            <p className="eyebrow">PRIVATE PROMPTS</p>
            <h2>个人提示词预设</h2>
          </div>
          <button className="outline-button small" onClick={() => void createProfilePreset()}><Plus size={15} /> 新建</button>
        </div>
        <div className="profile-prompt-workspace">
          <div className="profile-preset-list">{preferences.length ? [...preferences].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.sort_order - b.sort_order).map((preset) => <button key={preset.id} className={activePreset?.id === preset.id ? "selected" : ""} onClick={() => setActivePresetId(preset.id)}><span className="preset-priority">{priorityLabel(preset.priority)}</span><b>{preset.title}</b><small>{preset.tags.join(" / ") || preset.prompt.slice(0, 40) || "未填写"}</small></button>) : <div className="empty-output"><p>暂无个人提示词，点击新建开始。</p></div>}</div>
          <div className="profile-preset-editor">{activePreset ? <><input value={activePreset.title} onChange={(event) => patchProfilePreset({ title: event.target.value })} placeholder="标题" /><textarea value={activePreset.prompt} onChange={(event) => patchProfilePreset({ prompt: event.target.value })} placeholder="提示词内容" /><input value={activePreset.tags.join(", ")} onChange={(event) => patchProfilePreset({ tags: event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean) })} placeholder="标签，以逗号分隔" /><select value={activePreset.priority} onChange={(event) => patchProfilePreset({ priority: event.target.value as PromptPreset["priority"] })}><option value="pinned">置顶</option><option value="high">高</option><option value="normal">普通</option><option value="low">低</option></select><div className="profile-preset-actions"><button className="vermilion-button" disabled={saving} onClick={() => void persistProfilePresets(preferences, "个人提示词已保存")}><Check size={15} /> 保存</button><button className="outline-button small" onClick={() => { sessionStorage.setItem("ai-manju:image-prompt", activePreset.prompt); window.location.assign("/image"); }}><WandSparkles size={15} /> 送入关键帧</button><button className="outline-button small" onClick={() => void navigator.clipboard.writeText(activePreset.prompt).then(() => toast.success("提示词已复制"))}><FileText size={15} /> 复制</button><button className="outline-button small" onClick={() => window.confirm(`删除"${activePreset.title}"？`) && void persistProfilePresets(preferences.filter((item) => item.id !== activePreset.id), "个人提示词已删除")}><Trash2 size={15} /> 删除</button></div></> : <div className="empty-output"><p>选择一个提示词进行编辑。</p></div>}</div>
        </div>
      </section>
    </div>
  </div>;
}

export default ProfileView;
