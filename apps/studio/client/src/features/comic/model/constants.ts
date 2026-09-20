import type {
  ComicAssetClass,
  ComicBatchStatus,
  ComicBatchItemStatus,
} from "@/entities/comic";
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
  // 暂时隐藏"团队空间"入口（全局隐藏），恢复时取消下行注释
  // { value: "team", label: "团队空间" },
];

export const COMIC_CLASS_LABELS: Record<ComicAssetClass, string> = {
  character: "人物",
  environment: "场景",
  prop: "道具",
  ui: "UI",
};

export const COMIC_BATCH_POLL_INTERVAL_MS = 3_000;
/** 批次和单项状态统一显示为用户可读的生成阶段。 */
export const COMIC_BATCH_STATUS_LABELS: Record<ComicBatchStatus, string> = {
  queued: "等待调度",
  running: "生成中",
  paused: "已暂停",
  stopping: "正在停止",
  succeeded: "全部完成",
  partial_failed: "存在失败项",
  canceled: "已停止",
};
export const COMIC_BATCH_ITEM_STATUS_LABELS: Record<
  ComicBatchItemStatus,
  string
> = {
  pending: "等待调度",
  queued: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "生成失败",
  canceled: "已取消",
};
/** 列表使用小图，查看时再按需读取原图。 */
export const COMIC_OUTPUT_THUMBNAIL_SIZE = 320;
/** 生成服务的排队阶段，区分首次等待与供应商自动重试。 */
export const COMIC_QUEUE_PHASE_LABELS: Record<string, string> = {
  waiting_provider_slot: "等待可用生成通道",
  provider_retry_backoff: "生成服务繁忙，等待自动重试",
};
export const COMIC_REFERENCE_LIMIT = 6;

/** Prefer Luna only when its actual model ID is returned by the text catalog. */
export const COMIC_DEFAULT_ANALYSIS_MODEL = "gpt-5.6-luna";
/** Keep the first-round instructions comfortably within the analysis input budget. */
export const COMIC_ANALYSIS_INSTRUCTION_MAX_LENGTH = 4_000;
