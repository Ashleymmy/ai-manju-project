import { modelOptions } from "@/shared/lib/modelSelection";
import { useMemo } from "react";

import {
  isSeedanceFastVideoModel,
  isSeedanceVideoModel,
  normalizeVideoGenerationConfig,
  videoModelSettings,
  type VideoGenerationConfig,
} from "../services/generationGateway";

/* 底部参数条：模型/比例/分辨率/时长分段按钮 + 音频/水印开关（按 studio 影印风重绘）。 */

export function ParamsBar({
  models,
  labels,
  config,
  onChange,
  disabled,
}: {
  models: string[];
  labels: Record<string, string>;
  config: VideoGenerationConfig;
  onChange: (config: VideoGenerationConfig) => void;
  disabled: boolean;
}) {
  const normalized = useMemo(() => normalizeVideoGenerationConfig(config), [config]);
  /* 未配置模型时也按 Seedance 展示（比例/30s 时长档位）；配上 OpenAI 兼容模型后自动切回尺寸/20s */
  const seedance = !normalized.model || isSeedanceVideoModel(normalized.model);
  const fastSeedance = isSeedanceFastVideoModel(normalized.model);
  const ratios = seedance ? videoModelSettings.seedanceRatios : videoModelSettings.openAiSizes;
  const durations = seedance ? videoModelSettings.seedanceDurations : videoModelSettings.openAiDurations;

  const patch = (partial: Partial<VideoGenerationConfig>) => onChange(normalizeVideoGenerationConfig({ ...normalized, ...partial }));

  return (
    <div className="wb-params">
      <div className="wb-param-group">
        <span className="wb-param-label">模型</span>
        <select
          value={normalized.model}
          disabled={disabled || !models.length}
          onChange={(event) => patch({ model: event.target.value })}
        >
          {!models.length ? <option value="">未配置</option> : null}
          {/* 展示模型名称，option value 保留完整调用标识。 */}
          {modelOptions(models, normalized.model, labels).map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div className="wb-param-group">
        <span className="wb-param-label">{seedance ? "比例" : "尺寸"}</span>
        <div className="wb-segments">
          {ratios.map((ratio) => (
            <button
              key={ratio}
              type="button"
              disabled={disabled}
              className={normalized.size === ratio ? "active" : ""}
              onClick={() => patch({ size: ratio })}
            >{ratio}</button>
          ))}
        </div>
      </div>
      <div className="wb-param-group">
        <span className="wb-param-label">分辨率</span>
        <div className="wb-segments">
          {videoModelSettings.seedanceResolutions.map((resolution) => (
            <button
              key={resolution}
              type="button"
              disabled={disabled || (fastSeedance && resolution === "1080p")}
              className={normalized.resolution === resolution ? "active" : ""}
              onClick={() => patch({ resolution })}
            >{resolution}</button>
          ))}
        </div>
      </div>
      <div className="wb-param-group wb-param-duration">
        <span className="wb-param-label">时长</span>
        <div className="wb-segments">
          {durations.map((duration) => (
            <button
              key={duration}
              type="button"
              disabled={disabled}
              className={normalized.seconds === String(duration) ? "active" : ""}
              onClick={() => patch({ seconds: String(duration) })}
            >{duration === -1 ? "智能" : `${duration}s`}</button>
          ))}
        </div>
      </div>
      <div className="wb-param-group">
        <span className="wb-param-label">开关</span>
        <div className="wb-segments">
          <button
            type="button"
            disabled={disabled}
            className={normalized.generateAudio ? "active" : ""}
            onClick={() => patch({ generateAudio: !normalized.generateAudio })}
          >音频</button>
          <button
            type="button"
            disabled={disabled}
            className={normalized.watermark ? "active" : ""}
            onClick={() => patch({ watermark: !normalized.watermark })}
          >水印</button>
        </div>
      </div>
    </div>
  );
}
