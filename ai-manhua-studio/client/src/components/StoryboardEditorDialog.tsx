import { Check, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type StoryboardScene = {
  id: string;
  duration: number;
  visual: string;
  dialogue: string;
  sfx: boolean;
  bgm: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  scenes: StoryboardScene[];
  onSave: (scenes: StoryboardScene[]) => void;
};

function createScene(index: number): StoryboardScene {
  return { id: crypto.randomUUID(), duration: 4, visual: "", dialogue: "", sfx: false, bgm: false, ...(index ? {} : {}) };
}

/** 视频节点分镜栏编辑：场景列表 + 时长/画面/台词/音效编辑，存节点 metadata。 */
export default function StoryboardEditorDialog({ open, onOpenChange, title, scenes: initialScenes, onSave }: Props) {
  const [scenes, setScenes] = useState<StoryboardScene[]>([]);
  const [activeId, setActiveId] = useState("");
  const active = scenes.find((item) => item.id === activeId) || scenes[0];

  useEffect(() => {
    if (open) {
      const list = initialScenes.length ? initialScenes : [createScene(0)];
      setScenes(list);
      setActiveId(list[0]?.id || "");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchActive = (patch: Partial<StoryboardScene>) => {
    if (!active) return;
    setScenes((items) => items.map((item) => item.id === active.id ? { ...item, ...patch } : item));
  };

  const addScene = () => {
    const created = createScene(scenes.length);
    setScenes((items) => [...items, created]);
    setActiveId(created.id);
  };

  const removeScene = (id: string) => {
    if (scenes.length <= 1) return toast.warning("至少保留一个分镜");
    const next = scenes.filter((item) => item.id !== id);
    setScenes(next);
    if (activeId === id) setActiveId(next[0]?.id || "");
  };

  const save = () => {
    onSave(scenes);
    toast.success(`分镜已保存（${scenes.length} 个场景）`);
    onOpenChange(false);
  };

  const totalDuration = scenes.reduce((sum, item) => sum + item.duration, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="storyboard-editor-dialog">
        <DialogHeader>
          <DialogTitle>分镜栏编辑</DialogTitle>
          <DialogDescription>{title || "视频分镜"} · {scenes.length} 个场景 · 共 {totalDuration} 秒。保存后写入当前视频节点。</DialogDescription>
        </DialogHeader>
        <div className="storyboard-editor-layout">
          <aside className="storyboard-scene-list">
            {scenes.map((scene, index) => (
              <button key={scene.id} type="button" className={active?.id === scene.id ? "scene-item active" : "scene-item"} onClick={() => setActiveId(scene.id)}>
                <b>分镜 {index + 1}</b>
                <span>{scene.duration}s · {scene.visual || scene.dialogue ? (scene.visual || scene.dialogue).slice(0, 14) : "未填写"}</span>
              </button>
            ))}
            <button type="button" className="scene-item scene-add" onClick={addScene}><Plus size={14} /> 添加分镜</button>
          </aside>
          <section className="storyboard-scene-editor">
            {active ? (
              <>
                <div className="param-group">
                  <span className="param-group-label">时长 <b>{active.duration} 秒</b></span>
                  <input type="range" className="param-range" min={1} max={10} step={1} value={active.duration} onChange={(event) => patchActive({ duration: Number(event.target.value) })} />
                  <div className="param-range-ticks">{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((item) => <span key={item}>{item}s</span>)}</div>
                </div>
                <div className="param-group">
                  <span className="param-group-label">画面</span>
                  <textarea className="prompt-copy" value={active.visual} placeholder="描述这个镜头的画面内容、机位与运动…" onChange={(event) => patchActive({ visual: event.target.value })} />
                </div>
                <div className="param-group">
                  <span className="param-group-label">台词 / 旁白</span>
                  <textarea className="prompt-copy" value={active.dialogue} placeholder="这个镜头的台词或旁白（可选）…" onChange={(event) => patchActive({ dialogue: event.target.value })} />
                </div>
                <div className="param-group storyboard-flags">
                  <label><input type="checkbox" checked={active.sfx} onChange={(event) => patchActive({ sfx: event.target.checked })} /> 音效</label>
                  <label><input type="checkbox" checked={active.bgm} onChange={(event) => patchActive({ bgm: event.target.checked })} /> BGM</label>
                </div>
                <div className="storyboard-scene-actions">
                  <button className="outline-button small" onClick={() => removeScene(active.id)}><Trash2 size={13} /> 删除分镜</button>
                  <button className="vermilion-button" onClick={save}><Check size={14} /> 保存分镜</button>
                </div>
              </>
            ) : null}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
