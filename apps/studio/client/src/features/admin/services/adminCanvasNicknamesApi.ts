// [画布别名] 读取模型目录与别名配置、保存别名。
import type { AiModelsResponse } from "@/entities/model";
import { request } from "@/shared/api/http";
import {
  CANVAS_NICKNAMES_CONFIG_KEY,
  canvasNicknameRows,
  normalizeCanvasNicknames,
  type CanvasNicknamesSnapshot,
} from "../model/canvasNicknames";
import { listAdminBillingConfigs, updateAdminBillingConfig } from "./adminMemberApi";

export async function fetchAdminCanvasNicknames(): Promise<CanvasNicknamesSnapshot> {
  const [configs, catalog] = await Promise.all([
    listAdminBillingConfigs(),
    request<AiModelsResponse>("/api/ai/models"),
  ]);
  return {
    rows: canvasNicknameRows(catalog),
    nicknames: normalizeCanvasNicknames(configs.find(config => config.key === CANVAS_NICKNAMES_CONFIG_KEY)?.value),
  };
}

export function saveAdminCanvasNicknames(value: Record<string, string>) {
  return updateAdminBillingConfig(CANVAS_NICKNAMES_CONFIG_KEY, value);
}
