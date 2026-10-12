import { Loader2, RefreshCw } from "lucide-react";

import type { CapabilityModelCatalog } from "@/entities/model";

import { COMIC_ANALYSIS_INSTRUCTION_MAX_LENGTH, COMIC_TEXT_MODEL_MISSING_MESSAGE } from "../model/constants";
import "./comic-analysis-settings.css";

type Props = {
  catalog: CapabilityModelCatalog | null;
  loading: boolean;
  error: boolean;
  disabled: boolean;
  onRefresh: () => void;
  instruction: string;
  onInstructionChange: (instruction: string) => void;
};

export function ComicAnalysisSettings({ catalog, loading, error, disabled, onRefresh, instruction, onInstructionChange }: Props) {
  const unavailable = !loading && (error || !catalog?.models.length);

  return (
    <section className="dialog-section comic-analysis-settings" aria-label="剧本分析设置">
      {unavailable && <p className="comic-analysis-model-status" role="status">
        {error ? "暂时无法连接分析模型，请刷新重试。" : COMIC_TEXT_MODEL_MISSING_MESSAGE}
        <button type="button" className="comic-analysis-refresh" aria-label="刷新文本模型" title="重新检查" disabled={disabled || loading} onClick={onRefresh}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
        </button>
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
