import { Check, Menu, Plus, X } from "lucide-react";
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
  startTime: number;
  endTime: number;
  quality: "标准" | "流畅" | "高清";
  lightEffect: "选择";
  visual: string;
  camera: string;
  materials: string;
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

function createScene(index: number, prevEnd: number): StoryboardScene {
  return {
    id: crypto.randomUUID(),
    startTime: prevEnd,
    endTime: prevEnd + 5,
    quality: "标准",
    lightEffect: "选择",
    visual: "",
    camera: "",
    materials: "",
    sfx: false,
    bgm: false,
  };
}

/** 视频节点分镜栏编辑：时间轴式横向标签 + 当前分镜完整编辑区（画质/光效/时间范围/镜语/运镜/素材/音效BGM）。 */
export default function StoryboardEditorDialog({ open, onOpenChange, title, scenes: initialScenes, onSave }: Props) {
  const [scenes, setScenes] = useState<StoryboardScene[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const active = scenes[activeIndex];

  useEffect(() => {
    if (open) {
      const list = initialScenes.length ? initialScenes : [createScene(0, 0)];
      setScenes(list);
      setActiveIndex(0);
    }
  }, [open, initialScenes]);

  const patchActive = (patch: Partial<StoryboardScene>) => {
    if (!active) return;
    setScenes((items) => items.map((item, index) => index === activeIndex ? { ...item, ...patch } : item));
  };

  const addScene = () => {
    const lastEnd = scenes.length ? scenes[scenes.length - 1].endTime : 0;
    const created = createScene(scenes.length, lastEnd);
    setScenes((items) => [...items, created]);
    setActiveIndex(scenes.length);
  };

  const removeScene = () => {
    if (scenes.length <= 1) return toast.warning("至少保留一个分镜");
    const next = scenes.filter((_, index) => index !== activeIndex);
    setScenes(next);
    setActiveIndex(Math.min(activeIndex, next.length - 1));
  };

  const save = () => {
    onSave(scenes);
    toast.success(`分镜已保存（${scenes.length} 个场景）`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="storyboard-timeline-dialog">
        <DialogHeader>
          <DialogTitle>分镜栏编辑</DialogTitle>
          <DialogDescription>编辑视频分镜时间轴、内容与配置。保存后写入当前视频节点。</DialogDescription>
        </DialogHeader>
        <div className="storyboard-timeline-tabs">
          <Menu size={16} />
          {scenes.map((scene, index) => (
            <button
              key={scene.id}
              type="button"
              className={activeIndex === index ? "active" : ""}
              onClick={() => setActiveIndex(index)}
            >
              分镜 {index + 1}
            </button>
          ))}
        </div>
        {active ? (
          <div className="storyboard-timeline-editor">
            <div className="storyboard-timeline-row">
              <label>画质
                <select value={active.quality} onChange={(event) => patchActive({ quality: event.target.value as StoryboardScene["quality"] })}>
                  <option value="标准">标准</option>
                  <option value="流畅">流畅</option>
                  <option value="高清">高清</option>
                </select>
              </label>
              <label>光效
                <select value={active.lightEffect} onChange={(event) => patchActive({ lightEffect: event.target.value as StoryboardScene["lightEffect"] })}>
                  <option value="选择">选择</option>
                </select>
              </label>
              <label>选择
                <select disabled>
                  <option>选择运镜预设</option>
                </select>
              </label>
            </div>
            <div className="param-group">
              <span className="param-group-label">时间范围 <b>{active.startTime.toFixed(1)}s ~ {active.endTime.toFixed(1)}s</b></span>
              <div className="storyboard-timeline-range-wrap">
                <input
                  type="range"
                  className="param-range"
                  min={0}
                  max={60}
                  step={0.1}
                  value={active.startTime}
                  onChange={(event) => {
                    const start = Number(event.target.value);
                    if (start < active.endTime) patchActive({ startTime: start });
                  }}
                />
                <input
                  type="range"
                  className="param-range"
                  min={0}
                  max={60}
                  step={0.1}
                  value={active.endTime}
                  onChange={(event) => {
                    const end = Number(event.target.value);
                    if (end > active.startTime) patchActive({ endTime: end });
                  }}
                />
              </div>
            </div>
            <div className="param-group">
              <span className="param-group-label">镜语</span>
              <textarea value={active.visual} placeholder="描述语言，可 @ 引用素材…" onChange={(event) => patchActive({ visual: event.target.value })} />
            </div>
            <div className="param-group">
              <span className="param-group-label">运镜</span>
              <textarea value={active.camera} placeholder="描述运镜，可 @ 引用素材…" onChange={(event) => patchActive({ camera: event.target.value })} />
            </div>
            <div className="param-group">
              <span className="param-group-label">素材</span>
              <textarea value={active.materials} placeholder="输入分镜需求描述，可 @ 引用素材…" onChange={(event) => patchActive({ materials: event.target.value })} />
            </div>
            <div className="storyboard-timeline-footer">
              <div className="storyboard-timeline-flags">
                <label><input type="checkbox" checked={active.sfx} onChange={(event) => patchActive({ sfx: event.target.checked })} /> 音效</label>
                <label><input type="checkbox" checked={active.bgm} onChange={(event) => patchActive({ bgm: event.target.checked })} /> BGM</label>
              </div>
              <button type="button" className="outline-button small" onClick={addScene}><Plus size={13} /> 添加分镜</button>
            </div>
            <div className="storyboard-timeline-hint">
              <p>提示：1、支持多镜，视频全段分段多字幕，无任何冗余。</p>
              <p>2、视频中两人物直线镜级间切换显得突兀，不要连续镜级间切视频。</p>
            </div>
            <div className="storyboard-timeline-actions">
              {scenes.length > 1 ? <button type="button" className="outline-button" onClick={removeScene}><X size={14} /> 删除分镜 {activeIndex + 1}</button> : null}
              <button type="button" className="outline-button" onClick={() => onOpenChange(false)}>取消</button>
              <button type="button" className="vermilion-button" onClick={save}><Check size={15} /> 确定</button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
