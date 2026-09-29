import { Stamp, Volume2 } from "lucide-react";
import { videoModelOptions } from "@/shared/lib/modelSelection";
import { videoModelDurations } from "@/entities/model";
import { videoModelCapabilities, videoOptionAvailable } from "@/entities/model/videoCapabilities";
import { VideoDurationInput } from "@/shared/ui/VideoDurationInput";
import type { PricingRulesConfig } from "@/features/member";

import {
  h3VideoSettings,
  isSeedanceVideoModel,
  normalizeVideoGenerationConfig,
  videoModelSettings,
  type VideoGenerationConfig,
} from "../services/generationGateway";

/* 模型参数及独立的时长、音频、水印控件，能力约束由模型目录提供。 */

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
  const capabilities = videoModelCapabilities(normalized.model);
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
              disabled={disabled || !videoOptionAvailable(normalized.model, "ratios", ratio)}
              title={!videoOptionAvailable(normalized.model, "ratios", ratio) ? "当前模型不支持此比例" : undefined}
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
              disabled={disabled || !videoOptionAvailable(normalized.model, "resolutions", resolution)}
              title={!videoOptionAvailable(normalized.model, "resolutions", resolution) ? "当前模型不支持此分辨率" : undefined}
              className={normalized.resolution === resolution ? "active" : ""}
              onClick={() => patch({ resolution })}
            >{resolution}</button>
          ))}
        </div>
      </div>
      <div className="wb-param-footer">
        <div className="wb-param-group wb-param-duration">
          <div className="wb-param-duration-heading">
            <span className="wb-param-label">视频时长</span>
            {new Set(durations.map(Number).filter(seconds => seconds > 0)).size > 1 && <span className="wb-param-duration-hint">拖动调节</span>}
          </div>
          <VideoDurationInput presentation="scrubber" value={normalized.seconds} durations={durations}
            disabled={disabled} onChange={seconds => patch({ seconds })} />
        </div>
        {!h3 && <div className="wb-param-switches" role="group" aria-label="视频输出选项">
          <button type="button" role="switch" aria-checked={normalized.generateAudio}
            disabled={disabled || capabilities.has_audio === false}
            className="wb-param-switch"
            title={capabilities.has_audio === false ? "当前模型不支持生成音频" : "生成视频时同时生成音频"}
            onClick={() => patch({ generateAudio: !normalized.generateAudio })}>
            <Volume2 size={14} aria-hidden="true" /><span>音频</span>
            <span className="wb-param-switch-track" aria-hidden="true" />
          </button>
          <button type="button" role="switch" aria-checked={normalized.watermark}
            disabled={disabled} className="wb-param-switch" title="在生成的视频中添加水印"
            onClick={() => patch({ watermark: !normalized.watermark })}>
            <Stamp size={14} aria-hidden="true" /><span>水印</span>
            <span className="wb-param-switch-track" aria-hidden="true" />
          </button>
        </div>}
      </div>

    </div>
  );
}
