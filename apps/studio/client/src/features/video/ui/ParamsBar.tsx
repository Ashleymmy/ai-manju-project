import { videoModelOptions } from "@/shared/lib/modelSelection";
import { videoModelDurations } from "@/entities/model";
import { VideoDurationInput } from "@/shared/ui/VideoDurationInput";
import type { PricingRulesConfig } from "@/features/member";

import {
  h3VideoSettings,
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
  providerNames,
  config,
  onChange,
  disabled,
  pricingRules,
}: {
  models: string[];
  labels: Record<string, string>;
  providerNames?: Record<string, string>;
  config: VideoGenerationConfig;
  onChange: (config: VideoGenerationConfig) => void;
  disabled: boolean;
  pricingRules?: PricingRulesConfig;
}) {
  const normalized = normalizeVideoGenerationConfig(config);
  const seedance = !normalized.model || isSeedanceVideoModel(normalized.model);
  const fastSeedance = isSeedanceFastVideoModel(normalized.model);
  const h3 = h3VideoSettings(normalized.model);
  const ratios = h3 ? ["1280x720", "720x1280"] : seedance ? videoModelSettings.seedanceRatios : videoModelSettings.openAiSizes;
  const durations = videoModelDurations(normalized.model);
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
          {videoModelOptions(models, normalized.model, labels, providerNames).map(({ value, label, disabled }) => <option key={value} value={value} disabled={disabled}>{label}</option>)}
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
          {(h3?.resolutions ?? videoModelSettings.seedanceResolutions).map((resolution) => (
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
        <span className="wb-param-label">时长 {normalized.seconds === "-1" ? "自动" : `${normalized.seconds} 秒`}</span>
        <VideoDurationInput value={normalized.seconds} durations={durations}
          disabled={disabled} onChange={seconds => patch({ seconds })} />
      </div>
      {!h3 && <div className="wb-param-group">
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
      </div>}

    </div>
  );
}
