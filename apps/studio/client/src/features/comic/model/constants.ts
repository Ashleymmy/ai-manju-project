import type { ComicAssetClass } from "@/entities/comic";
import type { WorkspaceScope } from "@/shared/config";

export const COMIC_DEFAULT_INSTRUCTION =
  "请逐场检查剧本，不要遗漏有视觉特征或连续性要求的角色、场景和道具。";

export const COMIC_PROJECT_ANALYSIS_INSTRUCTION =
  "按剧本出现顺序完整拆解人物、场景、道具和必要 UI；不同服装、造型或受损状态分别建项；保留身份关系、外观、服装、材质、随身道具、场景时间空间和光线细节；剧本未明确的信息标记为未明确，不得自行补写。";

export const COMIC_OPTIMIZE_DIRECTION =
  "保留原始设定细节，补足可视化特征，避免随意改写人物身份、场景关系和关键道具。";

export const COMIC_SCOPE_OPTIONS: Array<{
  value: WorkspaceScope;
  label: string;
}> = [
  { value: "personal", label: "个人空间" },
  { value: "team", label: "团队空间" },
];

export const COMIC_CLASS_LABELS: Record<ComicAssetClass, string> = {
  character: "人物",
  environment: "场景",
  prop: "道具",
  ui: "UI",
};

export const COMIC_BATCH_POLL_INTERVAL_MS = 3_000;
export const COMIC_REFERENCE_LIMIT = 6;
