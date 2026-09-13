import { Loader2, RefreshCw } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CapabilityModelCatalog } from "@/entities/model";
import { modelName, modelOptions, resolveModel } from "@/shared/lib/modelSelection";

import { COMIC_ANALYSIS_INSTRUCTION_MAX_LENGTH } from "../model/constants";
import "./comic-analysis-settings.css";

type Props = {
  catalog: CapabilityModelCatalog | null;
  loading: boolean;
  error: boolean;
  disabled: boolean;
  onRefresh: () => void;
  model: string;
  onModelChange: (model: string) => void;
  instruction: string;
  onInstructionChange: (instruction: string) => void;
};

export function ComicAnalysisSettings({ catalog, loading, error, disabled, onRefresh, model, onModelChange, instruction, onInstructionChange }: Props) {
  const available = error ? [] : catalog?.models || [];
  const selected = resolveModel(available, model);
  const options = modelOptions(available, selected);
  const placeholder = loading ? "正在获取文本模型…" : error ? "模型加载失败" : "暂无可用文本模型";

  return (
    <section className="dialog-section comic-analysis-settings" aria-label="剧本分析设置">
      <div className="comic-analysis-model-row">
        <div>
          <label className="dialog-label" htmlFor="comic-analysis-model">分析模型</label>
          <p className="comic-analysis-help">用于理解剧本并提取人物、场景和道具</p>
        </div>
        <div className="comic-analysis-model-controls">
          <Select value={selected} onValueChange={onModelChange} disabled={disabled || loading || !options.length}>
            <SelectTrigger id="comic-analysis-model" className="comic-analysis-model-trigger" aria-label="分析模型">
              <SelectValue placeholder={placeholder}>{loading ? placeholder : selected ? modelName(selected) : placeholder}</SelectValue>
            </SelectTrigger>
            <SelectContent className="comic-analysis-model-menu" align="start" sideOffset={6}>
              {options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <button type="button" className="comic-analysis-refresh" aria-label="刷新文本模型" title="刷新模型列表" disabled={disabled || loading} onClick={onRefresh}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
        </div>
      </div>
      {!loading && (error || !options.length) && <p className="comic-analysis-model-status" role="status">
        {error ? "暂时无法获取模型，请刷新重试。" : "尚未获取到文本模型，请刷新列表或在模型服务中配置。"}
      </p>}
      <div className="comic-analysis-instruction">
        <label className="dialog-label" htmlFor="comic-analysis-instruction">首轮分析要求</label>
        <p className="comic-analysis-help" id="comic-analysis-instruction-hint">补充需要保留的细节、拆分规则或重点关注的内容。</p>
        <textarea id="comic-analysis-instruction" aria-describedby="comic-analysis-instruction-hint" rows={5} value={instruction} disabled={disabled}
          onChange={event => onInstructionChange(event.target.value)} maxLength={COMIC_ANALYSIS_INSTRUCTION_MAX_LENGTH} />
        <div className="comic-analysis-instruction-footer"><span>分析结果将在创建项目前供你预览确认</span><span>{instruction.length} / {COMIC_ANALYSIS_INSTRUCTION_MAX_LENGTH}</span></div>
      </div>
    </section>
  );
}
