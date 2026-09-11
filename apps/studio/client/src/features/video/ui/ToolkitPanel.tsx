import { Eraser, Sparkles } from "lucide-react";
import { useRef } from "react";
import { useVideoToolkit } from "../hooks/useVideoToolkit";

/* 擦除接入持久任务；增强不属于本轮接口范围。 */

export function ToolkitPanel() {
  const input = useRef<HTMLInputElement>(null);
  const { busy, erase } = useVideoToolkit();
  return (
    <div className="wb-toolkit">
      <div className="wb-history-head">
        <b>工具箱</b>
        <span>视频后处理工具，依赖管理员配置的外部媒体服务</span>
      </div>
      <div className="wb-toolkit-grid">
        <div className="wb-toolkit-card">
          <span className="wb-toolkit-icon"><Eraser size={20} /></span>
          <b>字幕擦除</b>
          <p>识别并移除视频中的硬字幕与台标区域，支持标准/专业两档处理强度。</p>
          <input ref={input} type="file" accept="video/*" hidden onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void erase(file);
          }} />
          <button type="button" className="outline-button small" disabled={busy} onClick={() => input.current?.click()} title="选择视频并提交标准擦除任务">
            {busy ? "提交中…" : "选择视频"}
          </button>
        </div>
        <div className="wb-toolkit-card">
          <span className="wb-toolkit-icon"><Sparkles size={20} /></span>
          <b>视频增强</b>
          <p>对生成结果做超分与画质增强，输出更高分辨率的成片。</p>
          <button type="button" className="outline-button small" disabled title="依赖管理员配置的外部媒体服务">
            即将上线
          </button>
        </div>
      </div>
    </div>
  );
}
