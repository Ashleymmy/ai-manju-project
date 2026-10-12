// [画布别名] 后台「画布别名」页的数据整理与校验。
import type { AiModelsResponse } from "@/entities/model";
import { normalizeModelList } from "@/entities/model";
import { isHiddenImageModel, modelDisplayName, modelName } from "@/shared/lib/modelSelection";

export const canvasNicknamesQueryKey = ["admin", "canvas-nicknames"] as const;

/** 后端 billing_configs 键（model.BillingConfigKeyCanvasNicknames）。 */
export const CANVAS_NICKNAMES_CONFIG_KEY = "canvas_model_nicknames";

/** 与后端 service.MaxCanvasModelNicknameRunes 保持一致。 */
export const MAX_CANVAS_NICKNAME_LENGTH = 32;

export type CanvasNicknameGroup = "image" | "video" | "audio";

export const canvasNicknameGroups: readonly (readonly [CanvasNicknameGroup, string])[] = [
  ["image", "图片"],
  ["video", "视频"],
  ["audio", "音频"],
];

export type CanvasNicknameRow = {
  /** 真实模型 ID：别名按它全局生效，同一 ID 在所有供应商下共用。 */
  id: string;
  providers: string[];
  /** 后台当前显示名称（模型显示名称映射，未配置时为模型 ID）。 */
  displayName: string;
};

export type CanvasNicknameRows = Record<CanvasNicknameGroup, CanvasNicknameRow[]>;

export type CanvasNicknamesSnapshot = {
  rows: CanvasNicknameRows;
  nicknames: Record<string, string>;
};

const groupModels: Record<CanvasNicknameGroup, keyof AiModelsResponse> = {
  image: "image_models",
  video: "video_models",
  audio: "audio_models",
};

export function canvasNicknameRows(catalog: AiModelsResponse): CanvasNicknameRows {
  const labels = catalog.model_labels || {};
  const providerNames = catalog.model_provider_names || {};
  const rows = {} as CanvasNicknameRows;
  for (const [group] of canvasNicknameGroups) {
    const byId = new Map<string, CanvasNicknameRow>();
    const selectors = normalizeModelList(catalog[groupModels[group]] as AiModelsResponse["models"]);
    for (const selector of selectors) {
      const id = modelName(selector);
      if (!id || (group === "image" && isHiddenImageModel(selector))) continue;
      const row = byId.get(id) || { id, providers: [], displayName: "" };
      const provider = providerNames[selector]?.trim();
      if (provider && !row.providers.includes(provider)) row.providers.push(provider);
      if (!row.displayName || labels[selector]?.trim()) row.displayName = modelDisplayName(selector, labels);
      byId.set(id, row);
    }
    rows[group] = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  return rows;
}

export function normalizeCanvasNicknames(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([id, nickname]) => [id.trim(), typeof nickname === "string" ? nickname.trim() : ""])
    .filter(([id, nickname]) => id && nickname));
}

/** 草稿含全部已保存别名；不在当前目录中的模型也原样保留。 */
export function changedCanvasNicknameCount(draft: Record<string, string>, saved: Record<string, string>) {
  const ids = new Set([...Object.keys(draft), ...Object.keys(saved)]);
  return [...ids].filter(id => (draft[id] || "").trim() !== (saved[id] || "")).length;
}

export function parseCanvasNicknameDraft(draft: Record<string, string>) {
  const value: Record<string, string> = {};
  for (const [id, raw] of Object.entries(draft)) {
    const nickname = raw.trim();
    if (!nickname) continue;
    if (Array.from(nickname).length > MAX_CANVAS_NICKNAME_LENGTH) {
      throw new Error(`${id} 的别名不能超过 ${MAX_CANVAS_NICKNAME_LENGTH} 个字符。`);
    }
    value[id] = nickname;
  }
  return value;
}
