import { Eraser, Sparkles } from "lucide-react";

/* 工具箱视图：字幕擦除 / 视频增强入口。
   两者依赖外部 AI MediaKit 服务，当前为配置缺失时的占位说明（对齐画布超分占位的处理方式）。 */

export function ToolkitPanel() {
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
          <button type="button" className="outline-button small" disabled title="依赖管理员配置的外部媒体服务">
            即将上线
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
